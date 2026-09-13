# Switchboard · 独立 AI 智能路由

多服务商、多模型统一调用平台。基于 Node.js 独立运行，支持本地部署、容器部署和主流云平台。

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chensl139-ok/switchboard-ai-router)

> 本仓库公开可用。Render 一键部署需要登录 Render 账号并确认资源配置；Blueprint 使用付费 Starter + 持久磁盘。

## 功能

- 服务商：硅基流动、DeepSeek、OpenAI、Anthropic、Gemini、百炼，以及自定义兼容接口。
- 一键跨服务商查询模型目录，使用 provider::model 统一 ID；同服务商多模型切换；六种路由：固定、故障转移、加权轮询、最低延迟、关键词规则、经济优先。
- OpenAI Chat/Responses/Completions 与 Anthropic Messages 兼容入口；文本、图片输入、函数工具及结果回传。
- HTTP、SSE、WebSocket；流式失败不拼接其他模型的回复；取消、心跳和基础背压保护。
- 产品侧 API Key 管理：一次性展示明文、哈希存储、生效/过期、停用/启用、总次数/每日次数/RPM 限制。
- 模型实验室：独立运行参数面板、增量回复、折叠思考区、显示/隐藏思考、思考开关、停止生成、Enter 发送。
- 上游密钥 AES-256-GCM 加密，配置和 Key 配额保存在挂载磁盘，日志只保存调用元数据。
- 收起式导航、窄屏布局、账户登录、租户隔离与成员角色管理，无外部账号平台依赖。

## 账户、租户与价格

- 账户：邮箱 + 密码、邀请注册、修改密码、会话退出；Cookie 为 HttpOnly + SameSite。
- 租户：配置、上游密钥、路由、API Key、日志和价格隔离；每个账户可加入多个租户。
- 角色：所有者、管理员、成员、只读；最后一个所有者不能被移除或降级。
- API Key：创建、限额、有效期、停用和删除；删除不可恢复，既有日志保留。
- 价格：OpenRouter 公共接口自动同步（7 天有效），其他平台手动录入（默认 30 天有效）。
- 经济优先：只比较同币种、价格有效的已配置模型；按输入 Token 估算与实际发送的输出上限计算参考成本。未知/过期价格不会当作免费。
- 用量：每租户 SQLite 保存 90 天元数据，支持按日期、服务商、模型和 Key 分析；成本仅为估算。

## 本机一键部署

安装 Docker Desktop（Windows/macOS）或 Docker Engine + Compose v2（Linux），然后克隆仓库。

**macOS / Linux：**

```sh
git clone https://github.com/chensl139-ok/switchboard-ai-router.git
cd switchboard-ai-router
sh deploy.sh
```

**Windows PowerShell（需 Node.js 22 LTS + Docker Desktop）：**

```powershell
git clone https://github.com/chensl139-ok/switchboard-ai-router.git
cd switchboard-ai-router
node scripts/deploy.mjs
```

安装了 Node.js 的所有系统都可以执行 `npm run deploy`。脚本首次运行自动生成独立随机管理令牌和兼容调用令牌，写入 `.env`，重复执行不覆盖配置。

打开 **http://127.0.0.1:3000**，首次使用 `.env` 中的 `ADMIN_TOKEN` 创建所有者账户，之后使用邮箱与密码登录。配置服务商 API Key、获取模型、启用服务商，再进入「API Key 管理」给业务方签发受限 Key。

端口被占用时在 `.env` 设置 `LOCAL_PORT=3001` 后重新执行部署命令。本地 Compose 只绑定回环地址，不向局域网公开。

## 不使用 Docker

需要 Node.js >= 22.13：

```sh
npm ci
npm run setup
npm start
```

适用于 Windows、macOS、Linux。原生运行使用 `.env` 的 `HOST` / `PORT`；Docker 内部固定 `HOST=0.0.0.0`，对外绑定由部署平台控制。

## 云服务器 HTTPS/WSS 一键启动

适用于阿里云、腾讯云、AWS EC2 等支持 Docker 的服务器，以及自己的 VPS。先将域名解析到服务器，并开放 80/443。

```sh
npm run setup
# 编辑 .env：GATEWAY_DOMAIN=router.example.com
sh deploy.sh --public
# 或 npm run deploy:public
```

Caddy 自动管理 HTTPS，支持 WebSocket Upgrade，SSE 即时刷新、不缓冲；应用的 3000 端口不直接暴露公网。

## 托管平台

| 平台 | 仓库配置 | 仍需完成的步骤 |
| --- | --- | --- |
| Render | `render.yaml` + 上方 Deploy 按钮 | 登录并确认资源计划；令牌自动生成，磁盘自动挂载 |
| Railway | `railway.json` + Dockerfile | 从 GitHub 导入；添加挂载 `/app/data` 的 Volume；设置两个令牌；生成公开域名 |
| Fly.io | `fly.toml` + Dockerfile | 创建唯一应用名、`router_data` 持久卷、设置两个令牌；单实例 `fly deploy --ha=false` |
| Coolify / Dokploy | Dockerfile 或 Compose | 连接 Git 仓库、设置环境变量和域名、挂载 `/app/data` |
| 通用容器平台 | Dockerfile | 设置环境变量、持久化目录、健康检查、单副本、HTTPS/WSS 转发 |

Railway/Fly/通用容器平台必须设置 `ADMIN_TOKEN`、`GATEWAY_TOKEN`（各至少 24 字符），`HOST=0.0.0.0` 和 `DATA_DIR=/app/data`。不能把原生本地 `.env` 中的 `HOST=127.0.0.1` 直接复制到云容器。

