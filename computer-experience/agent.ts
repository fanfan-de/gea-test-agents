import {
  applyPatch,
  bash,
  defineAgent,
  defineTool,
  editFile,
  findFiles,
  listDirectory,
  readFile,
  searchText,
  writeFile,
} from "@gea-ai/agent-sdk";
import { agentCore } from "@gea-ai/agent-sdk/agent-core";
import { defaultComputer } from "@gea-ai/agent-sdk/computer";
import { z } from "zod";

const computerTargets = defineTool({
  name: "computer_targets",
  description:
    "只读取当前会话已固定的 Computer 挂载 ID 和 primary；不打开环境、不读取文件或执行命令。",
  input: z.object({}),
  permissions: { workspace: [], commands: false, network: false },
  execute(_, ctx) {
    return {
      primaryMountId: ctx.computers.primaryMountId,
      mounts: ctx.computers.list(),
    };
  },
});

export default defineAgent({
  name: "Computer-Experience",
  slug: "computer-experience",
  model: "qwen3.7-plus",
  engine: agentCore({ maxToolConcurrency: 1 }),
  context: false,
  computer: defaultComputer({
    allowUserDevice: true,
    filesystem: { durability: "durable", scope: "chat" },
    requires: ["shell", "files"],
  }),
  tools: [
    computerTargets,
    bash(),
    readFile(),
    writeFile(),
    editFile(),
    applyPatch(),
    findFiles(),
    listDirectory(),
    searchText(),
  ],
});
