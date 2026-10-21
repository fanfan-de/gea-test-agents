import {
  bash,
  defineAgent,
  defineTool,
  readFile,
  writeFile,
} from "@gea-ai/agent-sdk";
import { agentCore } from "@gea-ai/agent-sdk/agent-core";
import { z } from "zod";

const computerTargets = defineTool({
  name: "computer_targets",
  description:
    "只读取当前会话已固定的 Computer 挂载列表和 primaryMountId；不打开 Computer、不执行命令或读取文件。",
  input: z.object({}),
  permissions: { workspace: [], commands: false, network: false },
  execute(_, ctx) {
    return {
      primaryMountId: ctx.computers.primaryMountId,
      mounts: ctx.computers.list(),
    };
  },
});

const calculateSum = defineTool({
  name: "calculate_sum",
  description:
    "在工具内对 1 至 20 个有限数字求和，不使用 Computer、文件或网络。",
  input: z.object({ values: z.array(z.number()).min(1).max(20) }),
  permissions: { workspace: [], commands: false, network: false },
  execute({ values }) {
    return {
      count: values.length,
      sum: values.reduce((sum, value) => sum + value, 0),
    };
  },
});

export default defineAgent({
  name: "Computer-None-Test",
  slug: "computer-none",
  model: "qwen3.7-plus",
  engine: agentCore({ maxToolConcurrency: 1 }),
  context: false,
  tools: [computerTargets, calculateSum, bash(), readFile(), writeFile()],
});
