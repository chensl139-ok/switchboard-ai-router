# Switchboard 智能路由

妙搭全栈管理平台 + 可独立部署的 SSE/WebSocket 网关。

## 部署版本

- 根目录：妙搭官方 NestJS + React 19 + PostgreSQL 工程，使用飞书登录、平台 `router_admin` 角色和原生开放 API 鉴权。
- `standalone/`：Node.js 实时网关，Docker 可部署，支持 HTTP、SSE 与 WebSocket。该版本使用本地加密配置和单实例限流，不与妙搭数据库自动同步。

## 妙搭版功能

- 六类预置服务商、自定义白名单域名、账户模型发现与分页、同服务商多模型选择。
- 固定模型、故障转移、加权轮询、最低延迟、关键词任务规则五种路由。
- 自动模式连续 3 次失败熔断 60 秒；显式模型不跨平台回退。关键词规则按顺序匹配最后一条用户消息。
- PostgreSQL 配置持久化和版本号冲突检测；配置修改审计；最近 500 条请求元数据。
- 数据库原子限流与并发租约，多实例共享计数。请求共用最多 25 秒超时，连接关闭中止上游。
- AES-256-GCM 密钥加密，主密钥在环境变量中；密钥不回传客户端。
- HTTPS 域名白名单、DNS 公网地址验证与连接固定、禁止重定向、4 MB 上游响应限制。
- 模型实验室 Enter 发送、Shift+Enter 换行、停止请求、防重复提交。

## 启动与发布

需要访问妙搭私有依赖仓库的权限。首次初始化由 `lark-cli apps +init` 完成。

```sh
npm ci
npm run type:check
npm test
npm run build:prod
npm run dev
```

官方发布链路：commit -> push `sprint/default` -> `lark-cli apps +release-create` -> `+release-get` finished。

平台角色 `router_admin` 已创建，并授予应用创建者。其他管理员通过妙搭角色面板授权，勿直接改数据库或硬编码用户 ID。

环境变量：
- `ROUTER_MASTER_KEY`：32 字节随机值的 Base64 编码。生产密钥必须独立保存与备份，丢失后需重新输入服务商密钥。
- `ROUTER_ALLOWED_HOSTS`：可选，逗号分隔的自定义上游域名。仅允许 HTTPS/443，不接受 URL 凭据或跳转。
- `LOG_REQUEST_BODY=false`、`LOG_RESPONSE_BODY=false`：生产环境不要采集正文与密钥。

SQL 变更在 `docs/`。数据库 Schema 由官方生成器生成，不能手动编辑。RLS 限制到平台管理员角色和平台系统身份。

## 对外 API

- `GET /openapi/v1/models`
- `POST /openapi/v1/chat/completions`
- 完整规范：`docs/openapi.json`

对外凭据由妙搭原生开放 API 管理功能创建，按平台生成的调用示例配置鉴权。`model: "auto"` 使用后台路由；`model: "siliconflow"` 固定服务商；附加 `upstream_model` 指定该服务商已配置模型。

妙搭托管入口按平台限制使用标准 HTTP，`stream: true` 明确拒绝。实时协议请部署 `standalone/`，见 `docs/realtime.md`；它们不是已获验证的妙搭网关透传能力。

## 运行边界与运维

本版本已加入生产基础保护，但尚未完成真实模型端到端验收、并发压测或 SLA 验证，不承诺无需验收即可承担关键业务。

- 云端使用独立密钥和空服务商配置；本地已有 API Key 不迁移。请上线后重新填写并测试。
- 延迟策略依赖至少 3 条一小时内的成功样本，无样本按优先级；不是自动质量评估或计费优化。
- 当前只支持文本 Chat Completions，不支持工具调用、图像、音频和 Responses API。
- 生成超时后上游可能仍计费，故障回退也可能增加费用。
- 配置审计保留最新 200 条；请求表持久保留。`RouterStore.cleanup()` 提供 30 天日志清理，未启用自动清理任务，部署方应安排保留策略。
- 生产数据库和加密主密钥需分别备份。版本回滚使用旧代码提交重新发布，不重建/删除数据库。
- 单用户/组织管理员使用；未提供客户计费、按客户配额、多租户账户系统或成本结算。
- 管理端使用自定义 Axios adapter 在平台采集前隐藏请求/响应正文，保留平台 CSRF、URL、状态与耗时。

## 测试

`npm test` 覆盖五种策略、熔断、SSRF 地址过滤和加密篡改。`cd standalone && npm ci && npm test` 覆盖 HTTP 鉴权、分页、模型切换、回退、SSE 拆包及截断、WebSocket 鉴权与增量完成事件。
