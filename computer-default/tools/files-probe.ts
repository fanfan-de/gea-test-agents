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
  unicodeText: z.string(),
  removed: z.boolean(),
});

export default defineTool({
  name: "files_probe",
  description:
    "显式验证 workspace 文本、中文空格路径、Node 二进制读写/改名/删除及命令与文件 API 同源。read 只观察 note，绝不补写。",
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
    const root = "provider-tests/default";
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
      const probeDir = root + "/probes/" + crypto.randomUUID();
      const unicodePath = probeDir + "/中文 空格.txt";
      const commandPath = probeDir + "/命令 output.txt";
      const unicodeText = "中文 file API → command\n";
      const commandText = "命令 → 文件 API\n";
      await computer.workspace.writeText(path, text);
      await computer.workspace.writeText(unicodePath, unicodeText);
      const [saved, unicodeSaved] = await Promise.all([
        computer.workspace.readText(path),
        computer.workspace.readText(unicodePath),
      ]);
      const output = await computer.commands.run({
        command: "node",
        args: [
          "-e",
          "const fs=require('node:fs'),path=require('node:path');const [dir,source,target,text]=process.argv.slice(1);const input=Buffer.from([0,255,128]),a=path.join(dir,'bytes.bin'),b=path.join(dir,'renamed.bin');fs.writeFileSync(a,Buffer.concat([input,Buffer.from([0,255])]));fs.renameSync(a,b);const bytes=fs.readFileSync(b),size=fs.statSync(b).size;fs.unlinkSync(b);fs.writeFileSync(target,text);process.stdout.write(JSON.stringify({inputHex:input.toString('hex'),resultHex:bytes.toString('hex'),size,unicodeText:fs.readFileSync(source,'utf8'),removed:!fs.existsSync(a)&&!fs.existsSync(b)}))",
          probeDir,
          unicodePath,
          commandPath,
          commandText,
        ],
        timeoutMs: 10000,
      });
      if (output.exitCode !== 0)
        return {
          status: "error",
          mode,
          path,
          probeDir,
          error: { operation: "files_probe.node", ...output },
        };
      const binary = programResultSchema.parse(JSON.parse(output.stdout));
      const commandSaved = await computer.workspace.readText(commandPath);
      const cleanup = await computer.commands.run({
        command: "node",
        args: [
          "-e",
          "require('node:fs').rmSync(process.argv[1],{recursive:true})",
          probeDir,
        ],
        timeoutMs: 10000,
      });
      if (cleanup.exitCode !== 0)
        return {
          status: "error",
          mode,
          path,
          probeDir,
          error: { operation: "files_probe.cleanup", ...cleanup },
        };
      const matches = saved === text;
      const binaryMatches =
        binary.inputHex === "00ff80" &&
        binary.resultHex === "00ff8000ff" &&
        binary.size === 5 &&
        binary.removed;
      const unicodeMatches =
        unicodeSaved === unicodeText && binary.unicodeText === unicodeText;
      const commandFileMatches = commandSaved === commandText;
      return {
        status:
          matches && binaryMatches && unicodeMatches && commandFileMatches
            ? "passed"
            : "error",
        mode,
        path,
        found: true,
        text: saved,
        matches,
        binaryMatches,
        unicodeMatches,
        commandFileMatches,
        binary,
        entries: await computer.workspace.list(root),
        exitCode: output.exitCode,
      };
    });
    if (result.isErr()) {
      const error =
        result.error.cause instanceof Error ? result.error.cause : result.error;
      return {
        status: "error",
        error: {
          operation: "files_probe",
          name: error.name,
          message: error.message,
        },
      };
    }
    return result.value;
  },
});
