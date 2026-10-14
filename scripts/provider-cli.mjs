import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  config,
  providers,
  projectDirectory,
  root,
  loadTestEnvironment,
} from "./provider-environment.mjs";

const command = process.argv[2] ?? "status";
const provider = process.argv[3] ?? "all";
const selected = provider === "all" ? providers : [provider];
for (const name of selected) projectDirectory(name);
if (process.version !== "v24.16.0")
  throw new Error("Use Node 24.16.0, found " + process.version);

async function run(executable, args, cwd, env = process.env, input) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
  });
  if (input) child.stdin.end(JSON.stringify(input));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(executable + " exited with " + code);
}
if (command === "install") {
  for (const name of selected)
    await run("pnpm", ["install", "--dir", projectDirectory(name)], root);
} else if (command === "validate" || command === "pack") {
  for (const name of selected) {
    await run(
      "pnpm",
      [
        "exec",
        "tsc",
        "--project",
        path.join(projectDirectory(name), "tsconfig.json"),
      ],
      config.sourceRoot,
    );
    await run(
      "pnpm",
      ["exec", "jiti", "src/bin.ts", "agent", command, "--json-file", "-"],
      path.join(config.sourceRoot, "packages/gea-cli"),
      process.env,
      { cwd: projectDirectory(name) },
    );
  }
} else if (command === "start" || command === "stop" || command === "status") {
  const { settings, directory, remoteToken } = await loadTestEnvironment();
  const metadataFile = path.join(directory, "remote-service.json");
  async function remoteProcess() {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataFile, "utf8"));
      const argv = (
        await readFile("/proc/" + metadata.pid + "/cmdline", "utf8")
      ).split("\0");
      return argv.includes(path.join(root, "scripts/remote-service.mjs"))
        ? metadata
        : null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return null;
    }
  }
  if (command === "start") {
    const healthy = await fetch(
      "http://127.0.0.1:" + settings.runtimePort + "/healthz",
      { signal: AbortSignal.timeout(2000) },
    ).then(
      (response) => response.ok,
      () => false,
    );
    if (!healthy) {
      const log = openSync(
        path.join(directory, "studio-launcher.log"),
        "a",
        0o600,
      );
      const child = spawn(
        "bash",
        [path.join(root, "computer-contract/start-local.sh")],
        { cwd: root, detached: true, stdio: ["ignore", log, log] },
      );
      child.unref();
    }
    if (!(await remoteProcess())) {
      const log = openSync(
        path.join(directory, "remote-service.log"),
        "a",
        0o600,
      );
      const child = spawn(
        process.execPath,
        [path.join(root, "scripts/remote-service.mjs")],
        { cwd: root, detached: true, stdio: ["ignore", log, log] },
      );
      child.unref();
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      const checks = await Promise.all([
        fetch("http://127.0.0.1:" + settings.webPort + "/readyz", {
          headers: { host: "musegea.localhost:" + settings.webPort },
          signal: AbortSignal.timeout(2000),
        }).then(
          (response) => response.ok,
          () => false,
        ),
        fetch("http://127.0.0.1:" + settings.runtimePort + "/healthz", {
          signal: AbortSignal.timeout(2000),
        }).then(
          (response) => response.ok,
          () => false,
        ),
        fetch("http://127.0.0.1:8791/", {
          headers: { authorization: "Bearer " + remoteToken },
          signal: AbortSignal.timeout(2000),
        }).then(
          (response) => response.status === 404,
          () => false,
        ),
      ]);
      if (checks.every(Boolean) && (await remoteProcess())) {
        console.log(
          "Studio ready: http://musegea.localhost:" +
            settings.webPort +
            "/; Remote Computer ready on 8791",
        );
        break;
      }
      if (attempt === 119)
        throw new Error(
          "Test environment did not become ready; inspect private launcher logs",
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (command === "stop") {
    const remote = await remoteProcess();
    if (remote) process.kill(remote.pid, "SIGTERM");
    await run(
      "bash",
      [path.join(root, "computer-contract/stop-local.sh")],
      root,
    );
  }
  if (command === "status") {
    await run(
      "bash",
      [path.join(root, "computer-contract/start-local.sh"), "--status"],
      root,
    );
    console.log(
      "Remote Computer: " + ((await remoteProcess()) ? "running" : "stopped"),
    );
  }
} else if (command === "publish" || command === "test") {
  const script =
    command === "publish" ? "publish-provider.mjs" : "verify-provider.mjs";
  for (const name of selected) {
    if (command === "test" && name === "e2b") {
      console.log(
        "E2B live acceptance skipped by user request; its fixture remains validated and packable.",
      );
      continue;
    }
    await run(
      process.execPath,
      [path.join(root, "scripts", script), name],
      root,
    );
  }
} else if (command === "dev") {
  if (provider !== "local")
    throw new Error(
      "dev currently selects the local project; hosted providers use publish/test",
    );
  await run(
    process.execPath,
    [path.join(root, "scripts/local-session.mjs"), "start"],
    root,
  );
} else if (command === "pair-device") {
  await run(
    process.execPath,
    [path.join(root, "scripts/device-session.mjs"), "start"],
    root,
  );
} else {
  throw new Error("Unknown provider command: " + command);
}
