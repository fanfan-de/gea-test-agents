# Just-bash Computer Test

独立 Agent `computer-justbash-test`，模型 `qwen3.7-plus`，使用 `justbash()`，无飞书 Extension。虚拟 shell 与 InMemoryFs 都在 Worker 内，不分配 Native Computer、容器或宿主进程。

它只声明 shell、files、readonly-mounts，文件策略 ephemeral。原生命令、后台进程、交互句柄、增量输出与 Computer application protocol v1 当前不支持。前台 `commands.run` 可以使用初始文本 stdin、字面 args/env 和 timeout；没有 Python 或宿主网络回退。

依赖链接 `/home/fanfande/gea-computer-providers-current/packages/agent-sdk`，测试用 contract 同样 source-link；Node 24.16.0、pnpm 12.8.1。先在该源码快照安装依赖，再从 WSL 对本目录 `pnpm install`。没有 provider secret。

从父目录运行：

```powershell
.\providers.ps1 validate -Provider justbash
.\providers.ps1 pack -Provider justbash
.\providers.ps1 publish -Provider justbash
.\providers.ps1 test -Provider justbash
```

WSL 入口为 `../providers.sh validate justbash`；本目录也可用 pnpm validate、pack:agent、publish:agent、test:agent。共享 Studio、Runtime、配置和真实模型验收由父目录脚本管理。

[agent.ts](./agent.ts) 初始化以完整公开文件 API 验证4097字节的分块流与二进制、文本、seed、rename/stat/list/remove。只删除本次UUID probe，然后写info.json，不铺入note。六个工具：

| 工具                                | 实际测试                         | 预期                           |
| ----------------------------------- | -------------------------------- | ------------------------------ |
| computer_info                       | 初始化探测和roots/capabilities   | passed                         |
| files_probe                         | workspace写读与虚拟shell cat同源 | write/read一致；read不补写     |
| command_probe success               | 字面args/env、初始文本stdin      | stdout完全匹配                 |
| command_probe nonzero/timeout       | 非零exit 7与取消deadline         | 真实预期结果                   |
| command_probe terminate/interactive | 尝试不支持的后台句柄             | rejected、unsupported          |
| permissions_probe                   | 未授权Tool的写入/命令            | 两项allowed false、denied true |
| readonly_skill_probe                | 真实挂载Skill只读                | 读取成功、写入拒绝、内容不变   |
| application_probe                   | 核对未提供v1                     | unsupported                    |

同 invocation 可写后读note；下一 invocation（即使相同Chat）必须 found false。普通消息回复、打包和前台shell成功不代表后台或v1能力通过。所有生成文件只在 `provider-tests/justbash/`，不清空workspace或其他项目文件。

可复现的本地行为测试是 [tests/worker-smoke.ts](./tests/worker-smoke.ts)。它直接调用当前 `runAgentWorkerRequest`、本Agent factory/onSession和六个Tool，真实使用just-bash session与SDK权限检查。只替换模型和Session存储为确定性协议fixtures，没有伪造Computer或权限拒绝。命令：

```bash
source /home/fanfande/.local/gea-computer-v1/environment.sh
cd /home/fanfande/gea-computer-providers-current/packages/gea-cli
pnpm exec jiti /mnt/c/Projects/GEA测试Agents/computer-justbash/tests/worker-smoke.ts
```
