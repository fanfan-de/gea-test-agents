# GEA 测试 Agents

GEA Agent 集成测试项目，包含飞书 Extension 测试与 Computer 文件、进程能力测试。

## 当前 Computer 主测试入口（2026-10-21）

本次改造复用 [computer-default](./computer-default/README.md)，依赖直接链接 `C:\Projects\gea-worktree` 当前源码，不再使用旧 WSL 副本。目标由 [studio.config.json](./studio.config.json) 指定，当前为 `http://local-dev.musegea.localhost:3000`、工作区 `default`。模型在 `computer-default/agent.ts` 中配置。

在本目录执行：

```powershell
.\studio.ps1 install
.\studio.ps1 unit
.\studio.ps1 validate
.\studio.ps1 pack
.\studio.ps1 doctor
.\studio.ps1 publish
.\studio.ps1 test
```

`studio.ps1` 使用 `.node-version` 要求的 Node 24.16.0；安装了 fnm 时会通过它运行对应版本，避免 PowerShell 提示与实际 Node 版本不一致。`unit` 使用本机真实临时文件和 Node 子进程验证探针逻辑；`validate` 检查类型和当前 CLI 的 Agent 定义；`pack` 在 `computer-default/dist` 生成可导入的 `.gea-agent.zip`。这三步不要求 Studio 在线。

`doctor` 只检查目标与 `/readyz`，不启动或停止服务。自动发布和真实 Agent 验收需要完整的 Studio 链路就绪；仓库启动说明见 `C:\Projects\gea-worktree\README.md` 中的 `pnpm dev:studio`。自动登录读取 `.local/studio-login.json`，结构见 [studio-login.example.json](./studio-login.example.json)，填入当前本地 Studio 的已有账号；该私有文件被 Git 忽略。也可直接通过 Builder 界面导入打包文件并使用[测试提示词](./computer-default/测试提示词.md)。

发布只选择 Preview，新的回执保存到 `.local/studio-ready.json`。验收会检查目标和当前源码的构建 hash，串行调用真实模型与工具，核对消息持久化、Run 最终状态、同 Session 持久化和新 Session 隔离。每次报告保存为 `.local/studio-verification-<时间>.json/.md`，最新报告为 `.local/studio-verification.json/.md`；失败、unsupported 和未执行项目分别列出。它不把模型的口头结论或历史测试结果计为通过。

Run 结束需同时满足 `finished`、流恢复接口 HTTP 204 和持久化工具证据一致；原始 `activeStreamId` 保留在报告中，不单凭该字段判断活跃状态。已确认结束的工具失败会记为 failed 后继续独立项目，依赖失败的文件用例记为 blocked；部署不符、证据缺失、仍活跃或结果明确 unknown 时会中止并清理本轮精确 Run。任何失败或未执行项都不能得到整轮通过结论。

已有浏览器登录会话时，脚本也支持临时的 `.local/studio-session.json`，字段为 `baseUrl`、`organization`、`workspace`、`cookie`、`expiresAt`（ISO UTC）。只接受与当前配置完全一致且未过期的会话；文件损坏、过期或目标不符都会在请求前停止。该文件包含认证秘密，使用后删除；不要纳入版本管理。文件不存在时才使用上面的账号密码登录流程。

