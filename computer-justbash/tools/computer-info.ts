import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const infoSchema = z.object({
  status: z.literal("passed"),
  provider: z.literal("just-bash"),
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
    status: z.literal("passed"),
    streamBytes: z.number().int().positive(),
    binaryMatches: z.boolean(),
    textMatches: z.boolean(),
    renamed: z.boolean(),
    removed: z.boolean(),
    seed: z.boolean(),
  }),
});

export default defineTool({
  name: "computer_info",
  description: "读取本次真实 just-bash 初始化的文件探测结果、目录和能力。",
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
          await computer.workspace.readText(
            "provider-tests/justbash/info.json",
          ),
        ),
      ),
    );
    if (result.isErr())
      return {
        status: "error",
        error: {
          operation: "computer_info",
          message:
            result.error.cause instanceof Error
              ? result.error.cause.message
              : result.error.message,
        },
      };
    const info = result.value;
    const probe = info.filesystemProbe;
    return {
      ...info,
      status:
        probe.binaryMatches &&
        probe.textMatches &&
        probe.renamed &&
        probe.removed &&
        probe.seed &&
        probe.streamBytes === 4097
          ? "passed"
          : "error",
      protocol: { supported: Boolean(computer.protocol) },
    };
  },
});
