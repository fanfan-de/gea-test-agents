import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "permissions_probe",
  description:
    "只读 Tool 实际尝试被禁止的文件写入和命令；只有两个操作都拒绝才通过。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const [write, command] = await Promise.all([
      Result.tryPromise(() =>
        computer.workspace.writeText(
          "provider-tests/remote/probes/forbidden-" +
            crypto.randomUUID() +
            ".txt",
          "permission probe",
        ),
      ),
      Result.tryPromise(() =>
        computer.commands.run({
          command: "python3",
          args: ["-c", "print('UNEXPECTED_COMMAND_PERMISSION')"],
        }),
      ),
    ]);
    const fileWrite = write.match({
      ok: () => ({ allowed: true, denied: false }),
      err: (error) => {
        const message =
          error.cause instanceof Error ? error.cause.message : error.message;
        return {
          allowed: false,
          denied: message.includes("cannot write the workspace"),
          message,
        };
      },
    });
    const commandRun = command.match({
      ok: () => ({ allowed: true, denied: false }),
      err: (error) => {
        const message =
          error.cause instanceof Error ? error.cause.message : error.message;
        return {
          allowed: false,
          denied: message.includes("cannot run commands"),
          message,
        };
      },
    });
    return {
      status: fileWrite.denied && commandRun.denied ? "passed" : "error",
      fileWrite,
      commandRun,
    };
  },
});
