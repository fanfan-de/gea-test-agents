import assert from "node:assert/strict";
import test from "node:test";
import * as results from "./studio-results.mjs";
import {
  verifyRunEvidence,
  summarizeVerification,
  verifyDeploymentEvidence,
} from "./studio-results.mjs";

function finishedRun(output = { status: "passed", text: "真实结果" }) {
  const call = {
    name: "files_probe",
    toolCallId: "call-1",
    state: "output-available",
    input: { mode: "read" },
    output,
  };
  return {
    status: "finished",
    activeStreamId: null,
    resumeStatus: 204,
    tools: [call],
    persisted: [structuredClone(call)],
  };
}

test("accepts actual tools only after a finished Run and matching persisted evidence", () => {
  const record = finishedRun();
  assert.deepEqual(verifyRunEvidence(record, ["files_probe"]), {
    files_probe: record.tools[0].output,
  });
  for (const status of [
    "running",
    "queued",
    "stopping",
    "interrupted",
    "failed",
    "error",
    "aborted",
  ]) {
    assert.throws(() =>
      verifyRunEvidence({ ...record, status }, ["files_probe"]),
    );
  }
});

test("accepts a finished Run with a retained stream ID only when resume confirms HTTP 204", () => {
  const record = {
    ...finishedRun(),
    activeStreamId: "retained-projection-id",
    resumeStatus: 204,
  };
  assert.deepEqual(verifyRunEvidence(record, ["files_probe"]), {
    files_probe: record.tools[0].output,
  });
  for (const resumeStatus of [undefined, 200, 503]) {
    assert.throws(() =>
      verifyRunEvidence({ ...record, resumeStatus }, ["files_probe"]),
    );
  }
  for (const status of [
    "running",
    "error",
    "failed",
    "aborted",
    "interrupted",
  ]) {
    assert.throws(() =>
      verifyRunEvidence({ ...record, status }, ["files_probe"]),
    );
  }
  assert.throws(() =>
    verifyRunEvidence({ ...record, activeStreamId: null, resumeStatus: 200 }, [
      "files_probe",
    ]),
  );
});

test("rejects a missing, duplicate, errored or unpersisted tool even if the model says passed", () => {
  const record = finishedRun();
  for (const tools of [
    [],
    [...record.tools, ...record.tools],
    [{ ...record.tools[0], state: "output-error" }],
  ]) {
    assert.throws(() =>
      verifyRunEvidence({ ...record, tools }, ["files_probe"]),
    );
  }
  assert.throws(() =>
    verifyRunEvidence({ ...record, persisted: [] }, ["files_probe"]),
  );
  const persisted = [
    { ...record.persisted[0], output: { status: "passed", text: "different" } },
  ];
  assert.throws(() =>
    verifyRunEvidence({ ...record, persisted }, ["files_probe"]),
  );
});

test("rejects a model calling a different scenario or rewriting the persistence marker", () => {
  const write = finishedRun();
  write.tools[0].input = { mode: "write", text: "previous-marker" };
  write.persisted[0].input = structuredClone(write.tools[0].input);
  assert.throws(() =>
    verifyRunEvidence(write, ["files_probe"], {
      files_probe: { mode: "read" },
    }),
  );
  const command = finishedRun();
  for (const call of [...command.tools, ...command.persisted]) {
    call.name = "command_probe";
    call.input = { scenario: "success" };
  }
  for (const scenario of ["timeout", "terminate", "interactive"]) {
    assert.throws(() =>
      verifyRunEvidence(command, ["command_probe"], {
        command_probe: { scenario },
      }),
    );
  }
});

test("reports unsupported separately and never treats an empty or partial suite as passed", () => {
  assert.equal(summarizeVerification([]).status, "blocked");
  assert.equal(summarizeVerification([{ status: "passed" }]).status, "passed");
  assert.equal(
    summarizeVerification([{ status: "passed" }, { status: "unsupported" }])
      .status,
    "passed-with-unsupported",
  );
  assert.equal(
    summarizeVerification([{ status: "passed" }, { status: "failed" }]).status,
    "failed",
  );
  assert.equal(
    summarizeVerification([{ status: "blocked" }]).status,
    "blocked",
  );
  assert.deepEqual(
    summarizeVerification([{ status: "passed" }, { status: "unsupported" }])
      .counts,
    { passed: 1, failed: 0, unsupported: 1, blocked: 0 },
  );
});

test("requires the live Preview and Session deployment to match the published receipt", () => {
  const receipt = { deploymentId: "published-deployment" };
  const selected = {
    agentDeploymentId: "published-deployment",
    environment: "preview",
  };
  verifyDeploymentEvidence(receipt, selected);
  for (const deployment of [
    null,
    { ...selected, agentDeploymentId: "rolled-back-deployment" },
    { ...selected, environment: "production" },
  ]) {
    assert.throws(() => verifyDeploymentEvidence(receipt, deployment));
  }
});

test("records a verified finished tool failure without hiding it or blocking the next independent result", () => {
  const output = {
    status: "error",
    error: { message: "Computer command and cleanup failed." },
  };
  const failure = results.evaluateProbeCase(finishedRun(output), {
    name: "files_probe",
    input: { mode: "read" },
    capabilities: [],
  });
  assert.equal(failure.status, "failed");
  assert.equal(failure.canContinue, true);
  assert.deepEqual(failure.output, output);
  assert.match(failure.message, /cleanup failed/);
  const next = results.evaluateProbeCase(finishedRun(), {
    name: "files_probe",
    input: { mode: "read" },
    capabilities: [],
    verify(value) {
      assert.equal(value.text, "真实结果");
    },
  });
  assert.equal(next.status, "passed");
  assert.equal(summarizeVerification([failure, next]).status, "failed");
});

test("does not downgrade unsafe or missing Run evidence to a recoverable case failure", () => {
  const options = {
    name: "files_probe",
    input: { mode: "read" },
    capabilities: [],
  };
  for (const record of [
    { ...finishedRun(), status: "running" },
    { ...finishedRun(), resumeStatus: 200 },
    { ...finishedRun(), resumeStatus: 503 },
    { ...finishedRun(), persisted: [] },
  ]) {
    assert.throws(() => results.evaluateProbeCase(record, options));
  }
  const mismatch = results.evaluateProbeCase(finishedRun(), {
    ...options,
    verify(value) {
      assert.equal(value.text, "expected-marker");
    },
  });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.output.text, "真实结果");
  const unknown = results.evaluateProbeCase(
    finishedRun({
      status: "error",
      error: { code: "COMMAND_LOST", outcome: "unknown" },
    }),
    options,
  );
  assert.equal(unknown.status, "failed");
  assert.equal(unknown.canContinue, false);
  assert.equal(unknown.output.error.outcome, "unknown");
});