2026-10-21 本地 Studio 从当前 `gea-worktree` 源码同步到 WSL `/home/fanfande/gea-studio-current` 后启动，入口为 `http://local-dev.musegea.localhost:3000`。同次源码构建的 API、Worker Runtime 和 Computer 服务分别使用 3001、3002、8789 端口；复用原有数据库与 Docker 基础服务。启动状态和日志位于本项目忽略目录 `.local/studio-service/`，不读取 2026-10-12 的旧测试源码。当前 [Computer-Default-Test](http://local-dev.musegea.localhost:3000/builder/default/agents/01a15cee-9f1b-717a-bf82-cb8572bb0e40) 已发布到 `local-dev / default` 的 Preview，真实结果以本次验收报告为准。

本轮完整真实验收执行了 12 项：10 passed、2 failed、0 unsupported、0 blocked。失败项是命令 timeout 与后台 terminate，均返回 `Computer command and cleanup failed.`；已定位到共享命令句柄关闭时未传终止确认标记，不能将其计为通过。全部 Run 已 finished，流恢复接口均为 204。完整证据见 `.local/studio-verification.json/.md`，平台问题分析见 `.local/studio-platform-observations.md`。本地 36 项行为测试、当前源码 validate 和 pack 通过，打包 hash 与实际 Preview 部署一致。本轮复用现有浏览器登录完成；临时认证文件已清理，后续脚本执行需要重新提供当前有效的本地登录配置。

以下 provider 矩阵和部署记录是 2026-10-12 的历史环境，保留用于参考。改造后的 `computer-default` 使用上面的 `studio.ps1` 入口，不再使用旧 `providers.ps1` / `providers.sh` 验收它；其他 provider 项目和飞书项目保持原样。

## 项目入口

- [computer-none](./computer-none/README.md)：完全省略 Computer 配置的独立测试 Agent，已发布到本地 3006 Preview；真实验证空挂载下纯计算可用，shell/文件调用失败。
- [feishu-basic-test](./feishu-basic-test/README.md)：官方飞书 Extension 基础测试 Agent，凭据在 Studio 配置。
- [飞书基础测试提示词](./feishu-basic-test/测试提示词.md)：基础对话、Connector、私聊、群聊和个人授权测试。
- [computer-contract](./computer-contract/README.md)：环境配置、启动、发布和验收说明。
- [测试提示词](./computer-contract/测试提示词.md)：飞书与 Computer 测试场景。

`feishu-basic-test` 链接相邻 `gea-worktree` 的当前源码。`computer-contract` 的测试环境依赖本机 WSL 中的 GEA 源码与服务，路径配置见 `computer-contract/local-test.config.json`，依赖链接见 `computer-contract/package.json`。

## 独立 Computer provider 测试

六个新项目均无飞书 Extension，各自有独立 Agent slug、工具、Skill、提示词和打包产物：

| 项目                                               | Provider       | 文件生命周期       | 执行入口                                       |
| -------------------------------------------------- | -------------- | ------------------ | ---------------------------------------------- |
| [computer-default](./computer-default/README.md)   | default        | durable/chat       | 本地 Studio + agent-computerd                  |
| [computer-justbash](./computer-justbash/README.md) | just-bash      | 每次 Run ephemeral | 本地 Studio；另有真实 SDK Worker smoke         |
| [computer-e2b](./computer-e2b/README.md)           | e2b            | 普通 Run ephemeral | Studio Preview；未配置 E2B_API_KEY，跳过运行   |
| [computer-remote](./computer-remote/README.md)     | remote         | durable/chat       | 本地 Studio + Linux reference service          |
| [computer-local](./computer-local/README.md)       | local sandbox  | 已授权项目目录     | Studio 中注册；实际执行使用独立 CLI/App Server |
| [computer-device](./computer-device/README.md)     | device trusted | 已授权设备目录     | 本地 Studio + 独立配对的 WSL App Server/relay  |

当前源码取自 `C:\Projects\gea`，包含工作区中尚未提交的源码修改。隔离 WSL 副本为 `/home/fanfande/gea-computer-providers-current`，同源 native 二进制位于 `/home/fanfande/.local/gea-computer-providers-current/cargo-target/debug`。固定 Node 24.16.0、pnpm 12.8.1、Rust 1.94.1。配置入口为 [computer-providers.config.json](./computer-providers.config.json)。

现有 `feishu-basic-test` 的文件保留；`computer-contract` 仍是飞书测试项目，SDK、平台和运行时链接到当前隔离源码。当前主源码已经没有旧的独立飞书 Extension 包，因此该旧包继续从原 WSL 副本链接；没有复制或重写飞书 Agent 的源码、凭据或历史版本。

在本目录使用：

```powershell
.\providers.ps1 start
.\providers.ps1 validate
.\providers.ps1 pack
.\providers.ps1 publish -Provider default
.\providers.ps1 test -Provider default
.\providers.ps1 dev -Provider local
.\providers.ps1 pair-device
.\providers.ps1 publish -Provider device
.\providers.ps1 test -Provider device
.\providers.ps1 status
```

WSL 等价入口为 `bash providers.sh <command> <provider>`。`.\providers.ps1 publish` 会将六个独立 Agent 上传并选择 Studio Preview。`publish local` 保留 `localComputer` 定义，仅注册到 Studio；当前 hosted 运行器在实际分配时返回 `local_computer_requires_local_host`，实际运行仍使用 `dev local` / `test local` 的授权本地管理接口。`test e2b` 显示明确跳过。`start` 启动或复用本项目 Studio 和 Remote reference service，不能把其他进程的同名端口视为本服务。

Studio 入口是 `http://musegea.localhost:3003/`，测试组织入口是 `http://local-test.musegea.localhost:3003/studio/default`。端口与登录文件均读配置；运行时使用 3005、Agents API 使用 3004、Computer 使用 8790、Remote 使用 8791。测试使用原独立数据库与私有状态，不清理历史记录，不发送飞书业务消息。

## Studio 部署（2026-10-12）

六个项目已分别注册到当前本地 `local-test / default` 工作区，并选择各自的 Preview 版本。以下链接需要测试环境服务运行并登录测试组织：

| Provider  | Agent Studio                                                                                                                  | 运行条件                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| default   | [Computer-Default-Test](http://local-test.musegea.localhost:3003/studio/default/agents/01a12eae-988b-755e-8880-afd7c7e8e99b)  | 使用同源 agent-computerd                         |
| just-bash | [Computer-Justbash-Test](http://local-test.musegea.localhost:3003/studio/default/agents/01a12eb8-27b2-724f-9c2a-e5e6e111c511) | Worker 内执行                                    |
| E2B       | [Computer-E2B-Test](http://local-test.musegea.localhost:3003/studio/default/agents/01a12ed2-a398-71d4-8502-0ce22ddd51af)      | 未配置 E2B_API_KEY，按用户要求跳过真实运行       |
| remote    | [Computer-Remote-Test](http://local-test.musegea.localhost:3003/studio/default/agents/01a12ea7-9742-777f-9420-f3c0424cc5ab)   | 使用 reference service；Preview secret 已配置    |
| local     | [ComputerLocalTest](http://local-test.musegea.localhost:3003/studio/default/agents/01a12ed3-61d5-75d8-ad14-97352fd5f027)      | Studio 中可查看定义；实际执行使用本地 App Server |
| device    | [ComputerDeviceTest](http://local-test.musegea.localhost:3003/studio/default/agents/01a12ea7-960d-7299-94ff-5cd1996601ec)     | 使用已配对的测试设备和授权目录                   |

各项目 `.local/ready.json` 保存公开的 Agent/Worker/Deployment ID 和入口，不含密钥。根 `.local/studio-deployments.json` 保存本次从 Studio 读取的部署与环境缺项汇总；上传成功和运行条件分别记录。

后续需要重新同步当前源码时，先停止本项目正在执行的 Run 和独立 local/device App Server，再运行 `.\providers.ps1 setup`。该命令复制 Git 管理和非 ignored 的当前源码，排除环境密钥，执行 frozen install 和同源 native/Agent Core 构建，最后安装六个项目依赖。其他工作区的服务不得停止。

自动验收逐个串行调用真实工具，核对公开文件/命令 API、同源文件内容、字面参数、非零退出、超时、后台 kill、权限、只读 Skill 和声明的 application v1。跨 Run/Chat 预期按 provider 分别处理，不把 ephemeral 或共享目录当成 durable/chat。成功与失败记录分别在各项目 `.local/verification.json` 和 `.local/verification-failed.json`；缺少能力必须明确报告 unsupported。

设备注册仅用于 `local-test` 测试组织，授权根只有 `computer-device` 项目目录。配对 token 和 App Server control token 在隔离私有目录，未改用户的 `~/.gea/device.json`；公开 `.local/device.json` 只含设备 ID、路径和连接状态。

## 本次验收（2026-10-12）

六个项目均已通过当前源码的 TypeScript、CLI validate 和 pack。default、remote、local、device、just-bash 均已进行真实模型/SDK 验收；just-bash 另有 12 次真实 Worker Tool 调用的直接测试。E2B 按用户要求跳过真实账号调用。

测试结果包括文件流与二进制、字面参数、退出码、超时、后台终止、权限、只读挂载和各 provider 的文件生命周期。default/remote/device 的命令修正通过定向复核，原失败记录保留，不将失败观察计为通过。

原 `feishu-basic-test` 的 8 个文件 SHA-256 均保持不变。`computer-contract` 的原 Agent、项目、凭据和版本历史保留，在当前平台重新发布。为避免历史退役 capability 阻塞环境配置读取，主源码补了仅校验 retained environment 声明的兼容修复，5 个行为回归测试和全工作区类型检查通过；没有修改历史 manifest。

旧飞书机器人接收器仍是 `retrying/channel_receiver_runtime_unavailable`：控制记录的 active target 指向含退役 `channel-shared-session-v1` 的历史部署，当前停止路径无法解析它。新 provider 项目无飞书依赖；本次保留该接收器和历史，未删除安装或手改控制记录，也未发送飞书业务消息。恢复该历史接收器在线需要另行处理 Channel 迁移边界。

## 版本管理

源码、脚本、配置结构和依赖锁文件纳入 Git 管理。本地运行状态（`.local/`、`.gea/`）、依赖目录、日志和环境密钥文件由 `.gitignore` 排除。

飞书凭据在 Studio 环境变量中配置；本机登录信息与服务密钥保存在仓库外，具体说明见项目 README。
