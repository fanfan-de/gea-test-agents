import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const computerInfoSchema = z.object({
  chatId: z.string().min(1),
  scope: z.object({
    type: z.enum(["chat", "user", "custom"]),
    key: z.string().optional(),
  }),
  roots: z.object({
    workspace: z.string().min(1),
    artifacts: z.string().min(1),
    skills: z.string().min(1),
    tmp: z.string().min(1),
  }),
  capabilities: z.array(z.string()),
});

export default defineTool({
  name: "computer_info",
  description:
    "读取 Computer 初始化时保存的真实 Chat、目录和能力信息。公开 SDK 不暴露 computerId 或 executionId。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return { error: { message: "当前 Agent 未启用 Computer。" } };
    const result = await Result.tryPromise(async () =>
      computerInfoSchema.parse(
        JSON.parse(await computer.workspace.readText("computer-info.json")),
      ),
    );
    if (result.isErr()) {
      const error = result.error;
      return {
        error: {
          operation: "workspace.readText",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
