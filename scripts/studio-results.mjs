import assert from "node:assert/strict";

export function verifyDeploymentEvidence(receipt, deployment) {
  assert.ok(
    deployment,
    "The live Preview or test Session has no deployment binding",
  );
  assert.equal(
    deployment.environment,
    "preview",
    "The test target is not Preview",
  );
  assert.equal(
    deployment.agentDeploymentId,
    receipt.deploymentId,
    "Studio selected a different deployment; publish the current Agent before testing.",
  );
}

export function verifyRunEvidence(record, expectedNames, expectedInputs = {}) {
  assert.equal(
    record.status,
    "finished",
    "The logical Run did not finish successfully",
  );
  assert.equal(
    record.resumeStatus,
    204,
    "The Session stream endpoint did not confirm that no stream is active",
  );
  assert.equal(
    record.tools.length,
    expectedNames.length,
    "Unexpected tool count",
  );
  const outputs = {};
  for (const name of expectedNames) {
    const calls = record.tools.filter((call) => call.name === name);
    assert.equal(calls.length, 1, `Expected exactly one actual ${name} call`);
    const call = calls[0];
    assert.equal(
      call.state,
      "output-available",
      `${name} did not return a result`,
    );
    assert.ok(call.toolCallId, `${name} has no tool call ID`);
    for (const [key, value] of Object.entries(expectedInputs[name] ?? {})) {
      assert.deepEqual(
        call.input?.[key],
        value,
        `${name} did not execute the requested ${key}`,
      );
    }
    const saved = record.persisted.filter(
      (item) => item.toolCallId === call.toolCallId,
    );
    assert.equal(
      saved.length,
      1,
      `${name} has no unique persisted tool result`,
    );
    assert.equal(saved[0].name, name);
    assert.equal(saved[0].state, "output-available");
    assert.deepEqual(
      saved[0].input,
      call.input,
      `${name} persisted different input`,
    );
    assert.deepEqual(
      saved[0].output,
      call.output,
      `${name} persisted different output`,
    );
    outputs[name] = call.output;
  }
  return outputs;
}

export function evaluateProbeCase(
  record,
  { name, input, capabilities, verify },
) {
  // Missing or unsafe execution evidence is fatal, before recoverable Tool verdicts.
  const output = verifyRunEvidence(record, [name], { [name]: input })[name];
  if (
    output.error?.outcome === "unknown" ||
    output.error?.code === "COMMAND_LOST"
  ) {
    return {
      status: "failed",
      output,
      canContinue: false,
      message: `${name} has an unknown mutation outcome: ${JSON.stringify(output)}`,
    };
  }
  try {
    const optional =
      name === "command_probe" &&
      ["terminate", "interactive"].includes(input.scenario);
    if (output.status === "unsupported") {
      assert.ok(
        optional && !capabilities.includes("processes"),
        `${name} unexpectedly unsupported`,
      );
    } else {
      assert.equal(
        output.status,
        "passed",
        `${name} returned ${JSON.stringify(output)}`,
      );
    }
    if (verify) verify(output);
    return { status: output.status, output, canContinue: true };
  } catch (error) {
    return {
      status: "failed",
      output,
      canContinue: true,
      message: error.message,
    };
  }
}

export function summarizeVerification(cases) {
  const counts = { passed: 0, failed: 0, unsupported: 0, blocked: 0 };
  for (const entry of cases) {
    assert.ok(
      Object.hasOwn(counts, entry.status),
      `Unknown case status: ${entry.status}`,
    );
    counts[entry.status]++;
  }
  return {
    status: counts.failed
      ? "failed"
      : counts.blocked || cases.length === 0
        ? "blocked"
        : counts.unsupported
          ? "passed-with-unsupported"
          : "passed",
    counts,
  };
}
