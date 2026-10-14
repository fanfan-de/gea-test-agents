import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const entriesSchema = z.array(
  z.union([
    z.string(),
    z.object({ name: z.string(), path: z.string().optional() }),
  ]),
);

const programResultSchema = z.object({
  inputHex: z.string(),
  resultHex: z.string(),
  size: z.number().int(),
  label: z.string(),
  stdinText: z.string(),
  environment: z.string(),
  removed: z.boolean(),
});

export default defineTool({
  name: "files_probe",
  description:
    "通过 workspace API 写读 note.txt；通过真实 Python 验证二进制文件和字面 argv/env/stdin。read 模式只检查已有 note，绝不补写。",
  input: z.object({
    mode: z.enum(["write", "read"]).default("write"),
    text: z.string().max(4096).default("你好，Computer！"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ mode, text }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const root = "provider-tests/remote";
    const path = root + "/note.txt";
    const result = await Result.tryPromise(async () => {
      if (mode === "read") {
        const entries = entriesSchema.parse(
          await computer.workspace.list(root),
        );
        const found = entries.some((entry) =>
          typeof entry === "string"
            ? entry === "note.txt" || entry.endsWith("/note.txt")
            : entry.name === "note.txt",
        );
        return {
          status: "passed",
          mode,
          path,
          found,
          ...(found ? { text: await computer.workspace.readText(path) } : {}),
          entries,
        };
      }
      await computer.workspace.writeText(path, text);
      const saved = await computer.workspace.readText(path);
      const label = "literal $HOME ' \" $(echo should-not-run) 中文";
      const stdinText = "stdin $HOME\n中文";
      const binaryPath = root + "/probes/files-" + crypto.randomUUID() + ".bin";
      const command = await computer.commands.run({
        command: "python3",
        args: [
          "-c",
          "import json,os,pathlib,sys; p=pathlib.Path(sys.argv[2]); incoming=sys.stdin.read(); source=bytes([0,255,128]); p.write_bytes(source+bytes([0,255])); actual=p.read_bytes(); p.unlink(); print(json.dumps({'inputHex':source.hex(),'resultHex':actual.hex(),'size':len(actual),'label':sys.argv[1],'stdinText':incoming,'environment':os.environ['PROVIDER_TEST_VALUE'],'removed':not p.exists()},ensure_ascii=False))",
          label,
          binaryPath,
        ],
        env: { PROVIDER_TEST_VALUE: label },
        stdin: stdinText,
        timeoutMs: 10000,
      });
      if (command.exitCode !== 0)
        return {
          status: "error",
          mode,
          path,
          error: { operation: "files_probe.python", ...command },
        };
      const binary = programResultSchema.parse(JSON.parse(command.stdout));
      const matches = saved === text;
      const binaryMatches =
        binary.inputHex === "00ff80" &&
        binary.resultHex === "00ff8000ff" &&
        binary.size === 5 &&
        binary.label === label &&
        binary.stdinText === stdinText &&
        binary.environment === label &&
        binary.removed;
      return {
        status: matches && binaryMatches ? "passed" : "error",
        mode,
        path,
        found: true,
        text: saved,
        matches,
        binaryMatches,
        binary,
        entries: await computer.workspace.list(root),
        exitCode: command.exitCode,
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        error: {
          operation: "files_probe",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
