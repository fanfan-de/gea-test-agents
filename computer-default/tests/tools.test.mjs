import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { fsCache: false });
const load = async (path) => (await jiti.import(join(project, path))).default;
const agent = await load("agent.ts");
const filesProbe = await load("tools/files-probe.ts");
const commandProbe = await load("tools/command-probe.ts");
const computerInfo = await load("tools/computer-info.ts");

async function fixture(
  t,
  capabilities = ["shell", "exec", "files", "readonly-mounts", "processes"],
) {
  const directory = await mkdtemp(join(tmpdir(), "gea-computer-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const info = {
    provider: "default",
    chatId: "fixture-chat",
    scope: { type: "chat" },
    roots: {
      workspace: directory,
      artifacts: "/artifacts",
      skills: "/.agents",
      tmp: "/tmp",
    },
    capabilities,
  };
  const workspace = {
    async list(path) {
      return readdir(join(directory, path));
    },
    async readText(path) {
      return readFile(join(directory, path), "utf8");
    },
    async writeText(path, text) {
      const destination = join(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text);
    },
  };
  await workspace.writeText(
    "provider-tests/default/info.json",
    JSON.stringify(info),
  );
  const commands = {
    async run(input, options = {}) {
      const child = spawn(
        input.command === "node" ? process.execPath : input.command,
        input.args ?? [],
        {
          cwd: input.cwd ?? directory,
          env: { ...process.env, ...input.env },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let stdout = "",
        stderr = "",
        callbacks = Promise.resolve(),
        timeout;
      let waitOptions = options;
      let failure;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        callbacks = callbacks.then(() => waitOptions.onStdout?.(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        callbacks = callbacks.then(() => waitOptions.onStderr?.(chunk));
      });
      const result = new Promise((resolveResult, reject) => {
        child.once("error", reject);
        child.once("close", async (exitCode) => {
          clearTimeout(timeout);
          await callbacks;
          if (failure) reject(failure);
          else if (exitCode === null)
            reject(
              Object.assign(new Error("process terminated"), {
                code: "COMMAND_TERMINATED",
                outcome: "failed",
              }),
            );
          else resolveResult({ stdout, stderr, exitCode });
        });
      });
      timeout = setTimeout(() => {
        failure = new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
        child.kill();
      }, input.timeoutMs ?? 10000);
      if (typeof input.stdin === "string") child.stdin.end(input.stdin);
      else if (input.stdin !== true) child.stdin.end();
      if (!input.background) return result;
      return {
        processId: String(child.pid),
        wait(next = {}) {
          waitOptions = { ...options, ...next };
          return result;
        },
        async sendStdin(data, opts = {}) {
          if (opts.end) child.stdin.end(data);
          else child.stdin.write(data);
        },
        async kill() {
          child.kill();
        },
      };
    },
  };
  return {
    directory,
    info,
    ctx: {
      computer: { workspace, commands },
      signal: new AbortController().signal,
    },
  };
}

test("initialization records metadata without running probes or requiring a runtime", async () => {
  const written = [];
  const computer = {
    roots: {
      workspace: "/workspace",
      artifacts: "/artifacts",
      skills: "/.agents",
      tmp: "/tmp",
    },
    capabilities: ["shell", "exec", "files", "readonly-mounts"],
    async writeTextFile(value) {
      written.push(value);
    },
  };
  await agent.computer.onSession({
    use: async () => computer,
    ctx: { chatId: "test", scope: { type: "chat" } },
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].path, "provider-tests/default/info.json");
  assert.deepEqual(
    JSON.parse(written[0].content).capabilities,
    computer.capabilities,
  );
  assert.equal(agent.computer.requires.includes("processes"), false);
});

test("computer_info remains usable with metadata only", async (t) => {
  const { ctx, info } = await fixture(t, [
    "shell",
    "exec",
    "files",
    "readonly-mounts",
  ]);
  const result = await computerInfo.execute({}, ctx);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.capabilities, info.capabilities);
  assert.equal(result.chatId, info.chatId);
});

test("file probe verifies Unicode paths, bytes and command/file interoperability", async (t) => {
  const { ctx, directory } = await fixture(t);
  const result = await filesProbe.execute(
    { mode: "write", text: "唯一 token 中文" },
    ctx,
  );
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.matches, true);
  assert.equal(result.binaryMatches, true);
  assert.equal(result.unicodeMatches, true);
  assert.equal(result.commandFileMatches, true);
  assert.equal(
    await readFile(join(directory, "provider-tests/default/note.txt"), "utf8"),
    "唯一 token 中文",
  );
  assert.deepEqual(
    await readdir(join(directory, "provider-tests/default/probes")),
    [],
  );
  const reread = await filesProbe.execute({ mode: "read" }, ctx);
  assert.equal(reread.found, true);
  assert.equal(reread.text, "唯一 token 中文");
});

test("read mode observes missing files without writing them", async (t) => {
  const { ctx, directory } = await fixture(t);
  const result = await filesProbe.execute(
    { mode: "read", text: "must not write" },
    ctx,
  );
  assert.equal(result.found, false);
  assert.equal(
    (await readdir(join(directory, "provider-tests/default"))).includes(
      "note.txt",
    ),
    false,
  );
});

test("runtime probe checks actual Node literal argv, environment and stdin", async (t) => {
  const runtimeProbe = await load("tools/runtime-probe.ts");
  const { ctx } = await fixture(t);
  const result = await runtimeProbe.execute({}, ctx);
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.nodeVersion, process.version);
  assert.equal(result.argvMatches, true);
  assert.equal(result.environmentMatches, true);
  assert.equal(result.stdinMatches, true);
});

