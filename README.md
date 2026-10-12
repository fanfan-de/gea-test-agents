# GEA 测试 Agents

GEA Agent 集成测试项目，包含飞书 Extension 测试与 Computer 文件、进程能力测试。

## 项目入口

- [computer-contract](./computer-contract/README.md)：环境配置、启动、发布和验收说明。
- [测试提示词](./computer-contract/测试提示词.md)：飞书与 Computer 测试场景。

当前测试环境依赖本机 WSL 中的 GEA 源码与服务，路径配置见 `computer-contract/local-test.config.json`，依赖链接见 `computer-contract/package.json`。

## 版本管理

源码、脚本、配置结构和依赖锁文件纳入 Git 管理。本地运行状态（`.local/`、`.gea/`）、依赖目录、日志和环境密钥文件由 `.gitignore` 排除。

飞书凭据在 Studio 环境变量中配置；本机登录信息与服务密钥保存在仓库外，具体说明见项目 README。
