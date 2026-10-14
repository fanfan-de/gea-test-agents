import { defineTool } from "@gea-ai/agent-sdk";
import type { ComputerProtocolEvent } from "@gea-ai/agent-sdk/computer/protocol";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "application_probe",
  description:
    "可选应用协议 v1：真实二进制文件、stdin/EOF、输出事件和最终命令状态；不可用时明确 unsupported。",
  input: z.object({}),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute(_, ctx) {
    const computer = ctx.computer?.protocol;
    if (!computer)
      return {
        status: "unsupported",
        supported: false,
        reason:
          "e2b does not expose application protocol v1 in this execution.",
      };
    const directory = "provider-tests/e2b/application-" + crypto.randomUUID();
    const result = await Result.gen(async function* () {
      yield* Result.await(
        computer.fs.mkdir({ path: directory, recursive: true }),
      );
      yield* Result.await(
        computer.fs.writeFile({
          path: directory + "/input.bin",
          dataBase64: "AP+A",
          overwrite: false,
        }),
      );
      const command = yield* Result.await(
        computer.commands.start({
          cmd: "python3",
          args: [
            "-c",
            "import pathlib,sys; p=pathlib.Path(sys.argv[2]); data=p.read_bytes()+sys.stdin.buffer.read(); pathlib.Path(sys.argv[3]).write_bytes(data); sys.stdout.buffer.write(data); sys.stderr.write(sys.argv[1])",
            "literal $HOME 中文",
            directory + "/input.bin",
            directory + "/result.bin",
          ],
          timeoutMs: 10000,
        }),
      );
      yield* Result.await(
        computer.commands.writeStdin({
          commandId: command.commandId,
          dataBase64: "AP8=",
          end: true,
        }),
      );
      const events: ComputerProtocolEvent[] = [];
      let stdout = "";
      let stderr = "";
      for await (const item of command.events) {
        const event = yield* item;
        events.push(event);
        if (event.event === "command.output") {
          const data = atob(event.data.dataBase64);
          if (event.data.stream === "stdout") stdout += data;
          else stderr += data;
        }
      }
      const state = yield* Result.await(
        computer.commands.get({ commandId: command.commandId }),
      );
      const bytes = yield* Result.await(
        computer.fs.readFile({ path: directory + "/result.bin" }),
      );
      yield* Result.await(
        computer.fs.remove({ path: directory, recursive: true }),
      );
      const removed = yield* Result.await(
        computer.fs.stat({ path: directory }),
      );
      const stdoutHex = Array.from(stdout, (byte) =>
        byte.charCodeAt(0).toString(16).padStart(2, "0"),
      ).join("");
      const stderrText = new TextDecoder().decode(
        Uint8Array.from(stderr, (byte) => byte.charCodeAt(0)),
      );
      const passed =
        state.state === "exited" &&
        "exitCode" in state &&
        state.exitCode === 0 &&
        bytes.dataBase64 === "AP+AAP8=" &&
        stdoutHex === "00ff8000ff" &&
        stderrText === "literal $HOME 中文" &&
        removed.info === null;
      return Result.ok({
        status: passed ? "passed" : "error",
        supported: true,
        computerId: computer.computerId,
        executionId: computer.executionId,
        commandId: command.commandId,
        stdoutHex,
        stderrText,
        state,
        events,
        fileDataBase64: bytes.dataBase64,
        removed: removed.info === null,
      });
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        supported: true,
        error: {
          code: error.code,
          outcome: error.outcome,
          method: error.method,
          message: error.message,
        },
      };
    }
    return result.value;
  },
});
