import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "command_probe",
  description:
    "串行测试成功、非零退出、超时、后台 kill 或交互 stdin/EOF；保留实际错误和退出结果。",
  input: z.object({
    scenario: z.enum([
      "success",
      "nonzero",
      "timeout",
      "terminate",
      "interactive",
    ]),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ scenario }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        scenario,
        error: { message: "Computer is unavailable." },
      };
    let processId: string | undefined;
    let killRequested = false;
    let readinessOutput = "";
    const started = Date.now();
    const deadline =
      scenario === "timeout" ? AbortSignal.timeout(1000) : undefined;
    const result = await Result.tryPromise(async () => {
      if (scenario === "interactive") {
        const process = await computer.commands.run({
          command: "python3",
          args: [
            "-c",
            "import sys; data=sys.stdin.read(); sys.stdout.write(data); sys.stderr.write('EOF_RECEIVED')",
          ],
          background: true,
          stdin: true,
          timeoutMs: 10000,
        });
        processId = process.processId;
        const text = "interactive $HOME\n中文";
        await process.sendStdin(text, { end: true });
        const output = await process.wait();
        return {
          status:
            output.exitCode === 0 &&
            output.stdout === text &&
            output.stderr === "EOF_RECEIVED"
              ? "passed"
              : "error",
          scenario,
          processId,
          ...output,
        };
      }
      if (scenario === "terminate") {
        const process = await computer.commands.run({
          command: "python3",
          args: [
            "-c",
            "import time; print('READY_TO_KILL',flush=True); time.sleep(30)",
          ],
          background: true,
          timeoutMs: 10000,
        });
        processId = process.processId;
        const output = await process.wait({
          async onStdout(chunk) {
            readinessOutput += chunk;
            if (!killRequested && readinessOutput.includes("READY_TO_KILL")) {
              await process.kill();
              killRequested = true;
            }
          },
        });
        return {
          status: killRequested && output.exitCode !== 0 ? "passed" : "error",
          scenario,
          processId,
          killRequested,
          readinessOutput,
          ...output,
        };
      }
      const program =
        scenario === "success"
          ? "import os; print('COMMAND_OK'); print(os.getcwd())"
          : scenario === "nonzero"
            ? "import sys; print('EXPECTED_NONZERO',file=sys.stderr); sys.exit(7)"
            : "import time; print('WAITING_FOR_TIMEOUT',flush=True); time.sleep(30)";
      const output = await computer.commands.run(
        {
          command: "python3",
          args: ["-c", program],
          timeoutMs: scenario === "timeout" ? 1000 : 10000,
        },
        deadline ? { signal: deadline } : {},
      );
      const passed =
        scenario === "success"
          ? output.exitCode === 0 && output.stdout.includes("COMMAND_OK")
          : scenario === "nonzero" &&
            output.exitCode === 7 &&
            output.stderr.includes("EXPECTED_NONZERO");
      return { status: passed ? "passed" : "error", scenario, ...output };
    });
    if (result.isErr()) {
      const error = result.error;
      const cause = error.cause instanceof Error ? error.cause : error;
      const elapsedMs = Date.now() - started;
      const expectedTermination =
        scenario === "terminate" &&
        killRequested &&
        readinessOutput.includes("READY_TO_KILL") &&
        (cause.message === "Computer process exited without an exit code." ||
          /terminated|killed/u.test(cause.message.toLowerCase()));
      const expectedTimeout =
        scenario === "timeout" &&
        deadline?.aborted === true &&
        deadline.reason?.name === "TimeoutError" &&
        !ctx.signal.aborted;
      return {
        status: expectedTermination || expectedTimeout ? "passed" : "error",
        scenario,
        ...(processId ? { processId } : {}),
        killRequested,
        readinessOutput,
        elapsedMs,
        expectedTermination,
        expectedTimeout,
        ...(deadline ? { deadlineExpired: deadline.aborted } : {}),
        error: {
          operation: "commands.run/wait",
          name: cause.name,
          message: cause.message,
        },
      };
    }
    return result.value;
  },
});
