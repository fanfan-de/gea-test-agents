import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPackage = new URL("../../../gea/packages/gea-cli/package.json", import.meta.url);
const sourceRequire = createRequire(cliPackage);
const jiti = sourceRequire("jiti").createJiti(import.meta.url);
const { packageAgentProject } = await jiti.import(
  fileURLToPath(
    new URL("../local-backend/src/commands/agent-packages/project.ts", cliPackage),
  ),
);
const { archivePath } = await packageAgentProject({ cwd: projectRoot });
console.log(archivePath);
