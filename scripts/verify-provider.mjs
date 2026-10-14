import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  projectDirectory,
  root,
  sourceRequire,
  loadTestEnvironment,
} from "./provider-environment.mjs";
import { requireProbeResult, verifyFileLifetime } from "./verify-results.mjs";
import { signInStudio } from "../computer-contract/scripts/studio-client.mjs";

const provider = process.argv[2];
const cwd = projectDirectory(provider);
if (provider === "e2b")
  throw new Error("E2B real acceptance is explicitly skipped by user request");
const { settings, environment } = await loadTestEnvironment();
const invokeFile = promisify(execFile);
const localScript = path.join(root, "scripts/local-session.mjs");
const { DefaultChatTransport, readUIMessageStream } = sourceRequire("ai");
class Transport extends DefaultChatTransport {
  parse(stream) {
    return this.processResponseStream(stream);
  }
}
const auth = provider === "local" ? null : await signInStudio();
const ready =
  provider === "local"
    ? null
    : JSON.parse(await readFile(path.join(cwd, ".local/ready.json"), "utf8"));
const device =
  provider === "device"
    ? JSON.parse(await readFile(path.join(cwd, ".local/device.json"), "utf8"))
    : null;
if (device)
  assert.equal(
    device.bindingReady,
    true,
    "Pair the isolated test device first",
  );
const records = [];
const marker = "GEA-" + provider + "-" + randomUUID();
const commandsOnly = process.argv.includes("--commands-only");
const scenariosIndex = process.argv.indexOf("--scenarios");
const scenarios =
  scenariosIndex < 0
    ? commandsOnly
      ? ["success", "nonzero", "timeout", "terminate"]
      : ["nonzero", "timeout", "terminate"]
    : process.argv[scenariosIndex + 1].split(",");
