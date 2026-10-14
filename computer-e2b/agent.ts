import { defineAgent } from "@gea-ai/agent-sdk";
import { secret } from "@gea-ai/agent-sdk/computer";
import { e2b } from "@gea-ai/computer-e2b";

export default defineAgent({
  name: "Computer-E2B-Test",
  slug: "computer-e2b-test",
  model: "qwen3.7-plus",
  computer: e2b({
    apiKey: secret("E2B_API_KEY"),
    template: "base",
    timeoutMs: 300000,
    requires: ["shell", "exec", "processes", "files", "readonly-mounts"],
    filesystem: {
      durability: "ephemeral",
      files: { "provider-tests/e2b/seed.txt": "e2b seed\n" },
    },

    async onSession({ use, ctx }) {
      const computer = await use();
      const root = "provider-tests/e2b";
      const probeDir = root + "/probes/" + crypto.randomUUID();
      await computer.mkdir({ path: probeDir, recursive: true });
      const expected = new Uint8Array([0, 255, 128, 65, 10]);
      await computer.writeBinaryFile({
        path: probeDir + "/bytes.bin",
        content: expected,
      });
      const binary = await computer.readBinaryFile({
        path: probeDir + "/bytes.bin",
      });
      await computer.writeFile({
        path: probeDir + "/stream.bin",
        content: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(expected.slice(0, 2));
            controller.enqueue(expected.slice(2));
            controller.close();
          },
        }),
      });
      const stream = await computer.readFile({
        path: probeDir + "/stream.bin",
      });
      if (!stream) throw new Error("The written stream file is missing.");
      const reader = stream.getReader();
      const streamed: number[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          streamed.push(...chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      await computer.writeTextFile({
        path: probeDir + "/source.txt",
        content: "中文 file probe\n",
      });
      await computer.rename({
        source: probeDir + "/source.txt",
        destination: probeDir + "/renamed.txt",
      });
      const [text, metadata, entries, seed] = await Promise.all([
        computer.readTextFile({ path: probeDir + "/renamed.txt" }),
        computer.stat({ path: probeDir + "/bytes.bin" }),
        computer.listFiles({ path: probeDir }),
        computer.readTextFile({ path: root + "/seed.txt" }),
      ]);
      await computer.remove({ path: probeDir, recursive: true });
      const removed = await computer.stat({ path: probeDir });
      const filesystemProbe = {
        binary:
          binary !== null &&
          expected.every((byte, index) => binary[index] === byte) &&
          binary.length === expected.length,
        stream:
          streamed.length === expected.length &&
          expected.every((byte, index) => streamed[index] === byte),
        rename:
          text === "中文 file probe\n" &&
          entries.some((entry) => entry.name === "renamed.txt") &&
          !entries.some((entry) => entry.name === "source.txt"),
        stat: metadata?.type === "file" && metadata.size === expected.length,
        remove: removed === null,
        seed: seed === "e2b seed\n",
      };
      if (Object.values(filesystemProbe).some((passed) => !passed))
        throw new Error("Public Computer filesystem verification failed.");
      const python = await computer.commands.run({
        command: "python3",
        args: ["--version"],
        timeoutMs: 10000,
      });
      if (python.exitCode !== 0)
        throw new Error("The provider needs Python 3 in PATH.");
      await computer.writeTextFile({
        path: root + "/info.json",
        content: JSON.stringify({
          provider: "e2b",
          chatId: ctx.chatId,
          scope: ctx.scope,
          roots: computer.roots,
          capabilities: computer.capabilities,
          filesystemProbe,
          pythonVersion: (python.stdout + python.stderr).trim(),
        }),
      });
    },
  }),
});
