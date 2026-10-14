# 飞书 Extension 本地测试

本 Agent 挂载当前工作树的 `@gea-ai/agent-extension-feishu`，包含机器人 Channel、原生 Feishu Connector 和 `feishu__lark-cli` Skill。Studio 项目为「飞书 Extension 测试」，Agent 为 `Feishu-Extension-Local`，模型为 `qwen3.7-plus`。Computer 工具保留为辅助测试。

目录名和 slug 沿用 `computer-contract` / `computer-contract-local`，保留现有项目与记录。挂载入口是 [extensions/feishu.ts](./extensions/feishu.ts)，依赖链接当前 WSL 源码。

## 配置并开始测试

需要登录时打开 [测试组织登录入口](http://musegea.localhost:3003/sign-in?orgSlug=local-test)。账号为 `tester@example.local`，密码沿用本次本地测试账号。

打开 [Agent 环境变量](http://local-test.musegea.localhost:3003/studio/default/agents/01a12509-e3d6-730b-b7ea-e63ab2c2dc1f?environment=preview&view=environment)，在「预览环境」配置：

| 名称                     | 类型   | 内容                                                                                                |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| `FEISHU_APP_ID`          | 普通值 | 测试机器人应用 ID                                                                                   |
| `FEISHU_APP_SECRET`      | Secret | 同一应用的 Secret                                                                                   |
| `FEISHU_ALLOWED_SENDERS` | 普通值 | 发送人 JSON 数组 `[{"tenantKey":"...","openId":"ou_..."}]`；`*` 允许所有发送人，`[]` 拒绝所有发送人 |

初始 allowlist 使用 `[]`；准备收消息时改成测试发送人的名单。缺失凭据时渠道显示配置错误；打包通过不代表飞书收发通过。凭据在 Studio 保存，不写入源码、提示词或 Computer。

本地使用 WebSocket 长连接，无需公网回调。飞书开放平台的测试应用需启用机器人、将事件订阅方式设为长连接、订阅 `im.message.receive_v1`，并发布允许测试用户使用的应用版本。卡片回复还需要 `cardkit:card:write`、`im:message.reactions:write_only` 及更新消息权限。

打开 [飞书渠道状态](http://local-test.musegea.localhost:3003/studio/default/agents/01a12509-e3d6-730b-b7ea-e63ab2c2dc1f?environment=preview&view=channels)，确认 `feishu-bot` receiver 为 `ready`，然后私聊机器人，按 [测试提示词](./测试提示词.md) 验收。

## 两个测试入口

**飞书机器人内测试**：普通回复由 Channel 返回当前会话。`--as bot` 使用本 Channel 的应用，无需个人 Connector 连接；`--as user` 使用当前发送人对同一应用的授权，缺少授权时返回发送人专属链接。授权后重新发消息，不自动恢复旧请求。

**Studio 调试页测试**：在 [调试页面](http://local-test.musegea.localhost:3003/studio/default/agents/01a12509-e3d6-730b-b7ea-e63ab2c2dc1f?environment=preview&view=playground) 新建对话，发送「实际调用 `feishu__api__connect`，只返回真实授权链接，不执行飞书业务操作」。打开工具返回的链接完成独立 Feishu Connection，再发下一条测试消息。未连接时直接业务调用也会返回授权链接。Playground 不是机器人 Channel 上下文，仅填写 Channel 环境变量不会替代这条连接；当前「连接」列表不会列出这项原生连接。

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

2026-10-10 Preview v6 已通过真实模型的 `feishu__api__connect` 验收：授权链接正常返回，Run 完成，流输出和持久化工具结果一致。当前独立 Connection 尚未授权，频道接收器已报告 `ready`；实际文档等业务操作仍需按测试提示词验收。完整调试结果保存在 `.local/feishu-connect.json`，其中的临时授权链接不应分享。

本次同时修复主工作树 Connector Host 的 Zod JSON Schema 元数据兼容问题，避免飞书工具初始化返回 400、调试请求返回 500；回归测试 10/10 和全工作区类型检查通过。

随后修复了飞书 Channel 经 Agents API 创建 Run 时丢失频道来源的问题。内部 Run 保留经主机验证的安装标识，每次工具调用重新验证安装归属与权限；机器人会话的 `--as bot` 不再错误要求独立 Connection，`--as user` 仍使用当前发送人的授权。

这项修复的相关回归测试 132/132、全工作区类型检查与代码检查通过。使用实际发送人和捕获版本经过真实 ToolHost、Connector Host 与 Bubblewrap CLI 的只读验收也通过：`whoami --as bot` 确认为 bot，版本查询成功；去掉频道来源仍要求独立 Connection，`whoami --as user` 仍在执行前返回绑定频道与发送人的授权要求。个人 Connection 前后均为零，没有发送额外飞书消息或修改文档。安全摘要在 `.local/feishu-channel-bot-verification.json`，私有报告在本机服务状态目录。

平台已安装官方 `@larksuite/cli@1.0.90`，独立入口 `/usr/local/bin/gea-lark-cli` 使用 `/usr/local/lib/gea-node-v24.16.0` 的 Node。WSL 重建依赖时运行：

```powershell
wsl -d Ubuntu -u root -- bash /mnt/c/Projects/GEA测试Agents/computer-contract/scripts/install-feishu-platform.sh
```

## Computer 辅助测试

原有五个 Computer 工具保留。2026-10-10 Preview v4 的六轮真实模型验收覆盖文件、二进制、退出码、超时、终止、权限、持久化和隔离；这个记录不代表飞书验收。

`test-agent.ps1` 是 Computer 自动验收入口，结果在 `.local/verification.json`。含飞书 Extension 的版本在 Playground 中可能先要求独立 Feishu Connection。命令场景逐条发送；后台进程 handle 关闭前会拒绝前台执行。终止场景保留实际 processId、killRequested、退出码或错误，不补造退出码。

## 本机服务与源码

- Web、API、Worker Runtime、Computer 在 WSL2 Ubuntu 中运行。Studio 为 `musegea.localhost:3003`，Runtime 为 `127.0.0.1:3005`，API 为 `127.0.0.1:3004`，Computer 为 `127.0.0.1:8790`。
- DEV Web 的 Nitro worker 负责 receiver reconcile；当前 Studio 授权走直接 HTTP 流，无需另启旧飞书 Setup worker。
- 独立数据库为 `gea_worktree_test_20261010`，基础设施复用已有 PostgreSQL、Redis、MinIO、OpenSearch 和 SpiceDB。
- 项目源码是 `C:\Projects\gea` 当前工作树的 WSL 快照 `/home/fanfande/gea-computer-providers-current`（包含同步时未提交的 tracked 更改）。Runtime、App Server、API、Computer 和 sandboxd 均从该快照同源构建；主项目后续修改需重新同步构建并重启，Agent 本目录可直接重新发布。
- Agent SDK 链接当前快照；当前工作树不再包含原来的 `packages/agent-extension-feishu`，此测试保留原快照中的该 Extension 依赖，保持已有 Agent、Channel、Connector 和 Skill 声明。
- 配置入口为 `local-test.config.json` 与 `scripts/environment.mjs`。基础配置读取主工作树 Web `.env`，测试端口、数据库及平台 CLI 路径由启动器覆盖。
- 工具链固定 Node 24.16.0、pnpm 12.8.1、Rust 1.94.1。平台 CLI 的 Node 副本位于沙箱可见的 `/usr/local`，不替换其他项目的全局 Node。
- 服务日志与私有状态在 `/home/fanfande/.local/share/gea-computer-studio-20261010`；Computer 缓存在 `/home/fanfande/.local/share/ct1010`；本目录 `.local` 保存部署及验收结果。
