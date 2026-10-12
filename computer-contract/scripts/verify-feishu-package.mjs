import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { sourceRoot } = z
  .object({ sourceRoot: z.string().min(1) })
  .parse(
    JSON.parse(
      await readFile(
        new URL("../local-test.config.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const require = createRequire(
  path.join(sourceRoot, "packages/gea-cli/package.json"),
);
const jiti = require("jiti").createJiti(import.meta.url);
const { buildAgentPackageUploadArtifact } = await jiti.import(
  path.join(
    sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/project.ts",
  ),
);
const { agentApplicationArtifactManifestSchema } = await jiti.import(
  path.join(sourceRoot, "packages/contract/src/agent-package-artifacts.ts"),
);
const { agentPackageSnapshotSchema } = await jiti.import(
  path.join(sourceRoot, "packages/contract/src/agent-packages.ts"),
);

const artifact = await buildAgentPackageUploadArtifact({ cwd: projectRoot });
const manifest = agentApplicationArtifactManifestSchema.parse(
  artifact.manifest,
);
const agent = manifest.agentApplication.agents.find(
  (entry) => entry.key === "computer-contract-local",
);
assert.ok(agent, "Packaged computer-contract-local Agent is missing.");
const snapshotFile = artifact.files.find(
  (file) => file.path === agent.snapshotPath,
);
assert.ok(snapshotFile, "Packaged Agent snapshot file is missing.");
assert.equal(
  `sha256:${createHash("sha256").update(snapshotFile.content).digest("hex")}`,
  agent.snapshotHash,
  "Packaged snapshot must match its manifest hash.",
);
const snapshot = agentPackageSnapshotSchema.parse(
  JSON.parse(snapshotFile.content.toString("utf8")),
);
const extension = snapshot.extensionMounts?.find(
  (mount) => mount.id === "@gea-ai/agent-extension-feishu",
);
assert.ok(extension, "Feishu Extension is not mounted in the packaged Agent.");
assert.equal(extension.name, "Feishu");
assert.equal(extension.namespace, "feishu");
assert.ok(extension.instructionCount > 0, "Feishu instructions are missing.");
assert.deepEqual(extension.contributions.channels, [
  { logicalName: "bot", runtimeName: "feishu-bot", status: "active" },
]);

const channel = snapshot.channels.find((entry) => entry.key === "feishu-bot");
assert.ok(channel, "Packaged Feishu bot Channel is missing.");
assert.equal(channel.path, `/channels/${agent.key}/feishu/bot`);
assert.deepEqual(channel.receiver, { kind: "websocket", version: 1 });
assert.deepEqual(channel.routes, []);
assert.ok(channel.networkHosts.includes("*.feishu.cn"));
const environment = snapshot.environment.filter((entry) =>
  entry.name.startsWith("FEISHU_"),
);
assert.deepEqual(environment, [
  { name: "FEISHU_ALLOWED_SENDERS", secret: false },
  { name: "FEISHU_APP_ID", secret: false },
  { name: "FEISHU_APP_SECRET", secret: true },
]);

const connector = snapshot.connectors.find(
  (entry) =>
    entry.definition.key === "feishu" &&
    entry.definition.runtime.type === "native" &&
    entry.definition.runtime.provider === "feishu",
);
assert.ok(connector, "Packaged native Feishu Connector is missing.");
assert.equal(connector.definition.name, "Feishu");
assert.ok(
  connector.definition.operations.some(
    (operation) => operation.name === "call",
  ),
  "Native Feishu Connector must expose call.",
);
assert.deepEqual(connector.allowedCallers, ["direct"]);
assert.deepEqual(extension.contributions.connectors, [
  { logicalName: "api", runtimeName: connector.alias, status: "active" },
]);

assert.deepEqual(extension.contributions.skills, [
  {
    logicalName: "lark-cli",
    runtimeName: "feishu__lark-cli",
    status: "active",
  },
]);
const skill = snapshot.skills.find(
  (entry) =>
    entry.type === "local" &&
    entry.path === "extensions/feishu/skills/feishu__lark-cli",
);
assert.ok(skill, "Packaged feishu__lark-cli Skill snapshot is missing.");
const skillPath = `source/${skill.path}/SKILL.md`;
const skillFile = artifact.files.find((file) => file.path === skillPath);
assert.ok(skillFile, "Packaged Feishu Skill resource is missing.");
assert.equal(skillFile.role, "skill");
assert.ok(skillFile.content.byteLength > 0, "Packaged Feishu Skill is empty.");
const skillDescriptor = manifest.files.find((file) => file.path === skillPath);
assert.ok(
  skillDescriptor,
  "Feishu Skill is missing from the artifact manifest.",
);
assert.equal(skillDescriptor.role, "skill");
assert.equal(
  skillDescriptor.sha256,
  `sha256:${createHash("sha256").update(skillFile.content).digest("hex")}`,
);
assert.ok(
  manifest.workerManifest.requiredCapabilities.includes("channel-receiver-v1"),
  "Worker must require managed Channel receivers.",
);
assert.ok(
  manifest.workerManifest.durableObjectBindings.some(
    (binding) =>
      binding.name === "CHANNEL_RECEIVERS" &&
      binding.className === "ChannelReceiverDO",
  ),
  "Worker ChannelReceiverDO binding is missing.",
);

console.log(
  JSON.stringify({
    verified: true,
    agent: agent.key,
    extension: extension.id,
    channel: channel.key,
    transport: channel.receiver.kind,
    environment,
    connector: connector.alias,
    skill: "feishu__lark-cli",
  }),
);
