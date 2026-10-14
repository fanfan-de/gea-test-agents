import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  jiti,
  config,
  projectDirectory,
  loadTestEnvironment,
} from "./provider-environment.mjs";
import { signInStudio } from "../computer-contract/scripts/studio-client.mjs";

const provider = process.argv[2];
const cwd = projectDirectory(provider);
const { settings, remoteToken } = await loadTestEnvironment();
const { buildAgentPackageUploadArtifact } = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/project.ts",
  ),
);
const { getAgentPackageFileContentType } = await jiti.import(
  path.join(
    config.sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/index.ts",
  ),
);
const { client } = await signInStudio();
const projectSlug = "computer-" + provider + "-tests";
const projects = await client.studioProjects.list({});
let project = projects.find(
  (item) => item.project.slug === projectSlug,
)?.project;
if (!project)
  project = await client.studioProjects.create({
    name: "Computer " + provider + " 测试",
    slug: projectSlug,
    description:
      "独立 " + provider + " Computer provider 验收，无飞书渠道或连接。",
  });
const artifact = await buildAgentPackageUploadArtifact({ cwd });
const byPath = new Map(artifact.files.map((file) => [file.path, file]));
const deploymentFiles = artifact.manifest.workerManifest.files.map(
  (descriptor) => {
    const file = byPath.get(descriptor.path);
    if (!file) throw new Error("Missing Worker file " + descriptor.path);
    return file;
  },
);
const files = deploymentFiles.map((file) => ({
  path: file.path,
  contentType: getAgentPackageFileContentType(file.path),
  checksumMd5Base64: createHash("md5").update(file.content).digest("base64"),
}));
const name = "computer-" + provider + "-test";
const plan = await client.workers.createDeploymentUpload({
  agentApplication: artifact.manifest.agentApplication,
  files,
  manifest: artifact.manifest.workerManifest,
  name,
  studioProjectSlug: projectSlug,
});
for (const file of deploymentFiles) {
  const target = plan.files.find((entry) => entry.path === file.path);
  if (!target) throw new Error("Missing upload target " + file.path);
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.uploadHeaders,
    body: file.content,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error("Upload failed for " + file.path + ": " + response.status);
}
const deployment = await client.workers.completeDeploymentUpload({
  agentApplication: artifact.manifest.agentApplication,
  deploymentId: plan.deploymentId,
  workerId: plan.workerId,
  keyPrefix: plan.keyPrefix,
  files,
  manifest: artifact.manifest.workerManifest,
  name,
  studioProjectSlug: projectSlug,
});
const inspection = await client.studioProjects.inspect({
  projectId: project.id,
});
const agent = inspection.agents.find((entry) => entry.slug === name);
if (!agent) throw new Error("Agent was not registered: " + name);
if (provider === "remote") {
  const existing = await client.studioAgents.getEnvironmentVariables({
    agentId: agent.id,
  });
  const variable = existing.variables.find(
    (entry) =>
      entry.name === "COMPUTER_REMOTE_TOKEN" &&
      entry.configured &&
      entry.environments.includes("preview"),
  );
  await client.studioAgents.mutateEnvironmentVariables({
    agentId: agent.id,
    agentVersionId: existing.agentVersionId,
    operation: variable
      ? {
          type: "update",
          current: { name: variable.name, environments: variable.environments },
          environments: ["preview"],
          name: variable.name,
          secret: true,
          value: remoteToken,
        }
      : {
          type: "create",
          environments: ["preview"],
          secret: true,
          variables: [{ name: "COMPUTER_REMOTE_TOKEN", value: remoteToken }],
        },
  });
}
const ready = {
  provider,
  projectId: project.id,
  agentId: agent.id,
  agentName: agent.name,
  deploymentId: deployment.deploymentId ?? plan.deploymentId,
  workerId: plan.workerId,
  studioUrl:
    "http://" +
    settings.organization +
    ".musegea.localhost:" +
    settings.webPort +
    "/studio/" +
    settings.workspace +
    "/agents/" +
    agent.id,
};
await mkdir(path.join(cwd, ".local"), { recursive: true });
await writeFile(
  path.join(cwd, ".local/ready.json"),
  JSON.stringify(ready, null, 2),
);
console.log(JSON.stringify(ready, null, 2));
if (provider === "local")
  console.log(
    "Registered in Studio Preview. localComputer execution requires the authorized local App Server; use providers.ps1 dev -Provider local.",
  );
if (provider === "e2b")
  console.log(
    "Registered in Studio Preview. E2B execution requires E2B_API_KEY; live acceptance remains skipped by user request.",
  );