for (const scenario of scenarios)
  assert.ok(
    ["success", "nonzero", "timeout", "terminate", "interactive"].includes(
      scenario,
    ),
  );
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
      errorText: part.errorText,
    }));
}
async function local(action, args = []) {
  const { stdout } = await invokeFile(
    process.execPath,
    [localScript, action, ...args],
    { cwd: root, timeout: 330000, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
async function createSession() {
  if (provider === "local") return (await local("create")).sessionId;
  const chatId = randomUUID();
  await auth.client.studioAgents.createPlaygroundChat({
    agentId: ready.agentId,
    chatId,
    environment: "preview",
    ...(device ? { deviceId: device.deviceId } : {}),
  });
  return chatId;
}
async function run(chatId, prompt) {
  console.log("Testing " + provider + " session " + chatId);
  if (provider === "local") {
    const completed = await local("run", [
      "--session",
      chatId,
      "--prompt",
      prompt,
    ]);
    assert.equal(completed.status, "finished");
    const saved = JSON.parse(await readFile(completed.resultFile, "utf8"));
    const messages = saved.snapshot.messages;
    // A Session snapshot includes earlier Runs; the local runner records this Run's IDs.
    const allCalls = toolCalls(messages);
    const lastUser = messages.findLastIndex(
      (message) => message.role === "user",
    );
    const calls = toolCalls(messages.slice(lastUser + 1));
    assert.ok(allCalls.length >= calls.length);
    const result = { chatId, runId: completed.runId, tools: calls };
    records.push(result);
    console.log("Completed: " + calls.map((call) => call.name).join(", "));
    return result;
  }
  const response = await fetch(
    "http://127.0.0.1:" + settings.webPort + "/api/chat",
    {
      method: "POST",
      headers: {
        cookie: auth.cookie,
        host: settings.organization + ".musegea.localhost:" + settings.webPort,
        origin: environment.APP_BASE_URL,
        "X-Organization-Slug": settings.organization,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        agentId: ready.agentId,
        id: chatId,
        message: prompt,
        organizationSlug: settings.organization,
        workspaceSlug: settings.workspace,
        environment: "preview",
        projectId: null,
        runOptions: null,
        timezone: "Asia/Shanghai",
      }),
      signal: AbortSignal.timeout(300000),
    },
  );
  if (!response.ok)
    throw new Error(
      "Chat failed " + response.status + ": " + (await response.text()),
    );
  let assistant;
  for await (const message of readUIMessageStream({
    stream: new Transport().parse(response.body),
    terminateOnError: true,
  }))
    assistant = message;
  const [chat, messages] = await Promise.all([
    auth.client.chats.getById({ id: chatId }),
    auth.client.chats.listMessagesByChatId({
      id: chatId,
      limit: 100,
      cursor: null,
    }),
  ]);
  assert.equal(chat.latestRunStatus, "finished");
  assert.equal(chat.activeStreamId, null);
  const calls = toolCalls(assistant ? [assistant] : []);
  const persisted = toolCalls(messages.items);
  const result = { chatId, tools: calls, persisted };
  records.push(result);
  for (const call of calls) {
    const saved = persisted.find((part) => part.toolCallId === call.toolCallId);
    assert.equal(saved?.state, "output-available");
    assert.deepEqual(saved.output, call.output);
  }
  console.log("Completed: " + calls.map((call) => call.name).join(", "));
  return result;
}
try {
  const chatId = await createSession();
  if (!commandsOnly) {
    const first = await run(
      chatId,
      "严格按顺序各调用一次：computer_info({})；files_probe({mode:'write',text:'" +
        marker +
        "'})；command_probe({scenario:'success'})；permissions_probe({})；readonly_skill_probe({})；application_probe({})。每次工具返回后再调用下一个。不补跑失败或unsupported的工具，不调用其他工具。结果只来自真实工具。",
    );
    const infoOutput = requireProbeResult(first.tools, "computer_info");
    const info = infoOutput.info ?? infoOutput;
    assert.equal(info.chatId, chatId);
    assert.ok(info.roots.workspace);
    const wrote = requireProbeResult(first.tools, "files_probe");
    assert.equal(wrote.text, marker);
    requireProbeResult(first.tools, "command_probe");
    const permissions = requireProbeResult(first.tools, "permissions_probe");
    assert.equal(permissions.fileWrite.allowed, false);
    assert.equal(permissions.commandRun.allowed, false);
    requireProbeResult(first.tools, "readonly_skill_probe");
    requireProbeResult(
      first.tools,
      "application_probe",
      ["justbash", "device"].includes(provider) ? "unsupported" : "passed",
    );

    const same = await run(
      chatId,
      "只调用一次 files_probe({mode:'read'})，不要创建或重写note。只报告实际工具结果。",
    );
    const anotherId = await createSession();
    const another = await run(
      anotherId,
      "只调用一次 files_probe({mode:'read'})，不要创建或重写note。只报告实际工具结果。",
    );
    verifyFileLifetime(
      ["default", "remote"].includes(provider)
        ? "durable-chat"
        : provider === "justbash"
          ? "ephemeral"
          : "shared-directory",
      marker,
      requireProbeResult(same.tools, "files_probe"),
      requireProbeResult(another.tools, "files_probe"),
    );
  }

  for (const scenario of scenarios) {
    const result = await run(
      chatId,
      "只调用一次 command_probe({scenario:'" +
        scenario +
        "'})，不调用其他工具。报告真实状态、输出、退出码或错误；不要补跑。",
    );
    const output = requireProbeResult(
      result.tools,
      "command_probe",
      scenario === "terminate" && provider === "justbash"
        ? "unsupported"
        : "passed",
    );
    if (scenario === "nonzero") assert.equal(output.exitCode, 7);
    if (scenario === "terminate" && provider !== "justbash") {
      assert.ok(output.processId);
      assert.equal(output.killRequested, true);
    }
  }
  if (
    ["default", "remote"].includes(provider) &&
    !scenarios.includes("interactive")
  ) {
    const result = await run(
      chatId,
      "只调用一次 command_probe({scenario:'interactive'})，报告真实stdin/EOF结果，不调用其他工具。",
    );
    requireProbeResult(result.tools, "command_probe");
  }
  const verification = {
    provider,
    status: "passed",
    mode: commandsOnly ? "commands" : "full",
    testedAt: new Date().toISOString(),
    sourceRoot: settings.sourceRoot,
    marker,
    records,
  };
  await mkdir(path.join(cwd, ".local"), { recursive: true });
  await writeFile(
    path.join(
      cwd,
      commandsOnly
        ? ".local/verification-commands.json"
        : ".local/verification.json",
    ),
    JSON.stringify(verification, null, 2),
  );
  console.log(provider + " Agent acceptance passed");
} catch (error) {
  await mkdir(path.join(cwd, ".local"), { recursive: true });
  await writeFile(
    path.join(
      cwd,
      commandsOnly
        ? ".local/verification-commands-failed.json"
        : ".local/verification-failed.json",
    ),
    JSON.stringify(
      {
        provider,
        status: "failed",
        mode: commandsOnly ? "commands" : "full",
        testedAt: new Date().toISOString(),
        message: error.message,
        records,
      },
      null,
      2,
    ),
  );
  throw error;
}
