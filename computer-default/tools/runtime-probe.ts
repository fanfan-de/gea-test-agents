import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const runtimeSchema = z.object({
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  cwd: z.string().min(1),
  argv: z.string(),
  environment: z.string(),
  stdin: z.string(),
});

export default defineTool({
  name: "runtime_probe",
  description:
    "实际运行 Node，检查版本、cwd 和包含中文及 shell 符号的字面 argv/env/stdin；不读取其他环境变量。",
  input: z.object({}),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute(_, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const label = "literal $HOME ' \" $(echo should-not-run) 中文";
    const stdin = "stdin $HOME\n中文";
    const result = await Result.tryPromise(async () => {
      const output = await computer.commands.run({
        command: "node",
        args: [
          "-e",
          "const fs=require('node:fs'); process.stdout.write(JSON.stringify({nodeVersion:process.version,platform:process.platform,arch:process.arch,cwd:process.cwd(),argv:process.argv[1],environment:process.env.GEA_COMPUTER_PROBE,stdin:fs.readFileSync(0,'utf8')}))",
          label,
        ],
        env: { GEA_COMPUTER_PROBE: label },
        stdin,
        timeoutMs: 10000,
      });
      if (output.exitCode !== 0)
        return {
          status: "error",
          error: { operation: "runtime_probe.node", ...output },
        };
      const runtime = runtimeSchema.parse(JSON.parse(output.stdout));
      const argvMatches = runtime.argv === label;
      const environmentMatches = runtime.environment === label;
      const stdinMatches = runtime.stdin === stdin;
      return {
        status:
          argvMatches && environmentMatches && stdinMatches
            ? "passed"
            : "error",
        ...runtime,
        argvMatches,
        environmentMatches,
        stdinMatches,
        exitCode: output.exitCode,
      };
    });
    if (result.isErr()) {
      const error =
        result.error.cause instanceof Error ? result.error.cause : result.error;
      return {
        status: "error",
        error: {
          operation: "runtime_probe",
          name: error.name,
          message: error.message,
        },
      };
    }
    return result.value;
  },
});
