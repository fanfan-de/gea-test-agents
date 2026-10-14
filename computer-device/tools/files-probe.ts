import { defineTool } from "@gea-ai/agent-sdk";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "files_probe",
  description:
    "仅在 provider-tests/computer-device-test/note.txt 写入或只读检查；跨 Run/Chat 观察真实持久化与共享，read 不重建缺失文件。",
  input: z.object({
    mode: z.enum(["write", "read"]).default("write"),
    text: z.string().max(4096).default("provider-files-marker"),
  }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ mode, text }, ctx) {
    if (!ctx.computer)
      return { status: "unsupported", reason: "computer_not_enabled" };
    const directory = "provider-tests/computer-device-test";
    const path = directory + "/note.txt";
    const result = await Result.tryPromise(async () => {
      const infoPath =
        directory +
        "/" +
        encodeURIComponent(ctx.identity.chat.id) +
        "/computer-info.json";
      const info = z
        .object({ roots: z.object({ workspace: z.string() }) })
        .parse(JSON.parse(await ctx.computer!.workspace.readText(infoPath)));
      if (mode === "write") await ctx.computer!.workspace.writeText(path, text);
      const existence = await ctx.computer!.commands.run({
        command: "/usr/bin/python3",
        args: [
          "-c",
          "import json,pathlib,sys; print(json.dumps({'found':pathlib.Path(sys.argv[1]).is_file()}))",
          path,
        ],
        cwd: info.roots.workspace,
        timeoutMs: 10000,
      });
      if (existence.exitCode !== 0)
        return { status: "error", operation: "commands.run", ...existence };
      const { found } = z
        .object({ found: z.boolean() })
        .parse(JSON.parse(existence.stdout));
      if (!found)
        return {
          status: "passed",
          mode,
          path,
          found: false,
          chatId: ctx.identity.chat.id,
        };
      const savedText = await ctx.computer!.workspace.readText(path);
      return {
        status: "passed",
        mode,
        path,
        found: true,
        text: savedText,
        chatId: ctx.identity.chat.id,
      };
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        operation: "files_probe",
        message:
          error.cause instanceof Error ? error.cause.message : error.message,
      };
    }
    return result.value;
  },
});
