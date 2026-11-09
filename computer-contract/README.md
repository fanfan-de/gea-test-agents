# 飞书 Extension 本地测试

本 Agent 挂载当前工作树的 `@gea-ai/agent-extension-feishu`，包含机器人 Channel、原生 Feishu Connector 和 `feishu__lark-cli` Skill。Studio 项目为「飞书 Extension 测试」，Agent 为 `Feishu-Extension-Local`，模型为 `qwen3.7-plus`。Computer 工具保留为辅助测试。

目录名和 slug 沿用 `computer-contract` / `computer-contract-local`，保留现有项目与记录。挂载入口是 [extensions/feishu.ts](./extensions/feishu.ts)，依赖链接当前 WSL 源码。

## 配置并开始测试

登录 [local-test.config.json](./local-test.config.json) 指定的测试组织和工作区，在目标 Agent 的「预览环境」配置：

| 名称                     | 类型   | 内容                                                                                                |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| `FEISHU_APP_ID`          | 普通值 | 测试机器人应用 ID                                                                                   |
| `FEISHU_APP_SECRET`      | Secret | 同一应用的 Secret                                                                                   |
| `FEISHU_ALLOWED_SENDERS` | 普通值 | 发送人 JSON 数组 `[{"tenantKey":"...","openId":"ou_..."}]`；`*` 允许所有发送人，`[]` 拒绝所有发送人 |

初始 allowlist 使用 `[]`；准备收消息时改成测试发送人的名单。缺失凭据时渠道显示配置错误；打包通过不代表飞书收发通过。凭据在 Studio 保存，不写入源码、提示词或 Computer。

本地使用 WebSocket 长连接，无需公网回调。飞书开放平台的测试应用需启用机器人、将事件订阅方式设为长连接、订阅 `im.message.receive_v1`，并发布允许测试用户使用的应用版本。卡片回复还需要 `cardkit:card:write`、`im:message.reactions:write_only` 及更新消息权限。

打开 Agent 的飞书渠道状态，确认 `feishu-bot` receiver 为 `ready`，然后私聊机器人，按 [测试提示词](./测试提示词.md) 验收。

## 两个测试入口

**飞书机器人内测试**：普通回复由 Channel 返回当前会话。`--as bot` 使用本 Channel 的应用，无需个人 Connector 连接；`--as user` 使用当前发送人对同一应用的授权，缺少授权时返回发送人专属链接。授权后重新发消息，不自动恢复旧请求。

**Studio 调试页测试**：在目标 Agent 的 Preview 调试页 新建对话，发送「实际调用 `feishu__api__connect`，只返回真实授权链接，不执行飞书业务操作」。打开工具返回的链接完成独立 Feishu Connection，再发下一条测试消息。未连接时直接业务调用也会返回授权链接。Playground 不是机器人 Channel 上下文，仅填写 Channel 环境变量不会替代这条连接；当前「连接」列表不会列出这项原生连接。

飞书业务操作使用实际 Connector 工具，通常为 `feishu__api__call`。参数为 `argv` 和可选文本 `stdin`，例如 `{"argv":["skills","list"]}`。业务命令明确选择 `--as bot` 或 `--as user`。平台在 Bubblewrap 沙箱执行官方 CLI；Computer 不安装、不执行 CLI，也不接收凭据。

先验证官方 Skills/help 和指定测试文档的读取。修改文档或独立发消息时，在当前会话明确指定目标与操作；未知结果先核对目标，不重复执行。

## 启动、发布与验收

```powershell
Set-Location -LiteralPath 'C:\Projects\GEA测试Agents\computer-contract'
.\start-local.ps1
.\publish-agent.ps1
.\test-feishu.ps1
```

重复启动复用本测试服务。`stop-local.ps1` 只停止启动器记录并验证归属的进程。修改 `agent.ts`、`extensions`、`AGENTS.md` 或 `tools` 后重新发布；Preview 更新后需新建对话，旧会话仍绑定原版本。

`test-feishu.ps1` 验证真实打包产物中的 Extension、Channel/WebSocket、环境声明与 Secret 类型、Connector、Skill 及 receiver 绑定，并在平台真实沙箱执行官方 CLI 的版本、Skills 和帮助命令。它不读取凭据、不连接机器人，也不将通过等同于真实飞书收发验收。

旧 WSL 测试环境使用官方 `@larksuite/cli@1.0.90`，独立入口 `/usr/local/bin/gea-lark-cli` 使用 `/usr/local/lib/gea-node-v24.16.0` 的 Node。WSL 重建依赖时运行：

```powershell
wsl -d Ubuntu -u root -- bash /mnt/c/Projects/GEA测试Agents/computer-contract/scripts/install-feishu-platform.sh
```

## Computer 辅助测试

`test-agent.ps1` 是 Computer 自动验收入口，结果在 `.local/verification.json`。含飞书 Extension 的版本在 Playground 中可能先要求独立 Feishu Connection。命令场景逐条发送；后台进程 handle 关闭前会拒绝前台执行。终止场景保留实际 processId、killRequested、退出码或错误，不补造退出码。

## 本机服务与源码

[local-test.config.json](./local-test.config.json) 和 `scripts/environment.mjs` 指定 WSL 源码、Web 环境文件、CLI、端口和隔离数据库。运行旧版测试入口前，核对 SDK、飞书 Extension 及各运行时二进制与目标环境兼容。日志、部署回执和验收结果保存在本地状态目录。
