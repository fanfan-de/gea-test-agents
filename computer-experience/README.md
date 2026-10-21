# Computer 亲自体验

独立手动体验 Agent：`computer-experience`，模型 `qwen3.7-plus`，使用相邻 `gea-worktree` 当前 SDK。它提供 SDK 原有八项 shell/文件工具和只读 `computer_targets`，工具调度并发为 1。默认 Computer 是 durable/chat，没有 seed 和初始化回调，也允许选择用户环境作为 primary。

## 当前已运行的体验

2026-10-21 本地 Preview v1 已 ready，可直接打开 [Computer-Experience Playground](http://local-dev.musegea.localhost:3006/builder/default/agents/01a15edf-becc-74da-b6f7-2243aff431ab?environment=preview&view=playground)。首版已自动设为 Preview，直接新建调试会话即可。

主进程保持后台运行。可用环境包括默认沙箱和在线设备 `P5-Installed-WSL2-20261021`。设备只为本次体验新增授权目录 `C:\Projects\GEA测试Agents\computer-experience\workspace`；Agent 写入的 `computer-experience/` 子目录对应其中的 `workspace\computer-experience\`，可从 Windows 直接查看真实文件。

通过会话中的“电脑”选择器，在新 Session 中依次体验默认沙箱、WSL2、双挂载，并选择主环境。先发送体验提示词第 1 条，核对真实 mountId 和 primary。首次 Run 后挂载固定；更换挂载或主环境时新建 Session。双挂载的每次工具调用都应显示明确 targetMountId。

账号菜单的“我的电脑”可查看连接状态，复制配对、连接和应用目录授权命令，也可撤销授权。撤权、关闭连接是可选体验，当前无需执行。需要重新连接已有 WSL2 设备时，在 PowerShell 运行：

```powershell
wsl.exe -d Ubuntu -u fanfande --exec bash /mnt/c/Projects/GEA测试Agents/.local/computer-experience/device-cli.sh computer connect --json-file /mnt/c/Projects/GEA测试Agents/.local/computer-experience/connect.json
```

本地服务启动脚本为 `/home/fanfande/.local/gea-computer-personal-dev-20261021/start.py`，服务日志与状态根目录为 `/home/fanfande/.local/gea-computer-personal-dev-20261021/`；设备连接日志在 `C:\Projects\GEA测试Agents\.local\computer-experience\`。旧 3000、3003 两套服务已关闭，当前入口使用 3006。

## 腾讯云体验

2026-10-21，腾讯云设备 `P5 腾讯云 · 当前安装包` 已通过独立 SSH 回环通道连接到本地 3006。为本次体验新建的应用授权只覆盖 `/home/ubuntu/.local/gea-computer-p5-20261021/experience-3006`，网页中的目录名称为 `experience-3006`。旧 `tencent-workspace` 的已撤销授权保持原状。

[腾讯云验证会话](http://local-dev.musegea.localhost:3006/builder/default/agents/01a15edf-becc-74da-b6f7-2243aff431ab?chatId=01a15eef-0df6-7102-b27c-0965cbac3d86&environment=preview&view=playground) 只挂载这台腾讯云 Computer，且将其设为主环境。可以直接续聊；新建会话后，在“会话电脑”选择 `P5 腾讯云 · 当前安装包 · experience-3006`。Agent 的 `/workspace/computer-experience/` 对应上述物理授权根下的 `computer-experience/`。

本机 SSH 通道及腾讯云客户端均在后台保持连接。关闭本地 GEA 或该通道后，此测试链路会离线。连接状态与日志分别保存在本机 `.local/computer-experience/tencent/` 和腾讯云 `/home/ubuntu/.local/gea-computer-p5-20261021/personal-3006/`；这些目录不保存到 Git。没有重启或修改腾讯云现有应用。

## 本地校验与发布

先从 `C:\Projects\gea-worktree` 执行 `fnm exec --using=24.16.0 pnpm.cmd install`，再在本目录执行：

```powershell
fnm exec --using=24.16.0 pnpm.cmd install
fnm exec --using=24.16.0 pnpm.cmd validate
fnm exec --using=24.16.0 pnpm.cmd pack:agent
```

validate 先检查 TypeScript，再调用当前源码 CLI 共用的 `validateAgentProject`；pack 调用 `packageAgentProject`，生成 `dist/` 中的 `.gea-agent.zip`。这些操作不登录或发布，不启动服务。项目依赖使用当前源码 link，源码本身也需要先完成 pnpm install。

发布使用已登录目标工作区的标准 CLI：`gea agent push --json-file push-input.json`。输入如下，cwd 应指向当前执行系统中已安装依赖的 Agent 目录：

```json
{
  "cwd": "/home/fanfande/.local/gea-computer-personal-dev-20261021/experience-agent",
  "project": "computer-default-tests",
  "slug": "computer-experience"
}
```

本机本次部署使用 WSL 副本，SDK 链接 `/home/fanfande/.local/gea-computer-p5-installed-20261021/source/packages/agent-sdk`；Windows 与 WSL 分别安装自己的依赖。已有认证配置由私有 CLI wrapper 读取，不在 Agent 中保存。在 PowerShell 执行：

```powershell
wsl.exe -d Ubuntu -u fanfande --exec bash /mnt/c/Projects/GEA测试Agents/.local/computer-experience/device-cli.sh agent validate --json-file /home/fanfande/.local/gea-computer-personal-dev-20261021/experience-agent/validate-input.json
wsl.exe -d Ubuntu -u fanfande --exec bash /mnt/c/Projects/GEA测试Agents/.local/computer-experience/device-cli.sh agent push --json-file /home/fanfande/.local/gea-computer-personal-dev-20261021/experience-agent/push-input.json
```

`validate-input.json` 只包含上述 cwd。更新 Agent 后先同步 `agent.ts` 和 `AGENTS.md` 到 WSL 副本，再 validate 和 push。首版 v1 已 ready 并自动设为 Preview；后续发布后，以 Builder 的 Worker 环境页显示为准，再新建调试会话。本次目标为 `http://local-dev.musegea.localhost:3006` 的 `default` 工作区。

首次发送前，通过“操作环境”选择默认环境、已有授权的用户环境或多个环境，并确认 primary。挂载冻结后，切换需新建会话。用户环境需要先完成设备连接和应用目录授权；本 Agent 不自动配对或增加授权。

按 [体验提示词](./体验提示词.md) 逐条操作，可在界面展开每次工具输入与输出。所有体验写入限于所选目标的 `computer-experience/` 子目录；多个目标的同名路径相互独立。默认环境同会话保留文件，新默认会话应隔离；用户目录按资源实际生命周期观察。

本地 validate/pack 只证明定义与构建有效。实际连通性、模型调用、文件持久化和多环境路由应以本次网页操作的真实结果为准。当前覆盖 shell 和文件，不包含 GUI、截图、键鼠。
