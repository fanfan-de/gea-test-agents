import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  config,
  jiti,
  loadTestEnvironment,
  projectDirectory,
} from "./provider-environment.mjs";
import { signInStudio } from "../computer-contract/scripts/studio-client.mjs";

const {
  ensureAppServerService,
  readAppServerStatus,
  reloadAppServerDevice,
  stopAppServer,
} = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/app-server-client.ts",
  ),
);
const { readGeaLocalDevice, writeGeaLocalDevice, deleteGeaLocalDevice } =
  await jiti.import(
    path.join(config.sourceRoot, "packages/local/src/store/index.ts"),
  );
const test = await loadTestEnvironment();
const projectRoot = await realpath(projectDirectory("device"));
const isolatedRoot = path.join(test.directory, "device");
const configDir = path.join(isolatedRoot, "config");
const appServerDirectory = path.join(isolatedRoot, "app-server");
const outputDirectory = path.join(projectRoot, ".local");
const metadataFile = path.join(outputDirectory, "device.json");
const environment = {
  ...test.childEnvironment,
  GEA_CONFIG_DIR: configDir,
  GEA_APP_SERVER_STATE_DIR: appServerDirectory,
};
const action = process.argv[2] ?? "start";
await Promise.all(
  [configDir, appServerDirectory, outputDirectory].map((directory) =>
    mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
);
if (
  test.settings.organization !== "local-test" ||
  new URL(test.environment.APP_BASE_URL).protocol !== "http:" ||
  new URL(test.environment.APP_BASE_URL).hostname !== "musegea.localhost"
)
  throw new Error(
    "Device registration is limited to the local-test organization on the local test platform.",
  );
const baseUrl = "http://127.0.0.1:" + test.settings.webPort;
const { client } = await signInStudio();
function assertPairing(device) {
  if (
    device.authorizedRoot !== projectRoot ||
    device.baseUrl !== baseUrl ||
    device.orgSlug !== test.settings.organization
  )
    throw new Error(
      "The saved device does not belong to this isolated test environment.",
    );
  return device;
}
async function saveMetadata(device, status) {
  const summary = {
    provider: "device",
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    authorizedRoot: device.authorizedRoot,
    baseUrl,
    organization: device.orgSlug,
    sourceRoot: config.sourceRoot,
    configDir,
    appServerDirectory,
    state: status?.state ?? "disconnected",
    bindingReady: status?.state === "connected",
    lastError: status?.lastError ?? null,
  };
  await writeFile(metadataFile, JSON.stringify(summary, null, 2), {
    mode: 0o600,
  });
  return { ...summary, metadataFile };
}
async function main() {
  if (action === "stop") {
    const pairing = await readGeaLocalDevice(configDir);
    await stopAppServer(environment);
    if (pairing) {
      assertPairing(pairing);
      await client.devices.revoke({ id: pairing.deviceId });
      await deleteGeaLocalDevice(configDir);
    }
    await rm(metadataFile, { force: true });
    return { provider: "device", state: "stopped", revoked: Boolean(pairing) };
  }
  let device = await readGeaLocalDevice(configDir);
  if (device) assertPairing(device);
  if (action === "status") {
    if (!device) return { provider: "device", state: "unpaired" };
    const server = await readAppServerStatus(environment);
    return saveMetadata(device, server.running ? server.device : null);
  }
  if (!["start", "pair"].includes(action))
    throw new Error("Use device-session.mjs start|status|stop.");
  if (!device) {
    const registered = await client.devices.register({
      name: "ComputerDeviceProviderLocalTest",
    });
    device = {
      version: 1,
      authorizedRoot: projectRoot,
      baseUrl,
      deviceId: registered.device.id,
      deviceName: registered.device.name,
      orgSlug: test.settings.organization,
      pairedAt: new Date().toISOString(),
      token: registered.token,
    };
    await writeGeaLocalDevice(configDir, device);
    await saveMetadata(device, null);
  }
  await ensureAppServerService(environment);
  await reloadAppServerDevice(environment);
  for (const deadline = Date.now() + 30000; ; await delay(250)) {
    const server = await readAppServerStatus(environment);
    const status = server.running ? server.device : null;
    if (status?.state === "connected") {
      const devices = await client.devices.list({});
      const owned = devices.find((value) => value.id === device.deviceId);
      if (owned?.online) return saveMetadata(device, status);
    }
    if (status?.state === "revoked" || Date.now() > deadline) {
      const summary = await saveMetadata(device, status);
      await stopAppServer(environment);
      throw new Error(
        "The isolated device relay did not connect: " +
          (summary.lastError ?? summary.state) +
          ". Metadata: " +
          metadataFile,
      );
    }
  }
}
try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  if (["start", "pair"].includes(action))
    await stopAppServer(environment).catch(() => undefined);
  console.error(
    error instanceof Error ? error.message : "The isolated device test failed.",
  );
  process.exitCode = 1;
}
