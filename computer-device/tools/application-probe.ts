import { defineTool } from "@gea-ai/agent-sdk";
import type { ComputerProtocolEvent } from "@gea-ai/agent-sdk/computer/protocol";
import { Result } from "better-result";
import { z } from "zod";

export default defineTool({
  name: "application_probe",
  description:
    "可选 application v1：实际写入二进制、字面 Python argv、二进制 stdin/EOF、消费事件并读取结果；没有协议时明确 unsupported。",
  input: z.object({ label: z.string().max(1024).default("hello $HOME") }),
  permissions: { workspace: ["read", "write"], commands: true },
  async execute({ label }, ctx) {
    const protocol = ctx.computer?.protocol;
    if (!protocol)
      return {
        status: "unsupported",
        reason: "application_protocol_v1_not_advertised",
      };
    const directory =
      "provider-tests/computer-device-test/" +
      encodeURIComponent(ctx.identity.chat.id) +
      "/application-" +
      crypto.randomUUID();
    const result = await Result.gen(async function* () {
      const metadata = yield* Result.await(protocol.get());
      const execution = metadata.currentExecution;
      if (!execution)
        return Result.ok({
          status: "unsupported",
          reason: "no_current_execution",
        });
      yield* Result.await(
        protocol.fs.mkdir({ path: directory, recursive: true }),
      );
      yield* Result.await(
        protocol.fs.writeFile({
          path: directory + "/input.bin",
          dataBase64: "AP+A",
          overwrite: false,
        }),
      );
      const command = yield* Result.await(
        protocol.commands.start({
          cmd: "/usr/bin/python3",
          args: [
            "-c",
            "import pathlib,sys; data=pathlib.Path('input.bin').read_bytes()+sys.stdin.buffer.read(); pathlib.Path('result.bin').write_bytes(data); sys.stdout.buffer.write(data); sys.stderr.write(sys.argv[1])",
            label,
          ],
          cwd: execution.roots.workspace + "/" + directory,
          timeoutMs: 10000,
        }),
      );
      yield* Result.await(
        protocol.commands.writeStdin({
          commandId: command.commandId,
          dataBase64: "AP8=",
          end: true,
        }),
      );
      const events: ComputerProtocolEvent[] = [];
      for await (const event of command.events) events.push(yield* event);
      const state = yield* Result.await(
        protocol.commands.get({ commandId: command.commandId }),
      );
      const file = yield* Result.await(
        protocol.fs.readFile({ path: directory + "/result.bin" }),
      );
      const passed =
        state.state === "exited" &&
        "exitCode" in state &&
        state.exitCode === 0 &&
        file.dataBase64 === "AP+AAP8=";
      return Result.ok({
        status: passed ? "passed" : "error",
        directory,
        commandId: command.commandId,
        metadata,
        state,
        events,
        file,
      });
    });
    if (result.isErr()) {
      const error = result.error;
      return {
        status: "error",
        code: error.code,
        outcome: error.outcome,
        method: error.method,
        message: error.message,
      };
    }
    return result.value;
  },
});
