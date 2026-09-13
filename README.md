# Switchboard · AI 智能路由平台

一个入口连接多个模型服务商。支持账户与租户隔离、六种路由策略、OpenAI / Anthropic 兼容 API、SSE / WebSocket，以及模型价格和用量管理。基于 Node.js 独立运行，可部署在本机、Docker 或支持持久磁盘的云服务器。

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chensl139-ok/switchboard-ai-router)

[API 接入说明](API.md) · [租户与权限](TENANCY.md) · [调用示例](examples)

## 主要功能

| 功能 | 支持内容 |
| --- | --- |
| 服务商与模型 | 硅基流动、DeepSeek、OpenAI、Anthropic、Gemini、OpenRouter、百炼及自定义兼容服务；同服务商多模型切换 |
| 智能路由 | 固定模型、故障转移、加权轮询、延迟优先、关键词规则、经济优先 |
| 模型目录 | 一键查询服务商模型、搜索并加入调用列表；通过 `provider::model` 指定渠道与模型 |
| 兼容 API | Chat Completions、Responses、Legacy Completions、Anthropic Messages；JSON、SSE、自建 WebSocket |
| 多模态与工具 | 文字与图片输入、函数工具定义、流式工具参数和结果回传；工具由调用方执行 |
| 模型实验室 | Enter 发送、Shift + Enter 换行、直接粘贴图片、附件预览、停止生成、草稿保留、回复复制 |
| 模型思考 | 真实思考内容展示与折叠；模型推理开关与界面显示开关独立 |
| API Key | 产品侧创建、有效期、启停、删除、总次数／每日次数／RPM 限制；明文仅展示一次 |
| 多租户 | 邮箱密码登录、邀请注册、租户切换、所有者／管理员／成员／只读角色 |
| 价格管理 | 输入、输出、缓存命中价格；高峰／空闲时段、时区与星期；图片按张参考价格 |
| 观测与文档 | 调用日志、用量分析、费用估算、操作审计、产品内 API 文档和 OpenAPI JSON 下载 |

上游密钥使用 AES-256-GCM 加密，外部调用 Key 使用哈希存储。服务端日志保存调用元数据，不保存提示词、回复正文或密钥。界面支持侧栏收起、服务商搜索筛选和移动端布局。

## 快速开始

### 方式一：直接运行 Node.js

需要 **Node.js >= 22.13**，适用于 Windows、macOS 和 Linux。

```sh
git clone https://github.com/chensl139-ok/switchboard-ai-router.git
cd switchboard-ai-router
npm ci
npm run setup
```

编辑自动生成的 `.env`，本机示例使用 **3100**，避免与其他服务占用的 3000 冲突：

```dotenv
HOST=127.0.0.1
PORT=3100
```

保留文件中已生成的令牌，再启动：

```sh
npm start
```

