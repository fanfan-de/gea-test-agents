import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertStudioReady,
  assertStudioReceiptTarget,
  createStudioSource,
  fetchStudio,
  loadStudioConfig,
  signInStudio,
} from "./studio-environment.mjs";

const sourceRoot = fileURLToPath(
  new URL("../../gea-worktree", import.meta.url),
);
const settings = {
  sourceRoot,
  baseUrl: "http://musegea.localhost:3000",
  organization: "local-dev",
  workspace: "default",
  projectDirectory: "computer-default",
  projectSlug: "computer-default-tests",
  workerName: "computer-default-test",
  loginFile: ".local/studio-login.json",
};

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gea-studio-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "studio.config.json");
  await writeFile(filename, JSON.stringify({ ...settings, ...overrides }));
  return { directory, filename };
}

test("configuration derives the same tenant and scoped RPC target including the port", async (t) => {
  const { directory, filename } = await fixture(t, {
    baseUrl: "http://musegea.localhost:3011/",
  });
  const config = await loadStudioConfig(filename);
  assert.equal(config.baseUrl, "http://musegea.localhost:3011");
  assert.equal(config.tenantBaseUrl, "http://local-dev.musegea.localhost:3011");
  assert.equal(
    config.rpcUrl,
    "http://local-dev.musegea.localhost:3011/api/orgs/local-dev/w/default/rpc",
  );
  assert.equal(config.projectPath, path.join(directory, "computer-default"));
  assert.equal(
    config.loginPath,
    path.join(directory, ".local/studio-login.json"),
  );
  assert.equal(
    config.readyFile,
    path.join(directory, ".local/studio-ready.json"),
  );
});

test("configuration rejects a URL with an embedded credential or non-apex path", async (t) => {
  for (const baseUrl of [
    "http://user:private@musegea.localhost:3000",
    "http://musegea.localhost:3000/studio/default",
  ]) {
    const { filename } = await fixture(t, { baseUrl });
    await assert.rejects(loadStudioConfig(filename), /baseUrl/);
  }
});

test("readiness reports the actual failed service and prevents a successful health result", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  const requests = [];
  await assert.rejects(
    assertStudioReady(config, {
      fetch: async (request) => {
        requests.push({ url: request.url, host: request.headers.get("host") });
        return Response.json({ ok: false, failed: ["rust"] }, { status: 503 });
      },
    }),
    /Studio readiness failed.*HTTP 503.*rust/,
  );
  assert.deepEqual(requests, [
    { url: "http://127.0.0.1:3000/readyz", host: "musegea.localhost:3000" },
  ]);
});

test("Studio transport preserves tenant identity and request body without wildcard localhost DNS", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  const response = await fetchStudio(
    config,
    new Request(config.rpcUrl, {
      method: "POST",
      headers: {
        cookie: "test-session=example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "computer test" }),
    }),
    {},
    async (request) => {
      assert.equal(
        request.url,
        "http://127.0.0.1:3000/api/orgs/local-dev/w/default/rpc",
      );
      assert.equal(
        request.headers.get("host"),
        "local-dev.musegea.localhost:3000",
      );
      assert.equal(request.headers.get("cookie"), "test-session=example");
      assert.equal(request.method, "POST");
      return Response.json(await request.json());
    },
  );
  assert.deepEqual(await response.json(), { prompt: "computer test" });
});

test("readiness accepts the current web health endpoint's HTTP 200 empty response", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  const { jiti } = createStudioSource(config);
  const { createWebHealth } = await jiti.import(
    path.join(config.sourceRoot, "packages/web/src/health.ts"),
  );
  const health = createWebHealth();
  health.markReady();
  assert.deepEqual(
    await assertStudioReady(config, {
      fetch: () => health.ready(async () => []),
    }),
    { ok: true },
  );
});

test("readiness rejects a JSON failure even when HTTP status is 200", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  await assertStudioReady(config, {
    fetch: async () => Response.json({ ok: true }),
  });
  await assert.rejects(
    assertStudioReady(config, {
      fetch: async () => Response.json({ ok: false, failed: ["database"] }),
    }),
    /database/,
  );
});

test("readiness rejects other empty statuses and malformed nonempty responses", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  for (const response of [
    new Response(null, { status: 204 }),
    new Response("<html>development server</html>", { status: 200 }),
    new Response("{invalid", { status: 200 }),
    new Response(" ", { status: 200 }),
  ]) {
    await assert.rejects(
      assertStudioReady(config, { fetch: async () => response }),
      /Studio readiness failed.*HTTP (200|204).*invalid readiness response/i,
    );
  }
});

test("readiness identifies the configured target when its connection is unavailable", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  await assert.rejects(
    assertStudioReady(config, {
      fetch: async () => {
        throw new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    }),
    /Studio readiness request failed at http:\/\/musegea\.localhost:3000\/readyz: ECONNREFUSED/,
  );
});

