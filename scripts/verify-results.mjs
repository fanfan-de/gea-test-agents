import assert from "node:assert/strict";

export function requireProbeResult(calls, name, expectedStatus = "passed") {
  const matches = calls.filter((call) => call.name === name);
  assert.ok(matches.length > 0, `Missing actual tool call: ${name}`);
  assert.equal(matches.length, 1, `Expected exactly one ${name} call`);
  const call = matches[0];
  assert.equal(
    call.state,
    "output-available",
    `${name} did not return output-available`,
  );
  assert.equal(
    call.output?.status,
    expectedStatus,
    `${name} expected ${expectedStatus}: ${JSON.stringify(call.output)}`,
  );
  return call.output;
}

export function verifyFileLifetime(policy, marker, sameChat, anotherChat) {
  assert.equal(
    sameChat.found,
    policy !== "ephemeral",
    "Unexpected file lifetime across Runs",
  );
  if (sameChat.found) assert.equal(sameChat.text, marker);
  assert.equal(
    anotherChat.found,
    policy === "shared-directory",
    "Unexpected file visibility in another Chat",
  );
  if (anotherChat.found) assert.equal(anotherChat.text, marker);
}
