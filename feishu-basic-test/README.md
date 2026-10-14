# 飞书基础测试 Agent

用于验证官方 `@gea-ai/agent-extension-feishu` 的 Channel、Connector 与个人授权。采用官方最小结构，当前模型为生产平台默认的 `gea-pro`，飞书消息通过 WebSocket 长连接接收。

## 重新部署（2026-10-13）

已使用相邻源码仓库 `6dece1b78` 重新构建并发布 **Production v3**，部署 ID 为 `01a133b3-6328-72be-89dd-c4526dc70a44`，状态为 `ready`。Preview 和 Production 均指向此部署。生产 Channel 已启用，Preview Channel 已停用。

- [Production 基础检查](https://tezign.musegea.com/studio/default/agents/01a12ff2-0ede-7337-9e1f-0fb68db1ed67?view=playground&environment=production&chatId=01a133b6-fd48-7672-be01-ae62f4a220cd)已回复 `FEISHU_AGENT_OK`，页面显示 `Run finished`。Preview v3 的基础检查也通过。
- **飞书收发仍未通过**。开始排查时线上实际为 Preview 启用、Production 停用；恢复生产启用并请求重启后，生产接收器 revision 升至 22，但仍为 `connecting`，active target 保留在 v1，desired target 和 lastError 都为空。停用的 Preview 同样没有收敛到 `stopped`。
- 这些事实指向生产接收器协调链路没有成功推进，不能据此断定是凭据错误、飞书权限不足或具体哪一个后台故障。下一步需要检查 `agent.channel.receiver.reconcile` 任务消费与失败记录，以及 `gea-worker` / `worker-runtime` 对 installation `01a12ff3-8c30-727e-be65-1f0faa438af2` 的控制日志。
- 本地 CLI 的 Windows 绝对路径兼容问题已在 `packages/contract/src/app-server.ts` 修复；6 个行为测试、完整工作区 `pnpm type-check` 和格式检查通过。修复保留为未提交改动。
- 已从当前源码重新构建原生 App Server。复用历史状态目录仍出现启动超时；每次构建或推送使用新的 `GEA_APP_SERVER_STATE_DIR`，继续复用 `.gea/production-cli` 的生产登录状态。新版本上传耗时约三分钟，命令成功返回后才切换 Production。

无密钥回执为 `.local/studio-production-v3.json`；生产运行和 Channel 状态截图分别为 `.local/production-v3-smoke.png`、`.local/production-v3-channel.png`。这些结果确认发布和普通对话成功，不代表飞书收发成功。本次没有重新执行 Connector 业务调用，也没有发送飞书测试消息。当前会话没有 GEA MCP，未同步共享知识。

## 生产部署与验收（2026-10-12）

已对齐相邻源码仓库 `origin/main` 的 `5258d1b44`，SDK 和飞书 Extension 均为 `0.1.261012-alpha.1`。另有一处未提交的本地兼容性修复：App Server 合约接受 Rust 返回的 Windows `\\?\C:\...` 绝对路径。相关 6 个测试、飞书 Extension/打包相关 11 个测试及完整工作区 `pnpm type-check` 均通过。

- [生产 Agent](https://tezign.musegea.com/studio/default/agents/01a12ff2-0ede-7337-9e1f-0fb68db1ed67)：Production v2。
- [生产项目](https://tezign.musegea.com/studio/default/projects/01a12ff1-a6a2-73ca-aec6-67c7a09de2b9)：`tezign/default`，项目 slug 为 `feishu-basic-test`。
- [基础检查成功会话](https://tezign.musegea.com/studio/default/agents/01a12ff2-0ede-7337-9e1f-0fb68db1ed67?view=playground&environment=production&chatId=01a12ffc-0434-721f-91cf-0f055034bdcf)：已持久化 `FEISHU_AGENT_OK`，运行状态为 `finished`。
- 本地模型 `qwen3.7-plus` 不在生产模型目录中；生产提供 `gea-pro` 和 `gea-fast`。改用 `gea-pro` 后普通对话通过。
- 原测试机器人的三个 `FEISHU_*` 变量已迁移到项目 **Production**，App Secret 以 secret 保存；配置检查 `ready: true`。`FEISHU_ALLOWED_SENDERS` 当前是 `*`，表示允许所有发送人。
- 按用户要求，本地 Channel 已停用。生产站点的 Preview Channel 也已停用，只有 Production Channel 启用。
- **飞书收发尚未通过**：用户实测没有回复。接收器持续 `connecting`，revision 为 `3`；目标部署为 v2，active target 仍为 v1，desired target 为 null，未返回具体错误。需要生产 `gea-worker` / `worker-runtime` 日志继续定位，当前没有访问权限。
- **Studio Connector 尚未授权**：已真实调用 `skills list` 和 `--help`，均返回 `authorization_required` / `connection.configured: false`。Studio 需要独立 Feishu Connection；这一结果不能证明 Channel 的 bot 调用是否可用。
- 无密钥部署与验收回执：`.local/studio-production.json`。生产 CLI 会话隔离在 `.gea/production-cli`；不要提交该目录。

生产部署 ID：`01a12ffb-75bd-771d-a0d7-53dfefb2d4f4`。待排查的 Channel installation ID：`01a12ff3-8c30-727e-be65-1f0faa438af2`。排查时先检查后台 `agent.channel.receiver.reconcile` 任务是否被处理，以及 Worker Runtime 的接收器控制日志；目前未证实具体根因。不要把“发布成功”当作飞书收发验收成功。

本次未同步 GEA 共享知识：会话未提供 GEA MCP，记录保留在本地。

### 无生产日志条件下的补充排查（2026-10-12 20:13，UTC+8）

通过正式 ORPC 接口重新读取状态，确认不是页面缓存。Production 为 v2 / `gea-pro`，接收器 revision 为 10；Preview 已禁用、revision 为 8。两者仍为 `connecting`，`desiredTarget` 与 `lastError` 都为 null，active target 仍是 v1。状态快照见 `.local/production-channel-observation.json`。

使用此前迁移的原机器人凭据，仅调用飞书鉴权、机器人信息、WebSocket 地址发现接口：三者均返回 HTTP 200 / code 0，机器人名为“薛登文的智能助手”，返回的 WSS 地址符合 Extension 域名规则。未建立 WebSocket，未发送业务消息；回执不保存 token 或连接地址，见 `.local/feishu-provider-probe.json`。生产与预览的 App ID 均与原机器人一致，见 `.local/feishu-app-match.json`。

此时变量已改为 Worker 层配置，两套环境的允许发送人仍是 `*`。Secret 无法通过管理接口读回，所以原凭据验证成功不等于当前 Worker Secret 已逐字核对；本地网络验证也不能证明生产到飞书的网络连通性。

当前证据优先指向 GEA 接收器协调链路没有成功推进：正常协调任务每分钟调度；正常目标解析会填充 desired target，已处理的配置/运行故障通常会记录错误，而禁用请求也应收敛到 stopped 或记录停止失败。仍需区分任务未消费、Worker 版本/任务注册不匹配、权限或数据库等前置步骤失败。不能仅凭现有状态确定其中某个根因。

页面“等待旧连接停止”文案仅根据 Worker target 与 active target 的部署 ID 不同显示，并不能证明旧 WebSocket 实际建立过，或后台已执行到停止旧连接阶段。为保留现场，本次补充排查没有修改生产部署、环境变量或 Channel 开关。

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

使用 `.node-version` 的 Node.js 24.16.0 和 pnpm 12.8.1。当前机器的全局工具入口有问题时，可以在本次 PowerShell 中使用已安装的隔离工具：

```powershell
$env:Path = "$env:LOCALAPPDATA\fnm\node-versions\v24.16.0\installation;$env:LOCALAPPDATA\Temp\gea-dev-tools-pnpm-12.8.1\node_modules\.bin;$env:Path"
node --version
pnpm --version
```

校验和打包不需要飞书凭据，也不会连接飞书。打包产物保存在 Git 忽略的 `dist/` 下，CLI 运行状态保存在 `.gea/` 下；实际路径以 CLI 输出为准。

源码 CLI 依赖原生 App Server。缺少二进制时，在 `gea-worktree` 按其 Rust toolchain 构建：

```powershell
cargo +1.94.1 build --manifest-path crates/app-server/Cargo.toml --bin gea-app-server
```

本机复用旧 App Server 状态目录时曾出现启动超时。可为本次命令指定新的状态目录，保留旧状态供排查：

```powershell
$env:GEA_APP_SERVER_STATE_DIR = Join-Path $PWD (".gea/run-" + [guid]::NewGuid().ToString("N"))
pnpm pack:agent
Remove-Item Env:GEA_APP_SERVER_STATE_DIR
```

## 加入 Studio

此前本地 Studio 已推送 Preview v1（2026-10-12）；以下是历史本地测试记录。此次生产切换已停用本地 Channel，原本地 Runtime 不在运行：

- 项目：`飞书基础测试`，slug 为 `feishu-basic-test`。
- [Agent 页面](http://local-dev.musegea.localhost:3000/studio/default/agents/01a12e35-a306-7396-b529-736f0205fde1)。
- [项目页面](http://local-dev.musegea.localhost:3000/studio/default/projects/01a12e34-089e-7178-8b1d-50caee3ada7b)。
- 本地推送回执：`.local/studio-push.json`；独立 CLI 会话：`.gea/cli-config`。
- Worker Runtime 容器：`gea-feishu-basic-worker-runtime`，本机端口 `3002`。模型目录和所选 Gateway 配置保存在 Git 忽略的 `.gea/worker-runtime/runtime.env`；容器数据保存在同名 `-data` Docker 卷。
- Cloud Agents API：本机端口 `3001`，使用源码仓库的 `crates/api/target/debug/gea-api.exe`；私有配置位于 `.gea/worker-runtime/cloud-agent-api.json`。
- 此前本地测试使用的 Web 配置位于 `.gea/worker-runtime/web-runtime-env.json`。重启本地完整测试栈时需要再次加载这些变量；单独运行 `pnpm dev` 不会自动加载此文件。
- 实际运行验证：Studio Preview 的“基础检查”已生成并持久化 `FEISHU_AGENT_OK`。回执为 `.local/studio-smoke.json`；[成功的调试会话](http://local-dev.musegea.localhost:3000/studio/default/agents/01a12e35-a306-7396-b529-736f0205fde1?view=playground&environment=preview&chatId=01a12e46-feea-744e-a625-211a16ddec7d)。

飞书应用凭据在 Agent 的 Preview 环境变量中配置，不写入本目录。以上运行验证只覆盖基础对话；飞书消息回复与业务 Connector 按下文分别验证。

历史本地测试曾修复数据库迁移记录存在但缺少 `organization_credential` 表的问题，并启动匹配的 Cloud Agents API 与 Worker Runtime 完成基础对话；这些历史结果不代表当前生产飞书链路已通过。

先让 CLI 登录目标 GEA 环境并选择组织、工作区，然后创建或选择一个 Studio 测试项目。使用该项目的 slug 推送到 Preview：

```powershell
.\gea.ps1 push -Project <测试项目slug>
```

`gea.ps1` 默认使用相邻的 `gea-worktree` 和 `.gea/cli-config` 本地 CLI 会话；需要其他源码仓库时传 `-SourceRoot <源码目录>`。生产登录状态单独保存于 `.gea/production-cli`，推送时显式指定：

```powershell
.\gea.ps1 push -Project feishu-basic-test -ConfigDir "$PWD/.gea/production-cli"
```

该命令更新 Preview，不会自动切换 Production。确认目标、构建和环境后，使用 `worker release` 显式选择部署 ID。模型 ID 必须来自目标平台目录，然后重新校验和推送。

## Studio 飞书配置

在 Agent 的 Preview 环境配置以下变量，再启用 Channel。Production 单独配置；同一飞书应用避免同时被多个长连接测试实例占用。

| 变量                     | 设置                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `FEISHU_APP_ID`          | 自建应用 App ID。                                                                                                        |
| `FEISHU_APP_SECRET`      | 以 secret 类型保存 App Secret。                                                                                          |
| `FEISHU_ALLOWED_SENDERS` | 测试用户数组：`[{"tenantKey":"<租户key>","openId":"<测试用户open_id>"}]`。初始 `[]` 拒绝所有输入，填写测试用户后才接收。 |

`FEISHU_ALLOWED_SENDERS` 也支持 `*`，允许所有发送人；本次沿用的测试机器人使用这一配置。可在生产项目的 Environment Variables 页面点击该行的 Reveal value 查看。

飞书自建应用需开启机器人能力，将测试用户加入应用可用范围，配置长连接事件订阅 `im.message.receive_v1` 并发布应用版本。群聊 @ 测试还需 `im:message.group_at_msg:readonly`，并把机器人加入测试群。

Channel key 是 `feishu-bot`，路径为 `/channels/feishu-basic-test/feishu/bot`。业务工具默认为 `feishu__api__call`，参数为 CLI `argv`，例如 `{"argv":["skills","list"]}`。每次业务命令选择 `--as bot` 或 `--as user`。

Studio 调试需单独建立 Feishu Connection。托管飞书 Channel 内的 bot 调用使用 Channel 应用；user 调用还需要本次发送人的个人授权。应用凭据只在 Studio 配置。

平台侧需具备官方 lark-cli 与 Linux sandbox 执行环境。当前 Windows Web dev 的页面可用和 Agent 构建成功，不能替代平台业务调用验收；可使用已有 Linux/WSL 测试平台进行真实飞书验证。

完成配置后按[测试提示词](./测试提示词.md)逐项验证。只读取或明确指定的测试资源；不要将 secret、token 或飞书文档内容提交到 Git。
