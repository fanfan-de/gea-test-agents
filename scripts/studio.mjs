import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStudioConfig,
  createStudioSource,
  assertStudioReady,
} from "./studio-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const requiredNode = (
  await readFile(path.join(root, ".node-version"), "utf8")
).trim();
if (process.version !== `v${requiredNode}`) {
  throw new Error(
    `Use Node ${requiredNode}; actual ${process.version}. On Windows run .\\studio.ps1.`,
  );
}
const command = process.argv[2] ?? "doctor";

async function runNode(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Node command failed (exit ${code}).`);
}

try {
  const config = await loadStudioConfig();
  if (command === "doctor") {
    const sdk = JSON.parse(
      await readFile(
        path.join(config.sourceRoot, "packages/agent-sdk/package.json"),
        "utf8",
      ),
    );
    console.log(
      JSON.stringify(
        {
          sourceRoot: config.sourceRoot,
          nodeVersion: process.version,
          sdkVersion: sdk.version,
          studioUrl: config.tenantBaseUrl,
          workspace: config.workspace,
          projectPath: config.projectPath,
        },
        null,
        2,
      ),
    );
    await assertStudioReady(config);
    console.log("Studio /readyz is healthy.");
  } else if (command === "unit") {
    const scriptTests = (await readdir(path.join(root, "scripts")))
      .filter((name) => /^(studio-.*|verify-results)\.test\.mjs$/u.test(name))
      .map((name) => path.join(root, "scripts", name));
    const agentTests = (await readdir(path.join(config.projectPath, "tests")))
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => path.join(config.projectPath, "tests", name));
    await runNode(["--test", ...scriptTests, ...agentTests], root);
  } else if (command === "validate" || command === "pack") {
    const { sourceRequire, jiti } = createStudioSource(config);
    const typescriptManifest = sourceRequire.resolve("typescript/package.json");
    const typescript = JSON.parse(await readFile(typescriptManifest, "utf8"));
    await runNode(
      [
        path.resolve(path.dirname(typescriptManifest), typescript.bin.tsc),
        "--project",
        path.join(config.projectPath, "tsconfig.json"),
      ],
      config.projectPath,
    );
    const { validateAgentProject, packageAgentProject } = await jiti.import(
      path.join(
        config.sourceRoot,
        "packages/local-backend/src/commands/agent-packages/project.ts",
      ),
    );
    const result =
      command === "pack"
        ? await packageAgentProject({ cwd: config.projectPath })
        : await validateAgentProject({ cwd: config.projectPath });
    const summary =
      command === "pack"
        ? result
        : {
            name: result.snapshot.name,
            model: result.snapshot.model,
            snapshotHash: result.snapshotHash,
            tools: result.snapshot.tools.map((tool) => tool.name ?? tool.id),
            sourceRoot: config.sourceRoot,
            projectPath: config.projectPath,
          };
    await mkdir(path.join(root, ".local"), { recursive: true });
    await writeFile(
      path.join(root, ".local", `studio-${command}.json`),
      JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify(summary, null, 2));
  } else if (command === "publish") {
    await runNode([path.join(root, "scripts/studio-publish.mjs")], root);
  } else if (command === "test") {
    await runNode([path.join(root, "scripts/studio-verify.mjs")], root);
  } else {
    throw new Error(
      `Unknown command ${command}. Use doctor, unit, validate, pack, publish or test.`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
