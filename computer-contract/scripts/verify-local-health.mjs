import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { environment, projectRoot, settings } from "./environment.mjs";
import { signInStudio } from "./studio-client.mjs";

const endpoints = [
  [
    "web",
    `${environment.APP_BASE_URL}/readyz`,
    { host: `musegea.localhost:${settings.webPort}` },
  ],
  ["runtime", `${environment.WORKER_RUNTIME_URL}/healthz`, {}],
  [
    "api",
    `${environment.GEA_AGENT_API_URL}/healthz`,
    { "x-gea-agent-api-host": environment.GEA_AGENT_API_HOST_SECRET },
  ],
  ["computer", `${environment.AGENT_COMPUTER_SERVICE_URL}/readyz`, {}],
];
const checks = [];
for (const [service, address, headers] of endpoints) {
  const url =
    service === "web" ? `http://127.0.0.1:${settings.webPort}/readyz` : address;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`${service} health failed (${response.status}).`);
  checks.push({ service, status: response.status });
}
const { client } = await signInStudio();
const projects = await client.studioProjects.list({});
const existingProjectPreserved = projects.some(
  (item) => item.project.slug === settings.projectSlug,
);
if (!existingProjectPreserved)
  throw new Error("The existing Feishu test project is unavailable.");
const result = {
  sourceRoot: settings.sourceRoot,
  studioUrl: `http://${settings.organization}.musegea.localhost:${settings.webPort}/studio/${settings.workspace}`,
  checks,
  signIn: "verified",
  existingProjectPreserved,
};
await mkdir(path.join(projectRoot, ".local"), { recursive: true });
await writeFile(
  path.join(projectRoot, ".local/health.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
