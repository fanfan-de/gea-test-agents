import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "readonly_skill_probe",
  description: "真实读取只读Skill，尝试修改后验证内容保持原样。",
  input: z.object({}),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute(_, ctx) {
    if (!ctx.computer) throw new Error("Computer is disabled");
    const path = "/.agents/skills/readonly-check/SKILL.md";
    const original = await ctx.computer.commands.run({
      command: "cat",
      args: [path],
    });
    if (
      original.exitCode !== 0 ||
      !original.stdout.includes("GEA_READONLY_SKILL")
    )
      throw new Error("Bundled Skill is unreadable");
    const write = await Result.tryPromise(() =>
      ctx.computer!.commands.run({ command: "printf corrupt > " + path }),
    );
    const after = await ctx.computer.commands.run({
      command: "cat",
      args: [path],
    });
    const writeMessage = write.isErr()
      ? write.error.cause instanceof Error
        ? write.error.cause.message
        : write.error.message
      : write.value.stderr;
    const writeDenied =
      (write.isErr() || write.value.exitCode !== 0) &&
      /read-only|permission denied|operation not permitted/iu.test(
        writeMessage,
      );
    if (!writeDenied || after.stdout !== original.stdout)
      throw new Error("Skill read-only mount was modified");
    return {
      status: "passed",
      readable: true,
      writeDenied,
      unchanged: true,
      rejection: writeMessage,
    };
  },
});
