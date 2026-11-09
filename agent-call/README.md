# Bot 调用测试目标

同一个 GEA Worker 导出四个可独立调用的测试 Agent。

| 名称 | Slug |
| --- | --- |
| Agent-Call-Test-01 | `agent-call-test-01` |
| Agent-Call-Test-02 | `agent-call-test-02` |
| Agent-Call-Test-03 | `agent-call-test-03` |
| Agent-Call-Test-04 | `agent-call-test-04` |

在 Agent Builder 中导入 `dist/*.gea-agent.zip` 并发布到 Bot 使用的环境。让现有主 Agent 向每个目标发送 `PROBE <token>`，例如 `PROBE bot-test-01`。目标返回 `agent`、`token`、`sessionId` 和 `runId`。从另一个 Worker 声明 SDK 依赖时，使用 Builder 分配的 Agent ID 和 `defineRemoteAgent({ agentId, description })`，并在调用方配置相应的目标调用授权。

需要重新打包时，在本目录使用 Node 24.16.0 和 pnpm 12.8.1 运行以下命令。SDK 和打包器直接使用相邻的 `gea` 工作树。

```sh
pnpm install --frozen-lockfile
pnpm pack:agent
```
