import { defineAgent } from "@gea-ai/agent-sdk";
import { defaultComputer } from "@gea-ai/agent-sdk/computer";

export default defineAgent({
  name: "Computer-Default-Test",
  slug: "computer-default-test",
  model: "qwen3.7-plus",
  computer: defaultComputer({
    requires: ["shell", "exec", "files", "readonly-mounts"],
    filesystem: {
      durability: "durable",
      scope: "chat",
      files: { "provider-tests/default/seed.txt": "default seed\n" },
    },
    async onSession({ use, ctx }) {
      const computer = await use();
      await computer.writeTextFile({
        path: "provider-tests/default/info.json",
        content: JSON.stringify({
          provider: "default",
          chatId: ctx.chatId,
          scope: ctx.scope,
          roots: computer.roots,
          capabilities: computer.capabilities,
        }),
      });
    },
  }),
});