打开 [http://127.0.0.1:3100](http://127.0.0.1:3100)。如果未修改 `PORT`，原生运行默认使用 3000。

### 方式二：Docker 一键部署

安装 Docker Desktop，或 Docker Engine + Compose v2 后克隆仓库。

**macOS / Linux：**

```sh
sh deploy.sh
```

**Windows PowerShell（需安装 Node.js）：**

```powershell
node scripts/deploy.mjs
```

有 Node.js 的环境也可以使用 `npm run deploy`。初始化脚本重复运行不会覆盖已有 `.env`。

本地 Compose 默认入口为 `http://127.0.0.1:3000`。如需使用本文统一示例端口，在 `.env` 设置后重新部署：

```dotenv
LOCAL_PORT=3100
```

| 运行方式 | 修改哪个端口 | 说明 |
| --- | --- | --- |
| `npm start` | `PORT=3100` | Node.js 直接监听的端口 |
| Docker Compose | `LOCAL_PORT=3100` | 宿主机端口；容器内部仍为 3000 |

本地默认仅绑定回环地址。若 3000 打开的是 Grafana 等其他应用，请访问你配置的路由平台端口。

### 首次配置

1. 使用 `.env` 中的 `ADMIN_TOKEN` 创建首个所有者账户，之后通过邮箱和密码登录。
2. 在「服务商管理」填写上游地址与密钥，获取模型并启用服务商。
3. 在「模型实验室」验证模型，按需要设置路由策略与价格。
4. 在「API Key 管理」创建业务调用 Key，并设置额度和有效时间。
5. 打开侧栏「API 文档」查看示例，或访问 `/#api`。

`ADMIN_TOKEN` 用于首次账户初始化，不能用作业务调用 Key。新部署不会包含其他实例的账户、供应商密钥或价格配置。

## API 接入

以下地址假设本机已配置为 3100；云端部署请替换为实际 HTTPS 域名。

```sh
curl -N 'http://127.0.0.1:3100/v1/chat/completions' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

- `model: "auto"`：跟随当前租户的后台路由策略。
- `model: "siliconflow"`：固定使用该服务商的当前模型。
- `model: "siliconflow::zai-org/GLM-5.3"`：固定服务商和已配置模型。

鉴权支持 `Authorization: Bearer KEY` 或 `x-api-key: KEY`；同时提供时必须一致。使用产品签发的 Key，不要填上游服务商密钥。

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/v1/models` | 已配置并启用的可调用模型，以及自动路由／服务商别名 |
| GET | `/v1/models/all` | 一次查询已启用服务商的全部模型，返回统一列表 |
| GET | `/v1/models/discover` | 查询完整目录，按服务商分组返回 |
| GET | `/v1/models/{id}` | 查询单个可调用模型，ID 需 URL 编码 |
| POST | `/v1/chat/completions` | OpenAI Chat，支持图片、函数工具和 SSE |
| POST | `/v1/responses` | 无状态 Responses，支持 SSE |
| POST | `/v1/messages` | Anthropic Messages，支持 SSE |
| POST | `/v1/completions` | 单个文本 prompt，支持 SSE |
| POST | `/v1/messages/count_tokens` | 原生 Anthropic 上游真实 Token 计数 |
| GET | `/v1/openapi.json` | 对外 HTTP API 的 OpenAPI 3.1 文档，需鉴权 |
| WS | `/v1/realtime` | 自建 WebSocket 协议 |

### 一次获取全部模型

```sh
curl 'http://127.0.0.1:3100/v1/models/all' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

返回的 `data` 使用 `provider::model` ID，`callable` 表示是否已经加入调用列表。`partial: true` 表示部分服务商失败，具体原因见 `errors`，不能将部分结果当作完整目录。

目录查询限定在当前 Key 所属租户的已启用服务商。发现模型不会自动注册或启用；私有模型目录需要配置相应服务商密钥。查询最多等待 45 秒、最多并发 3 个服务商，10 秒内限一次；`all` 与 `discover` 共用限频，不消耗生成次数额度。

### SSE 与 WebSocket

HTTP 请求设置 `stream: true` 开启 SSE。Chat 以 `[DONE]` 结束；Responses 和 Messages 使用各自协议的命名事件。已经输出内容后不会换上游拼接回复。

WebSocket 连接 `ws://127.0.0.1:3100/v1/realtime`，5 秒内发送认证消息：

```json
{"type":"auth","token":"YOUR_API_KEY"}
```

收到 `ready` 后发送：

```json
{"type":"chat","id":"request-1","input":{"model":"auto","messages":[{"role":"user","content":"你好"}]}}
```

服务器返回 `delta`、`done` 或 `error`。发送 `{"type":"cancel","id":"request-1"}` 可取消；每个连接同时处理一个生成请求。不要把密钥放进 URL。此接口是自建协议，不是 OpenAI Realtime 音频接口。

完整参数、SDK、图片与工具回传示例见 [API.md](API.md) 和产品内 `/#api`。文档页支持代码复制及 OpenAPI JSON 下载，并自动填入当前部署地址。`/api/*` 管理接口使用账户会话，不能使用外部 Key 修改平台配置。

## Cherry Studio 配置

1. 添加 OpenAI 兼容服务商。
2. API 地址填写 **`http://127.0.0.1:3100/v1`**，云端使用对应域名。
3. API 密钥填写本平台签发的 Key。
4. 点击「获取模型列表」，将需要的模型加入客户端；选择 `auto` 可使用后台路由策略。

API 地址不要追加 `/models` 或 `/chat/completions`。Cherry Studio 标准模型列表使用 `/v1/models`，仅显示已配置的模型；完整上游目录使用 `/v1/models/all` 查询。

**能聊天但拉取模型列表失败：**检查客户端代理。已复现列表请求被系统代理转发并断开的情况；改为使用原代理地址的「自定义代理」，在绕过规则中加入 `localhost,127.0.0.1,::1`，保留原有绕过规则后可恢复。代理端口以你自己的配置为准，不要复制其他机器的端口。

## 价格与经济优先

- 按调用渠道分别维护价格，支持 CNY / USD。相同模型在不同服务商的价格互不替代。
- 录入普通输入、输出、缓存命中输入的每百万 Tokens 价格及每次请求固定费用。缓存价留空表示未知，`0` 表示已确认免费。
- 支持最多 8 个高峰／空闲时段，设置 IANA 时区及生效星期；可跨午夜，开始时间包含、结束时间不包含，跨午夜归属开始日。重叠时段禁止保存，未覆盖时间使用基础价格。
- 经济优先只比较同币种、价格有效的已配置模型，按选路时的时段价格及输出上限估算，不预设缓存命中。图片输入不进行经济选路估算。
- 调用费用根据上游实际用量，按每次上游尝试开始时间估算；流式生成过程中不切价。命中缓存但缓存价格未知、或有不支持的缓存写入费用时，不估算总费用。
- 图片按张价格可单独记录，不参与聊天经济路由；录入图片价格不代表支持图片生成接口。
- OpenRouter 可同步价格，默认有效 7 天；手动价格默认有效 30 天。自动同步会替换相应模型的价格配置，包括手动时段。

价格数据属于部署实例。仓库不内置会随时间变化的个人渠道报价；录入前请核对服务商当期价格。费用为参考估算，不作为供应商账单或计费结算凭据。

## 思考、图片与工具的边界

实验室支持图片附件和直接粘贴截图，最多 4 张、单张不超过 4 MB；包含历史及 Base64 的总请求上限为 10 MB。选择具备视觉能力的上游模型后才能处理图片。

“显示思考”仅影响界面；`thinking_mode: "disabled"` 控制实际推理。不支持关闭的模型会明确拒绝，不能通过隐藏文字减少推理费用。GLM-5.3 等强制思考模型禁用关闭选项。模型返回的思考会占用输出预算，仅返回思考而无正文时可检查输出上限。

函数工具由调用方验证参数、执行并回传结果；网关不执行工具。当前不支持音频、视频、文件上传、图像生成、内置联网／代码执行工具、Responses 服务端会话存储，以及 JSON Schema 结构化输出。兼容范围以 [API.md](API.md) 为准。

## 云部署

### Docker 服务器 + HTTPS / WSS

适用于有 Docker 的云服务器或 VPS。将域名解析到服务器并开放 80/443：

```sh
npm run setup
# 编辑 .env：GATEWAY_DOMAIN=router.example.com
sh deploy.sh --public
# 有 Node.js 时也可执行 npm run deploy:public
```

仓库的 Caddy 配置负责 HTTPS、WebSocket Upgrade 和 SSE 转发。应用内部 3000 端口不直接暴露公网。

| 平台 | 仓库提供 | 部署时需配置 |
| --- | --- | --- |
| Render | `render.yaml`、上方部署按钮 | 登录并确认计划；Blueprint 配置 Starter 与持久磁盘，可能产生费用 |
| Railway | `railway.json`、Dockerfile | 导入仓库、设置令牌、添加 `/app/data` Volume、生成域名 |
| Fly.io | `fly.toml`、Dockerfile | 应用名、`router_data` 卷、令牌；单实例部署 |
| Coolify / Dokploy | Dockerfile、Compose | 仓库、环境变量、域名和持久卷 |
| 通用容器平台 | Dockerfile、健康检查 | 持久化目录、单副本、HTTPS / WSS 与长连接支持 |

自定义容器环境需设置 `ADMIN_TOKEN`、`GATEWAY_TOKEN`（各至少 24 字符）、`HOST=0.0.0.0`、`DATA_DIR=/app/data`。对外使用 HTTPS 时设置 `COOKIE_SECURE=true`。原生本机的 `HOST=127.0.0.1` 不适用于容器对外监听。

云端配置需在目标环境验收。当前验证范围为本地及 CI；不支持直接作为 GitHub Pages、纯静态网站，或无持久磁盘／不支持长连接的函数服务部署。

## 配额、备份与升级

调用配额按开始执行的生成请求计数；上游失败或取消也计一次，内部回退不重复扣次数。每日额度按 UTC 零点（北京时间 08:00）重置。Token 是已知用量统计，不是 Token 或金额硬限额。停用或过期阻止新请求，已开始请求允许完成。

旧 `GATEWAY_TOKEN` 可在「API Key 管理」中关闭。它不受产品 Key 配额限制；业务调用应使用产品签发的受限 Key。初始化脚本仍需该环境变量。

持久数据包含：

```text
data/
├── accounts.json          # 账户、会话、租户与成员
├── state.json             # 默认租户配置与价格
├── api-keys.json           # 默认租户调用 Key 与配额
├── master.key             # 上游凭据加密主密钥
├── usage.sqlite           # 调用元数据
└── tenants/<tenantId>/     # 其他租户的独立数据
```

整体备份数据目录或 Docker 持久卷，不可丢失 `master.key`。不要提交 `.env`、密钥或数据目录到公开仓库。

当前使用本地文件、SQLite 和进程内限流，**只支持单副本运行**，不要让多个进程共享同一数据目录。多副本需先迁移共享数据库及分布式限流。默认日志保留 90 天，不包含 SSO / MFA、支付结算或可用性 SLA。

升级前备份数据，然后执行：

```sh
git pull --ff-only
# Node.js：停止原进程后
npm ci
npm start
# Docker：
# npm run deploy
```

不要执行 `docker compose down -v`，它会删除持久卷。容器完成目录权限初始化后以非 root 用户运行。

## 验证与项目结构

```sh
npm ci
npm run check
npm test
```

CI 在 Linux、Windows、macOS 上运行测试；Linux 额外验证 Docker 构建、Compose 启动、健康检查和重启。

| 文件 | 职责 |
| --- | --- |
| `platform.mjs` / `accounts.mjs` | 账户、租户与访问控制 |
| `server.mjs` / `routing.mjs` | API 服务、选路与调用 |
| `protocols.mjs` / `protocol-stream.mjs` / `realtime.mjs` | 协议转换与流式传输 |
| `model-catalog.mjs` / `openapi.mjs` | 模型目录与接口定义 |
| `pricing.mjs` / `usage-store.mjs` | 价格计算与用量记录 |
| `public/` | 控制台、实验室和 API 文档 |
| `test/` / `examples/` | 自动化测试与客户端示例 |

默认分支 `main` 包含完整独立运行源码与部署配置。
