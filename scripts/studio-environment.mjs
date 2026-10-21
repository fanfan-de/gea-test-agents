import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultConfigPath = fileURLToPath(
  new URL("../studio.config.json", import.meta.url),
);

export function createStudioSource(config) {
  const sourceRequire = createRequire(
    path.join(config.sourceRoot, "packages/gea-cli/package.json"),
  );
  const jiti = sourceRequire("jiti").createJiti(import.meta.url);
  return { sourceRequire, jiti };
}

export async function loadStudioConfig(configPath = defaultConfigPath) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  if (
    raw === null ||
    typeof raw !== "object" ||
    typeof raw.sourceRoot !== "string" ||
    !path.isAbsolute(raw.sourceRoot)
  ) {
    throw new Error(
      "Studio configuration sourceRoot must be an absolute source checkout path.",
    );
  }
  const { sourceRequire } = createStudioSource(raw);
  const { z } = sourceRequire("zod");
  const settings = z
    .strictObject({
      sourceRoot: z.string().min(1),
      baseUrl: z.url().superRefine((value, context) => {
        const url = new URL(value);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        ) {
          context.addIssue({
            code: "custom",
            message: "baseUrl must be an HTTP(S) apex origin.",
          });
        }
      }),
      organization: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      workspace: z.string().min(1),
      projectDirectory: z.string().min(1),
      projectSlug: z.string().min(1),
      workerName: z.string().min(1),
      loginFile: z.string().min(1),
    })
    .parse(raw);
  const root = path.dirname(path.resolve(configPath));
  const baseUrl = new URL(settings.baseUrl).origin;
  const tenant = new URL(baseUrl);
  tenant.hostname = `${settings.organization}.${tenant.hostname}`;
  const tenantBaseUrl = tenant.origin;
  return {
    ...settings,
    baseUrl,
    root,
    projectPath: path.resolve(root, settings.projectDirectory),
    loginPath: path.resolve(root, settings.loginFile),
    readyFile: path.join(root, ".local/studio-ready.json"),
    tenantBaseUrl,
    rpcUrl: `${tenantBaseUrl}/api/orgs/${encodeURIComponent(settings.organization)}/w/${encodeURIComponent(settings.workspace)}/rpc`,
  };
}

export async function assertStudioReady(config, options = {}) {
  const url = `${config.baseUrl}/readyz`;
  let response;
  try {
    response = await fetchStudio(
      config,
      url,
      { signal: AbortSignal.timeout(10_000) },
      options.fetch,
    );
  } catch (error) {
    throw new Error(
      `Studio readiness request failed at ${url}: ${error.cause?.code ?? error.message}.`,
    );
  }
  const body = await response.text();
  // The current Web health endpoint uses an empty HTTP 200 for readiness success.
  if (response.status === 200 && body === "") return { ok: true };
  const invalidResponseMessage = `Studio readiness failed at ${url} (HTTP ${response.status}): invalid readiness response.`;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(invalidResponseMessage);
  }
  const { sourceRequire } = createStudioSource(config);
  const { z } = sourceRequire("zod");
  const parsed = z
    .object({
      ok: z.boolean(),
      failed: z.array(z.string()).optional(),
    })
    .safeParse(data);
  if (!parsed.success) throw new Error(invalidResponseMessage);
  const status = parsed.data;
  if (response.status !== 200 || !status.ok) {
    throw new Error(
      `Studio readiness failed at ${url} (HTTP ${response.status}): ${status.failed?.join(", ") || "readyz reported failure"}.`,
    );
  }
  return status;
}

export function fetchStudio(config, input, init, request = fetch) {
  const original = new Request(input, init);
  const target = new URL(original.url);
  if (![config.baseUrl, config.tenantBaseUrl].includes(target.origin)) {
    throw new Error(
      "Studio request does not match the configured apex or tenant origin.",
    );
  }
  if (target.hostname.endsWith(".localhost")) {
    // Node does not resolve wildcard localhost on Windows. Keep HTTP tenancy in Host.
    const host = target.host;
    target.hostname = "127.0.0.1";
    const transported = new Request(target, original);
    transported.headers.set("host", host);
    return request(transported);
  }
  return request(original);
}

