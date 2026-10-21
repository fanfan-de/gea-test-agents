# Computer Default Test

专门测试 GEA Studio Computer 文件和命令能力的独立 Agent，slug 为 `computer-default-test`，模型为 `qwen3.7-plus`。入口是 [agent.ts](./agent.ts)，规则见 [AGENTS.md](./AGENTS.md)，手动用例见 [测试提示词.md](./测试提示词.md)。

使用当前相邻 `gea-worktree` 的公开 Agent SDK，声明 `defaultComputer()` 与 durable/chat 文件 scope。初始化只写 provider/chat/scope/roots/capabilities 元数据；文件和进程检查由用户显式调用。要求 shell、exec、files、readonly-mounts，缺少 processes 时仍可检查环境。

## 执行

从父目录 `C:\Projects\GEA测试Agents` 使用新入口，连接配置中的当前 Studio：

```powershell
.\studio.ps1 doctor
.\studio.ps1 unit
.\studio.ps1 validate
.\studio.ps1 pack
.\studio.ps1 publish
.\studio.ps1 test
```

`doctor` 检查配置和 Studio readiness；`unit` 运行本地行为测试；`validate`/`pack` 检查当前源代码。`publish` 将本项目上传到配置的 Studio Preview，`test` 串行调用真实模型和工具，检查相同 Chat 持久化及新 Chat 隔离。源代码变动后应重新 publish，再运行 test。凭据与环境配置方式见[父目录说明](../README.md)。

工具链固定 Node 24.16.0、pnpm 12.8.1。Windows 优先使用 `studio.ps1` 选择固定 Node，不能只信 shell 的版本提示。项目 `pnpm` 脚本也指向新 Studio 入口；旧 `providers.ps1` 与历史 `.local` 回执不作为当前验收依据。

## 覆盖

| 工具                 | 实际检查                                                          | 通过条件                                   |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| computer_info        | 初始化记录与实际能力                                              | 元数据可读，provider 为 default            |
| runtime_probe        | Node 版本、cwd、字面 argv/env/stdin                               | 三项匹配为 true                            |
| files_probe          | workspace 文本、中文空格路径、Node 二进制改名/删除、命令/API 同源 | 四项匹配为 true；保留 note                 |
| command_probe        | 成功、exit 7、timeout、kill、stdin EOF                            | 实际结果符合场景；后台无能力时 unsupported |
| permissions_probe    | Tool 文件写与命令权限拒绝                                         | 两项真实拒绝                               |
| readonly_skill_probe | 独立测试 Skill 读及原字节写回                                     | 可读、内容未变、写入被拒绝                 |

files_probe 的 read 模式绝不补写。它返回 found/text 供外部核对；同 Chat 应读回本轮唯一 token，新 Chat 应不存在。读取成功本身不能证明持久化。UUID probe 目录成功后删除；失败可保留作为证据。seed 只初始化一次，后续不会自动铺回。

默认 Computer 的实际后端由宿主环境决定。Studio hosted 默认可提供原生 Node 和 processes；本地 virtual 兼容后端的能力有限，Node 缺失会如实失败，后台场景依据 capabilities 报 unsupported。测试不会自动切换 provider 或退回 trusted shell。

## 验收边界

`tests/tools.test.mjs` 使用真实临时文件与 Node 子进程验证 Tool 行为，包括初始化不运行测试、Unicode/二进制互通、缺文件观察、后台能力拒绝、超时和清理失败判定。这些测试不代替真实 Studio 的鉴权、Runtime、sandboxd、模型、权限隔离和持久化验收；实际运行结果以本轮报告为准。

当前 Tool context 只公开 commands 与 workspace 文本/列表方法，没有 `computer.protocol`。旧 application_probe 已移除。本项目不直接验收底层 v1 事件或完整 stream/binary SDK API，也不测试 GUI 截图、键鼠或设备 relay。所有测试文件限定在 `provider-tests/default/`，不清空 workspace，不输出凭据。
