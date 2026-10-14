import { defineAgent } from "@gea-ai/agent-sdk";
import { justbash } from "@gea-ai/agent-sdk/computer/just-bash";

export default defineAgent({
  name: "Computer-Justbash-Test",
  slug: "computer-justbash-test",
  model: "qwen3.7-plus",
  computer: justbash({
    requires: ["shell", "files", "readonly-mounts"],
    filesystem: {
      durability: "ephemeral",
      files: { "provider-tests/justbash/seed.txt": "just-bash seed\n" },
    },
    async onSession({ use, ctx }) {
      const computer = await use();
      const directory = "provider-tests/justbash/probes/" + crypto.randomUUID();
      await computer.mkdir({ path: directory, recursive: true });
      const bytes = Uint8Array.from(
        { length: 4097 },
        (_, index) => index % 256,
      );
      await computer.writeFile({
        path: directory + "/stream.bin",
        content: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 2048));
            controller.enqueue(bytes.subarray(2048));
            controller.close();
          },
        }),
      });
      const actual = await computer.readBinaryFile({
        path: directory + "/stream.bin",
      });
      if (
        !actual ||
        actual.length !== bytes.length ||
        actual.some((byte, index) => byte !== bytes[index])
      )
        throw new Error("just-bash stream/binary roundtrip failed.");
      await computer.writeTextFile({
        path: directory + "/source.txt",
        content: "中文\nsecond line\n",
      });
      await computer.rename({
        source: directory + "/source.txt",
        destination: directory + "/renamed.txt",
      });
      const [text, stat, entries, seed] = await Promise.all([
        computer.readTextFile({ path: directory + "/renamed.txt" }),
        computer.stat({ path: directory + "/stream.bin" }),
        computer.listFiles({ path: directory }),
        computer.readTextFile({ path: "provider-tests/justbash/seed.txt" }),
      ]);
      const renamed =
        entries.some((entry) => entry.name === "renamed.txt") &&
        !entries.some((entry) => entry.name === "source.txt");
      if (
        text !== "中文\nsecond line\n" ||
        stat?.type !== "file" ||
        stat.size !== bytes.length ||
        !renamed ||
        seed !== "just-bash seed\n"
      )
        throw new Error(
          "just-bash rename/text/stat/list/seed verification failed.",
        );
      await computer.remove({ path: directory, recursive: true });
      if (await computer.stat({ path: directory }))
        throw new Error("just-bash remove failed.");
      await computer.writeTextFile({
        path: "provider-tests/justbash/info.json",
        content: JSON.stringify({
          status: "passed",
          provider: "just-bash",
          chatId: ctx.chatId,
          scope: ctx.scope,
          roots: computer.roots,
          capabilities: computer.capabilities,
          filesystemProbe: {
            status: "passed",
            streamBytes: actual.length,
            binaryMatches: true,
            textMatches: true,
            renamed: true,
            removed: true,
            seed: true,
          },
        }),
      });
    },
  }),
});
