import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  loadStudioConfig,
  createStudioSource,
  assertStudioReady,
  assertStudioReceiptTarget,
  signInStudio,
  fetchStudio,
} from "./studio-environment.mjs";
import {
  summarizeVerification,
  verifyDeploymentEvidence,
  evaluateProbeCase,
} from "./studio-results.mjs";
import { verifyFileLifetime } from "./verify-results.mjs";

const config = await loadStudioConfig();
const startedAt = new Date().toISOString();
const marker = `GEA-${randomUUID()} 中文 $HOME`;
const cases = [];
const records = [];
const pendingCases = [
  "environment",
  "runtime",
  "files-write",
  "files-same-session",
  "files-new-session",
  "command-success",
  "command-nonzero",
  "command-timeout",
  "command-terminate",
  "command-interactive",
  "permissions",
  "readonly-skills",
];
let auth;
let receipt;
let capabilities = [];
let chatId;
let activeRun;
let currentCase = "preflight";
const terminalRunStatuses = [
  "finished",
  "aborted",
  "failed",
  "error",
  "interrupted",
];

function toolCalls(messages) {
  return messages
    .flatMap((message) => message.parts ?? [])
    .filter(
      (part) => part.type?.startsWith("tool-") || part.type === "dynamic-tool",
    )
    .map((part) => ({
      name: part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
      input: part.input,
      output: part.output,
      state: part.state,
      toolCallId: part.toolCallId,
      ...(part.errorText ? { errorText: part.errorText } : {}),
    }));
}

async function createSession() {
  const id = randomUUID();
  await auth.client.studioAgents.createPlaygroundChat({
    agentId: receipt.agentId,
    chatId: id,
    environment: "preview",
  });
  const sessions = await auth.client.studioAgents.listPlaygroundChats({
    agentId: receipt.agentId,
    limit: 100,
  });
  verifyDeploymentEvidence(
    receipt,
    sessions.find((session) => session.chatId === id),
  );
  return id;
}

async function readStreamStatus(id) {
  const response = await fetchStudio(
    config,
    `${config.tenantBaseUrl}/api/chat/${id}/stream`,
    {
      headers: { cookie: auth.cookie, origin: config.baseUrl },
      signal: AbortSignal.timeout(15000),
    },
  );
  await response.body?.cancel();
  return response.status;
}

async function runProbe(id, name, input) {
  const { sourceRequire } = createStudioSource(config);
  const { DefaultChatTransport, readUIMessageStream } = sourceRequire("ai");
  class Transport extends DefaultChatTransport {
    parse(stream) {
      return this.processResponseStream(stream);
    }
  }
  const response = await fetchStudio(
    config,
    `${config.tenantBaseUrl}/api/chat`,
    {
      method: "POST",
      headers: {
        cookie: auth.cookie,
        origin: config.baseUrl,
        "X-Organization-Slug": config.organization,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        agentId: receipt.agentId,
        id,
        message: `只调用一次 ${name}(${JSON.stringify(input)})。等待工具返回后用中文报告真实结果。不要调用其他工具，不补跑失败或 unsupported 的工具。`,
        organizationSlug: config.organization,
        workspaceSlug: config.workspace,
        environment: "preview",
        timezone: "Asia/Shanghai",
      }),
      signal: AbortSignal.timeout(300000),
    },
  );
  assert.ok(response.ok, `Chat request returned HTTP ${response.status}`);
  activeRun = { chatId: id, runId: response.headers.get("x-gea-agent-run-id") };
  const record = {
    chatId: id,
    runId: activeRun.runId,
    tools: [],
    persisted: [],
  };
  records.push(record);
  let assistant;
  for await (const message of readUIMessageStream({
    stream: new Transport().parse(response.body),
    terminateOnError: true,
  })) {
    assistant = message;
  }
  record.tools = toolCalls(assistant ? [assistant] : []);
  let chat = await auth.client.chats.getById({ id });
  // The projection may trail stream EOF; observe completion without replaying a Run.
  for (
    let attempt = 0;
    attempt < 20 &&
    ["running", "queued", "stopping"].includes(chat.latestRunStatus);
    attempt++
  ) {
    await setTimeout(250);
    chat = await auth.client.chats.getById({ id });
  }
  record.runId ??= chat.latestRunId;
  activeRun.runId ??= chat.latestRunId;
  assert.equal(
    chat.latestRunId,
    record.runId,
    "Observed a different Run than the one admitted",
  );
  record.status = chat.latestRunStatus;
  record.activeStreamId = chat.activeStreamId;
  record.resumeStatus = await readStreamStatus(id);
  if (
    terminalRunStatuses.includes(chat.latestRunStatus) &&
    record.resumeStatus === 204
  ) {
    activeRun = null;
  }
  const [messages, sessions] = await Promise.all([
    auth.client.chats.listMessagesByChatId({ id, limit: 100, cursor: null }),
    auth.client.studioAgents.listPlaygroundChats({
      agentId: receipt.agentId,
      limit: 100,
    }),
  ]);
  const session = sessions.find((entry) => entry.chatId === id);
  record.deploymentId = session?.agentDeploymentId;
  record.agentVersionId = session?.agentVersionId;
  verifyDeploymentEvidence(receipt, session);
  record.persisted = toolCalls(messages.items);
  return record;
}

