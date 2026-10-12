import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  childEnvironment,
  environment,
  settings,
  stateRoot,
} from "./environment.mjs";

const statusFile = path.join(stateRoot, "status.json");
let previous;
try {
  previous = z
    .object({
      running: z.boolean(),
      pid: z.number().int().positive(),
      studioUrl: z.url().optional(),
    })
    .parse(JSON.parse(await readFile(statusFile, "utf8")));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let alreadyRunning = false;
if (previous?.running) {
  try {
    const command = await readFile(`/proc/${previous.pid}/cmdline`, "utf8");
    alreadyRunning = command.split("\0").includes("scripts/run-local.mjs");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (alreadyRunning || process.argv.includes("--status")) {
  console.log(
    alreadyRunning
      ? `服务已运行：${previous.studioUrl}`
      : "本测试服务尚未运行。",
  );
  process.exit(alreadyRunning ? 0 : 1);
}
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const exits = children
    .filter(
      (child) =>
        child.pid && child.exitCode === null && child.signalCode === null,
    )
    .map((child) => {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      return exited;
    });
  await Promise.all(exits);
  await writeFile(
    statusFile,
    JSON.stringify({ running: false, pid: process.pid }),
  );
  process.exit(code);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
function start(name, command, args, cwd, env) {
  const log = openSync(path.join(stateRoot, `${name}.log`), "a", 0o600);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`${name}: ${error.message}`);
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`${name} exited: ${code}`);
      void stop(1);
    }
  });
  return child;
}
async function waitReady(url, headers) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      /* Child exit handlers report process failures during startup. */
    }
    await delay(1000);
  }
  throw new Error(`Service did not become ready: ${url}`);
}
try {
  await Promise.all([
    mkdir(childEnvironment.AGENT_FILESYSTEM_ROOT, { recursive: true }),
    mkdir(childEnvironment.TABLE_DATA_ROOT, { recursive: true }),
  ]);
  const apiConfigPath = path.join(stateRoot, "agent-api.json");
  await writeFile(
    apiConfigPath,
    JSON.stringify({
      listen: `127.0.0.1:${settings.agentApiPort}`,
      databaseUrl: environment.DATABASE_URL,
      hostUrl: `http://127.0.0.1:${settings.webPort}`,
      hostSecret: environment.GEA_AGENT_API_HOST_SECRET,
    }),
    { mode: 0o600 },
  );
  start(
    "agents-api",
    path.join(settings.rustTargetRoot, "debug/gea-api"),
    [],
    stateRoot,
    {
      ...childEnvironment,
      GEA_AGENT_API_CLOUD_CONFIG: apiConfigPath,
    },
  );
  const prefix = (childEnvironment.OBJECT_STORE_PREFIX ?? "").replace(
    /^\/+|\/+$/g,
    "",
  );
  const runtimeConfigPath = path.join(stateRoot, "worker-runtime.json");
  await writeFile(
    runtimeConfigPath,
    JSON.stringify({
      dataRoot: path.join(stateRoot, "runtime"),
      deploymentStore: {
        bucket: `s3://${environment.S3_BUCKET}${prefix ? `/${prefix}` : ""}`,
        endpoint: environment.S3_ENDPOINT_URL,
        region: environment.S3_REGION,
      },
      deployments: [],
      durableObjects: { mode: "local" },
    }),
    { mode: 0o600 },
  );
  start("worker-runtime", settings.workerBinary, [], stateRoot, {
    ...childEnvironment,
    WORKER_RUNTIME_CONFIG: runtimeConfigPath,
    WORKER_RUNTIME_LISTEN_ADDR: `127.0.0.1:${settings.runtimePort}`,
  });
  const computerRoot = path.join(path.dirname(stateRoot), "ct1010");
  start(
    "computer",
    path.join(settings.rustTargetRoot, "debug/agent-computerd"),
    [
      "serve",
      "--state-root",
      computerRoot,
      "--socket-path",
      path.join(computerRoot, "run/computer.sock"),
      "--mksquashfs-path",
      "/usr/bin/mksquashfs",
      "--unsquashfs-path",
      "/usr/bin/unsquashfs",
      "--bwrap-path",
      "/usr/bin/bwrap",
      "--shim-path",
      path.join(settings.rustTargetRoot, "debug/sandboxd"),
    ],
    stateRoot,
    {
      ...childEnvironment,
      PATH: `${path.join(settings.rustTargetRoot, "debug")}:${childEnvironment.PATH}`,
    },
  );
  const webRoot = path.join(settings.sourceRoot, "packages/web");
  const configRoot = path.join(webRoot, "node_modules/.gea-computer-studio");
  await mkdir(configRoot, { recursive: true });
  await writeFile(
    path.join(configRoot, "package.json"),
    '{"type":"module","private":true}',
  );
  await writeFile(
    path.join(configRoot, "vite.config.ts"),
    'import webConfig from "../../vite.config.ts";\nimport { paraglideCompilerOptions } from "../../../i18n/paraglide.config.js";\nparaglideCompilerOptions.cleanOutdir = false;\nexport default webConfig;\n',
  );
  start(
    "studio-web",
    "pnpm",
    [
      "exec",
      "vp",
      "dev",
      "--config",
      "node_modules/.gea-computer-studio/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(settings.webPort),
      "--strictPort",
    ],
    webRoot,
    childEnvironment,
  );
  const status = {
    running: true,
    pid: process.pid,
    childPids: children.map((child) => child.pid),
    studioUrl: `http://${settings.organization}.musegea.localhost:${settings.webPort}/studio/${settings.workspace}`,
    apexUrl: environment.APP_BASE_URL,
    runtimeUrl: environment.WORKER_RUNTIME_URL,
    agentApiUrl: environment.GEA_AGENT_API_URL,
    computerUrl: environment.AGENT_COMPUTER_SERVICE_URL,
  };
  await writeFile(statusFile, JSON.stringify(status, null, 2));
  await Promise.all([
    waitReady(`${environment.GEA_AGENT_API_URL}/healthz`, {
      "x-gea-agent-api-host": environment.GEA_AGENT_API_HOST_SECRET,
    }),
    waitReady(`${environment.WORKER_RUNTIME_URL}/healthz`),
    waitReady(`${environment.AGENT_COMPUTER_SERVICE_URL}/healthz`),
    waitReady(`http://127.0.0.1:${settings.webPort}/readyz`),
  ]);
  console.log(JSON.stringify(status, null, 2));
  console.log(`Studio ready. Logs: ${stateRoot}`);
} catch (error) {
  console.error(error);
  await stop(1);
}
