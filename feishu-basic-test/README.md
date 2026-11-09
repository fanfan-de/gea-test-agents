# 飞书基础测试 Agent

用于验证官方 `@gea-ai/agent-extension-feishu` 的 Channel、Connector 与个人授权。采用官方最小结构，当前模型为生产平台默认的 `gea-pro`，飞书消息通过 WebSocket 长连接接收。

## 文件

- `agent.ts`：名称、slug 和模型。
- `extensions/feishu.ts`：挂载官方 Extension，namespace 为 `feishu`。
- `AGENTS.md`：测试助手行为和真实结果报告规则。
- [测试提示词](./测试提示词.md)：Studio 调试、私聊、群聊与授权测试。
- `gea.ps1`：通过相邻 `gea-worktree` 的当前源码 CLI 校验、打包、开发或推送到 Studio Preview。

## 安装与构建

本项目链接 `C:\Projects\gea-worktree` 中的 SDK 和 Extension 源码。先在该源码仓库完成依赖安装，再在本目录运行：

```powershell
pnpm install
pnpm validate
pnpm pack:agent
```

校验和打包使用 `.node-version` 的 Node.js 24.16.0 和 pnpm 12.8.1。打包文件位于 `dist/`，CLI 状态位于 `.gea/`。源码 CLI 需要与检出版本匹配的原生 App Server。

## 加入 Studio

先让 CLI 登录目标 GEA 环境并选择组织、工作区，然后创建或选择一个 Studio 测试项目。使用该项目的 slug 推送到 Preview：

```powershell
.\gea.ps1 push -Project <测试项目slug>
```

`gea.ps1` 默认使用相邻的 `gea-worktree` 和 `.gea/cli-config`，也接受 `-SourceRoot` 与 `-ConfigDir`。推送后在目标环境验证 Preview。Production 需单独选择部署。

## Studio 飞书配置

在 Agent 的 Preview 环境配置以下变量，再启用 Channel。Production 单独配置；同一飞书应用避免同时被多个长连接测试实例占用。

| 变量                     | 设置                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `FEISHU_APP_ID`          | 自建应用 App ID。                                                                                                        |
| `FEISHU_APP_SECRET`      | 以 secret 类型保存 App Secret。                                                                                          |
| `FEISHU_ALLOWED_SENDERS` | 测试用户数组：`[{"tenantKey":"<租户key>","openId":"<测试用户open_id>"}]`。初始 `[]` 拒绝所有输入，填写测试用户后才接收。 |

飞书自建应用需开启机器人能力，将测试用户加入应用可用范围，配置长连接事件订阅 `im.message.receive_v1` 并发布应用版本。群聊 @ 测试还需 `im:message.group_at_msg:readonly`，并把机器人加入测试群。

Channel key 是 `feishu-bot`，路径为 `/channels/feishu-basic-test/feishu/bot`。业务工具默认为 `feishu__api__call`，参数为 CLI `argv`，例如 `{"argv":["skills","list"]}`。每次业务命令选择 `--as bot` 或 `--as user`。

Studio 调试需单独建立 Feishu Connection。托管飞书 Channel 内的 bot 调用使用 Channel 应用；user 调用还需要本次发送人的个人授权。应用凭据只在 Studio 配置。

平台侧需具备官方 lark-cli 与 Linux sandbox 执行环境。当前 Windows Web dev 的页面可用和 Agent 构建成功，不能替代平台业务调用验收；可使用已有 Linux/WSL 测试平台进行真实飞书验证。

完成配置后按[测试提示词](./测试提示词.md)逐项验证。只读取或明确指定的测试资源；不要将 secret、token 或飞书文档内容提交到 Git。
