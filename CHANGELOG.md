# Changelog

本项目遵循语义化版本。发布日期均使用北京时间。

## [1.1.0] - 2026-09-24

### 新增

- 飞书企业 OAuth 登录、邀请加入、备用密码、成员角色和租户切换。
- 组织审计：按成员、API Key 和租户统计调用量、Token、费用与最近使用时间。
- 自定义服务商、模型自动协议匹配，以及同服务商多模型和备用密钥故障转移。
- 模型实验室实际路由信息，显示命中的服务商、模型、协议、策略与故障转移次数。
- 媒体实验室的视频生成、异步进度、图片和音频能力。
- 多模型对比、思考内容、图片输入、函数工具及流式草稿编辑。

### 改进

- 重构路由策略、健康检查、熔断、超时和失败原因记录。
- 全平台界面密度、服务商卡片、导航收起交互与响应式布局。
- 生产安全响应头、就绪探针、请求 ID、数据隔离和密钥加密。
- Docker 运行、只读文件系统、健康检查与多架构镜像发布流程。

### 兼容性

- 保持 OpenAI Chat Completions、Responses、Legacy Completions 和 Anthropic Messages 接口兼容。
- 数据目录可从 `v1.0` 原地升级；升级前仍建议完整备份 `data/`，尤其是 `master.key`。

## [1.0.0] - 2026-09-21

- 首个可部署版本：服务商管理、基础模型路由、API Key 和控制台。

[1.1.0]: https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.1.0
[1.0.0]: https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.0