async function check(id, name, input, verify) {
  currentCase = id;
  const started = Date.now();
  const run = await runProbe(chatId, name, input);
  assert.equal(
    activeRun,
    null,
    "The last Run has not confirmed completion and cleanup",
  );
  const result = evaluateProbeCase(run, { name, input, capabilities, verify });
  cases.push({
    id,
    status: result.status,
    durationMs: Date.now() - started,
    chatId: run.chatId,
    runId: run.runId,
    ...(result.message ? { message: result.message } : {}),
    ...(result.status === "unsupported"
      ? { message: result.output.reason }
      : {}),
  });
  console.log(`${id}: ${result.status}`);
  if (!result.canContinue) {
    activeRun = { chatId: run.chatId, runId: run.runId };
    throw new Error(result.message);
  }
  return result.status === "failed" ? undefined : result.output;
}

try {
  await assertStudioReady(config);
  receipt = assertStudioReceiptTarget(
    config,
    JSON.parse(await readFile(config.readyFile, "utf8")),
  );
  const { jiti } = createStudioSource(config);
  const { buildAgentPackageUploadArtifact } = await jiti.import(
    path.join(
      config.sourceRoot,
      "packages/local-backend/src/commands/agent-packages/project.ts",
    ),
  );
  const artifact = await buildAgentPackageUploadArtifact({
    cwd: config.projectPath,
  });
  assert.equal(
    receipt.contentHash,
    artifact.manifest.contentHash,
    "Agent source changed; publish the current version before testing.",
  );
  auth = await signInStudio(config);
  const inspection = await auth.client.studioAgents.inspect({
    agentId: receipt.agentId,
  });
  verifyDeploymentEvidence(receipt, inspection.previewDeployment);
  chatId = await createSession();
  const environment = await check(
    "environment",
    "computer_info",
    {},
    (info) => {
      assert.equal(info.provider, "default");
      assert.equal(info.chatId, chatId);
      assert.ok(info.roots.workspace);
      assert.ok(Array.isArray(info.capabilities));
      capabilities = info.capabilities;
    },
  );
  assert.ok(
    environment,
    "Environment verification failed; remaining cases require known capabilities",
  );
  await check("runtime", "runtime_probe", {});
  const written = await check(
    "files-write",
    "files_probe",
    { mode: "write", text: marker },
    (output) => {
      assert.equal(output.text, marker);
    },
  );
  if (written) {
    const same = await check(
      "files-same-session",
      "files_probe",
      { mode: "read" },
      (output) => {
        assert.equal(
          output.found,
          true,
          "The same Session lost its file between Runs",
        );
        assert.equal(output.text, marker);
      },
    );
    if (same) {
      const originalChatId = chatId;
      currentCase = "files-new-session";
      chatId = await createSession();
      await check(
        "files-new-session",
        "files_probe",
        { mode: "read" },
        (another) => {
          verifyFileLifetime("durable-chat", marker, same, another);
        },
      );
      chatId = originalChatId;
    } else {
      cases.push({
        id: "files-new-session",
        status: "blocked",
        message: "Requires successful files-same-session evidence.",
      });
    }
  } else {
    for (const id of ["files-same-session", "files-new-session"]) {
      cases.push({
        id,
        status: "blocked",
        message: "Requires a successful files-write marker.",
      });
    }
  }
  for (const scenario of [
    "success",
    "nonzero",
    "timeout",
    "terminate",
    "interactive",
  ]) {
    await check(
      `command-${scenario}`,
      "command_probe",
      { scenario },
      (output) => {
        if (scenario === "nonzero") assert.equal(output.exitCode, 7);
      },
    );
  }
  await check("permissions", "permissions_probe", {}, (output) => {
    assert.equal(output.fileWrite.denied, true);
    assert.equal(output.commandRun.denied, true);
  });
  await check("readonly-skills", "readonly_skill_probe", {}, (output) => {
    assert.equal(output.readable, true);
    assert.equal(output.unchanged, true);
    assert.equal(output.writeDenied, true);
  });
} catch (error) {
  if (!cases.some((entry) => entry.id === currentCase)) {
    cases.push({
      id: currentCase,
      status: currentCase === "preflight" ? "blocked" : "failed",
      message: error.message,
    });
  }
  console.error(`${currentCase}: ${error.message}`);
  process.exitCode = 1;
} finally {
  let cleanup;
  if (activeRun?.runId && auth) {
    // A reader timeout does not cancel its logical Run. Stop only this runner's exact Run.
    try {
      const response = await fetchStudio(
        config,
        `${config.tenantBaseUrl}/api/chat/${activeRun.chatId}/stream`,
        {
          method: "DELETE",
          headers: {
            cookie: auth.cookie,
            origin: config.baseUrl,
            "content-type": "application/json",
          },
          body: JSON.stringify({ runId: activeRun.runId }),
          signal: AbortSignal.timeout(15000),
        },
      );
      cleanup = {
        ...activeRun,
        httpStatus: response.status,
        requested: response.ok,
        confirmed: false,
      };
      assert.ok(response.ok, "Cleanup Stop request failed");
      for (let attempt = 0; attempt < 20; attempt++) {
        const chat = await auth.client.chats.getById({ id: activeRun.chatId });
        if (
          chat.latestRunId === activeRun.runId &&
          terminalRunStatuses.includes(chat.latestRunStatus)
        ) {
          cleanup.status = chat.latestRunStatus;
          cleanup.activeStreamId = chat.activeStreamId;
          cleanup.resumeStatus = await readStreamStatus(activeRun.chatId);
          if (cleanup.resumeStatus === 204) {
            cleanup.confirmed = true;
            break;
          }
        }
        await setTimeout(250);
      }
      assert.ok(
        cleanup.confirmed,
        "Stop accepted but Run cleanup remains unconfirmed",
      );
    } catch (error) {
      cleanup = { ...activeRun, ...cleanup, error: error.message };
    }
  } else if (activeRun) {
    cleanup = {
      ...activeRun,
      confirmed: false,
      error:
        "No exact Run ID returned; inspect this test Session before retrying.",
    };
  }
  for (const id of pendingCases) {
    if (!cases.some((entry) => entry.id === id)) {
      cases.push({
        id,
        status: "blocked",
        message: `Not executed after ${currentCase}.`,
      });
    }
  }
  const report = {
    ...summarizeVerification(cases),
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    organization: config.organization,
    workspace: config.workspace,
    sourceRoot: config.sourceRoot,
    agentId: receipt?.agentId,
    deploymentId: receipt?.deploymentId,
    contentHash: receipt?.contentHash,
    capabilities,
    marker,
    cases,
    records,
    ...(cleanup ? { cleanup } : {}),
  };
  const directory = path.join(config.root, ".local");
  await mkdir(directory, { recursive: true });
  const stem = `studio-verification-${startedAt.replaceAll(/[:.]/gu, "-")}`;
  const cell = (value) => String(value ?? "").replaceAll(/[|\r\n]/gu, " ");
  const markdown = [
    "# Computer Studio 验收",
    "",
    `状态：${report.status}`,
    "",
    `Studio：${config.tenantBaseUrl}/builder/${config.workspace}`,
    `源码：${config.sourceRoot}`,
    `开始：${startedAt}`,
    "",
    "仅按实际工具输出、持久化消息与逻辑 Run 最终状态判定。unsupported 和未执行项目不算通过。",
    "",
    "| 场景 | 结果 | 耗时 ms | 说明 |",
    "| --- | --- | ---: | --- |",
    ...cases.map(
      (entry) =>
        `| ${entry.id} | ${entry.status} | ${entry.durationMs ?? ""} | ${cell(entry.message)} |`,
    ),
    "",
    ...(cleanup ? [`清理：${cell(JSON.stringify(cleanup))}`, ""] : []),
    `完整工具证据、Session/Run ID：${stem}.json`,
    "",
  ].join("\n");
  const json = JSON.stringify(report, null, 2);
  await Promise.all([
    writeFile(path.join(directory, `${stem}.json`), json),
    writeFile(path.join(directory, `${stem}.md`), markdown),
    writeFile(path.join(directory, "studio-verification.json"), json),
    writeFile(path.join(directory, "studio-verification.md"), markdown),
  ]);
  console.log(`Report: ${path.join(directory, "studio-verification.md")}`);
  if (!["passed", "passed-with-unsupported"].includes(report.status))
    process.exitCode = 1;
}
