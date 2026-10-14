import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "permissions_probe",
  description:
    "只读 Tool 实际尝试写文件和执行 /bin/true，报告真实拒绝；不会读取授权根目录外的文件。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    if (!ctx.computer)
      return { status: "unsupported", reason: "computer_not_enabled" };
    const path =
      "provider-tests/computer-device-test/" +
      encodeURIComponent(ctx.identity.chat.id) +
      "/permission-" +
      crypto.randomUUID() +
      ".txt";
    const [write, command] = await Promise.all([
      Result.tryPromise(() =>
        ctx.computer!.workspace.writeText(path, "permission probe"),
      ),
      Result.tryPromise(() =>
        ctx.computer!.commands.run({ command: "/bin/true" }),
      ),
    ]);
    return {
      status: write.isErr() && command.isErr() ? "passed" : "error",
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