test("background cases explicitly report unsupported before issuing commands", async (t) => {
  const { ctx } = await fixture(t, [
    "shell",
    "exec",
    "files",
    "readonly-mounts",
  ]);
  ctx.computer.commands.run = async () => {
    assert.fail("unsupported process must not start");
  };
  for (const scenario of ["terminate", "interactive"]) {
    const result = await commandProbe.execute({ scenario }, ctx);
    assert.equal(result.status, "unsupported");
  }
});

test("an unrelated error after the timeout deadline never passes", async (t) => {
  const { ctx } = await fixture(t);
  ctx.computer.commands.run = async () => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100));
    throw new Error("transport unavailable");
  };
  const result = await commandProbe.execute({ scenario: "timeout" }, ctx);
  assert.equal(result.status, "error");
  assert.equal(result.expectedTimeout, false);
});

test("success, nonzero, stdin EOF and confirmed kill preserve actual process results", async (t) => {
  const { ctx } = await fixture(t);
  const success = await commandProbe.execute({ scenario: "success" }, ctx);
  assert.equal(success.status, "passed", JSON.stringify(success));
  assert.equal(success.exitCode, 0);
  const nonzero = await commandProbe.execute({ scenario: "nonzero" }, ctx);
  assert.equal(nonzero.status, "passed", JSON.stringify(nonzero));
  assert.equal(nonzero.exitCode, 7);
  const interactive = await commandProbe.execute(
    { scenario: "interactive" },
    ctx,
  );
  assert.equal(interactive.status, "passed", JSON.stringify(interactive));
  assert.equal(interactive.stdout, "interactive $HOME\n中文");
  const killed = await commandProbe.execute({ scenario: "terminate" }, ctx);
  assert.equal(killed.status, "passed", JSON.stringify(killed));
  assert.equal(killed.killRequested, true);
});

test("provider timeout is accepted and cleanup failure is retained", async (t) => {
  const { ctx } = await fixture(t);
  const timedOut = await commandProbe.execute({ scenario: "timeout" }, ctx);
  assert.equal(timedOut.status, "passed", JSON.stringify(timedOut));
  assert.equal(timedOut.expectedTimeout, true);
  ctx.computer.commands.run = async () => {
    throw Object.assign(new Error("Computer command and cleanup failed."), {
      cause: [
        new DOMException("timeout", "TimeoutError"),
        new Error("cleanup unavailable"),
      ],
    });
  };
  const failed = await commandProbe.execute({ scenario: "timeout" }, ctx);
  assert.equal(failed.status, "error");
  assert.match(failed.error.message, /cleanup/);
  ctx.computer.commands.run = async () => {
    throw Object.assign(new Error("timeout"), {
      name: "TimeoutError",
      outcome: "unknown",
      code: "COMMAND_LOST",
    });
  };
  const unknown = await commandProbe.execute({ scenario: "timeout" }, ctx);
  assert.equal(unknown.status, "error");
  assert.equal(unknown.error.outcome, "unknown");
  ctx.computer.commands.run = async () => {
    throw Object.assign(new Error("timeout"), {
      name: "TimeoutError",
      code: "CLEANUP_FAILED",
      cause: new Error("cleanup unavailable"),
    });
  };
  const cleanupTimeout = await commandProbe.execute(
    { scenario: "timeout" },
    ctx,
  );
  assert.equal(cleanupTimeout.status, "error");
  assert.equal(cleanupTimeout.error.code, "CLEANUP_FAILED");
});

test("a kill acknowledgment cannot turn an unknown exit into success", async (t) => {
  const { ctx } = await fixture(t);
  ctx.computer.commands.run = async () => ({
    processId: "unknown-command",
    async kill() {},
    async wait(options) {
      await options.onStdout("READY_TO_KILL");
      throw Object.assign(
        new Error("Computer process exited without an exit code."),
        { outcome: "unknown" },
      );
    },
  });
  const result = await commandProbe.execute({ scenario: "terminate" }, ctx);
  assert.equal(result.status, "error");
  assert.equal(result.killRequested, true);
  assert.equal(result.error.outcome, "unknown");
});
