import { defineTool } from "@gea-ai/agent-sdk";
import { z } from "zod";

export default defineTool({
  name: "application_probe",
  description:
    "核对just-bash没有宣告Native application v1，不把缺失能力当成执行成功。",
  input: z.object({}),
  permissions: { workspace: ["read"], commands: false },
  async execute(_, ctx) {
    if (ctx.computer?.protocol)
      throw new Error("Unexpected application protocol on just-bash");
    return {
      status: "unsupported",
      supported: false,
      reason: "just-bash uses its Worker-local shell/files API",
    };
  },
});
