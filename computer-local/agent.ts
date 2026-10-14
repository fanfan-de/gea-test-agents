import { defineAgent } from "@gea-ai/agent-sdk";
import { localComputer } from "@gea-ai/agent-sdk/computer";
import { initializeComputer } from "./-initialize";

export default defineAgent({
  name: "ComputerLocalTest",
  slug: "computer-local-test",
  model: "qwen3.7-plus",
  computer: localComputer({
    mode: "sandbox",
    filesystem: { source: "local-project" },
    requires: ["shell", "exec", "processes", "files", "readonly-mounts"],
    onSession: initializeComputer,
  }),
});
