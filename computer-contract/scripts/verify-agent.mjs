import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { environment, projectRoot, settings } from "./environment.mjs";
import { signInStudio, sourceRequire } from "./studio-client.mjs";

const { DefaultChatTransport, readUIMessageStream } = sourceRequire("ai");
class Transport extends DefaultChatTransport {
  parse(stream) {
    return this.processResponseStream(stream);
  }
}
const { client, cookie } = await signInStudio();
const ready = JSON.parse(
  await readFile(path.join(projectRoot, ".local/ready.json"), "utf8"),
);
const marker = `GEA部署验收-${randomUUID()}`;
async function createSession() {
  const chatId = randomUUID();
  await client.studioAgents.createPlaygroundChat({
    agentId: ready.agentId,
    chatId,
    environment: "preview",
  });
  return chatId;
}
async function run(chatId, prompt) {
  console.log(`Testing session ${chatId}...`);
  const response = await fetch(
    `http://127.0.0.1:${settings.webPort}/api/chat`,
    {
      method: "POST",
      headers: {
        cookie,
        host: `${settings.organization}.musegea.localhost:${settings.webPort}`,
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
      `Chat request failed (${response.status}): ${await response.text()}`,
    );
  let assistant;
  for await (const message of readUIMessageStream({
    stream: new Transport().parse(response.body),
    terminateOnError: true,
  }))
    assistant = message;
  const chat = await client.chats.getById({ id: chatId });
  const messages = await client.chats.listMessagesByChatId({
    id: chatId,
    limit: 100,
    cursor: null,
  });
  assert.equal(
    chat.latestRunStatus,
    "finished",
    `Run ended with ${chat.latestRunStatus}`,
  );
  assert.equal(chat.activeStreamId, null);
  const tools = (assistant?.parts ?? [])
    .filter(
      (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool",
    )
    .map((part) => ({
      name: part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
      input: part.input,
      output: part.output,
      state: part.state,
      toolCallId: part.toolCallId,
    }));
  const persistedParts = messages.items.flatMap(
    (message) => message.parts ?? [],
  );
  for (const called of tools) {
    const persisted = persistedParts.find(
      (part) => part.toolCallId === called.toolCallId,
    );
    assert.equal(persisted?.state, "output-available");
    assert.deepEqual(persisted.output, called.output);
  }
  console.log(`Completed: ${tools.map((tool) => tool.name).join(", ")}`);
  return { chatId, tools, assistant, messages };
}
function tool(result, name, scenario) {
  const found = result.tools.find(
    (value) =>
      value.name === name &&
      (scenario === undefined || value.input?.scenario === scenario),
  );
  assert.ok(found, `Missing actual tool call: ${name} ${scenario ?? ""}`);
  assert.equal(found.state, "output-available");
  return found.output;
}
const chatId = await createSession();
if (process.argv.includes("--feishu-connect")) {
  const result = await run(
    chatId,
    "只实际调用一次 feishu__api__connect，输入为 {}。只返回工具给出的授权链接和真实连接状态，不执行任何飞书业务操作，不调用其他工具。",
  );
  const output = tool(result, "feishu__api__connect");
  assert.equal(result.tools.length, 1);
  assert.equal(output.status, "authorization_available");
  assert.equal(typeof output.connection.configured, "boolean");
  const authorizationUrl = new URL(output.url);
  assert.equal(
    authorizationUrl.origin,
    new URL(environment.APP_BASE_URL).origin,
  );
  assert.equal(authorizationUrl.pathname, "/api/agent-connectors/oauth/start");
  assert.ok(authorizationUrl.searchParams.get("ticket"));
  const report = {
    passed: true,
    deploymentId: ready.deploymentId,
    agentId: ready.agentId,
    chatId,
    status: output.status,
    configured: output.connection.configured,
    result,
    studioUrl: `${ready.studioUrl}?environment=preview&view=playground&chatId=${chatId}`,
  };
  await writeFile(
    path.join(projectRoot, ".local/feishu-connect.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      status: report.status,
      configured: report.configured,
      studioUrl: report.studioUrl,
    }),
  );
  process.exit(0);
}
const first = await run(
  chatId,
  `实际调用 computer_info；调用 files_demo，text设置为“${marker}”；调用 binary_program，label设置为字面值“hello $HOME”；调用 permissions_probe。所有结果必须来自工具。不要补跑失败的工具；如实报告错误。只给简短摘要。`,
);
await writeFile(
  path.join(projectRoot, ".local/verification-first.json"),
  JSON.stringify(first, null, 2),
);
assert.equal(tool(first, "computer_info").chatId, chatId);
const files = tool(first, "files_demo");
assert.equal(files.text, marker);
assert.equal(files.directoryCreated, true);
assert.equal(files.renamed, true);
assert.equal(files.removed, true);
assert.equal(files.metadata.size, new TextEncoder().encode(marker).length);
const binary = tool(first, "binary_program");
assert.equal(binary.resultHex, "00ff8000ff");
assert.equal(binary.inputHex, "00ff80");
assert.equal(binary.stdinHex, "00ff");
assert.equal(binary.size, 5);
assert.equal(binary.stderrText, "hello $HOME");
assert.equal(binary.exitCode, 0);
const permissions = tool(first, "permissions_probe");
assert.equal(permissions.fileWrite.allowed, false);
assert.equal(permissions.commandRun.allowed, false);
const nonzero = await run(
  chatId,
  "只实际调用一次 command_demo，scenario=nonzero。输出简短结果，不调用其他工具。",
);
assert.equal(tool(nonzero, "command_demo", "nonzero").exitCode, 7);
const timeout = await run(
  chatId,
  "只实际调用一次 command_demo，scenario=timeout。输出实际错误的简短结果，不调用其他工具。",
);
assert.match(
  tool(timeout, "command_demo", "timeout").error?.message ?? "",
  /interrupted|timeout|timed out|abort/i,
);
const termination = await run(
  chatId,
  "只实际调用一次 command_demo，scenario=terminate。输出processId、killRequested和真实错误或退出码的简短结果，不调用其他工具。",
);
const terminated = tool(termination, "command_demo", "terminate");
assert.equal(terminated.killRequested, true);
assert.ok(terminated.processId);
assert.ok(
  typeof terminated.exitCode === "number" ||
    terminated.error?.message.includes("process terminated"),
);
const second = await run(
  chatId,
  "实际调用 computer_info 和 command_demo 的 success 场景，验证此前保存的 manual/note.txt 仍可读取。不要重写文件。只给简短摘要。",
);
assert.equal(tool(second, "computer_info").chatId, chatId);
assert.ok(tool(second, "command_demo", "success").stdout.includes(marker));
const separateChatId = await createSession();
const third = await run(
  separateChatId,
  "这是新会话。实际调用 computer_info 和 command_demo 的 success 场景；只读取已有内容，不要创建manual/note.txt。只给简短摘要。",
);
assert.equal(tool(third, "computer_info").chatId, separateChatId);
assert.ok(
  tool(third, "command_demo", "success").stdout.includes("saved note: absent"),
);
const report = {
  passed: true,
  deploymentId: ready.deploymentId,
  agentId: ready.agentId,
  marker,
  rounds: [first, nonzero, timeout, termination, second, third],
  studioUrl: `${ready.studioUrl}?environment=preview&view=playground&chatId=${chatId}`,
};
await writeFile(
  path.join(projectRoot, ".local/verification.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { passed: true, chatId, separateChatId, studioUrl: report.studioUrl },
    null,
    2,
  ),
);
