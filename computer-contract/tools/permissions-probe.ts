import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "permissions_probe",
  description:
    "只读 Tool 实际尝试 workspace.writeText 和 commands.run，报告系统拒绝越权调用的原始错误消息。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return { error: { message: "当前 Agent 未启用 Computer。" } };
    const [write, command] = await Promise.all([
      Result.tryPromise(() =>
        computer.workspace.writeText("should-not-exist.txt", "x"),
      ),
      Result.tryPromise(() => computer.commands.run({ command: "/bin/true" })),
    ]);
    return {
      fileWrite: write.match({
        ok: () => ({ allowed: true }),
        err: (error) => ({
          allowed: false,
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        }),
      }),
      commandRun: command.match({
        ok: () => ({ allowed: true }),
        err: (error) => ({
          allowed: false,
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        }),
      }),
    };
  },
});
