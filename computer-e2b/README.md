# Computer E2B Test

这是独立 Computer 验收 Agent，slug 为 `computer-e2b-test`，模型为 `qwen3.7-plus`。目录没有飞书 Extension，不修改已有飞书测试项目。

声明入口为 [agent.ts](./agent.ts)，测试行为见 [AGENTS.md](./AGENTS.md)，逐项交互提示见 [测试提示词.md](./测试提示词.md)。

`e2b()` 使用独立 `@gea-ai/computer-e2b` 声明包，模板 `base`，环境 timeout 300 秒，文件系统 ephemeral。API key 只引用 `secret("E2B_API_KEY")`；在目标 Studio Preview/Production 环境分别配置对应 secret，不写入源码或 Agent 普通 environment。

当前要求 `shell`、`exec`、`processes`、`files`、`readonly-mounts`。Python 3 从 provider 的 PATH 解析，不硬编码发行版路径。初始化和命令请求通过 Worker Runtime 的 E2B Native adapter 直达 E2B API/envd。

源码依赖通过 `link:/home/fanfande/gea-computer-providers-current/packages/agent-sdk` 连接同一份源码快照，另链接同一快照的 `packages/computer-e2b`，不是固定 npm 发布包。工具链锁 Node `24.16.0`、pnpm `12.8.1`。先完成该源码快照的 `pnpm install`，再从 WSL 对本目录安装依赖并校验/打包；Windows 不能按 Linux绝对路径直接安装这些 source links。共享启动、校验、打包、发布和测试入口由上层 [README](../README.md) 与脚本提供；真实服务状态以共享启动器输出为准。

从父目录运行共享命令：

```powershell
.\providers.ps1 validate -Provider e2b
.\providers.ps1 pack -Provider e2b
.\providers.ps1 publish -Provider e2b
.\providers.ps1 test -Provider e2b
```

WSL 等价命令为 `../providers.sh validate e2b`，也可以在本 Agent 目录用 `pnpm validate`、`pnpm pack:agent`、`pnpm publish:agent`、`pnpm test:agent`。发布前选择测试组织、工作区与项目，真实测试前配置对应 secret。

初始化使用完整公开 Computer API 验证二进制与流读写、mkdir/rename/stat/list/remove 和 seed；随后保存 `provider-tests/e2b/info.json`。任何检查失败都会中止初始化，避免半初始化环境进入工具。初始化不会写或重建 `note.txt`。Tools 使用当前公开的 `ctx.computer.workspace`、`commands` 和可选 `protocol`；没有假造不存在的 Tool binary methods。

| 工具                   | 验证内容                                                         | 关键结果                                            |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `computer_info`        | 真实 roots/capabilities/初始化文件探测                           | `status`、`filesystemProbe`、`protocol.supported`   |
| `files_probe`          | workspace 文本、真实二进制文件、字面 argv/env/stdin；read 仅复读 | `mode`、`found`、`text`、`matches`、`binaryMatches` |
| `command_probe`        | 成功、非零、超时、后台 kill、stdin/EOF                           | 实际 stdout/stderr/exitCode 或 error                |
| `permissions_probe`    | 未授权 Tool 的写入/执行被拒绝                                    | 两项 `allowed: false`、`denied: true`               |
| `readonly_skill_probe` | 独立 bundled Skill 执行用户只读                                  | `readable/unchanged/writeDenied`                    |
| `application_probe`    | 可选 v1 binary stdin/EOF、events 和最终状态                      | 当前应为 `unsupported`                              |

工具只有观测到预期行为才返回 `status: passed`；不支持的能力返回 `unsupported`，协议/执行失败保留真实错误。非零退出、超时、kill 和传输失败是不同结果，不补造 exitCode。六种工具串行测试。当前命令 smoke 每次最多 10 秒；超时探测使用 1 秒 deadline。

普通 Run 每次创建临时 sandbox。同一 Chat 的后一条消息也不能假设沿用上次 Run 的文件；普通运行写入 note 后，下一次运行的 read 应报告 found: false。只有显式使用 idle Session Computer API 准备并保留环境时，才验证 retain/reconnect；这项测试需单独标记，且仍受 E2B timeout 限制。

所有产生的文件都在 `provider-tests/e2b/`。初始化和 application probe 清理自己的 UUID 临时目录；files probe 保留 note 用于 lifecycle 验证，二进制探测只删除它自己的 UUID 文件。构建、CLI 状态、依赖、日志和密钥文件由 `.gitignore` 排除。校验与打包不创建 provider 环境，真实运行会调用所选 provider。

新 Computer application protocol v1 尚未适配 E2B；旧公开文件与 commands/processes 成功不代表 v1 已通过。普通 Run 的 ephemeral 验收也不等于 idle Session retain 验收。
