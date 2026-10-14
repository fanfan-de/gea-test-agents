# GEA 测试 Agents

GEA Agent 集成测试项目，包含飞书 Extension 测试与 Computer 文件、进程能力测试。

## 项目入口

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
