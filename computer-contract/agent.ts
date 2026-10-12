import { defineAgent } from "@gea-ai/agent-sdk";
import { defaultComputer } from "@gea-ai/agent-sdk/computer";

export default defineAgent({
  name: "Feishu-Extension-Local",
  slug: "computer-contract-local",
  model: "qwen3.7-plus",
  computer: defaultComputer({
    requires: ["shell", "exec", "processes", "files"],
    filesystem: {
      durability: "durable",
      scope: "chat",
      files: { "README.txt": "这是当前会话的独立 Computer 工作目录。\n" },
    },
    async onSession({ use, ctx }) {
      const computer = await use();
      await Promise.all([
        computer.writeTextFile({
          path: "initialized.txt",
          content: "Computer 初始化已完成，工具使用公开 SDK 契约。\n",
        }),
        computer.writeTextFile({
          path: "computer-info.json",
          content: JSON.stringify({
            chatId: ctx.chatId,
            scope: ctx.scope,
            roots: computer.roots,
            capabilities: computer.capabilities,
          }),
        }),
      ]);
    },
  }),
});
