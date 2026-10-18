# Switchboard

自托管的多服务商 AI 模型路由网关。用一个 API 接入已配置的模型，在控制台管理路由、密钥、成员和用量，并在模型实验室验证调用效果。

[English](README.md) | **中文文档**

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chensl139-ok/switchboard-ai-router)](https://github.com/chensl139-ok/switchboard-ai-router/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GHCR](https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router)

![Switchboard 工作台（演示数据）](docs/demo/workspace.png)

[v2.2.0 Release](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.2.0) · [更新记录](CHANGELOG.md) · [API 细节](API.md) · [租户与权限](TENANCY.md) · [架构](ARCHITECTURE.md)

## 主要能力

- **密钥不出你的机器**：自托管 BYOK，服务商密钥 AES-256-GCM 加密落盘，业务 Key 哈希保存，请求日志不记录提示词与回复正文。
- **模型级路由**：设置首选模型和失败后的备用方式，可按价格、延迟或权重选路，带关键词例外、熔断和总超时。
- **工作空间**：管理服务商、模型、实验历史、密钥、成员与用量；`⌘K` / `Ctrl+K` 可搜索页面和可用模型。
- **部署**：单 Node.js 进程，运行时仅 `ws`、`marked` 两个第三方依赖；macOS App 使用系统 WebKit，内置独立 Node，无需另外安装 Docker 或 Node。

## 能做什么

| 模块 | 能力 |
| --- | --- |
| 模型路由 | 固定、故障转移、加权、延迟优先、关键词规则、经济优先；服务商内不同模型及跨服务商回退 |
| 协议网关 | OpenAI Chat Completions / Responses / Legacy Completions、Anthropic Messages、SSE，以及自建 WebSocket 文本协议 |
| 服务商与模型 | 配置上游地址和主／备密钥，获取并选择可调用模型，按模型自动匹配协议 |
| 模型实验室 | 对话、同题多模型对比、图片／音频／视频任务、视觉理解；显示实际命中模型、失败原因和可测得的延迟指标 |
| 团队管理 | 邮箱密码或飞书 OAuth 登录、邀请、角色、租户隔离、操作审计、密码重置 |
| 组织订阅 | 按租户查看 BYOK 订阅状态；平台主账号可准备套餐草案、手动分配内部试用订阅 |
| 运营观测 | 业务 API Key 配额、请求日志、最终成功率、用量、费用估算与模型价格 |

这是**单实例部署**：配置和账户使用本地文件，请求用量与 API Key 调用计数使用 SQLite，限流和部分状态在进程内。不要让多个进程或容器同时读写同一个 `data/` 目录。对外服务请置于 HTTPS 反向代理之后，做好数据备份和访问控制。

当前发布版本为 v2.2.0。主分支包含 [尚未发布的界面与工作流改进](CHANGELOG.md#unreleased)，已发布的 GHCR `2.2.0`、`2.2` 和 `latest` 不自动包含主分支提交。体验主分支请从源码构建；升级前备份数据。

## 五分钟部署

需要 Docker + Compose，以及用于生成初始配置的 Node.js **>= 22.18**。

```sh
git clone https://github.com/chensl139-ok/switchboard-ai-router.git
cd switchboard-ai-router
npm run setup
docker compose up -d --build
docker compose ps
```

`npm run setup` 仅在 `.env` 不存在时生成两个随机令牌，不会覆盖已有配置。控制台默认只监听本机：[http://127.0.0.1:3100](http://127.0.0.1:3100)；就绪检查为 `/readyz`。首次打开页面，用本机 `.env` 中的 `ADMIN_TOKEN` 初始化所有者账户，然后设置邮箱和密码。**不要把令牌发给其他人，也不要把 `.env` 提交到仓库。**

Compose 将数据挂载到当前目录的 `data/`，容器内部监听 3000。配置了服务商和模型后，可在「模型实验室」先试一次，再创建供业务系统使用的 API Key。初始化令牌不是业务 API Key。

控制台非首页功能采用按需加载，访问实验室、文档、日志等页面时才加载相应代码；切页或更换账户后，旧页面的异步加载结果不会重新覆盖当前视图。

### macOS 桌面 App

希望直接安装到电脑时，可使用内置运行环境的桌面版，无需 Docker 或 Node。打开 DMG，将 Switchboard 拖入“应用程序”后启动；可从 App 菜单导入已有部署的独立数据副本。菜单栏可查看服务状态、打开实验室与路由，或复制本机 API 地址。桌面使用、数据目录和打包方式见 [桌面版说明](desktop/README.md)。

当前安装包面向 macOS 13+ 的 Apple Silicon Mac（M 系列），尚未完成 Apple Developer ID 签名与公证，其他电脑可能出现安全拦截。DMG 不含个人账号、密钥或历史；分享给同事后各自运行独立平台，不会自动共享你的组织数据。详见[安装步骤](desktop/README.md#安装与使用)和[分享说明](desktop/README.md#分享安装包)。

本机开发版另提供个人 ChatGPT 订阅 OAuth 连接预览，无需 API Key，账户与租户隔离；不等同于组织订阅号池，不向业务 API 或其他成员共享。已在本机验收官方授权、模型获取和实际文本调用；其他账户仍以官方授权结果为准，详见 [订阅连接说明](desktop/README.md#个人订阅连接本机预览)。

订阅模型可在「个人路由（含订阅）」与组织 API 模型共同选路，仅影响本人当前租户的实验室调用。支持模型内及跨服务商故障转移，正文开始后不切换；未知价格的订阅不参与经济优先。Claude 订阅暂未取得官方第三方接入授权，不等同于已支持的 Anthropic API。

### Windows 桌面 App

Windows 用户可使用独立的 [Windows x64 桌面安装包](desktop/windows/README.md)：解压分享 ZIP 后运行 Setup.exe，安装后从开始菜单启动。无需 Docker 或 Node，使用系统 WebView2；当前安装包尚未进行 Windows 代码签名。Windows 构建从主分支工作流生成，不等同于已发布的 v2.2.0 Release 附件。

### 使用已发布镜像

不想在本机构建镜像时，可从 [GHCR](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router) 拉取 `linux/amd64` 或 `linux/arm64` 版本。先在仓库目录运行一次 `npm run setup`，再执行：

```sh
mkdir -p data
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:2.2.0
docker run -d --name switchboard-ai-router \
  --restart unless-stopped \
  -p 127.0.0.1:3100:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 -e DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  ghcr.io/chensl139-ok/switchboard-ai-router:2.2.0
```

上述 `docker run` 与 Compose 是**两种部署方式，二选一**，不要同时启动占用 3100 端口的实例。Release 另提供源码包、离线 OCI 镜像包和 `SHA256SUMS`。

不用 Docker 时运行 `npm ci && npm run setup && npm start`；默认端口为 3000，可在 `.env` 设置 `HOST=127.0.0.1`、`PORT=3100`。

## 工作原理

```
  Cherry Studio · Claude Code · curl · 你的应用 · 你的 Agent
                    │   一个 base_url + 一把业务 Key
                    ▼
  ┌──────────────────────── Switchboard ────────────────────────┐
  │  鉴权 · 租户 · API Key 配额 · 限流 · 审计                    │
  │  ─────────────────────────────────────────────────────────  │
  │  路由 · 固定 / 故障转移 / 加权 / 延迟优先 / 关键词 / 经济优先  │
  │        （含熔断、超时、尝试预算）                             │
  │  ─────────────────────────────────────────────────────────  │
  │  协议 · OpenAI Chat / Responses / Completions                │
  │         Anthropic Messages · SSE · WebSocket                 │
  │         媒体：图片 · 音频 · 视频 · 嵌入 · 重排               │
  └────┬──────────┬──────────┬──────────┬───────────┬───────────┘
       ▼          ▼          ▼          ▼           ▼
   DeepSeek    OpenAI    Anthropic    Gemini     阿里百炼 · OpenRouter
                                        · 任意 OpenAI/Anthropic 兼容上游
```

## 首次配置与调用

1. 在「服务商与模型」添加上游 Base URL 和 API Key；获取模型列表，勾选需要开放的模型并保存。支持自定义兼容服务商，同一服务商可添加备用密钥。
2. 在「路由策略」选首选模型，再选择失败后自动挑选备用、手动指定备用顺序或不换模型。右侧会检查当前草稿的真实调用顺序；确认后点「保存并生效」。进阶设置默认收起，修改草稿和检查顺序都不会请求上游。
3. 在「模型实验室」调用模型，确认实际命中、协议、输出和错误信息。媒体任务应选择对应的图片、音频、视频或视觉理解入口。
4. 所有者、管理员和普通成员均可在「API Key 管理」为自己的应用创建 Key、设置有效期和配额；只展示和管理本人创建的 Key。明文仅在创建时显示一次，成员移除或降为只读后，其个人 Key 不再允许新调用。

最小 API 调用示例；将 `YOUR_API_KEY` 换成平台签发的**业务 Key**，不要使用服务商密钥：

```sh
curl -i http://127.0.0.1:3100/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":false}'
```

| `model` 写法 | 含义 |
| --- | --- |
| `auto` | 跟随当前租户的路由策略，可尝试兼容的其他服务商／模型 |
| `provider-id` | 使用该服务商的当前模型 |
| `provider-id::model-id` | 固定服务商和模型；可使用同模型备用密钥，不跨模型回退 |

成功响应包含 `x-router-provider`、`x-router-model`、`x-router-protocol`、`x-router-attempt`、`x-router-fallback` 等头，方便确认真正命中的模型；文本头使用 URL 编码。实验室选择具体模型时，会把它作为起始模型并允许实验室的回退流程；这与 API 中固定的 `provider-id::model-id` 语义不同。

故障转移按“服务商 + 模型”组织候选，支持服务商内和跨服务商切换，并受协议／能力兼容性、熔断、超时和尝试预算约束。已经开始输出的流不会拼接另一个模型的回答。**最终成功率按一次用户请求的最终结果统计**：失败后回退成功计为成功；失败的上游尝试仍保留在日志里。

完整接口、SDK 与参数示例见 [API.md](API.md) 和控制台「API 文档」。OpenAPI 3.1 JSON 位于需鉴权的 `/v1/openapi.json`。Cherry Studio 等 OpenAI 兼容客户端将 Base URL 设为 `http://127.0.0.1:3100/v1`，Key 使用平台签发的业务 Key。

## 与同类项目的区别

2026 年 10 月快照，请以各项目最新文档为准；如有出入欢迎提 PR 修正。

| | Switchboard | LiteLLM | one-api | new-api | claude-code-router |
| --- | --- | --- | --- | --- | --- |
| 许可证 | **MIT** | MIT 核心 + 企业目录 | MIT | AGPL-3.0 + 附加条款 | MIT |
| 运行时 | Node.js · **仅 2 个运行时依赖** | Python SDK + Proxy | Go 单二进制 | Go 单二进制 | Node CLI |
| 控制台 | ✅ 中文一等公民 | ✅ 英文 | ✅ | ✅ | 以 CLI 为主 |
| 路由策略 | 固定 / 自动；4 个目标 + 任务规则 + 容灾 | 策略丰富 | 渠道级故障转移 | 渠道 + 协议转换 | 面向 Agent 的规则 |
| 协议互转 | OpenAI Chat / Responses / Completions + Anthropic Messages | 最广（100+ 服务商） | OpenAI 兼容 | OpenAI / Claude / Gemini | 面向 Agent |
| 多租户 RBAC + 操作审计 | ✅ 内置 | 企业版功能 | 🔶 基础用户/分组 | 🔶 基础用户/分组 | ❌ |
| 模型实验室与对比 | ✅ 带延迟指标 | 🔶 面板测试 | 🔶 | 🔶 | ❌ |
| 媒体任务（图/音/视频/嵌入/重排） | ✅ | ✅ | 🔶 | ✅ | ❌ |
| 计费分发、兑换码 | 未启用付费墙（BYOK 套餐草案） | 🔶 预算 | ✅ | ✅ | ❌ |
| 桌面 App | ✅ macOS | ❌ | ❌ | ❌ | CLI |

**什么时候不该选 Switchboard**：需要开箱即用的 100+ 冷门服务商（LiteLLM）、要做对外卖 Key 的中转站/兑换码生意（one-api / new-api）、或只想要一个给单个 Coding Agent 用的个人 CLI 小工具（claude-code-router）。Switchboard 面向的是**自托管一个受管网关服务多个服务商的个人与团队**。

## 模型实验室与媒体

对话页支持 SSE 输出、Markdown、代码复制、图片输入、函数工具和 2–4 个模型的同题对比。生成期间可继续编辑下一条草稿，但当前生成结束或停止前不会发送第二个请求。函数工具由调用方定义、执行并回传，网关不执行模型生成的代码。

实验室显示总耗时、输出 Token、TTFB（首个响应数据）、TTFT（首个可见内容或思考增量）、端到端 TPS 和**估算** TPOT。TPS 包含首字延迟及可能的故障转移；TPOT 根据多个流式增量的时间跨度和上游输出 Token 用量估算，并非供应商精确的逐 Token 解码耗时。缺少可靠数据时显示「—」，非流式完整响应不能测量 TTFT／TPOT。

媒体实验室按任务筛选模型：图片生成、语音合成、音频转文字、视频生成和视觉理解。媒体调用需指定已配置的模型，不使用对话的 `auto` 路由；视频任务当前仅适配硅基流动。更多媒体 API（包括图片编辑、音频翻译、嵌入和重排）见 [API.md](API.md#媒体与专用模型接口)，不一定都有实验室表单。

`moss-vl-1.0` 在当前上游接口属于**单轮视觉理解任务**，不进入普通文本对话或自动对话路由。使用媒体实验室「视觉理解」或同步 `/v1/responses`：一条文字指令搭配 1–5 张图片，或搭配 1 个视频；不能混用、不能仅发文字、不能设置 `stream=true`。

## 团队、价格和审计

「组织订阅」目前是**不启用付费墙的 BYOK 订阅框架**：现有租户继续使用自己的服务商密钥，模型费用由上游服务商收取。平台主账号可保存套餐草案，配置 API Key 数量、成员数量及对话／媒体／模型对比实验室权益，并手动分配内部试用套餐；租户所有者／管理员可查看本组织的规划权益。**所有权益限制目前仅展示、不执行**。

成员通过邀请加入租户；所有者、管理员、成员、只读角色具有不同权限，详见 [TENANCY.md](TENANCY.md)。忘记密码时，所有者／管理员可为成员签发一次性重置码，通过安全渠道交付；系统不会自动发邮件。唯一所有者失去登录能力时，部署管理员需停机后使用 `scripts/reset-admin-password.mjs` 本地恢复。

首次初始化的账户是平台主账号：只有该账号的邮箱密码登录，或该账号已连接的**模思智能（默认租户）飞书身份**登录，才可查看、切换和管理全部租户。

飞书登录为可选功能。一个飞书企业自建应用仅服务其所在企业；多个独立企业可各自提供一枚企业自建应用，映射到平台中各自独立的租户。配置步骤、安全注意事项与跨企业单入口迁移方案参见 [TENANCY.md](TENANCY.md) 与[飞书开放平台文档](https://open.feishu.cn/document/home/app-types-introduction/robots-web-applications-and-mini-programs)。如果没有自有域名，可用 [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) 把本机控制台以固定 HTTPS 地址开放给同事；注意这会把登录页公开到互联网，应保持强密码并严格管理飞书应用可用范围。

「请求日志」记录请求与上游尝试的元数据，不保存提示词或回复正文；「用量分析」展示成员、模型和 Key 用量及估算费用；「组织审计 → 租户操作」记录配置和成员操作，每个租户最多保留最近 2000 条。仅平台主账号可清空所有租户操作审计；租户所有者可重置统计起点或清除本租户请求日志与用量。

「模型实验室 → 历史记录」按当前账号和租户保存最近 100 条对话与媒体任务记录，支持服务端搜索、状态筛选、排序与分页；存储在 `data/lab-history.sqlite`。

经济优先使用已配置且有效的同币种价格做**预估**，不是结算系统。可以把 OpenRouter 模型报价导入其他服务商作为参考；手动价格和服务商自身报价优先。实际采购价、缓存命中、时段和多模态收费应以服务商账单为准。

## 运行、安全与升级

| 配置 | 用途 |
| --- | --- |
| `ADMIN_TOKEN`、`GATEWAY_TOKEN` | `npm run setup` 生成的独立令牌；不要公开 |
| `HOST`、`PORT`、`DATA_DIR` | 监听地址、端口和持久化目录；Compose 覆盖容器内监听设置 |
| `COOKIE_SECURE=true` | 公网 HTTPS 反向代理部署时启用 Secure Cookie |
| `GLOBAL_MAX_CONCURRENCY` | 全局并发上限，默认 20 |
| `UPSTREAM_ALLOWED_PRIVATE_HOSTS` | 精确授权需要访问的私有推理服务地址 |
| `ALLOW_HTTP_UPSTREAM=true` | 仅在受信任的本地推理服务必须使用 HTTP 时启用 |
| `UPSTREAM_PROXY_FAKE_IP=true` | 本机使用 Fake-IP 代理导致官方上游被 SSRF 防护拦截时启用 |

其余选项和注释见 [.env.example](.env.example)。默认拒绝非安全上游和私网／保留地址访问；仅在了解风险时精确放行。上游密钥在服务端以 AES-256-GCM 加密保存，业务 Key 哈希保存。公网暴露时必须配置 HTTPS、可信反向代理和访问控制。密钥相关接口不回显秘密，审计不记录正文。

**备份整个 `data/` 目录，包括 `master.key`。** 只备份配置而丢失主密钥，已保存的服务商密钥将无法解密；备份也包含敏感数据。建议停止容器后备份，以保持 SQLite 文件一致。不要让第二个实例挂载同一目录。

从源码升级前先备份数据，再更新代码并重建：

```sh
docker compose stop switchboard
cp -a data "data.backup.$(date +%Y%m%d-%H%M%S)"
git pull --ff-only
docker compose up -d --build
docker compose ps
```

若使用 GHCR 的 `docker run` 方式，请拉取新版本镜像，并按原参数重建容器，继续挂载原 `data/`；不要直接删除数据卷。健康检查可访问 `/healthz` 和 `/readyz`。

## 开发、验证与发布

```sh
npm ci
npm run check          # 语法、TypeScript/Vue 类型与前端构建
npm test               # 170+ 项自动化测试
npm start              # 构建并启动本地服务
```

`scripts/smoke.mjs` 默认只检查就绪状态和可调用模型列表；`--live` 会发起一次可能计费的真实对话调用：

```sh
SWITCHBOARD_TOKEN=YOUR_API_KEY node scripts/smoke.mjs
SWITCHBOARD_TOKEN=YOUR_API_KEY node scripts/smoke.mjs --live
```

推送 `v*` 标签会触发 [Release 工作流](.github/workflows/release.yml)：运行检查和测试、构建并推送 GHCR 的 amd64／arm64 镜像、从对应 [CHANGELOG.md](CHANGELOG.md) 条目生成 Release 说明和归档附件。普通提交由 [CI 工作流](.github/workflows/ci.yml) 验证，**不会**自动发布新版本。发布步骤见 [发布维护说明](.github/RELEASING.md)，维护脚本用途见 [脚本索引](scripts/README.md)。

项目架构和模块边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。问题反馈请提交 [GitHub Issue](https://github.com/chensl139-ok/switchboard-ai-router/issues)。

## 合规声明

Switchboard 是中立的自托管路由工具。请确保你的使用方式符合各模型服务商的服务条款与所在地区的法律法规；未经授权，不要基于本项目向公众提供生成式人工智能服务，也不要用于任何违法违规用途。

## Star History

如果 Switchboard 帮你省下了一次部署排障或一张意外账单，欢迎 ⭐ Star 支持——这是下一个版本最好的燃料。

[![Star History Chart](https://api.star-history.com/svg?repos=chensl139-ok/switchboard-ai-router&type=Date)](https://star-history.com/#chensl139-ok/switchboard-ai-router&Date)

## License

[MIT](LICENSE) © 2026 chensl139-ok