export async function signInStudio(config, options = {}) {
  const { sourceRequire, jiti } = createStudioSource(config);
  const { z } = sourceRequire("zod");
  const request = (input, init) =>
    fetchStudio(config, input, init, options.fetch);
  const sessionPath = path.join(config.root, ".local/studio-session.json");
  let sessionContents;
  try {
    sessionContents = await readFile(sessionPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let cookie;
  if (sessionContents !== undefined) {
    let sessionInput;
    try {
      sessionInput = JSON.parse(sessionContents);
    } catch {
      throw new Error(
        `Invalid Studio session file: ${sessionPath}. Expected valid JSON.`,
      );
    }
    const session = z
      .strictObject({
        baseUrl: z.url(),
        organization: z.string().min(1),
        workspace: z.string().min(1),
        cookie: z
          .string()
          .min(1)
          .regex(/^[^\r\n\0]+$/u),
        expiresAt: z.iso.datetime(),
      })
      .safeParse(sessionInput);
    if (!session.success)
      throw new Error(`Invalid Studio session file: ${sessionPath}.`);
    for (const key of ["baseUrl", "organization", "workspace"]) {
      if (session.data[key] !== config[key]) {
        throw new Error(
          `Studio session ${key} does not match the configured target.`,
        );
      }
    }
    if (Date.parse(session.data.expiresAt) <= Date.now()) {
      throw new Error(
        "Studio session is expired; remove the private session file or refresh the same-scoped browser session.",
      );
    }
    cookie = session.data.cookie;
  } else {
    const contents = await readFile(config.loginPath, "utf8");
    let loginInput;
    try {
      loginInput = JSON.parse(contents);
    } catch {
      // JSON syntax errors can quote private file contents at this local CLI boundary.
      throw new Error(
        `Invalid Studio login file: ${config.loginPath}. Expected valid JSON.`,
      );
    }
    const login = z
      .strictObject({
        email: z.email(),
        password: z.string().min(1),
      })
      .safeParse(loginInput);
    if (!login.success) {
      throw new Error(
        `Invalid Studio login file: ${config.loginPath}. Expected email and password.`,
      );
    }
    const response = await request(`${config.baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: config.baseUrl, "content-type": "application/json" },
      body: JSON.stringify(login.data),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Studio sign-in failed (HTTP ${response.status}).`);
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    if (!cookie) throw new Error("Studio sign-in returned no session cookie.");
  }
  const { createClientORPC } = await jiti.import(
    path.join(config.sourceRoot, "packages/orpc/src/client.ts"),
  );
  return {
    cookie,
    client: createClientORPC({
      url: config.rpcUrl,
      fetch: request,
      getHeaders: () => ({ cookie, origin: config.tenantBaseUrl }),
    }),
  };
}

export function assertStudioReceiptTarget(config, value) {
  const { sourceRequire } = createStudioSource(config);
  const { z } = sourceRequire("zod");
  const receipt = z
    .object({
      baseUrl: z.url(),
      organization: z.string().min(1),
      workspace: z.string().min(1),
      sourceRoot: z.string().min(1),
      projectDirectory: z.string().min(1),
      projectSlug: z.string().min(1),
      workerName: z.string().min(1),
      environment: z.literal("preview"),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      projectId: z.uuid(),
      agentId: z.uuid(),
      agentName: z.string().min(1),
      deploymentId: z.uuid(),
      workerId: z.uuid(),
      studioUrl: z.url(),
      publishedAt: z.iso.datetime(),
    })
    .parse(value);
  for (const key of [
    "baseUrl",
    "organization",
    "workspace",
    "sourceRoot",
    "projectDirectory",
    "projectSlug",
    "workerName",
  ]) {
    if (receipt[key] !== config[key]) {
      throw new Error(
        `Studio receipt ${key} does not match studio.config.json; publish to the selected target first.`,
      );
    }
  }
  const studioUrl = `${config.tenantBaseUrl}/builder/${encodeURIComponent(config.workspace)}/agents/${encodeURIComponent(receipt.agentId)}`;
  if (receipt.studioUrl !== studioUrl) {
    throw new Error(
      "Studio receipt studioUrl does not match the configured Agent Builder target; publish again.",
    );
  }
  return receipt;
}
