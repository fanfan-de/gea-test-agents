import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const binaryReadbackSchema = z.object({
  inputHex: z.string(),
  stdinHex: z.string(),
  resultHex: z.string(),
  size: z.number().int().nonnegative(),
});

export default defineTool({
  name: "binary_program",
  description:
    "真实 Python 进程写入和读回二进制文件，返回程序计算的 hex，并检查字面参数。公开 commands API 的 stdin/stdout 是文本，本测试不验证原始二进制传输。",
  input: z.object({ label: z.string().max(1024).default("hello $HOME") }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ label }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return { error: { message: "当前 Agent 未启用 Computer。" } };
    const result = await Result.tryPromise(async () => {
      const command = await computer.commands.run({
        command: "/usr/bin/python3",
        args: [
          "-c",
          "import base64,json,pathlib,sys; source=pathlib.Path('input.bin'); source.write_bytes(bytes([0,255,128])); incoming=base64.b64decode(sys.stdin.read(),validate=True); target=pathlib.Path('result.bin'); target.write_bytes(source.read_bytes()+incoming); actual=target.read_bytes(); print(json.dumps({'inputHex':source.read_bytes().hex(),'stdinHex':incoming.hex(),'resultHex':actual.hex(),'size':target.stat().st_size})); sys.stderr.write(sys.argv[1])",
          label,
        ],
        stdin: "AP8=",
        timeoutMs: 10000,
      });
      if (command.exitCode !== 0)
        return { error: { operation: "commands.run", ...command } };
      return {
        ...binaryReadbackSchema.parse(JSON.parse(command.stdout)),
        stderrText: command.stderr,
        exitCode: command.exitCode,
        transport: "UTF-8 text; hex is computed from actual binary file bytes",
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        error: {
          operation: "commands.run",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
