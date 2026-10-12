import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const settings = z
  .object({
    sourceRoot: z.string().min(1),
    webEnvironmentFile: z.string().min(1),
    loginFile: z.string().min(1),
    databaseName: z.string().regex(/^[a-z][a-z0-9_]*$/),
    stateDirectory: z.string().regex(/^[a-z][a-z0-9-]*$/),
    rustTargetRoot: z.string().min(1),
    workerBinary: z.string().min(1),
    webPort: z.number().int().min(3000).max(65535),
    runtimePort: z.number().int().min(1).max(65535),
    agentApiPort: z.number().int().min(1).max(65535),
    computerPort: z.number().int().min(1).max(65535),
    organization: z.string().min(1),
    workspace: z.string().min(1),
    projectSlug: z.string().min(1),
  })
  .parse(
    JSON.parse(
      await readFile(
        new URL("../local-test.config.json", import.meta.url),
        "utf8",
      ),
    ),
  );
export const stateRoot = path.join(
  homedir(),
  ".local/share",
  settings.stateDirectory,
);
await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const secretFile = path.join(stateRoot, "secrets.json");
let stored;
try {
  stored = await readFile(secretFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  stored = JSON.stringify({
    computerToken: randomBytes(32).toString("hex"),
    platformSecret: randomBytes(32).toString("hex"),
    peerSecret: randomBytes(32).toString("hex"),
  });
  await writeFile(secretFile, stored, { mode: 0o600, flag: "wx" });
}
const secrets = z
  .object({
    computerToken: z.string().min(32),
    platformSecret: z.string().min(32),
    peerSecret: z.string().min(32),
  })
  .parse(JSON.parse(stored));
const platform = parseEnv(await readFile(settings.webEnvironmentFile, "utf8"));
export const environment = createEnv({
  server: {
    APP_BASE_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    WORKER_RUNTIME_URL: z.url(),
    WORKER_PLATFORM_HOST_SHARED_SECRET: z.string().min(32),
    WORKER_RUNTIME_PEER_SECRET: z.string().min(32),
    GEA_AGENT_API_URL: z.url(),
    GEA_AGENT_API_HOST_SECRET: z.string().min(32),
    AGENT_COMPUTER_SERVICE_URL: z.url(),
    AGENT_COMPUTER_SERVICE_SHARED_SECRET: z.string().min(32),
    S3_BUCKET: z.string().min(1),
    S3_ENDPOINT_URL: z.url(),
    S3_REGION: z.string().min(1),
  },
  runtimeEnv: {
    ...platform,
    DATABASE_URL: (() => {
      const url = new URL(platform.DATABASE_URL);
      url.pathname = `/${settings.databaseName}`;
      return url.toString();
    })(),
    APP_BASE_URL: `http://musegea.localhost:${settings.webPort}`,
    WORKER_RUNTIME_URL: `http://127.0.0.1:${settings.runtimePort}`,
    WORKER_PLATFORM_HOST_SHARED_SECRET: secrets.platformSecret,
    WORKER_RUNTIME_PEER_SECRET: secrets.peerSecret,
    AGENT_COMPUTER_SERVICE_URL: `http://127.0.0.1:${settings.computerPort}`,
    AGENT_COMPUTER_SERVICE_SHARED_SECRET: secrets.computerToken,
    GEA_AGENT_API_URL: `http://127.0.0.1:${settings.agentApiPort}`,
    GEA_AGENT_API_HOST_SECRET: secrets.peerSecret,
  },
});
export const childEnvironment = {
  ...process.env,
  ...platform,
  ...environment,
  NODE_ENV: "development",
  SYSTEM_CONFIG_PATH: path.join(
    settings.sourceRoot,
    "config/system.development.yaml",
  ),
  AGENT_FILESYSTEM_ROOT: path.join(stateRoot, "agent-filesystems"),
  TABLE_DATA_ROOT: path.join(stateRoot, "tables"),
  AGENT_ENTRYPOINT: "real",
  FEISHU_LARK_CLI_BIN: "/usr/local/bin/gea-lark-cli",
  AGENT_COMPUTER_FILESYSTEM_MODE: "hybrid",
  AGENT_COMPUTER_REQUIRE_SHARED_POSIX: "false",
  AGENT_COMPUTER_LISTEN_ADDR: `127.0.0.1:${settings.computerPort}`,
  TABLE_DUCKDB_EXTENSION_DIRECTORY: path.join(stateRoot, "duckdb-extensions"),
  WORKER_PLATFORM_HOST_URL: `http://127.0.0.1:${settings.webPort}`,
  WORKER_PLATFORM_CALLBACK_URL: `http://127.0.0.1:${settings.webPort}`,
  WORKER_RUNTIME_SYSTEM_WORKER_ROOT: path.join(
    settings.sourceRoot,
    "crates/worker-runtime/system-workers",
  ),
};
Object.assign(process.env, childEnvironment);
