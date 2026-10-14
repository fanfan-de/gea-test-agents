import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const reportSchema = z.object({
  provider: z.literal("device"),
  chatId: z.string(),
  scope: z.object({
    type: z.enum(["chat", "user", "custom"]),
    key: z.string().optional(),
  }),
  roots: z.object({
    workspace: z.string(),
    artifacts: z.string(),
    skills: z.string(),
    tmp: z.string(),
  }),
  capabilities: z.array(z.string()),
  directory: z.string(),
  probeDirectory: z.string(),
  files: z.object({
    streamedBytes: z.number().int().nonnegative(),
    streamMatches: z.boolean(),
    binaryHex: z.string().nullable(),
    textMatches: z.boolean(),
    renameObserved: z.boolean(),
    metadata: z
      .object({
        type: z.enum(["file", "directory"]),
        size: z.number(),
        modifiedAt: z.number(),
      })
      .nullable(),
    removeObserved: z.boolean(),
  }),
  readonlySkill: z.object({
    path: z.string(),
    text: z.string().nullable(),
    unchanged: z.boolean(),
    apiWrite: z.object({
      allowed: z.boolean(),
      message: z.string().optional(),
    }),
    boundary: z.string(),
  }),
});
export default defineTool({
  name: "computer_info",
  description:
    "读取 onSession 实际保存的 scope、目录、能力、stream/binary/text 文件测试结果。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    if (!ctx.computer)
      return { status: "unsupported", reason: "computer_not_enabled" };
    const path =
      "provider-tests/computer-device-test/" +
      encodeURIComponent(ctx.identity.chat.id) +
      "/computer-info.json";
    const result = await Result.tryPromise(async () =>
      reportSchema.parse(
        JSON.parse(await ctx.computer!.workspace.readText(path)),
      ),
    );
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        operation: "workspace.readText",
        message:
          error.cause instanceof Error ? error.cause.message : error.message,
      };
    }
    const info = result.value;
    return {
      status:
        info.chatId === ctx.identity.chat.id &&
        info.files.streamMatches &&
        info.files.binaryHex === "00ff8000ff" &&
        info.files.textMatches &&
        info.files.renameObserved &&
        info.files.removeObserved
          ? "passed"
          : "error",
      info,
    };
  },
});
