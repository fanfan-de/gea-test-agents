import assert from "node:assert/strict";
import test from "node:test";
import { requireProbeResult, verifyFileLifetime } from "./verify-results.mjs";

test("uses the actual tool output, rejecting missing, failed and duplicate calls", () => {
  const output = { status: "passed", text: "真实结果" };
  assert.equal(
    requireProbeResult(
      [{ name: "files_probe", state: "output-available", output }],
      "files_probe",
    ),
    output,
  );
  assert.throws(() => requireProbeResult([], "files_probe"), /Missing/);
  assert.throws(
    () =>
      requireProbeResult(
        [{ name: "files_probe", state: "output-error", output }],
        "files_probe",
      ),
    /output-available/,
  );
  assert.throws(
    () =>
      requireProbeResult(
        [
          {
            name: "files_probe",
            state: "output-available",
            output: { status: "error", error: "I\/O failed" },
          },
        ],
        "files_probe",
      ),
    /passed/,
  );
  assert.throws(
    () =>
      requireProbeResult(
        Array(2).fill({
          name: "files_probe",
          state: "output-available",
          output,
        }),
        "files_probe",
      ),
    /exactly one/,
  );
});

test("unsupported capabilities must be expected, never counted as successful execution", () => {
  const calls = [
    {
      name: "application_probe",
      state: "output-available",
      output: { status: "unsupported" },
    },
  ];
  assert.throws(() => requireProbeResult(calls, "application_probe"), /passed/);
  assert.equal(
    requireProbeResult(calls, "application_probe", "unsupported").status,
    "unsupported",
  );
});

test("durable chat files survive a Run while another Chat starts without that marker", () => {
  verifyFileLifetime(
    "durable-chat",
    "标记",
    { found: true, text: "标记" },
    { found: false },
  );
  assert.throws(() =>
    verifyFileLifetime(
      "durable-chat",
      "标记",
      { found: false },
      { found: false },
    ),
  );
  assert.throws(() =>
    verifyFileLifetime(
      "durable-chat",
      "标记",
      { found: true, text: "标记" },
      { found: true, text: "标记" },
    ),
  );
});

test("ephemeral and caller-owned directories have distinct file lifetime expectations", () => {
  verifyFileLifetime("ephemeral", "标记", { found: false }, { found: false });
  assert.throws(() =>
    verifyFileLifetime(
      "ephemeral",
      "标记",
      { found: true, text: "标记" },
      { found: false },
    ),
  );
  verifyFileLifetime(
    "shared-directory",
    "标记",
    { found: true, text: "标记" },
    { found: true, text: "标记" },
  );
  assert.throws(() =>
    verifyFileLifetime(
      "shared-directory",
      "标记",
      { found: true, text: "标记" },
      { found: false },
    ),
  );
});
