import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentPackageSnapshot,
  createAgentToolRuntimeDefinition,
  defineAgent,
} from "@gea-ai/agent-sdk";
import { runAgentWorkerRequest } from "@gea-ai/agent-sdk/agent-worker";
import { createAgentSkillMountContentId } from "@gea-ai/contract/computer-mounts";
import original from "../agent";
import info from "../tools/computer-info";
import files from "../tools/files-probe";
import commands from "../tools/command-probe";
import permissions from "../tools/permissions-probe";
import readonlySkill from "../tools/readonly-skill-probe";
import application from "../tools/application-probe";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const definition = defineAgent({
  ...original,
  tools: [info, files, commands, permissions, readonlySkill, application],
});
const skillPath = "skills/readonly-check/SKILL.md";
const skillBytes = await readFile(path.join(root, skillPath));
const skillMount = {
  mount: "/.agents",
  mode: "read-only" as const,
  contentId: createAgentSkillMountContentId([
    { path: skillPath, bytes: skillBytes },
  ]),
  files: [{ path: skillPath, dataBase64: skillBytes.toString("base64") }],
};
const observations: Array<{ name: string; output: unknown }> = [];

function modelStream(choices: unknown[]) {
  const chunks = choices.map((choice, index) => ({
    choices: [choice],
    created: index,
    id: "probe-" + index,
    model: "deterministic-fixture",
    object: "chat.completion.chunk",
  }));
  return new Response(
    chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join("") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

async function run(
  calls: Array<{ name: string; input: object }>,
  chatId: string,
) {
  let modelCall = 0;
  const runtime = createAgentToolRuntimeDefinition(definition);
  for (const [name, action] of Object.entries(runtime.actions)) {
    const execute = action.handler;
    if (!execute) throw new Error("A probe Tool handler is missing.");
    action.handler = async (input) => {
      const output = await execute(input);
      observations.push({ name, output });
      return output;
    };
  }
  const response = await runAgentWorkerRequest({
    engine: "ai-sdk",
    context: false,
    snapshot: createAgentPackageSnapshot(definition),
    toolRuntime: runtime,
    createComputerSession: original.computer.createSession,
    onComputerSession: original.computer.onSession,
    skillMount,
    initialization: {
      connectors: [],
      conversation: {
        canListHistory: false,
        canRead: false,
        canSend: false,
        canStartChild: false,
      },
      runtime: {
        auth: { current: null },
        environment: "preview",
        variables: {},
      },
    },
    bindings: {
      ai: {
        async fetch(url) {
          if (url.includes("/model?"))
            return Response.json({ providerType: "openai-compatible" });
          if (!url.includes("/model/provider-fetch?"))
            throw new Error("Unexpected model route.");
          const call = calls[modelCall++];
          return call
            ? modelStream([
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "probe-call-" + modelCall,
                        type: "function",
                        function: {
                          name: call.name,
                          arguments: JSON.stringify(call.input),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                  index: 0,
                },
                { delta: {}, finish_reason: "tool_calls", index: 0 },
              ])
            : modelStream([
                {
                  delta: {
                    role: "assistant",
                    content: "DIRECT_PROBE_COMPLETE",
                  },
                  finish_reason: null,
                  index: 0,
                },
                { delta: {}, finish_reason: "stop", index: 0 },
              ]);
        },
      },
      computer: {
        async exec() {
          throw new Error("Native exec must not be used.");
        },
        async list() {
          throw new Error("Native files must not be used.");
        },
        async readText() {
          throw new Error("Native files must not be used.");
        },
        async writeText() {
          throw new Error("Native files must not be used.");
        },
      },
      identity: {
        async fetch() {
          return Response.json({
            agent: { id: "agent-direct" },
            chat: { id: chatId },
            organization: { id: "organization-direct" },
            project: null,
            run: { id: "run-direct" },
            user: null,
            workspace: { id: "workspace-direct" },
          });
        },
      },
      tools: {
        async fetch() {
          throw new Error("No remote Tool host is required.");
        },
      },
    },
    request: new Request("http://worker/internal/agent-runs/v1/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-direct",
        chatId,
        contextArtifactRootPath: "/.gea/context",
        currentTurn: [],
        environment: {},
        instructions: [],
        model: original.model,
        originalMessages: [
          {
            id: "user-direct",
            role: "user",
            parts: [
              {
                type: "text",
                text: "Execute the deterministic Computer probes.",
              },
            ],
          },
        ],
        responseMessageId: "assistant-direct",
        runId: "run-direct",
        runtimeContext: [],
      }),
    }),
    sessionNamespace: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(request) {
          const url = new URL(request.url).pathname;
          if (url === "/v2/computer") return Response.json({ computer: null });
          if (url === "/v1/computer-scope")
            return Response.json({ scope: { type: "chat" } });
          if (url === "/v1/model-context" && request.method === "GET")
            return Response.json({ context: null });
          if (url === "/v1/model-context")
            return Response.json({ stored: true });
          return Response.json({ stored: true, inserted: true, sequence: 1 });
        },
      }),
    },
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert(body.includes("DIRECT_PROBE_COMPLETE"), body);
  assert.equal(
    modelCall,
    calls.length + 1,
    "Every requested tool must execute.",
  );
}

await run(
  [
    { name: "computer_info", input: {} },
    {
      name: "files_probe",
      input: { mode: "write", text: "DIRECT_JUSTBASH_NOTE_中文" },
    },
    { name: "files_probe", input: { mode: "read" } },
    { name: "command_probe", input: { scenario: "success" } },
    { name: "command_probe", input: { scenario: "nonzero" } },
    { name: "command_probe", input: { scenario: "timeout" } },
    { name: "command_probe", input: { scenario: "terminate" } },
    { name: "command_probe", input: { scenario: "interactive" } },
    { name: "permissions_probe", input: {} },
    { name: "readonly_skill_probe", input: {} },
    { name: "application_probe", input: {} },
  ],
  "chat-direct",
);
assert.equal(observations.length, 11);
for (const item of observations) {
  const output = item.output as { status: string; scenario?: string };
  const unsupported =
    item.name === "application_probe" ||
    (item.name === "command_probe" &&
      ["terminate", "interactive"].includes(output.scenario ?? ""));
  assert.equal(
    output.status,
    unsupported ? "unsupported" : "passed",
    JSON.stringify(item),
  );
}
const permissionsResult = observations.find(
  (item) => item.name === "permissions_probe",
)!.output as {
  fileWrite: { allowed: boolean; denied: boolean };
  commandRun: { allowed: boolean; denied: boolean };
};
assert.equal(permissionsResult.fileWrite.allowed, false);
assert.equal(permissionsResult.fileWrite.denied, true);
assert.equal(permissionsResult.commandRun.allowed, false);
assert.equal(permissionsResult.commandRun.denied, true);
await run([{ name: "files_probe", input: { mode: "read" } }], "chat-direct");
const final = observations.at(-1)!.output as { found: boolean; status: string };
assert.equal(
  final.found,
  false,
  "A new invocation must not inherit the previous note.",
);
assert.equal(final.status, "passed");
await mkdir(path.join(root, ".local"), { recursive: true });
const report = {
  status: "passed",
  provider: "just-bash",
  environment:
    "real SDK Worker and real just-bash; deterministic model and Session fixtures",
  sdkPermissions: "enforced by runAgentWorkerRequest",
  checks: observations,
  ephemeralAcrossInvocations: true,
};
await writeFile(
  path.join(root, ".local", "direct-verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    status: report.status,
    checks: observations.length,
    sdkPermissions: report.sdkPermissions,
    ephemeralAcrossInvocations: true,
  }) + "\n",
);
