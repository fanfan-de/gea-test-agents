import { createHash } from "node:crypto";
import { signInStudio } from "./studio-client.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { projectRoot, settings, stateRoot } from "./environment.mjs";

const require = createRequire(
  path.join(settings.sourceRoot, "packages/gea-cli/package.json"),
);
const jiti = require("jiti").createJiti(import.meta.url);
const { buildAgentPackageUploadArtifact } = await jiti.import(
  path.join(
    settings.sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/project.ts",
  ),
);
const { getAgentPackageFileContentType } = await jiti.import(
  path.join(
    settings.sourceRoot,
    "packages/gea-cli/src/commands/agent-packages/index.ts",
  ),
);
const { client, cookie } = await signInStudio();
const projects = await client.studioProjects.list({});
let project = projects.find(
  (item) => item.project.slug === settings.projectSlug,
)?.project;
if (!project)
  project = await client.studioProjects.create({
    name: "飞书 Extension 测试",
    slug: settings.projectSlug,
    description:
      "当前飞书 Extension 的机器人 Channel、原生 Connector 与 Skill 测试，保留 Computer 辅助工具。",
  });
else if (project.name !== "飞书 Extension 测试") {
  const updated = await client.studioProjects.update({
    projectId: project.id,
    name: "飞书 Extension 测试",
    slug: project.slug,
    description:
      "当前飞书 Extension 的机器人 Channel、原生 Connector 与 Skill 测试，保留 Computer 辅助工具。",
  });
  project = updated.project;
}
console.log(`Studio project: ${project.name} (${project.id})`);
const artifact = await buildAgentPackageUploadArtifact({ cwd: projectRoot });
const artifactFiles = new Map(artifact.files.map((file) => [file.path, file]));
const deploymentFiles = artifact.manifest.workerManifest.files.map(
  (descriptor) => {
    const file = artifactFiles.get(descriptor.path);
    if (!file) throw new Error(`Missing Worker file ${descriptor.path}`);
    return file;
  },
);
const files = deploymentFiles.map((file) => ({
  path: file.path,
  contentType: getAgentPackageFileContentType(file.path),
  checksumMd5Base64: createHash("md5").update(file.content).digest("base64"),
}));
const name = "computer-contract-local-test";
const plan = await client.workers.createDeploymentUpload({
  agentApplication: artifact.manifest.agentApplication,
  files,
  manifest: artifact.manifest.workerManifest,
  name,
  studioProjectSlug: settings.projectSlug,
});
for (const file of deploymentFiles) {
  const target = plan.files.find((item) => item.path === file.path);
  if (!target) throw new Error(`Upload target missing: ${file.path}`);
  const uploaded = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.uploadHeaders,
    body: file.content,
    signal: AbortSignal.timeout(120000),
  });
  if (!uploaded.ok)
    throw new Error(`Upload failed: ${file.path} (${uploaded.status})`);
}
const deployment = await client.workers.completeDeploymentUpload({
  agentApplication: artifact.manifest.agentApplication,
  deploymentId: plan.deploymentId,
  workerId: plan.workerId,
  keyPrefix: plan.keyPrefix,
  files,
  manifest: artifact.manifest.workerManifest,
  name,
  studioProjectSlug: settings.projectSlug,
});
const inspection = await client.studioProjects.inspect({
  projectId: project.id,
});
const agent =
  inspection.agents.find((item) => item.slug === "computer-contract-local") ??
  inspection.agents[0];
if (!agent)
  throw new Error("No Agent was registered in the local Studio project.");
const ready = {
  projectId: project.id,
  agentId: agent.id,
  agentName: agent.name,
  deploymentId: deployment.deploymentId ?? plan.deploymentId,
  studioUrl: `http://${settings.organization}.musegea.localhost:${settings.webPort}/studio/${settings.workspace}/agents/${agent.id}`,
  projectUrl: `http://${settings.organization}.musegea.localhost:${settings.webPort}/studio/${settings.workspace}/projects/${project.id}`,
};
await mkdir(path.join(projectRoot, ".local"), { recursive: true });
await writeFile(
  path.join(projectRoot, ".local/ready.json"),
  JSON.stringify(ready, null, 2),
);
await writeFile(
  path.join(stateRoot, "studio-auth.json"),
  JSON.stringify({ cookie }),
  { mode: 0o600 },
);
console.log(JSON.stringify(ready, null, 2));
