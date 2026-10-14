# Computer Device 测试 Agent

本项目是独立的 Computer provider 测试 Agent，不包含飞书 Extension。模型为 qwen3.7-plus，slug 为 computer-device-test。只报告实际工具结果，不把打包通过或缺少协议等同于运行验收。

## 测试范围

- onSession 使用完整公开 Computer API，在独有测试目录验证 1 MiB 分块 stream 往返、二进制字节、Unicode 文本、rename/stat/remove，并检查本 Agent 的 bundled Skill mount 的文件 API 写入是否被拒绝。
- computer_info 读取实际初始化报告中的 scope、roots、capabilities 与文件结果；不编造未暴露的 Computer ID。
- files_probe 用公开 workspace API 写入和读取 provider-tests/computer-device-test/note.txt。mode=read 仅检查已有文件，不重建缺失 note。
- command_probe 在当前 Chat 的测试目录运行 /usr/bin/python3，测试字面 argv、文本 stdin、非零退出、超时及后台 wait/kill。场景必须串行。
- permissions_probe 是只读 Tool，实际尝试写入测试文件和执行 /bin/true，两个操作都应在 SDK 权限边界被拒绝。
- readonly_skill_probe 比较 bundled Skill 和实际 mount，报告初始化时观察到的文件 API 拒绝；不测试提升权限，也不把 trusted 文件只读位描述为 shell 沙箱。
- application_probe 仅在 ctx.computer.protocol 存在时验证 application v1 的二进制文件、字面 argv、二进制 stdin/EOF、输出事件和最终命令状态；否则返回 status=unsupported，reason=application_protocol_v1_not_advertised。

所有修改都在 provider-tests/computer-device-test/ 内，唯一例外是对本 Agent 自己的临时 bundled marker mount 做预期被拒绝的文件 API 写入。初始化删除的只有它刚创建的唯一 probe 文件；不会删除用户文件。初始化目录按 Chat 和随机 UUID 区分，不覆盖 note.txt。note 使用 provider 固定路径，所以新 Chat 读到旧 note 可以真实观察共享文件，而不是测试自行隔离后的结果。

## 工具与验收

按 [测试提示词](./测试提示词.md) 调用。输出使用 passed、error、unsupported；超时和 kill 只有匹配实际错误、时长或 readiness/kill 结果时才返回 passed，并保留 error 和 expectedTimeout/expectedTermination；未匹配时返回 error。须引用真实 operation、name、message 或退出状态。普通 exitCode=7 是成功观察到非零退出，不应写成 API 异常。工具没有原始重试，结果未知时不要再次执行同一 mutation。

stream/binary 测试由 onSession 完成，Tool ctx.computer 本身只有 workspace、commands 和可选 protocol；不虚构直接 stream 方法。application v1 返回真实 opaque Computer/execution IDs，不与 OS PID 混淆。桌面键鼠、截图和 GUI 不在本项目范围内。

## 当前源码与环境

依赖链接 /home/fanfande/gea-computer-providers-current/packages/agent-sdk，需要在对应 WSL 当前源码完成 pnpm install。固定 Node 24.16.0、pnpm 12.8.1。共享校验、打包、启动入口由上层测试环境提供；构建的 Runtime、App Server、sandboxd 必须来自同一源码快照。先完成 validate/pack 与环境预检，再使用真实模型验收。修改本目录后重新构建，新的运行使用新版本。

## Device 接入条件

当前入口是上层 `scripts/device-session.mjs`：

```sh
node ../scripts/device-session.mjs start
node ../scripts/device-session.mjs status
node ../scripts/device-session.mjs stop
```

`start` 只允许当前本地平台的 `local-test` 组织，注册一个测试设备，并通过当前 App Server 建立真实 device relay。它把授权根固定为本项目目录，`GEA_CONFIG_DIR` 与 `GEA_APP_SERVER_STATE_DIR` 使用共享测试 state 下的 `computer-providers/device/`；不会覆盖用户 `~/.gea/device.json`。配对 token 只保存在隔离配置中的 mode 0600 文件，stdout 和 `.local/device.json` 仅提供 deviceId、状态和非秘密路径。重复调用复用配对；`stop` 只停止该实例并撤销该测试设备。

发布后创建 Studio Chat 时，将 `.local/device.json` 中的 deviceId 传给 `studioAgents.createPlaygroundChat`。`bindingReady=true` 只证明中继在线，文件和进程能力仍需要真实调用六个测试工具验收。共享环境模块读取当前测试配置，使用 Web 3003 / Runtime 3005 / API 3004 / Computer 8790；以实际配置为准。

agent.ts 固定 deviceComputer()，由 provider 固定 durable/user 文件系统，不 seed、也不选择主机目录。需要在提供 device relay 的当前云端/本地 Studio 发布本 Agent，再用调用者身份绑定已配对 deviceId 的 Chat；不能作为普通 local Agent dev 的设备 provider。

设备主机需为 macOS/Linux，当前 App Server 服务、/usr/bin/python3 和可用的出站 WebSocket。配对时只授权专门的测试目录；token 和目录记录留在本机配置。不要通过 Agent 上传或展示 token。测试准备阶段不自动 pair、注册或撤销设备。

本机实际使用 trusted local provider，命令具有该 OS 用户权限；授权根校验和 Skills 0444 不是 shell 安全隔离。一个设备同一时间只接收一个 open Session，忙时报告 DEVICE_BUSY，离线/撤销时报告真实错误。多个 Chat 可能共享同一个 authorizedRoot，本测试不要求新 Chat 的 note 为空。

当前 device 不宣告 application v1，application_probe 的 unsupported 是能力观测；不能将它标记为 application v1 已验收。目录文件、进程、权限、Skill 文件 API 仍可分别验收。

本项目源码和配置不包含 token、secret、登录数据。运行记录应保存在 Git 忽略的 .local/；依赖、.gea/、provider-tests/ 同样不纳入版本管理。
