import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const reportSchema = z.object({
  readonlySkill: z.object({
    text: z.string().nullable(),
    unchanged: z.boolean(),
    apiWrite: z.object({
      allowed: z.boolean(),
      message: z.string().optional(),
    }),
    boundary: z.string(),
    path: z.string(),
  }),
});
export default defineTool({
  name: "readonly_skill_probe",
  description:
    "比较 bundled Skill 文本和实际 Computer mount，读取 onSession 的只读文件 API 拒绝结果；不把 trusted 只读位当作 shell 隔离。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    if (!ctx.computer || !ctx.skills)
      return {
        status: "unsupported",
        reason: "computer_or_skills_unavailable",
      };
    const result = await Result.tryPromise(async () => {
      const path =
        "provider-tests/computer-local-test/" +
        encodeURIComponent(ctx.identity.chat.id) +
        "/computer-info.json";
      const report = reportSchema.parse(
        JSON.parse(await ctx.computer!.workspace.readText(path)),
      );
      const bundledText = ctx.skills!.readText({
        name: "provider-check",
        path: "marker.txt",
      });
      return {
        ...report.readonlySkill,
        bundledText,
        matchesBundle: bundledText === report.readonlySkill.text,
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        operation: "readonly_skill_probe",
        message:
          error.cause instanceof Error ? error.cause.message : error.message,
      };
    }
    const output = result.value;
    return {
      status:
        output.matchesBundle && output.unchanged && !output.apiWrite.allowed
          ? "passed"
          : "error",
      ...output,
    };
  },
});
