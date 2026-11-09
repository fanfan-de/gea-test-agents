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

## 验收

把打包产物导入目标 Studio 的 Preview，再按[体验提示词](./体验提示词.md)验证。新会话应报告 `mounts: []` 和 `primaryMountId: null`，并能执行 `calculate_sum`。再核对 shell、读取与写入工具是否可见，以及调用时的持久化结果。最后再次运行纯计算，确认工具错误后的会话行为。
