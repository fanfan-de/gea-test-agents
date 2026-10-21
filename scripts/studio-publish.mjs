import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertStudioReady,
  assertStudioReceiptTarget,
  createStudioSource,
  loadStudioConfig,
  signInStudio,
} from "./studio-environment.mjs";

export async function publishStudioAgent(config) {
  config ??= await loadStudioConfig();
  const { jiti } = createStudioSource(config);
  const [
    { buildAgentPackageUploadArtifact },
    { getAgentPackageFileContentType },
  ] = await Promise.all([
    jiti.import(
      path.join(
        config.sourceRoot,
        "packages/gea-cli/src/commands/agent-packages/project.ts",
      ),
    ),
    jiti.import(
      path.join(
        config.sourceRoot,
        "packages/local-backend/src/commands/agent-packages/push.ts",
      ),
    ),
  ]);
  const artifact = await buildAgentPackageUploadArtifact({
    cwd: config.projectPath,
  });
  // The local build can finish while Studio is unavailable; no server writes precede readiness.
  await assertStudioReady(config);
  const { client } = await signInStudio(config);
  const projects = await client.studioProjects.list({});
  let project = projects.find(
    (item) => item.project.slug === config.projectSlug,
  )?.project;
  if (!project) {
    project = await client.studioProjects.create({
      name: "Computer 模块测试",
      slug: config.projectSlug,
      description: "当前本地 Studio 的独立 Computer 能力验收。",
    });
  }
  const byPath = new Map(artifact.files.map((file) => [file.path, file]));
  const deploymentFiles = artifact.manifest.workerManifest.files.map(
    (descriptor) => {
      const file = byPath.get(descriptor.path);
      if (!file) throw new Error(`Missing Worker file: ${descriptor.path}`);
      return file;
    },
  );
  const files = deploymentFiles.map((file) => ({
    path: file.path,
    contentType: getAgentPackageFileContentType(file.path),
    checksumMd5Base64: createHash("md5").update(file.content).digest("base64"),
  }));
  const input = {
    agentApplication: artifact.manifest.agentApplication,
    files,
    manifest: artifact.manifest.workerManifest,
    name: config.workerName,
    studioProjectSlug: config.projectSlug,
  };
  const plan = await client.workers.createDeploymentUpload(input);
  for (const file of deploymentFiles) {
    const target = plan.files.find((entry) => entry.path === file.path);
    if (!target) throw new Error(`Missing upload target: ${file.path}`);
    const response = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: file.content,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(
        `Upload failed for ${file.path} (HTTP ${response.status}).`,
      );
  }
  const deployment = await client.workers.completeDeploymentUpload({
    ...input,
    deploymentId: plan.deploymentId,
    workerId: plan.workerId,
    keyPrefix: plan.keyPrefix,
  });
  const inspection = await client.studioProjects.inspect({
    projectId: project.id,
  });
  const agent = inspection.agents.find(
    (entry) => entry.slug === config.workerName,
  );
  if (!agent) throw new Error(`Agent was not registered: ${config.workerName}`);
  const receipt = assertStudioReceiptTarget(config, {
    baseUrl: config.baseUrl,
    organization: config.organization,
    workspace: config.workspace,
    sourceRoot: config.sourceRoot,
    projectDirectory: config.projectDirectory,
    projectSlug: config.projectSlug,
    workerName: config.workerName,
    environment: "preview",
    contentHash: artifact.manifest.contentHash,
    projectId: project.id,
    agentId: agent.id,
    agentName: agent.name,
    deploymentId: deployment.deploymentId,
    workerId: plan.workerId,
    studioUrl: `${config.tenantBaseUrl}/builder/${encodeURIComponent(config.workspace)}/agents/${encodeURIComponent(agent.id)}`,
    publishedAt: new Date().toISOString(),
  });
  await mkdir(path.dirname(config.readyFile), { recursive: true });
  await writeFile(config.readyFile, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await publishStudioAgent(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
