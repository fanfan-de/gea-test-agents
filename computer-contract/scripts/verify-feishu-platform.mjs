import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

assert.equal(
  process.platform,
  "linux",
  "Platform sandbox verification requires Linux.",
);
const { sourceRoot } = z
  .object({ sourceRoot: z.string().min(1) })
  .parse(
    JSON.parse(
      await readFile(
        new URL("../local-test.config.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const require = createRequire(
  path.join(sourceRoot, "packages/gea-cli/package.json"),
);
const jiti = require("jiti").createJiti(import.meta.url);
const { buildLarkCliShimSpawn, runLarkCliShimSpawn } = await jiti.import(
  path.join(sourceRoot, "packages/agent/src/tools/bash-runner.ts"),
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "gea-feishu-platform-verification-"),
);

try {
  const roots = {
    workspaceDir: path.join(temporaryRoot, "workspace"),
    geaDir: path.join(temporaryRoot, "gea"),
    agentsDir: path.join(temporaryRoot, "agents"),
  };
  const larkCliStateRoot = {
    rootDir: path.join(temporaryRoot, "state"),
    homeDir: path.join(temporaryRoot, "state/home"),
    configDir: path.join(temporaryRoot, "state/config"),
    dataDir: path.join(temporaryRoot, "state/data"),
  };
  await Promise.all(
    [...Object.values(roots), ...Object.values(larkCliStateRoot)].map(
      (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );
  const results = [];
  for (const argv of [["--version"], ["skills", "list"], ["--help"]]) {
    const input = buildLarkCliShimSpawn({
      ...roots,
      argv,
      cwd: "/workspace",
      larkCliBinary: "/usr/local/bin/gea-lark-cli",
      larkCliStateRoot,
      stdin: "",
      timeoutMs: 30000,
    });
    const result = await runLarkCliShimSpawn(input);
    assert.equal(
      result.exitCode,
      0,
      `Sandbox lark-cli ${argv.join(" ")} failed: ${result.stderr}`,
    );
    assert.ok(result.stdout.trim(), "Sandbox CLI command returned no output.");
    if (argv[0] === "--version") assert.match(result.stdout, /\b1\.0\.90\b/);
    if (argv[0] === "skills")
      assert.match(
        result.stdout,
        /lark-doc/,
        "Official lark-doc Skill is missing.",
      );
    results.push({
      argv,
      exitCode: result.exitCode,
      stdoutBytes: Buffer.byteLength(result.stdout),
      stderrBytes: Buffer.byteLength(result.stderr),
      ...(argv[0] === "--version" ? { version: result.stdout.trim() } : {}),
    });
  }
  console.log(
    JSON.stringify({ verified: true, sandbox: "platform bubblewrap", results }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
