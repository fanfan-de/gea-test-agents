import type { ComputerSessionInitializer } from "@gea-ai/agent-sdk/computer";
import { Result } from "better-result";

export const initializeComputer: ComputerSessionInitializer = async ({
  use,
  ctx,
}) => {
  const computer = await use();
  const directory =
    "provider-tests/computer-device-test/" + encodeURIComponent(ctx.chatId);
  const probeDirectory = directory + "/initialization-" + crypto.randomUUID();
  await computer.mkdir({ path: probeDirectory, recursive: true });
  const streamPath = probeDirectory + "/stream.bin";
  let written = 0;
  await computer.writeFile({
    path: streamPath,
    content: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (written === 1024 * 1024) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(65536);
        for (let index = 0; index < chunk.length; index++)
          chunk[index] = (written + index) % 251;
        written += chunk.length;
        controller.enqueue(chunk);
      },
    }),
  });
  const stream = await computer.readFile({ path: streamPath });
  if (!stream) throw new Error("The file just written is missing.");
  const reader = stream.getReader();
  let streamedBytes = 0;
  let streamMatches = true;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    for (let index = 0; index < chunk.value.length; index++)
      if (chunk.value[index] !== (streamedBytes + index) % 251)
        streamMatches = false;
    streamedBytes += chunk.value.length;
  }
  reader.releaseLock();
  const binaryPath = probeDirectory + "/binary.bin";
  await computer.writeBinaryFile({
    path: binaryPath,
    content: new Uint8Array([0, 255, 128, 0, 255]),
  });
  const binary = await computer.readBinaryFile({ path: binaryPath });
  const text = "你好，Computer！\nsecond line\n";
  const source = probeDirectory + "/source.txt";
  const destination = probeDirectory + "/renamed.txt";
  await computer.writeTextFile({ path: source, content: text });
  await computer.rename({ source, destination });
  const savedText = await computer.readTextFile({ path: destination });
  const metadata = await computer.stat({ path: destination });
  const removed = probeDirectory + "/remove-only-this-test-file.txt";
  await computer.writeTextFile({ path: removed, content: "test-owned" });
  await computer.remove({ path: removed });
  const removedStat = await computer.stat({ path: removed });
  const skillPath = computer.roots.skills + "/skills/provider-check/marker.txt";
  const skillText = await computer.readTextFile({ path: skillPath });
  const skillWrite = await Result.tryPromise(() =>
    computer.writeTextFile({
      path: skillPath,
      content: "provider-check-marker\n",
    }),
  );
  const skillAfter = await computer.readTextFile({ path: skillPath });
  const report = {
    provider: "device",
    chatId: ctx.chatId,
    scope: ctx.scope,
    roots: computer.roots,
    capabilities: computer.capabilities,
    directory,
    probeDirectory,
    files: {
      streamedBytes,
      streamMatches: streamMatches && streamedBytes === 1024 * 1024,
      binaryHex: binary
        ? Array.from(binary, (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          )
        : null,
      textMatches: savedText === text,
      renameObserved:
        (await computer.stat({ path: source })) === null &&
        metadata?.type === "file",
      metadata,
      removeObserved: removedStat === null,
    },
    readonlySkill: {
      path: skillPath,
      text: skillText,
      unchanged: skillAfter === skillText,
      apiWrite: skillWrite.match({
        ok: () => ({ allowed: true }),
        err: (error) => ({
          allowed: false,
          message:
            error.cause instanceof Error ? error.cause.message : error.message,
        }),
      }),
      boundary:
        "File API protection; trusted shell permissions are best effort.",
    },
  };
  await computer.writeTextFile({
    path: directory + "/computer-info.json",
    content: JSON.stringify(report),
  });
};
