# GEA 测试 Agents

这些独立项目用于验证 GEA 的 Agent 调用、Computer 和飞书 Extension。每个项目保留自己的依赖、测试提示词和打包入口。

## 按场景选择

| 项目 | 验证场景 |
| --- | --- |
| [agent-call](./agent-call/README.md) | 一个 Worker 导出四个独立目标，验证 Bot 或其他 Agent 的调用与 Session 路由。 |
| [computer-default](./computer-default/README.md) | 默认沙箱的文件、命令、权限、同会话持久化和跨会话隔离。 |
| [computer-none](./computer-none/README.md) | 完全省略 Computer 时，纯计算仍可运行，文件和命令工具按实际能力返回结果。 |
| [computer-experience](./computer-experience/README.md) | 手动验证默认沙箱、用户设备、双挂载与主环境切换。 |
| [computer-justbash](./computer-justbash/README.md) | Worker 内的 just-bash 和每次 Run 的临时文件系统，附 SDK smoke test。 |
| [computer-e2b](./computer-e2b/README.md) | E2B 临时沙箱，真实运行需要测试环境中的 `E2B_API_KEY`。 |
| [computer-remote](./computer-remote/README.md) | Remote 参考服务、应用协议及同会话文件持久化。 |
| [computer-local](./computer-local/README.md) | 独立 App Server 授权的本地项目目录。 |
| [computer-device](./computer-device/README.md) | 已配对设备的 relay、授权目录、文件和进程。 |
| [feishu-basic-test](./feishu-basic-test/README.md) | 最小飞书 Channel、Connector 和个人授权测试。 |
| [computer-contract](./computer-contract/README.md) | 飞书 Extension 的本地打包、平台沙箱和 Computer 辅助探针。 |

## 校验与发布

使用 [.node-version](./.node-version) 中的 Node 版本和各项目 `package.json` 指定的 pnpm 版本。各项目的 `link:` 依赖需要对应的 GEA 源码检出和已安装的依赖。先确认源码与测试目标，再按项目 README 校验、打包或推送。

`computer-default` 使用 [studio.config.json](./studio.config.json)。从仓库根运行 `.\studio.ps1 install`、`unit`、`validate` 和 `pack` 做本地验证。完整 Studio 链路就绪后，再执行 `doctor`、`publish` 和 `test`。发布目标为 Preview，回执和逐项验收报告写入 `.local/`。登录配置格式见 [studio-login.example.json](./studio-login.example.json)。已有会话可临时写入 `.local/studio-session.json`，包含 `baseUrl`、`organization`、`workspace`、`cookie` 和 ISO UTC 格式的 `expiresAt`，用完清理。

其他 provider 的 Windows/WSL 测试入口是 `providers.ps1` 和 `providers.sh`。运行前核对 [computer-providers.config.json](./computer-providers.config.json) 和 [本地服务配置](./computer-contract/local-test.config.json) 中的源码、二进制、端口和隔离数据库。典型命令为 `bash providers.sh validate remote`、`pack remote`、`publish remote`、`test remote`。Local 和 Device 的接入条件见各自 README。这套入口依赖原来的 WSL 测试环境，配置里的路径和地址需在目标机器上核对。

## 文件与记录

- Agent 定义、测试、提示词和锁文件随源码管理。
- `node_modules/` 和 `dist/` 可按项目说明重新生成。`.local/` 和 `.gea/` 可能保存本地授权、部署回执和运行证据。
- 过去的部署地址和验收结果可从 Git 历史查看，例如 `git show b2f9b21:README.md`。当前验收以实际工具输出、持久化记录和 Run 终态为准。
