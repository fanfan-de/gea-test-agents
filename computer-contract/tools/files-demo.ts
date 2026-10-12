import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

const fileOperationsSchema = z.object({
  directoryCreated: z.boolean(),
  renamed: z.boolean(),
  removed: z.boolean(),
  metadata: z.object({
    size: z.number().int().nonnegative(),
    modifiedAt: z.number(),
  }),
});

export default defineTool({
  name: "files_demo",
  description:
    "用公开 workspace API 写入、读取、列目录，再通过真实 Python 进程验证 mkdir、rename、stat 和 remove。保留 manual/note.txt。",
  input: z.object({
    text: z.string().min(1).max(4096).default("你好，Computer！"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ text }, ctx) {
    const computer = ctx.computer;
    if (!computer)
      return { error: { message: "当前 Agent 未启用 Computer。" } };
    const result = await Result.tryPromise(async () => {
      const createDirectory = await computer.commands.run({
        command: "/usr/bin/python3",
        args: [
          "-c",
          "import pathlib; pathlib.Path('manual').mkdir(parents=True,exist_ok=True)",
        ],
        timeoutMs: 10000,
      });
      if (createDirectory.exitCode !== 0)
        return {
          error: {
            operation: "files_demo.createDirectory",
            ...createDirectory,
          },
        };
      await computer.workspace.writeText("manual/message.txt", text);
      const command = await computer.commands.run({
        command: "/usr/bin/python3",
        args: [
          "-c",
          "import json,pathlib; root=pathlib.Path('manual'); directory=root/'created-directory'; directory.mkdir(parents=True,exist_ok=True); source=root/'message.txt'; target=root/'note.txt'; source.replace(target); metadata=target.stat(); temporary=root/'to-remove.txt'; temporary.write_text('x'); temporary.unlink(); print(json.dumps({'directoryCreated':directory.is_dir(),'renamed':target.is_file() and not source.exists(),'removed':not temporary.exists(),'metadata':{'size':metadata.st_size,'modifiedAt':metadata.st_mtime}}))",
        ],
        timeoutMs: 10000,
      });
      if (command.exitCode !== 0)
        return { error: { operation: "files_demo", ...command } };
      const operations = fileOperationsSchema.parse(JSON.parse(command.stdout));
      const [savedText, entries] = await Promise.all([
        computer.workspace.readText("manual/note.txt"),
        computer.workspace.list("manual"),
      ]);
      return {
        path: "manual/note.txt",
        text: savedText,
        ...operations,
        entries,
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        error: {
          operation: "files_demo",
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        },
      };
    }
    return result.value;
  },
});
