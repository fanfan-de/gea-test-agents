import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const infoSchema = z.object({
  provider: z.literal("default"),
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
    "读取本次初始化记录的 provider、chat、目录与能力；不运行命令，不读取环境密钥。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const result = await Result.tryPromise(async () =>
      infoSchema.parse(
        JSON.parse(
          await computer.workspace.readText("provider-tests/default/info.json"),
        ),
      ),
    );
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        error: {
          operation: "computer_info",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return {
      status: "passed",
      ...result.value,
    };
  },
});
