# Computer Remote Test

这是独立 Computer 验收 Agent，slug 为 `computer-remote-test`，模型为 `qwen3.7-plus`。目录没有飞书 Extension，不修改已有飞书测试项目。

声明入口为 [agent.ts](./agent.ts)，测试行为见 [AGENTS.md](./AGENTS.md)，逐项交互提示见 [测试提示词.md](./测试提示词.md)。

`remoteComputer()` 连接 `http://127.0.0.1:8791`，使用 durable/chat 文件策略。token 只引用 `secret("COMPUTER_REMOTE_TOKEN")`；它须与共享启动器的本机 reference service 专用 bearer 一致，在目标 Studio 环境按 secret 配置。地址是 Worker 可访问的 WSL loopback，不是公开部署地址。若端口占用，共享启动器选择空闲端口后同步声明。

当前要求 `shell`、`exec`、`processes`、`files`、`readonly-mounts`。Python 3 从 provider 的 PATH 解析，不硬编码发行版路径。参考服务复用当前 Linux/WSL2 sandboxd + bubblewrap Provider；由共享测试环境负责启动、鉴权和回收。

源码依赖通过 `link:/home/fanfande/gea-computer-providers-current/packages/agent-sdk` 连接同一份源码快照，不是固定 npm 发布包。工具链锁 Node `24.16.0`、pnpm `12.8.1`。先完成该源码快照的 `pnpm install`，再从 WSL 对本目录安装依赖并校验/打包；Windows 不能按 Linux绝对路径直接安装这些 source links。共享启动、校验、打包、发布和测试入口由上层 [README](../README.md) 与脚本提供；真实服务状态以共享启动器输出为准。

从父目录运行共享命令：

```powershell
.\providers.ps1 validate -Provider remote
.\providers.ps1 pack -Provider remote
.\providers.ps1 publish -Provider remote
.\providers.ps1 test -Provider remote
```

WSL 等价命令为 `../providers.sh validate remote`，也可以在本 Agent 目录用 `pnpm validate`、`pnpm pack:agent`、`pnpm publish:agent`、`pnpm test:agent`。发布前选择测试组织、工作区与项目，真实测试前配置对应 secret。

初始化使用完整公开 Computer API 验证二进制与流读写、mkdir/rename/stat/list/remove 和 seed；随后保存 `provider-tests/remote/info.json`。任何检查失败都会中止初始化，避免半初始化环境进入工具。初始化不会写或重建 `note.txt`。Tools 使用当前公开的 `ctx.computer.workspace`、`commands` 和可选 `protocol`；没有假造不存在的 Tool binary methods。

| 工具                   | 验证内容                                                         | 关键结果                                            |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `computer_info`        | 真实 roots/capabilities/初始化文件探测                           | `status`、`filesystemProbe`、`protocol.supported`   |
| `files_probe`          | workspace 文本、真实二进制文件、字面 argv/env/stdin；read 仅复读 | `mode`、`found`、`text`、`matches`、`binaryMatches` |
| `command_probe`        | 成功、非零、超时、后台 kill、stdin/EOF                           | 实际 stdout/stderr/exitCode 或 error                |
| `permissions_probe`    | 未授权 Tool 的写入/执行被拒绝                                    | 两项 `allowed: false`、`denied: true`               |
| `readonly_skill_probe` | 独立 bundled Skill 执行用户只读                                  | `readable/unchanged/writeDenied`                    |
| `application_probe`    | 可选 v1 binary stdin/EOF、events 和最终状态                      | 当前 reference 应 `passed`；ID、events、state       |

工具只有观测到预期行为才返回 `status: passed`；不支持的能力返回 `unsupported`，协议/执行失败保留真实错误。非零退出、超时、kill 和传输失败是不同结果，不补造 exitCode。六种工具串行测试。当前命令 smoke 每次最多 10 秒；超时探测使用 1 秒 deadline。

文件使用 durable + chat scope。同一 Chat 的后续普通 Run 应能读回 note；新 Chat 不应读到另一个 Chat 的 note。执行 generation、scratch 和命令句柄属于运行，文件 scope 不代表全局执行锁。

所有产生的文件都在 `provider-tests/remote/`。初始化和 application probe 清理自己的 UUID 临时目录；files probe 保留 note 用于 lifecycle 验证，二进制探测只删除它自己的 UUID 文件。构建、CLI 状态、依赖、日志和密钥文件由 `.gitignore` 排除。校验与打包不创建 provider 环境，真实运行会调用所选 provider。

本机 Remote reference 是开发验收服务，完整结果只证明当前服务与源码链路。服务必须 advertise 应用协议 v1 才能暴露可选 protocol client；不能由 factory 名称推断。
