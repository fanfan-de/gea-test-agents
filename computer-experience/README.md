# Computer 亲自体验

独立手动体验 Agent：`computer-experience`，模型 `qwen3.7-plus`，使用相邻 `gea-worktree` 当前 SDK。它提供 SDK 原有八项 shell/文件工具和只读 `computer_targets`，工具调度并发为 1。默认 Computer 是 durable/chat，没有 seed 和初始化回调，也允许选择用户环境作为 primary。

## 体验步骤

在目标 Studio 发布 Preview 后，按[体验提示词](./体验提示词.md)验证默认沙箱、用户设备和双挂载。通过会话中的电脑选择器确认 mountId 与 primary，首次 Run 后更换挂载需要新建会话。使用用户设备前，先完成配对并授权专用测试目录。

写入限定在所选目标的 `computer-experience/` 子目录。检查同名文件在不同挂载上的实际位置、同会话持久化和新会话隔离。覆盖范围为 shell 和文件操作。

## 本地校验与发布

先从 `C:\Projects\gea-worktree` 执行 `fnm exec --using=24.16.0 pnpm.cmd install`，再在本目录执行：

```powershell
fnm exec --using=24.16.0 pnpm.cmd install
fnm exec --using=24.16.0 pnpm.cmd validate
fnm exec --using=24.16.0 pnpm.cmd pack:agent
```

validate 先检查 TypeScript，再调用当前源码 CLI 共用的 `validateAgentProject`；pack 调用 `packageAgentProject`，生成 `dist/` 中的 `.gea-agent.zip`。这些操作不登录或发布，不启动服务。项目依赖使用当前源码 link，源码本身也需要先完成 pnpm install。

发布时使用 `gea agent push`，将当前 Agent 目录作为 `cwd`，并指定目标项目和 slug `computer-experience`。发布和验收使用当前环境的实际部署记录。
