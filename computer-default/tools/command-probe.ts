import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const infoSchema = z.object({ capabilities: z.array(z.string()) });

export default defineTool({
  name: "command_probe",
  description:
    "串行验证 Node 成功、非零退出、真实 timeout、后台 kill 和交互 stdin/EOF；不支持 processes 时明确报告，未知结果和清理失败不算通过。",
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
    const result = await Result.tryPromise(async () => {
      if (scenario === "terminate" || scenario === "interactive") {
        const info = infoSchema.parse(
          JSON.parse(
            await computer.workspace.readText(
              "provider-tests/default/info.json",
            ),
          ),
        );
        if (!info.capabilities.includes("processes"))
          return {
            status: "unsupported",
            scenario,
            reason: "This Computer does not advertise processes.",
            capabilities: info.capabilities,
          };
      }
      if (scenario === "interactive") {
        const process = await computer.commands.run({
          command: "node",
          args: [
            "-e",
            "let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{process.stdout.write(text);process.stderr.write('EOF_RECEIVED')})",
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
          command: "node",
          args: ["-e", "console.log('READY_TO_KILL');setTimeout(()=>{},30000)"],
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
          ? "console.log('COMMAND_OK');console.log(process.cwd())"
          : scenario === "nonzero"
            ? "process.stderr.write('EXPECTED_NONZERO');process.exitCode=7"
            : "console.log('WAITING_FOR_TIMEOUT');setTimeout(()=>{},30000)";
      const output = await computer.commands.run({
        command: "node",
        args: ["-e", program],
        timeoutMs: scenario === "timeout" ? 1000 : 10000,
      });
      const passed =
        scenario === "success"
          ? output.exitCode === 0 && output.stdout.includes("COMMAND_OK")
          : scenario === "nonzero" &&
            output.exitCode === 7 &&
            output.stderr.includes("EXPECTED_NONZERO");
      return { status: passed ? "passed" : "error", scenario, ...output };
    });
    if (result.isErr()) {
      const cause =
        result.error.cause instanceof Error ? result.error.cause : result.error;
      const code =
        "code" in cause && typeof cause.code === "string"
          ? cause.code
          : undefined;
      const outcome =
        "outcome" in cause && typeof cause.outcome === "string"
          ? cause.outcome
          : undefined;
      const expectedTermination =
        scenario === "terminate" &&
        cause.cause === undefined &&
        (outcome === undefined || outcome === "failed") &&
        killRequested &&
        readinessOutput.includes("READY_TO_KILL") &&
        ((code === "COMMAND_TERMINATED" && outcome === "failed") ||
          (code === undefined &&
            cause.message === "Computer process exited without an exit code."));
      const expectedTimeout =
        scenario === "timeout" &&
        !ctx.signal.aborted &&
        cause.cause === undefined &&
        (outcome === undefined || outcome === "failed") &&
        (code === undefined || code === "COMMAND_FAILED") &&
        (cause.name === "TimeoutError" ||
          /^(?:Computer command failed: )?(?:Computer process timed out\.|process timed out after \d+ms)$/.test(
            cause.message,
          ));
      return {
        status: expectedTermination || expectedTimeout ? "passed" : "error",
        scenario,
        ...(processId ? { processId } : {}),
        killRequested,
        readinessOutput,
        elapsedMs: Date.now() - started,
        expectedTermination,
        expectedTimeout,
        error: {
          operation: "commands.run/wait",
          name: cause.name,
          message: cause.message,
          ...(code ? { code } : {}),
          ...(outcome ? { outcome } : {}),
          ...(Array.isArray(cause.cause)
            ? {
                causes: cause.cause.map((error: unknown) =>
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : { message: String(error) },
                ),
              }
            : {}),
          ...(cause.cause instanceof Error
            ? {
                cause: { name: cause.cause.name, message: cause.cause.message },
              }
            : {}),
        },
      };
    }
    return { ...result.value, elapsedMs: Date.now() - started };
  },
});
