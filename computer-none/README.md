# 完全不配置 Computer 的测试 Agent

`Computer-None-Test` 使用 `qwen3.7-plus`，源码在本目录，SDK 链接相邻 `C:\Projects\gea-worktree`。`agent.ts` 完全省略 `computer` 和 `computerRequirements`；没有空对象、null、false、默认 preset 或隐式 requirements。

保留五个声明工具：`computer_targets` 只读会话挂载元数据，`calculate_sum` 做纯计算，`bash`、`readFile`、`writeFile` 用于观察未配置 Computer 时的模型工具可见性与真实执行结果。两个自定义工具均不申请命令、文件或网络权限，工具串行调度。普通文字对话和纯计算不需要 Computer；shell/文件是否提供给模型、调用如何失败，以实际运行结果为准。

## 本地校验和打包

先在 `C:\Projects\gea-worktree` 安装当前源码依赖：

```powershell
fnm exec --using=24.16.0 pnpm.cmd install --frozen-lockfile
```

再在本目录执行：

```powershell
fnm exec --using=24.16.0 pnpm.cmd install
fnm exec --using=24.16.0 pnpm.cmd validate
fnm exec --using=24.16.0 pnpm.cmd pack:agent
```

固定使用 `.node-version` 的 Node 24.16.0。`validate` 先检查 TypeScript，再调用当前源码的 `validateAgentProject`，输出解析后的 Computer 描述、requirements、工具和 snapshot hash；如果快照出现启用的 Computer 或 requirements 则失败。快照中规范化的 `computer.enabled: false` 是平台输出，并非 Agent 配置了 Computer。`pack:agent` 先执行同样校验，再生成 `dist/` 中的 `.gea-agent.zip`，可在 Builder 导入。

本地校验和打包不登录、不发布、不启动或停止服务。依赖锁文件用于记录本项目安装结果；依赖链接的 SDK 仍取当前源码。

## 实际体验

2026-10-21 已发布 v1 到本地 `local-dev / default` 的 Preview，可打开 [Computer-None-Test Playground](http://local-dev.musegea.localhost:3006/builder/default/agents/01a15f03-eee2-73fe-9ea5-9ad70d42988a?environment=preview&view=playground)，新建会话后按 [体验提示词](./体验提示词.md) 逐条发送。

本次真实模型基线 Run 已 `finished`，持久化工具记录中，`computer_targets` 返回 `mounts: []`、`primaryMountId: null`；`calculate_sum([12, 30, 0.5])` 返回 `count: 3`、`sum: 42.5`。Agent 正常回复了这些结果，证明空挂载会话可执行不依赖 Computer 的自定义工具。[基线会话](http://local-dev.musegea.localhost:3006/builder/default/agents/01a15f03-eee2-73fe-9ea5-9ad70d42988a?chatId=01a15f04-5b4f-744b-9dac-646830e57d05&environment=preview&view=playground)可查看调用，原始摘要保存在忽略目录的 [summary-baseline.json](../.local/computer-none/summary-baseline.json)。这轮基线没有调用 shell 或文件工具。

同一会话的第二轮真实探针也已 `finished`。`bash`、`readFile`、`writeFile` 均实际调用并持久化为 `output-error`，界面工具记录显示通用错误 `Agent execution failed.`；模型收到并在回复中引用的具体错误为 `Computer target primary is not mounted in this Session.`。随后 `calculate_sum([1, 2, 3])` 成功返回 `sum: 6`。这证明当前定义仍向模型提供显式声明的 shell/文件工具，但空挂载时它们不能执行；连续工具失败后，纯计算仍可继续。证据见 [summary-probes.json](../.local/computer-none/summary-probes.json)。本次保留这一行为，没有修改平台错误展示。

验收需要分别确认：文字回复是否完成，`computer_targets` 是否返回空列表和 null primary，`calculate_sum` 是否真实执行，shell/文件工具是否提供给模型及调用结果，以及失败后纯计算能否继续。展开工具输入和输出核对，不把 Agent 口头结论当作执行证据。没有挂载时不要编造 targetMountId；出现任何挂载则停止 shell/文件探针并新建会话。

此项目只测试“完全省略 Computer 配置”的当前行为。不包含 `computerRequirements` 场景、用户设备挂载或默认沙箱对照。已有相邻 Agent 和共享服务配置保持原样。
