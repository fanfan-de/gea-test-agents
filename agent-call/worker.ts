import { defineAgent, defineTool } from "@gea-ai/agent-sdk";
import { defineWorker } from "@gea-ai/agent-sdk/worker";
import { z } from "zod";

const agents = ["01", "02", "03", "04"].map((number) => {
  const slug = `agent-call-test-${number}`;
  const invocationProbe = defineTool({
    name: "invocation_probe",
    description: "回传 token 和当前执行的 Agent、Session、Run 标识。",
    input: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
    execute({ token }, { identity }) {
      return {
        agent: slug,
        token,
        sessionId: identity.chat.id,
        runId: identity.run.id,
      };
    },
  });

  return defineAgent({
    name: `Agent-Call-Test-${number}`,
    slug,
    description: `调用测试目标 ${number}。发送 PROBE <token> 获取实际执行回执。`,
    model: "gea-fast",
    context: false,
    tools: [invocationProbe],
    instructions: [
      "收到 PROBE <token> 时，用原 token 调用 invocation_probe 一次。",
      "token 由 1 至 64 个 ASCII 字母、数字、下划线或连字符组成。",
      "成功后原样返回工具输出的 JSON。调用失败时返回实际错误。",
      "其他输入仅回复用法 PROBE <token>。",
    ].join("\n"),
  });
});

export default defineWorker({
  agents: Object.fromEntries(agents.map((agent) => [agent.slug, agent])),
});