test("a deployment receipt from a different Studio, workspace or project is rejected", async (t) => {
  const { filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  const receipt = {
    ...settings,
    environment: "preview",
    contentHash: "sha256:" + "a".repeat(64),
    projectId: "019a4000-0000-7000-8000-000000000001",
    agentId: "019a4000-0000-7000-8000-000000000002",
    agentName: "Computer-Default-Test",
    deploymentId: "019a4000-0000-7000-8000-000000000003",
    workerId: "019a4000-0000-7000-8000-000000000004",
    studioUrl:
      "http://local-dev.musegea.localhost:3000/builder/default/agents/019a4000-0000-7000-8000-000000000002",
    publishedAt: "2026-10-21T00:00:00.000Z",
  };
  assert.equal(
    assertStudioReceiptTarget(config, receipt).agentId,
    receipt.agentId,
  );
  assert.throws(
    () =>
      assertStudioReceiptTarget(config, {
        ...receipt,
        studioUrl: receipt.studioUrl.replace("/builder/", "/studio/"),
      }),
    /receipt studioUrl/,
  );
  const { contentHash, ...missingHash } = receipt;
  assert.throws(
    () => assertStudioReceiptTarget(config, missingHash),
    /contentHash/,
  );
  assert.throws(
    () =>
      assertStudioReceiptTarget(config, { ...receipt, contentHash: "invalid" }),
    /contentHash/,
  );
  for (const [key, value] of [
    ["baseUrl", "http://musegea.localhost:3003"],
    ["organization", "local-test"],
    ["workspace", "another"],
    ["projectSlug", "another-project"],
    ["workerName", "another-agent"],
  ]) {
    assert.throws(
      () => assertStudioReceiptTarget(config, { ...receipt, [key]: value }),
      new RegExp("receipt.*" + key, "i"),
    );
  }
});

test("invalid local login data fails before any sign-in request and does not expose the password", async (t) => {
  const { directory, filename } = await fixture(t, { loginFile: "login.json" });
  const config = await loadStudioConfig(filename);
  const privatePassword = "private-value-that-must-not-be-printed";
  await writeFile(
    path.join(directory, "login.json"),
    JSON.stringify({ email: "invalid-email", password: privatePassword }),
  );
  let calls = 0;
  await assert.rejects(
    signInStudio(config, {
      fetch: async () => {
        calls++;
        return Response.json({});
      },
    }),
    (error) => {
      assert.match(error.message, /login/i);
      assert.equal(error.message.includes(privatePassword), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("corrupt login JSON is reported without including its private contents", async (t) => {
  const { directory, filename } = await fixture(t, { loginFile: "login.json" });
  const config = await loadStudioConfig(filename);
  const privateValue = "private-login-file-value";
  await writeFile(path.join(directory, "login.json"), privateValue);
  await assert.rejects(signInStudio(config), (error) => {
    assert.match(error.message, /Invalid Studio login file/);
    assert.equal(error.message.includes(privateValue), false);
    return true;
  });
});

test("a valid same-scoped browser session authenticates the existing API without signing in", async (t) => {
  const { directory, filename } = await fixture(t);
  const config = await loadStudioConfig(filename);
  await mkdir(path.join(directory, ".local"));
  await writeFile(
    path.join(directory, ".local/studio-session.json"),
    JSON.stringify({
      baseUrl: config.baseUrl,
      organization: config.organization,
      workspace: config.workspace,
      cookie: "test-session=existing-browser-session",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  );
  const requests = [];
  const auth = await signInStudio(config, {
    fetch: async (request) => {
      requests.push({
        url: request.url,
        cookie: request.headers.get("cookie"),
        host: request.headers.get("host"),
      });
      return Response.json({ json: [] });
    },
  });
  assert.deepEqual(await auth.client.studioProjects.list({}), []);
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:3000/api/orgs/local-dev/w/default/rpc/studioProjects/list",
      cookie: "test-session=existing-browser-session",
      host: "local-dev.musegea.localhost:3000",
    },
  ]);
});

test("an expired or mismatched browser session is rejected before any network request", async (t) => {
  for (const override of [
    { expiresAt: new Date(Date.now() - 60_000).toISOString() },
    { baseUrl: "http://musegea.localhost:3003" },
    { organization: "another" },
    { workspace: "another" },
  ]) {
    const { directory, filename } = await fixture(t);
    const config = await loadStudioConfig(filename);
    await mkdir(path.join(directory, ".local"));
    const privateCookie = "test-session=private-mismatched-session";
    await writeFile(
      path.join(directory, ".local/studio-session.json"),
      JSON.stringify({
        baseUrl: config.baseUrl,
        organization: config.organization,
        workspace: config.workspace,
        cookie: privateCookie,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        ...override,
      }),
    );
    let requests = 0;
    await assert.rejects(
      signInStudio(config, {
        fetch: async () => {
          requests++;
          return Response.json({});
        },
      }),
      (error) => {
        assert.match(error.message, /Studio session.*(expired|does not match)/);
        assert.equal(error.message.includes(privateCookie), false);
        return true;
      },
    );
    assert.equal(requests, 0);
  }
});

test("a malformed browser session is rejected without revealing its contents", async (t) => {
  for (const contents of [
    "private-session-file-value",
    JSON.stringify({ cookie: "private-session-cookie" }),
  ]) {
    const { directory, filename } = await fixture(t);
    const config = await loadStudioConfig(filename);
    await mkdir(path.join(directory, ".local"));
    await writeFile(
      path.join(directory, ".local/studio-session.json"),
      contents,
    );
    await assert.rejects(signInStudio(config), (error) => {
      assert.match(error.message, /Invalid Studio session file/);
      assert.equal(error.message.includes("private-session"), false);
      return true;
    });
  }
});