平台配置依据：[Render Blueprint](https://render.com/docs/blueprint-spec)、[一键部署按钮](https://render.com/docs/deploy-to-render)、[Railway 配置](https://docs.railway.com/config-as-code/reference)、[Fly 配置与持久卷](https://fly.io/docs/reference/configuration/)。

**边界：**“跨平台部署”指支持上述 Node/Docker 环境，不包括无持久磁盘、禁止长连接的环境；不支持直接部署为 GitHub Pages、纯静态网站或普通 Vercel/Netlify Functions。不能用同一按钮自动开通所有云厂商账号。本仓库提供可用配置与入口，除本地及 CI 外，云厂商配置尚未逐一实机部署验收。

## 多协议、图片与工具

详细接口矩阵、一键模型查询、SDK 示例和兼容范围见 [统一 API 说明](API.md)。服务商上游可选 OpenAI Chat、OpenAI Responses 或 Anthropic Messages，所有入口共用租户与配额。

## 外部调用

非流式：`POST /v1/chat/completions`，`stream: false`。
SSE：同一地址，`stream: true`；成功以 `[DONE]` 结束。

```sh
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

`model: "auto"` 跟随当前策略；`model: "siliconflow"` 固定服务商；`upstream_model` 可指定该服务商已保存模型。`GET /v1/models` 返回可用路由 ID 和 provider::model 模型 ID；`GET /v1/models/discover` 查询已启用服务商的全部模型目录。

WebSocket 连接 `/v1/realtime`，5 秒内发送：

```json
{"type":"auth","token":"YOUR_API_KEY"}
```

收到 ready 后发送：

```json
{"type":"chat","id":"request-1","input":{"model":"auto","messages":[{"role":"user","content":"你好"}],"thinking_mode":"auto"}}
```

收到 `delta`、`done` 或 `error`；`{ "type": "cancel", "id": "request-1" }` 取消。密钥不要放 URL。
可运行示例：`GATEWAY_URL` 和 `GATEWAY_TOKEN` 配置到环境后，执行 `node examples/stream.mjs sse` 或 `node examples/stream.mjs ws`。

## 思考内容与开关

实验室只展示模型 API 真实返回的 `reasoning_content` 或 Anthropic thinking 文本；模型不返回时不会伪造。

- **显示思考内容**：仅控制显示，隐藏不减少推理计算或费用。
- **模型默认**：不发送控制参数，兼容所有已接入服务商。
- **开启/关闭思考**：`thinking_mode: "enabled" / "disabled"`。硅基流动/百炼映射 `enable_thinking`，DeepSeek 映射 `thinking.type`；具体模型仍须支持混合思考模式。
- GLM-5.3 系列为强制思考模型，产品禁用关闭选项，API 在调用上游前直接拒绝，不消耗生成配额。
- 若其他模型无视关闭参数并返回 reasoning_content，HTTP 返回 422，SSE/WebSocket 返回错误并中断，不把隐藏输出当作关闭推理。
- 未适配服务商的开关请求会明确失败；仍可以选择模型默认并显示它返回的思考。
- `max_tokens` 可能同时包含思考与回答；只有思考、没有正文时，检查模型设置并提高上限。
- 思考和对话只保留在当前浏览器页面内存，不写入服务端日志。支持文本、图片和函数工具多轮；音频、视频及内置工具暂不支持。

模型能力依据：[GLM-5.3 官方说明](https://docs.z.ai/guides/llm/glm-5.3)。

协议来源：[SiliconFlow](https://docs.siliconflow.cn/docs/userguide/capabilities/reasoning)、[DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/)、[百炼](https://help.aliyun.com/zh/model-studio/deep-thinking)。

## 配额、持久化与升级

调用配额按**开始执行的生成请求**计数；上游失败/取消也计一次，内部回退不重复计数。每日按 UTC 零点（北京时间 08:00）重置。Token 是上游返回的已知用量统计，不是 Token 或金额硬限额。停用/过期阻止新请求，已开始请求允许完成。

旧 `GATEWAY_TOKEN` 默认兼容，可在 API Key 管理页关闭。它不受应用 Key 配额限制；`ADMIN_TOKEN` 仅用于首次账户初始化，不能作为业务调用 Key。

`data` 包含默认租户的 `state.json`、`api-keys.json`、`master.key`、`usage.sqlite`，以及全局 `accounts.json`；新增租户的数据位于 `data/tenants/<tenantId>/`。必须整体备份，不可只保留加密数据而丢失主密钥。旧本地版的数据目录可原样继续使用；其他部署实例的数据需由管理员自行备份和迁移。

当前使用本地文件和单实例配额，**只能运行一个副本**，不要把多个进程指向同一目录。需要多副本时应先迁移共享数据库与分布式限流。本版本支持单实例多租户账户，不包含计费结算、SSO/MFA 或可用性 SLA；实际生产使用需自己的负载和故障演练。

升级：`git pull --ff-only` 后 `npm run deploy`，不要执行 `docker compose down -v`，后者会删除持久数据。容器启动时仅初始化目录权限，随后以非 root 用户运行。

## 验证

```sh
npm ci
npm run check
npm test
```

详细账户、隔离、价格和用量规则见 [租户与权限说明](TENANCY.md)。

GitHub CI 在 Linux、Windows、macOS 上运行测试；Linux 额外验证 Docker 构建、Compose 启动、健康检查与重启。默认分支 `main` 包含完整的独立运行源码与部署配置。

模型价格支持缓存命中输入价格，以及按 IANA 时区每天重复的高峰 / 空闲价格（最多 8 段，支持跨午夜，禁止重叠）。每段独立设置输入、输出、缓存命中和请求固定费用；空档使用基础价格。经济优先在选路时按当前时段比较，调用费用按每次上游尝试开始时间估算；流式请求不在生成中途切价。OpenRouter 自动同步会替换价格配置，包括手动时段。
