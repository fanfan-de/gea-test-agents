import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectPath = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.resolve(projectPath, "../../gea-worktree");

if (process.version !== "v24.16.0") {
  throw new Error("Use Node 24.16.0 from .node-version.");
}

const command = process.argv[2];
if (command !== "validate" && command !== "pack") {
  throw new Error("Use validate or pack.");
}

const sourceRequire = createRequire(
  path.join(sourceRoot, "packages/gea-cli/package.json"),
);
const compilerManifest = sourceRequire.resolve("typescript/package.json");
const compilerPackage = JSON.parse(await readFile(compilerManifest, "utf8"));
const compiler = path.resolve(
  path.dirname(compilerManifest),
  compilerPackage.bin.tsc,
);
const typeCheck = spawn(
  process.execPath,
  [compiler, "--project", path.join(projectPath, "tsconfig.json")],
  { cwd: projectPath, stdio: "inherit" },
);
const code = await new Promise((resolve, reject) => {
  typeCheck.once("error", reject);
  typeCheck.once("exit", resolve);
});
if (code !== 0) throw new Error(`Type check failed (exit ${code}).`);

const jiti = sourceRequire("jiti").createJiti(import.meta.url);
const { validateAgentProject, packageAgentProject } = await jiti.import(
  path.join(
    sourceRoot,
    "packages/local-backend/src/commands/agent-packages/project.ts",
  ),
);
const result =
  command === "pack"
    ? await packageAgentProject({ cwd: projectPath })
    : await validateAgentProject({ cwd: projectPath });
const summary =
  command === "pack"
    ? result
    : {
        valid: true,
        name: result.snapshot.name,
        model: result.snapshot.model,
        snapshotHash: result.snapshotHash,
        tools: result.snapshot.tools.map((tool) => tool.name ?? tool.id),
        sourceRoot,
        projectPath,
      };
console.log(JSON.stringify(summary, null, 2));
