import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  config,
  jiti,
  loadTestEnvironment,
  projectDirectory,
  sourceRequire,
} from "./provider-environment.mjs";

const { z } = sourceRequire("zod");
const { appServerCommandSchema, appServerResultSchema } = await jiti.import(
  path.join(config.sourceRoot, "packages/contract/src/app-server.ts"),
);
const { agentProjectServiceStatusSchema } = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/local-backend/src/commands/agent-packages/project-service.ts",
  ),
);
const { appServerServiceRecordSchema } = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/local-backend/src/commands/agent-packages/app-server-service.ts",
  ),
);
const test = await loadTestEnvironment();
const projectRoot = projectDirectory("local");
const isolatedRoot = path.join(test.directory, "local");
const configDir = path.join(isolatedRoot, "config");
const appServerDirectory = path.join(isolatedRoot, "app-server");
const outputDirectory = path.join(projectRoot, ".local");
const metadataFile = path.join(outputDirectory, "session.json");
const environment = {
  ...test.childEnvironment,
  GEA_CONFIG_DIR: configDir,
  GEA_APP_SERVER_STATE_DIR: appServerDirectory,
};
const jitiCommand = path.join(
  path.dirname(sourceRequire.resolve("jiti/package.json")),
  "lib/jiti-cli.mjs",
);
const bin = path.join(config.sourceRoot, "packages/gea-cli/src/bin.ts");
const parsed = parseArgs({
  allowPositionals: true,
  options: { prompt: { type: "string" }, session: { type: "string" } },
});
const action = parsed.positionals[0] ?? "start";
const metadataSchema = z
  .object({
    provider: z.literal("local"),
    projectRoot: z.string(),
    sourceRoot: z.string(),
    configDir: z.string(),
    appServerDirectory: z.string(),
    projectId: z.string(),
    agentKey: z.string(),
    url: z.url(),
    apiUrl: z.url(),
  })
  .strict();
