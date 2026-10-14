import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const successSchema = z.object({
  label: z.string(),
  stdin: z.string(),
  note: z.string().nullable(),
});
export default defineTool({
  name: "command_probe",
  description:
    "串行验证真实 Python 字面 argv/文本 stdin、非零退出、超时和后台 wait/kill；预期失败也必须匹配实际观察。",
  input: z.object({
    scenario: z.enum(["success", "nonzero", "timeout", "terminate"]),
    label: z.string().max(1024).default("hello $HOME"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ scenario, label }, ctx) {
    if (!ctx.computer)
      return { status: "unsupported", reason: "computer_not_enabled" };
    let processId: string | undefined;
    let killRequested = false;
    let readinessOutput = "";
    let deadline: AbortSignal | undefined;
    const started = Date.now();
    const result = await Result.tryPromise(async () => {
      const directory =
        "provider-tests/computer-local-test/" +
        encodeURIComponent(ctx.identity.chat.id);
      const info = z
        .object({ roots: z.object({ workspace: z.string() }) })
        .parse(
          JSON.parse(
            await ctx.computer!.workspace.readText(
              directory + "/computer-info.json",
            ),
          ),
        );
      const cwd = info.roots.workspace + "/" + directory;
      const programs = {
        success:
          "import json,pathlib,sys; p=pathlib.Path('../note.txt'); print(json.dumps({'label':sys.argv[1],'stdin':sys.stdin.read(),'note':p.read_text() if p.exists() else None},ensure_ascii=False))",
        nonzero:
          "import sys; print('ordinary nonzero exit',file=sys.stderr); sys.exit(7)",
        timeout: "import time; print('waiting',flush=True); time.sleep(30)",
        terminate:
          "import time; print('READY_TO_KILL',flush=True); time.sleep(30)",
      };
      if (scenario === "terminate") {
        const process = await ctx.computer!.commands.run({
          command: "/usr/bin/python3",
          args: ["-c", programs[scenario]],
          cwd,
          background: true,
          timeoutMs: 10000,
        });
        processId = process.processId;
        return await process.wait({
          async onStdout(chunk) {
            readinessOutput += chunk;
            if (!killRequested && readinessOutput.includes("READY_TO_KILL")) {
              await process.kill();
              killRequested = true;
            }
          },
        });
      }
      deadline = scenario === "timeout" ? AbortSignal.timeout(1000) : undefined;
      return await ctx.computer!.commands.run(
        {
          command: "/usr/bin/python3",
          args: ["-c", programs[scenario], label],
          cwd,
          stdin: scenario === "success" ? "你好 stdin\n" : undefined,
          timeoutMs: 10000,
        },
        deadline ? { signal: deadline } : {},
      );
    });
    const elapsedMs = Date.now() - started;
    if (result.isErr()) {
      const error = result.error;
      const cause = error.cause instanceof Error ? error.cause : error;
      const expectedTimeout =
        scenario === "timeout" &&
        deadline?.aborted === true &&
        deadline.reason?.name === "TimeoutError" &&
        (cause.name === "TimeoutError" ||
          /timeout|timed out|request cancelled|operation was aborted|deadline exceeded|interrupted/iu.test(
            cause.message,
          ));
      const expectedTermination =
        scenario === "terminate" &&
        processId !== undefined &&
        killRequested &&
        readinessOutput.includes("READY_TO_KILL") &&
        (/terminated|killed|cancelled|canceled/iu.test(cause.message) ||
          cause.message === "Computer process exited without an exit code.");
      return {
        status: expectedTimeout || expectedTermination ? "passed" : "error",
        scenario,
        ...(processId ? { processId } : {}),
        killRequested,
        readinessOutput,
        elapsedMs,
        expectedTimeout,
        expectedTermination,
        ...(deadline
          ? {
              deadlineExpired: deadline.aborted,
              deadlineReason: deadline.aborted
                ? String(deadline.reason?.name ?? "unknown")
                : null,
            }
          : {}),
        error: {
          operation: "commands.run/wait",
          name: cause.name,
          message: cause.message,
        },
      };
    }
    const output = result.value;
    const expectedTermination =
      scenario === "terminate" &&
      processId !== undefined &&
      killRequested &&
      readinessOutput.includes("READY_TO_KILL") &&
      output.exitCode !== 0;
    let passed: boolean = expectedTermination;
    if (scenario === "nonzero")
      passed =
        output.exitCode === 7 &&
        output.stderr.includes("ordinary nonzero exit");
    if (scenario === "success" && output.exitCode === 0) {
      const parsed = Result.try(() =>
        successSchema.parse(JSON.parse(output.stdout)),
      );
      passed =
        parsed.isOk() &&
        parsed.value.label === label &&
        parsed.value.stdin === "你好 stdin\n";
    }
    return {
      status: passed ? "passed" : "error",
      scenario,
      ...(processId ? { processId } : {}),
      killRequested,
      readinessOutput,
      elapsedMs,
      expectedTimeout: false,
      expectedTermination,
      ...output,
    };
  },
});
