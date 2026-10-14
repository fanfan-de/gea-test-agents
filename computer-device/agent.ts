import { defineAgent } from "@gea-ai/agent-sdk";
import { deviceComputer } from "@gea-ai/agent-sdk/computer";
import { initializeComputer } from "./-initialize";

export default defineAgent({
  name: "ComputerDeviceTest",
  slug: "computer-device-test",
  model: "qwen3.7-plus",
  computer: deviceComputer({
    requires: ["shell", "exec", "processes", "files", "readonly-mounts"],
    onSession: initializeComputer,
  }),
});
