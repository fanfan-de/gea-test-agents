import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "command_demo",
  description:
    "用公开 commands.run 测试正常退出、非零退出、超时和后台进程 kill；如实返回文本输出、退出码或 API 错误。",
  input: z.object({
    scenario: z.enum(["success", "nonzero", "timeout", "terminate"]),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ scenario }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return { error: { message: "当前 Agent 未启用 Computer。" } };
    const programs = {
      success:
        "import os,pathlib; print('Computer command executed'); print(os.getcwd()); p=pathlib.Path('manual/note.txt'); print('saved note: '+p.read_text() if p.exists() else 'saved note: absent')",
      nonzero:
        "import sys; print('ordinary nonzero exit',file=sys.stderr); sys.exit(7)",
      timeout: "import time; print('waiting',flush=True); time.sleep(30)",
      terminate: "import time; print('ready',flush=True); time.sleep(30)",
    };
    let processId: string | undefined;
    let killRequested = false;
    const result = await Result.tryPromise(async () => {
      if (scenario === "terminate") {
        const process = await computer.commands.run({
          command: "/usr/bin/python3",
          args: ["-c", programs[scenario]],
          background: true,
          timeoutMs: 10000,
        });
        processId = process.processId;
        let readinessOutput = "";
        const output = await process.wait({
          async onStdout(chunk) {
            readinessOutput += chunk;
            if (!killRequested && readinessOutput.includes("ready")) {
              killRequested = true;
              await process.kill();
            }
          },
        });
        return {
          scenario,
          processId,
          killRequested,
          ...output,
        };
      }
      const output = await computer.commands.run({
        command: "/usr/bin/python3",
        args: ["-c", programs[scenario]],
        timeoutMs: scenario === "timeout" ? 1000 : 10000,
      });
      return { scenario, ...output };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        scenario,
        ...(scenario === "terminate" ? { processId, killRequested } : {}),
        error: {
          operation: "commands.run",
          name: error.cause instanceof Error ? error.cause.name : error.name,
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
