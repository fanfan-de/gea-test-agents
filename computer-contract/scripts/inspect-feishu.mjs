import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./environment.mjs";
import { signInStudio } from "./studio-client.mjs";

const ready = JSON.parse(
  await readFile(path.join(projectRoot, ".local/ready.json"), "utf8"),
);
const { client } = await signInStudio();
const [inspection, variables, channels, configuration] = await Promise.all([
  client.studioAgents.inspect({ agentId: ready.agentId }),
  client.studioAgents.getEnvironmentVariables({ agentId: ready.agentId }),
  client.agentChannels.list({ agentId: ready.agentId, environment: "preview" }),
  client.studioAgents.getEnvironment({
    agentId: ready.agentId,
    connectionScope: "agent",
    environment: "preview",
  }),
]);
const extension = inspection.dependencies.extensionMounts.find(
  (mount) => mount.id === "@gea-ai/agent-extension-feishu",
);
assert.ok(extension, "Published Feishu Extension is missing.");
assert.ok(
  extension.contributions.skills.some(
    (skill) =>
      skill.runtimeName === "feishu__lark-cli" && skill.status === "active",
  ),
  "Published Feishu Skill is missing.",
);
for (const name of [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_ALLOWED_SENDERS",
]) {
  assert.ok(variables.variables.some((variable) => variable.name === name));
}
const allowedSenders = variables.variables.find(
  (variable) => variable.name === "FEISHU_ALLOWED_SENDERS",
);
if (
  !allowedSenders.effectiveEnvironments.some(
    (target) => target.environment === "preview" && target.configured,
  )
) {
  await client.studioAgents.mutateEnvironmentVariables({
    agentId: ready.agentId,
    agentVersionId: variables.agentVersionId,
    operation: {
      type: "create",
      environments: ["preview"],
      secret: false,
      variables: [{ name: "FEISHU_ALLOWED_SENDERS", value: "[]" }],
    },
  });
}
const installation = channels.installations.find(
  (item) => item.channelKey === "feishu-bot",
);
assert.ok(installation, "Published Feishu Channel installation is missing.");
const receiver = await client.agentChannels.getReceiver({
  installationId: installation.installationId,
});
const report = {
  deployed: true,
  agentId: ready.agentId,
  deploymentId: ready.deploymentId,
  version: inspection.latestVersion.versionNumber,
  extension: "@gea-ai/agent-extension-feishu",
  connectors: configuration.connectors.map((connector) => ({
    alias: connector.alias,
    key: connector.connectorKey,
    configured: connector.configured,
    status: connector.status,
  })),
  channel: {
    key: installation.channelKey,
    installationId: installation.installationId,
    state: receiver.state,
    errorCode: receiver.lastError?.code ?? null,
    missingVariables: receiver.lastError?.missingVariables ?? [],
  },
  urls: {
    environment: `${ready.studioUrl}?environment=preview&view=environment`,
    channels: `${ready.studioUrl}?environment=preview&view=channels`,
    connections: `${ready.studioUrl}?environment=preview&view=connections`,
    playground: `${ready.studioUrl}?environment=preview&view=playground`,
  },
};
await writeFile(
  path.join(projectRoot, ".local/feishu-deployment.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