await Promise.all(
  [configDir, appServerDirectory, outputDirectory].map((directory) =>
    mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);

async function cli(command, input) {
  const log = await open(
    path.join(outputDirectory, "local-session.log"),
    "a",
    0o600,
  );
  const child = spawn(
    process.execPath,
    [
      jitiCommand,
      bin,
      ...command,
      ...(input ? ["--json", JSON.stringify(input)] : []),
    ],
    {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", log.fd],
    },
  );
  await log.close();
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(
      "The isolated local CLI failed; see computer-local/.local/local-session.log.",
    );
  return JSON.parse(stdout);
}
async function metadata() {
  const value = metadataSchema.parse(
    JSON.parse(await readFile(metadataFile, "utf8")),
  );
  if (
    value.projectRoot !== projectRoot ||
    value.sourceRoot !== config.sourceRoot ||
    value.configDir !== configDir ||
    value.appServerDirectory !== appServerDirectory
  )
    throw new Error(
      "Local metadata does not belong to this isolated test environment.",
    );
  return value;
}
async function service() {
  return appServerServiceRecordSchema.parse(
    JSON.parse(
      await readFile(path.join(appServerDirectory, "service.json"), "utf8"),
    ),
  );
}
async function request(record, route, schema, body) {
  const response = await fetch(new URL(route, "http://" + record.address), {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + record.token,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(
      "Isolated local management " +
        route +
        " returned HTTP " +
        response.status +
        ".",
    );
  return schema.parse(await response.json());
}
async function projectStatus(record, saved) {
  return request(
    record,
    "/v1/projects/" + saved.projectId + "/status",
    agentProjectServiceStatusSchema,
  );
}
async function business(record, saved, command) {
  return request(
    record,
    "/v1/projects/" + saved.projectId + "/business/execute",
    appServerResultSchema,
    appServerCommandSchema.parse(command),
  );
}
async function freePort(start) {
  for (let port = start; port <= 65535; port++) {
    const server = net.createServer();
    const available = await new Promise((resolve, reject) => {
      server.once("error", (error) =>
        error.code === "EADDRINUSE" ? resolve(false) : reject(error),
      );
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (available) {
      await new Promise((resolve) => server.close(resolve));
      return port;
    }
  }
  throw new Error("No local test port is available.");
}
async function stop() {
  const stopped = await cli(["app-server", "stop"]);
  await rm(metadataFile, { force: true });
  await writeFile(
    path.join(outputDirectory, "stopped.json"),
    JSON.stringify({ provider: "local", stopped }),
    { mode: 0o600 },
  );
  return { provider: "local", status: "stopped" };
}
async function createSession(record, saved, ready) {
  if (!ready.scope)
    throw new Error("The local project has no authorized management scope.");
  const created = await business(record, saved, {
    operation: "session.create",
    scope: ready.scope,
    requestId: randomUUID(),
    agentId: saved.agentKey,
    environment: "local",
    title: "Computer local provider test",
    workingDirectory: projectRoot,
  });
  if (created.type !== "session")
    throw new Error("The local Session create response is invalid.");
  return created.session.id;
}
async function main() {
  if (action === "stop") return stop();
  if (action === "start") {
    if (existsSync(metadataFile)) {
      const saved = await metadata();
      const record = await service();
      const ready = await projectStatus(record, saved);
      if (ready.phase !== "ready")
        throw new Error(
          "The existing local test project is not ready; stop it before starting again.",
        );
      return { ...saved, status: "ready", reused: true, metadataFile };
    }
    if (
      !environment.LLM_MODEL_CATALOG_JSON &&
      !environment.CREATIVE_REASONING_API_KEY
    )
      throw new Error(
        "The local test environment has no real model configuration.",
      );
    const launch = z
      .object({
        cwd: z.string(),
        localComputer: z.literal("sandbox"),
        sandboxdPath: z.string(),
        bubblewrapPath: z.string(),
      })
      .strict()
      .parse(
        JSON.parse(
          await readFile(path.join(projectRoot, "local.config.json"), "utf8"),
        ),
      );
    if (launch.cwd !== projectRoot)
      throw new Error("The local launch root is not this test project.");
    const port = await freePort(3000);
    const apiPort = await freePort(port + 1);
    const started = z
      .object({
        status: z.literal("running"),
        url: z.url(),
        apiUrl: z.url(),
        projectId: z.string(),
      })
      .parse(
        await cli(["agent", "dev"], {
          ...launch,
          modelSource: "local",
          vite: false,
          background: true,
          port,
          apiPort,
        }),
      );
    const saved = {
      provider: "local",
      projectRoot,
      sourceRoot: config.sourceRoot,
      configDir,
      appServerDirectory,
      projectId: started.projectId,
      agentKey: "",
      url: started.url,
      apiUrl: started.apiUrl,
    };
    const record = await service();
    const ready = await projectStatus(record, saved);
    if (ready.phase !== "ready" || !ready.build?.agents.length)
      throw new Error("The local project did not become ready.");
    saved.agentKey = ready.build.agents[0].key;
    await writeFile(metadataFile, JSON.stringify(saved, null, 2), {
      mode: 0o600,
    });
    return { provider: "local", status: "ready", ...saved, metadataFile };
  }
  const saved = await metadata();
  const record = await service();
  const ready = await projectStatus(record, saved);
  if (action === "status")
    return {
      provider: "local",
      status: ready.phase,
      projectId: saved.projectId,
      apiUrl: saved.apiUrl,
      metadataFile,
    };
  if (action === "create") {
    const sessionId = await createSession(record, saved, ready);
    return { provider: "local", status: "created", sessionId };
  }
  if (action !== "run")
    throw new Error("Use local-session.mjs start|status|create|run|stop.");
  const prompt = z.string().trim().min(1).parse(parsed.values.prompt);
  const sessionId =
    parsed.values.session ?? (await createSession(record, saved, ready));
  if (!ready.scope)
    throw new Error("The local project has no authorized management scope.");
  const accepted = await business(record, saved, {
    operation: "run.start",
    scope: ready.scope,
    sessionId,
    requestId: randomUUID(),
    message: {
      id: randomUUID(),
      role: "user",
      parts: [{ type: "text", text: prompt }],
    },
  });
  if (accepted.type !== "run")
    throw new Error("The local Run start response is invalid.");
  for (const deadline = Date.now() + 180000; ; await delay(250)) {
    const response = await business(record, saved, {
      operation: "session.get",
      scope: ready.scope,
      sessionId,
      messageAfter: 0,
    });
    if (response.type !== "snapshot")
      throw new Error("The local Session response is invalid.");
    const snapshot = response.snapshot;
    if (
      snapshot.run &&
      ["finished", "error", "aborted", "interrupted", "waiting"].includes(
        snapshot.run.status,
      )
    ) {
      const resultFile = path.join(
        outputDirectory,
        "run-" + accepted.run.id + ".json",
      );
      await writeFile(
        resultFile,
        JSON.stringify(
          { provider: "local", sessionId, runId: accepted.run.id, snapshot },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      return {
        provider: "local",
        status: snapshot.run.status,
        sessionId,
        runId: accepted.run.id,
        resultFile,
      };
    }
    if (Date.now() > deadline)
      throw new Error("The local test Run did not finish in 180 seconds.");
  }
}
try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  if (action === "start") await stop().catch(() => undefined);
  console.error(
    error instanceof Error ? error.message : "The isolated local test failed.",
  );
  process.exitCode = 1;
}
