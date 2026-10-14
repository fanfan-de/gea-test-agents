import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "command_probe",
  description:
    "验证虚拟 shell 字面 argv/env/stdin、非零与超时；后台和交互句柄须明确拒绝。",
  input: z.object({
    scenario: z
      .enum(["success", "nonzero", "timeout", "terminate", "interactive"])
      .default("success"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ scenario }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const started = Date.now();
    const result = await Result.tryPromise(async () => {
      if (scenario === "terminate" || scenario === "interactive") {
        const process = await computer.commands.run({
          command: "echo started",
          background: true,
          ...(scenario === "interactive" ? { stdin: true } : {}),
        });
        await process.kill();
        return {
          status: "error",
          scenario,
          error: {
            message: "just-bash unexpectedly accepted a background process.",
          },
        };
      }
      if (scenario === "timeout") {
        const output = await computer.commands.run({
          command: "sleep 1; echo late",
          timeoutMs: 10,
        });
        return { status: "error", scenario, ...output };
      }
      const output =
        scenario === "nonzero"
          ? await computer.commands.run({
              command: "echo EXPECTED_NONZERO >&2; exit 7",
            })
          : await computer.commands.run({
              command: 'cat; printf "%s\\n" "$VALUE"; printf "%s"',
              args: ["hello $HOME; literal"],
              env: { VALUE: "literal $(echo injected)" },
              stdin: "stdin-text\n",
            });
      const passed =
        scenario === "nonzero"
          ? output.exitCode === 7 && output.stderr.includes("EXPECTED_NONZERO")
          : output.exitCode === 0 &&
            output.stdout ===
              "stdin-text\nliteral $(echo injected)\nhello $HOME; literal";
      return { status: passed ? "passed" : "error", scenario, ...output };
    });
    if (result.isErr()) {
      const error =
        result.error.cause instanceof Error ? result.error.cause : result.error;
      const unsupported =
        (scenario === "terminate" || scenario === "interactive") &&
        /does not support background processes or interactive stdin/iu.test(
          error.message,
        );
      const elapsedMs = Date.now() - started;
      const expectedTimeout =
        scenario === "timeout" &&
        elapsedMs >= 5 &&
        (error.name === "TimeoutError" ||
          /timeout|timed out|aborted|deadline/iu.test(error.message));
      return {
        status: unsupported
          ? "unsupported"
          : expectedTimeout
            ? "passed"
            : "error",
        scenario,
        rejected: true,
        elapsedMs,
        expectedTimeout,
        reason: error.message,
        error: { name: error.name, message: error.message },
      };
    }
    return result.value;
  },
});
