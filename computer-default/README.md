# Computer Default Test

独立 Agent，slug 为 `computer-default-test`，模型为 `qwen3.7-plus`，无飞书 Extension。声明入口 [agent.ts](./agent.ts)，交互规则 [AGENTS.md](./AGENTS.md)，验收提示 [测试提示词.md](./测试提示词.md)。

`defaultComputer()` 使用第一方托管 Computer allocation 与现有 `agent-computerd` 服务。Agent 不声明远程 endpoint/token，平台与 Native Runtime 负责分配、鉴权和路由。当前本机共享环境启动第一方 daemon 与 sandboxd；这套测试不依赖 Remote reference 的 8791 端口。

文件策略为 durable/chat；要求 shell、exec、processes、files、readonly-mounts。Python 3 由执行环境 PATH 解析。每个执行 generation 有自己的初始化与命令生命周期，文件按 chat scope 保留。Tool 不创建或停止 Computer。

依赖 source-link 指向 `/home/fanfande/gea-computer-providers-current/packages/agent-sdk`；Node 24.16.0、pnpm 12.8.1。先安装该源码快照依赖，再在 WSL 安装本项目。使用同源码的 Runtime、daemon 与 sandboxd，避免旧二进制影响验收。

从父目录使用共享入口：

```powershell
.\providers.ps1 validate -Provider default
.\providers.ps1 pack -Provider default
.\providers.ps1 publish -Provider default
.\providers.ps1 test -Provider default
```

WSL 入口是 `../providers.sh validate default`；本目录也可 `pnpm validate`、`pnpm pack:agent`、`pnpm publish:agent`、`pnpm test:agent`。共享配置与真实服务状态见上层 README、配置和启动器输出。Default 不需要为 Agent 配置 E2B 或 Remote provider secret。

初始化通过完整公开 Computer API 验证二进制/流读写、seed、mkdir/list/rename/stat/remove，成功后保存 `provider-tests/default/info.json`。只清理该次生成的 UUID probe。初始化不写、不重建 note。

| 工具                 | 覆盖                                                            | 预期                                 |
| -------------------- | --------------------------------------------------------------- | ------------------------------------ |
| computer_info        | roots/capabilities/初始化文件探测/Python/v1可用性               | passed；文件检查均 true              |
| files_probe          | workspace文本和真实Python二进制、字面argv/env/stdin；read不补写 | 写入完全匹配；同Chat复读成功         |
| command_probe        | success/nonzero/timeout/terminate/interactive                   | 实际退出或预期拒绝；nonzero为7       |
| permissions_probe    | 未授权Tool实际写入/执行                                         | 两项allowed false、denied true       |
| readonly_skill_probe | 独立测试Skill只读                                               | readable/unchanged/writeDenied均true |
| application_probe    | 可选v1 binary stdin/EOF、events、state                          | 当前托管实现支持；真实ID/字节/状态   |

普通 Run 写入 note 后，同 Chat 后续 Run 应 found true 且文本一致；新 Chat 的初始 read 应 found false。不能仅凭 roots 目录名判断隔离。scope 不是执行锁。应用协议只在当前 daemon advertise v1 后可用，不以旧 commands 成功替代。

测试串行执行。只保留 `provider-tests/default/seed.txt`、info.json、note.txt 和用户指定文件；清理只删除本工具的 UUID probes/application 文件。测试覆盖文件和进程，不覆盖桌面键鼠/截图。错误保留真实 operation/name/message 或协议 code/outcome/method；不编造退出码。

2026-10-12：依赖安装、类型检查、validate/pack 和真实 `qwen3.7-plus` 模型验收均已通过。六个 Tool、同 Chat 持久化、新 Chat 隔离、exit 7、超时、后台 kill 与交互 stdin/EOF 均有实际结果。验证采用已通过的文件/Skills/v1 基线加受影响命令的定向复核；旧超时判定失败保留，未将其改写为通过。

[当前 Studio Agent](http://local-test.musegea.localhost:3003/studio/default/agents/01a12eae-988b-755e-8880-afd7c7e8e99b)。整合回执在 `.local/verification.json`；来源为 `.local/verification-baseline.json` 与 `.local/verification-commands.json`。超时通过本 Tool 的明确 deadline signal 核对；kill 后无退出码时保留 SDK 的实际 terminal error，不补造退出码。
