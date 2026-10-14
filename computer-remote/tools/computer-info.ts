import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const infoSchema = z.object({
  provider: z.literal("remote"),
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
  filesystemProbe: z.object({
    binary: z.boolean(),
    stream: z.boolean(),
    rename: z.boolean(),
    stat: z.boolean(),
    remove: z.boolean(),
    seed: z.boolean(),
  }),
  pythonVersion: z.string().min(1),
});

export default defineTool({
  name: "computer_info",
  description:
    "读取真实初始化结果、目录、能力与应用协议可用性；不读取环境密钥。",
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
          await computer.workspace.readText("provider-tests/remote/info.json"),
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
    const info = result.value;
    return {
      status: Object.values(info.filesystemProbe).every(Boolean)
        ? "passed"
        : "error",
      ...info,
      protocol: computer.protocol
        ? {
            supported: true,
            computerId: computer.protocol.computerId,
            executionId: computer.protocol.executionId,
          }
        : { supported: false },
    };
  },
});
