import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const config = JSON.parse(
  await readFile(path.join(root, "computer-providers.config.json"), "utf8"),
);
export const providers = config.providers;
export const sourceRequire = createRequire(
  path.join(config.sourceRoot, "packages/gea-cli/package.json"),
);
export const jiti = sourceRequire("jiti").createJiti(import.meta.url);
export function projectDirectory(provider) {
  if (!providers.includes(provider))
    throw new Error("Unknown Computer provider: " + provider);
  return path.join(root, "computer-" + provider);
}
export async function loadTestEnvironment() {
  const base = await import("../computer-contract/scripts/environment.mjs");
  const { z } = sourceRequire("zod");
  const directory = path.join(base.stateRoot, "computer-providers");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretPath = path.join(directory, "secrets.json");
  let stored;
  try {
    stored = JSON.parse(await readFile(secretPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    stored = { remoteToken: randomBytes(32).toString("hex") };
    await writeFile(secretPath, JSON.stringify(stored), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const secrets = z
    .object({ remoteToken: z.string().min(32) })
    .strict()
    .parse(stored);
  const childEnvironment = {
    ...base.childEnvironment,
    GEA_WORKER_RUNTIME_BINARY: path.join(
      config.nativeTargetRoot,
      "debug/gea-worker-runtime",
    ),
    GEA_APP_SERVER_BINARY: path.join(
      config.nativeTargetRoot,
      "debug/gea-app-server",
    ),
    GEA_CONFIG_DIR: path.join(directory, "cli-config"),
    GEA_APP_SERVER_STATE_DIR: path.join(directory, "app-server"),
    COMPUTER_REMOTE_TOKEN: secrets.remoteToken,
  };
  return {
    ...base,
    childEnvironment,
    directory,
    remoteToken: secrets.remoteToken,
  };
}
