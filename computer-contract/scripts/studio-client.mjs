import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { environment, settings } from "./environment.mjs";

export const sourceRequire = createRequire(
  path.join(settings.sourceRoot, "packages/gea-cli/package.json"),
);
const jiti = sourceRequire("jiti").createJiti(import.meta.url);
const { createClientORPC } = await jiti.import(
  path.join(settings.sourceRoot, "packages/orpc/src/client.ts"),
);
const { createGeaLocalRpcUrl } = await jiti.import(
  path.join(settings.sourceRoot, "packages/local/src/urls.ts"),
);

export async function signInStudio() {
  const login = JSON.parse(await readFile(settings.loginFile, "utf8"));
  const signedIn = await fetch(
    `http://127.0.0.1:${settings.webPort}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: {
        host: `musegea.localhost:${settings.webPort}`,
        origin: environment.APP_BASE_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: login.email, password: login.password }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!signedIn.ok)
    throw new Error(`Local Studio sign-in failed (${signedIn.status}).`);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const client = createClientORPC({
    url: createGeaLocalRpcUrl({
      baseUrl: `http://127.0.0.1:${settings.webPort}`,
      orgSlug: settings.organization,
      workspaceSlug: settings.workspace,
    }),
    getHeaders: () => ({
      cookie,
      host: `${settings.organization}.musegea.localhost:${settings.webPort}`,
    }),
  });
  return { client, cookie };
}
