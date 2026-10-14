import path from "node:path";
import { writeFile } from "node:fs/promises";
import { config, jiti, loadTestEnvironment } from "./provider-environment.mjs";

const { directory, remoteToken } = await loadTestEnvironment();
const { startRemoteSandboxComputerService } = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/local-backend/src/commands/agent-packages/computer/remote-sandbox.ts",
  ),
);
const service = await startRemoteSandboxComputerService({
  stateRoot: path.join(directory, "remote"),
  token: remoteToken,
  sandboxdPath: path.join(config.nativeTargetRoot, "debug/sandboxd"),
  bubblewrapPath: "/usr/bin/bwrap",
  port: 8791,
});
console.log("Remote Computer ready: " + service.url);
await writeFile(
  path.join(directory, "remote-service.json"),
  JSON.stringify({ pid: process.pid, url: service.url }),
  { mode: 0o600 },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await service.close();
  process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
