import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const entriesSchema = z.array(
  z.union([
    z.string(),
    z.object({ name: z.string(), path: z.string().optional() }),
  ]),
);

export default defineTool({
  name: "files_probe",
  description:
    "workspace API 写读 note 并与虚拟 shell cat 核对；read 只观察，不重建文件。",
  input: z.object({
    mode: z.enum(["write", "read"]).default("write"),
    text: z.string().max(4096).default("你好，just-bash！"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ mode, text }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return {
        status: "error",
        error: { message: "Computer is unavailable." },
      };
    const path = "provider-tests/justbash/note.txt";
    const result = await Result.tryPromise(async () => {
      if (mode === "write") await computer.workspace.writeText(path, text);
      const entries = entriesSchema.parse(
        await computer.workspace.list("provider-tests/justbash"),
      );
      const found = entries.some((entry) =>
        typeof entry === "string"
          ? entry === "note.txt" || entry.endsWith("/note.txt")
          : entry.name === "note.txt",
      );
      if (!found)
        return {
          status: mode === "read" ? "passed" : "error",
          mode,
          path,
          found: false,
        };
      const actual = await computer.workspace.readText(path);
      const shell = await computer.commands.run({
        command: "cat",
        args: [path],
      });
      const matches =
        shell.exitCode === 0 &&
        shell.stdout === actual &&
        (mode === "read" || actual === text);
      return {
        status: matches ? "passed" : "error",
        mode,
        path,
        found,
        text: actual,
        matches,
        entries,
        stdout: shell.stdout,
        stderr: shell.stderr,
        exitCode: shell.exitCode,
      };
    });
    if (result.isErr())
      return {
        status: "error",
        error: {
          operation: "files_probe",
          message:
            result.error.cause instanceof Error
              ? result.error.cause.message
              : result.error.message,
        },
      };
    return result.value;
  },
});
