# Computer Local 测试 Agent

本项目是独立的 Computer provider 测试 Agent，不包含飞书 Extension。模型为 qwen3.7-plus，slug 为 computer-local-test。只报告实际工具结果，不把打包通过或缺少协议等同于运行验收。

## 测试范围

- onSession 使用完整公开 Computer API，在独有测试目录验证 1 MiB 分块 stream 往返、二进制字节、Unicode 文本、rename/stat/remove，并检查本 Agent 的 bundled Skill mount 的文件 API 写入是否被拒绝。
- computer_info 读取实际初始化报告中的 scope、roots、capabilities 与文件结果；不编造未暴露的 Computer ID。
- files_probe 用公开 workspace API 写入和读取 provider-tests/computer-local-test/note.txt。mode=read 仅检查已有文件，不重建缺失 note。
- command_probe 在当前 Chat 的测试目录运行 /usr/bin/python3，测试字面 argv、文本 stdin、非零退出、超时及后台 wait/kill。场景必须串行。
- permissions_probe 是只读 Tool，实际尝试写入测试文件和执行 /bin/true，两个操作都应在 SDK 权限边界被拒绝。
- readonly_skill_probe 比较 bundled Skill 和实际 mount，报告初始化时观察到的文件 API 拒绝；不测试提升权限，也不把 trusted 文件只读位描述为 shell 沙箱。
- application_probe 仅在 ctx.computer.protocol 存在时验证 application v1 的二进制文件、字面 argv、二进制 stdin/EOF、输出事件和最终命令状态；否则返回 status=unsupported，reason=application_protocol_v1_not_advertised。

所有修改都在 provider-tests/computer-local-test/ 内，唯一例外是对本 Agent 自己的临时 bundled marker mount 做预期被拒绝的文件 API 写入。初始化删除的只有它刚创建的唯一 probe 文件；不会删除用户文件。初始化目录按 Chat 和随机 UUID 区分，不覆盖 note.txt。note 使用 provider 固定路径，所以新 Chat 读到旧 note 可以真实观察共享文件，而不是测试自行隔离后的结果。

## 工具与验收

按 [测试提示词](./测试提示词.md) 调用。输出使用 passed、error、unsupported；超时和 kill 只有匹配实际错误、时长或 readiness/kill 结果时才返回 passed，并保留 error 和 expectedTimeout/expectedTermination；未匹配时返回 error。须引用真实 operation、name、message 或退出状态。普通 exitCode=7 是成功观察到非零退出，不应写成 API 异常。工具没有原始重试，结果未知时不要再次执行同一 mutation。

stream/binary 测试由 onSession 完成，Tool ctx.computer 本身只有 workspace、commands 和可选 protocol；不虚构直接 stream 方法。application v1 返回真实 opaque Computer/execution IDs，不与 OS PID 混淆。桌面键鼠、截图和 GUI 不在本项目范围内。

## 当前源码与环境

依赖链接 /home/fanfande/gea-computer-providers-current/packages/agent-sdk，需要在对应 WSL 当前源码完成 pnpm install。固定 Node 24.16.0、pnpm 12.8.1。共享校验、打包、启动入口由上层测试环境提供；构建的 Runtime、App Server、sandboxd 必须来自同一源码快照。先完成 validate/pack 与环境预检，再使用真实模型验收。修改本目录后重新构建，新的运行使用新版本。

## Local 启动条件

已注册到 [本地 Agent Studio Preview](http://local-test.musegea.localhost:3003/studio/default/agents/01a12ed3-61d5-75d8-ad14-97352fd5f027)，可以查看版本、工具和定义。当前 Studio hosted 运行器分配 `localComputer` 时返回 `local_computer_requires_local_host`；注册不提供云端执行能力。实际验收使用下方授权本地 App Server，Agent provider 仍为 local。

当前入口是上层 `scripts/local-session.mjs`。在 WSL 加载配置中的工具链后运行：

```sh
node ../scripts/local-session.mjs start
node ../scripts/local-session.mjs run --prompt '只实际调用一次 computer_info'
node ../scripts/local-session.mjs run --session <返回的sessionId> --prompt '只实际调用 files_probe，mode=read'
node ../scripts/local-session.mjs status
node ../scripts/local-session.mjs stop
```

`start` 使用标准 CLI 的 `agent dev` 后台模式，健康实例可复用。真实 Run 通过 App Server 的认证管理接口 `session.create`、`run.start`、`session.get` 执行，保持 Agent 的默认 HTTP 认证。`run` 返回 `sessionId`、`runId` 和 `.local/run-<id>.json`；文件包含实际 `snapshot.messages` 和终态，不是模拟结果。

脚本将 `GEA_CONFIG_DIR` 与 `GEA_APP_SERVER_STATE_DIR` 限定在共享测试 state 下的 `computer-providers/local/`，不加入其他项目的 App Server。`stop` 只停止该隔离实例；用户项目文件和 note 不删除。端口从 3000 开始选择可用值，不抢占其他进程。

agent.ts 固定 localComputer({ mode: "sandbox", filesystem: { source: "local-project" } })，不 seed 项目目录。Linux/WSL2 需要 sandboxd、bubblewrap 和 /usr/bin/python3；Windows 原生 local provider 不支持。

使用共享 CLI 的 agent dev 命令并传 local.config.json 内容；localComputer 必须显式授权同一 sandbox 模式。GEA_WORKER_RUNTIME_BINARY、GEA_APP_SERVER_BINARY 要指向当前源码的 gea-worker-runtime、gea-app-server。local.config.json 只保存公开的路径与执行模式。

默认授权根是此 Agent 项目目录，或 Host 已授权的 Session workingDirectory。目录真实文件会持久化，多个 Chat 可操作同一项目根；本测试不要求新 Chat 的 note 为空。只有明确改 agent.ts 为 trusted 并同步本地启动授权，才会测试 trusted；该模式使用 OS 用户的真实权限。

当前 Linux sandbox 预期提供 application v1。macOS 不宣告它时，application_probe 返回 unsupported。其他文件/命令结果仍须单独验证。

本项目源码和配置不包含 token、secret、登录数据。运行记录应保存在 Git 忽略的 .local/；依赖、.gea/、provider-tests/ 同样不纳入版本管理。
