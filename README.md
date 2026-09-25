# Switchboard · AI 智能路由平台

一个入口连接多个模型服务商。支持账户与租户隔离、六种路由策略、OpenAI / Anthropic 兼容 API、SSE / WebSocket，以及模型价格和用量管理。基于 Node.js 独立运行。

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chensl139-ok/switchboard-ai-router)](https://github.com/chensl139-ok/switchboard-ai-router/releases/latest)
[![Container](https://img.shields.io/badge/ghcr.io-multi--arch-2496ED?logo=docker&logoColor=white)](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router)

[最新版本 v2.0.10](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.0.10) · [更新记录](CHANGELOG.md) · [API 接入说明](API.md) · [租户与权限](TENANCY.md)

## 主要功能

| 功能 | 支持内容 |
| --- | --- |
| 服务商与模型 | DeepSeek、OpenAI、Anthropic、Gemini、OpenRouter、百炼及自定义兼容服务；自动协议、删除、排序与同服务商多模型切换 |
| 智能路由 | 固定模型、服务商间及服务商内模型故障转移、加权轮询、延迟优先、关键词规则、经济优先 |
| 模型目录 | 一键合并主/备用密钥的模型目录、搜索并加入调用列表；通过 `provider::model` 精确指定服务商与模型 |
| 兼容 API | Chat Completions、Responses、Legacy Completions、Anthropic Messages；JSON、SSE、自建 WebSocket |
| 多模态与工具 | 文字与图片输入、函数工具定义、流式工具参数和结果回传；工具由调用方执行 |
| 模型实验室 | 自适应对话工作区与按需展开的生成设置、2–4 个模型同题对比；显示实际路由、故障转移、耗时、Token、失败原因，并支持图片、工具和生成中草稿 |
| 模型思考 | 真实思考内容展示与折叠；模型推理开关与界面显示开关独立 |
| 媒体实验室 | 图片生成、图片编辑、音频合成、音频转写/翻译、视频生成与自动进度刷新，内置限额与任务归属追踪 |
| API Key | 产品侧创建、有效期、启停、删除、总次数／每日次数／RPM 限制；明文仅展示一次 |
| 多租户 | 邮箱密码与飞书 OAuth 登录、邀请注册、租户切换、所有者／管理员／成员／只读角色 |
| 价格管理 | 输入、输出、缓存命中价格；高峰／空闲时段、时区与星期；图片按张价格 |
| 观测与文档 | 请求日志组合筛选、故障转移请求追踪；租户审计按成员、类型、时间和关键字检索；用量趋势、费用估算、产品内 API 文档、OpenAPI 规范预览与 JSON 下载 |

上游密钥使用 AES-256-GCM 加密，外部调用 Key 使用哈希存储。服务端日志保存调用元数据，不保存提示词、回复正文或密钥。

控制台提供浅色与深色科技主题，默认跟随系统外观；手动切换后记住选择。桌面端将页面标题并入顶栏，正文只保留必要说明与操作；窄屏在正文显示标题，以留出搜索与按钮空间。全站页面边距、模块内部留白、筛选区、卡片和表格采用统一的间距尺度，模型实验室的对话与媒体页共用边界。侧栏平台名称左侧显示路由图标，展开态的收起按钮置于右侧；折叠态按钮与导航图标共用同一中心轴，租户切换列表从头像侧边弹出；窄屏使用横向导航和紧凑顶部栏。服务商卡片每 10 秒自动更新调用健康状态，回到页面时立即刷新。对话页让消息区随窗口伸缩，输入区贴底并可继续编辑下一条草稿；运行模型和状态合并为一个响应式操作条，实际命中模型只在回复标题显示一次，路由细节按需展开。输入框聚焦保持单层反馈，生成设置按需展开，在窄屏以侧边浮层呈现。

模型实验室每条回复展示总耗时、输出 Token 数、TTFB（首个响应数据）、TTFT（首个内容或思考增量）、TPS（端到端输出吞吐）及估算 TPOT。TPS 以上游返回的输出 Token 数除以完整请求耗时，包含首字延迟和故障转移耗时，不代表纯解码速度。TPOT 按 `(最后一个可见输出增量时间 - 第一个可见输出增量时间) / (上游输出 Token 数 - 1)` 估算，不再把结束帧和网络收尾时间计入生成。只有多个相隔足够时间的流式增量且上游报告输出 Token 用量时才展示；网络分块、隐藏思考和服务商 Token 口径仍可能影响准确性，不能视作供应商的精确逐 Token 解码指标。HTTP 完整响应无法测量 TTFT/TPOT，缺少可靠数据时显示「—」。

对话调用默认最大输出为 8192 Tokens；实验室或 API 请求显式设置的值优先。各服务商和模型自身的输出上限仍以对应上游为准。

故障转移以“服务商 + 模型”为候选单位：默认服务商置顶，前三个兼容候选优先安排首选服务商默认模型、该服务商另一个模型、下一服务商模型，再尝试其余模型与备用密钥，受“最多尝试次数”和总超时限制。延迟优先与加权轮询也可在首选失败后回退到同服务商或其他服务商的模型。自动对话会过滤媒体模型与不支持请求能力的模型，过滤项不占尝试次数。路由页面可预览候选顺序、协议、健康状态和过滤原因，预览不调用上游。实验室选择具体模型时，该模型作为起始模型并显式启用同服务商、跨服务商回退；API 使用 `provider::model` 时固定模型，但仍可切换同模型备用密钥。流式响应一旦已经输出首个增量，不会切换候选。

六种策略各有实际选路语义：固定模型只使用所选服务商的默认模型和备用密钥；故障转移按优先级安排服务商内、跨服务商候选；加权轮询按权重选择首选服务商；最低延迟在有足够成功样本时按平均耗时排序；任务规则按用户消息命中首条关键词规则并选其目标模型；经济优先按有效的同币种价格估算总成本。后五种策略均受熔断、协议兼容性和尝试预算约束，任务规则与经济优先也保留同服务商及跨服务商的回退路径。经济优先的价格可能是 OpenRouter 参考价，不等于供应商账单；价格未知或过期的模型不会被视为免费。

## 快速开始

需要 **Node.js >= 22.18**，适用于 Windows、macOS 和 Linux。`npm start` 会先构建控制台；Docker 构建会在独立阶段打包前端，不会把开发依赖带入运行镜像。

```sh
git clone https://github.com/chensl139-ok/switchboard-ai-router.git
cd switchboard-ai-router
npm ci
npm run setup
```

编辑自动生成的 `.env`（保留已生成的令牌），本机示例使用 **3100**：

```dotenv
HOST=127.0.0.1
PORT=3100
```

启动并打开 [http://127.0.0.1:3100](http://127.0.0.1:3100)：

```sh
npm start
```

### Docker 部署

推荐使用 Compose。先生成只保存在本机的令牌与配置，再启动容器：

```sh
npm run setup
docker compose up -d --build
docker compose ps
```

默认访问 [http://127.0.0.1:3100](http://127.0.0.1:3100)，数据持久化到仓库下的 `data/`。Compose 使用只读根文件系统、`no-new-privileges`、健康检查和 40 秒优雅停机。

正式 Release 同时发布 `linux/amd64` 与 `linux/arm64` 镜像：

```sh
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:2.0.10
docker run -d --name switchboard-ai-router \
  --restart unless-stopped \
  -p 127.0.0.1:3100:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 -e DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  ghcr.io/chensl139-ok/switchboard-ai-router:2.0.10
```

若使用 Release 中的离线镜像包：

```sh
gzip -dc switchboard-ai-router-v2.0.10-oci.tar.gz | docker load
SWITCHBOARD_VERSION=2.0.10 docker compose up -d
```

发布产物包括源码 ZIP/TAR.GZ、`SHA256SUMS`、多架构 OCI 镜像包，以及带 SBOM/Provenance 的 GHCR 镜像。

### 首次配置

1. 使用 `.env` 中的 `ADMIN_TOKEN` 创建首个所有者账户，之后通过邮箱和密码登录。
2. 在「服务商与模型」填写上游地址与密钥，获取模型后勾选所需模型；搜索结果支持同一个按钮全选或取消全选，保存后启用服务商。
   直接选择模型即可，系统会自动匹配 OpenAI Chat Completions、Responses 或 Anthropic Messages 协议；无法识别的模型使用服务商默认协议。Anthropic 兼容网关若要求 `Authorization: Bearer`，可选择对应鉴权方式。
3. 在「模型实验室」验证模型，按需要设置路由策略与价格。
   同一服务商可保存主密钥与备用密钥。模型发现会自动合并两把密钥可见的模型，调用失败时自动尝试可用备用密钥，不需要维护模型计费渠道。价格可分别录入输入、输出、缓存读取和缓存写入费用，未知缓存写入价格时不会伪造该次调用费用。
4. 在「API Key 管理」创建业务调用 Key，并设置额度和有效时间。
5. 打开侧栏「API 文档」查看示例，或访问 `/#api`。

`ADMIN_TOKEN` 用于首次账户初始化，不能用作业务调用 Key。新部署不会包含其他实例的账户、供应商密钥或价格配置。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | 监听地址与端口 |
| `ADMIN_TOKEN` / `GATEWAY_TOKEN` | setup 生成 | 初始化令牌，各至少 24 字符 |
| `UPSTREAM_PROXY_FAKE_IP` | `false` | 本机使用 Fake-IP 代理（Surge / Clash 等）时设为 `true`，放行官方上游域名的 198.18/15 虚拟地址 |
| `UPSTREAM_PROXY_FAKE_IP_HOSTS` | 空 | 在启用上项时，精确列出也需要放行 Fake-IP 的自定义 HTTPS 服务商域名，逗号分隔；不接受通配符 |
| `UPSTREAM_ALLOWED_PRIVATE_HOSTS` | 空 | 私有推理服务须精确授权域名/IP，逗号分隔 |
| `ALLOW_HTTP_UPSTREAM` | `false` | 默认禁止 HTTP 上游，仅访问受信任的本地推理服务时开启 |
| `COOKIE_SECURE` | `false` | HTTPS 反代场景设为 `true` |
| `GLOBAL_MAX_CONCURRENCY` | `20` | 平台级并发上限 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 空 | 飞书企业自建应用凭据；只保存在服务端 |
| `FEISHU_REDIRECT_URI` | 空 | 完整 OAuth 回调地址，必须以 `/api/account/sso/feishu/callback` 结尾并与飞书后台一致 |
| `FEISHU_ALLOWED_TENANT_KEY` | 空 | 建议设置为本企业 tenant_key，阻止其他企业账号登录 |
| `FEISHU_AUTO_JOIN` | `false` | 同企业飞书用户是否无需邀请自动加入默认租户 |
| `FEISHU_DEFAULT_ROLE` | `member` | 自动加入角色，仅支持 `member` 或 `viewer` |

> **提示**：若本机开启了 Fake-IP 模式代理，服务商模型列表会报「网络异常」——实际是被 SSRF 防护拦截。将 `UPSTREAM_PROXY_FAKE_IP` 设为 `true` 并重启即可。

### 飞书企业登录

在飞书开放平台创建企业自建应用，启用网页应用登录，并把重定向 URL 配置为部署域名加 `/api/account/sso/feishu/callback`。将应用凭据和相同回调地址写入 `.env` 后重启，登录页会自动出现“使用飞书登录”。

默认采用邀请制：管理员在「成员与角色」按企业邮箱生成邀请后，同事可直接用对应飞书账号登录并消费邀请，无需另设密码。若公司希望全员可用，可同时配置 `FEISHU_ALLOWED_TENANT_KEY` 并开启 `FEISHU_AUTO_JOIN=true`；不建议在未限制 tenant_key 时开启自动加入。飞书用户可在「账户与租户」设置本地备用密码。

### 组织用量审计

所有者和管理员可在「组织审计」按 7／30／90 天查看每位成员的请求数、上游尝试、最终成功率、输入／输出 Token、费用估算和最近使用时间。最终成功率按独立请求计算，故障转移后成功也计为成功；每次失败尝试仍留在请求日志和服务商健康中。租户操作记录支持按操作人、类型、时间范围和关键字组合筛选，服务端分页覆盖所有保留事件，并展示原始事件标识。控制台调用直接归属登录成员；新建 API Key 自动归属创建人。升级前创建的 Key 和旧版环境令牌无法可靠推断个人身份，因此保留为“未归属”，不会伪造审计关系。管理配置变更和飞书登录事件也会记录操作者。

租户所有者还可在「用量分析」重置统计起点，或清除当前租户的请求日志与用量记录。前者保留历史日志，后者不可从平台恢复；两者都需确认并写入租户审计，且不会修改 API Key、配额计数、账号和服务商配置，也不会清除其他租户的数据。

### 忘记密码

普通成员可在登录页选择「忘记密码？」。组织所有者或管理员在「成员与角色」为该成员签发一次性重置码，再通过安全渠道交付；有效期为 30 分钟，使用后会撤销该账户全部旧会话。注册另需管理员提供的邮箱专属邀请码，登录页已提前说明。系统不会自动发送邮件。

若唯一所有者忘记密码且无法使用已绑定飞书登录，由部署管理员在服务器本地恢复。密码使用 scrypt 单向哈希存储，无法反推明文；使用随仓库提供的 reset 脚本：

```sh
# 1. 停止平台进程；Docker 部署则执行 docker compose stop switchboard

# 2. 把新密码通过环境变量传入，不进 shell history
export SWITCHBOARD_NEW_PASSWORD='你的新密码（≥12 字符）'

# 3. 执行重置
node scripts/reset-admin-password.mjs

# 4. 取消密码变量并重启服务；Docker 部署则执行 docker compose start switchboard
unset SWITCHBOARD_NEW_PASSWORD
npm start
```

脚本会原子覆盖 `data/accounts.json`、清空该账号 session、并在审计日志追加 `account.password.reset`。

## API 接入

以下地址假设本机已配置为 3100。

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

非流式和 SSE 响应都会返回 `x-router-provider`、`x-router-provider-name`、`x-router-model`、`x-router-protocol`、`x-router-reason`、`x-router-attempt` 和 `x-router-fallback` 响应头，用于观测自动路由实际命中结果；WebSocket 的 `done.route` 返回同样信息。Header 文本使用 URL 编码，读取后用 `decodeURIComponent` 解码。

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

### 接口兼容性边界（便于排错）

- `n`、`best_of` 不支持除 `1` 之外的值；`Responses` 不支持 `response` 历史会话类参数；部分复杂参数会直接返回 `invalid_request`。
- `messages` 场景目前不支持 `tool` 角色的图片内容；工具调用仅支持调用方执行的 `function`。
- `/v1/messages/count_tokens` 仅用于 Anthropic 上游。
- `/v1/realtime` 为本仓库自定义 JSON 协议，非 OpenAI 音频实时协议；每个连接同一时刻只处理一个生成请求。

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

服务器返回 `delta`、`done` 或 `error`。发送 `{"type":"cancel","id":"request-1"}` 可取消；每个连接同时处理一个生成请求。不要把密钥放进 URL。

完整参数、SDK、图片与工具回传示例见 [API.md](API.md) 和产品内 `/#api`。`/api/*` 管理接口使用账户会话，不能使用外部 Key 修改平台配置。

## Cherry Studio 配置

1. 添加 OpenAI 兼容服务商。
2. API 地址填写 **`http://127.0.0.1:3100/v1`**。
3. API 密钥填写本平台签发的 Key。
4. 点击「获取模型列表」，将需要的模型加入客户端；选择 `auto` 可使用后台路由策略。

API 地址不要追加 `/models` 或 `/chat/completions`。Cherry Studio 标准模型列表使用 `/v1/models`，仅显示已配置的模型；完整上游目录使用 `/v1/models/all` 查询。

**能聊天但拉取模型列表失败**：检查客户端代理。列表请求可能被系统代理转发并断开；在客户端代理绕过规则中加入 `localhost,127.0.0.1,::1` 后可恢复。

## 价格与经济优先

- 按服务商与模型分别维护价格，支持 CNY / USD。相同模型在不同服务商的价格互不替代。
- 录入普通输入、输出、缓存命中输入的每百万 Tokens 价格及每次请求固定费用。缓存价留空表示未知，`0` 表示已确认免费。
- 支持最多 8 个高峰／空闲时段，设置 IANA 时区及生效星期；可跨午夜，开始时间包含、结束时间不包含。
- 经济优先只比较同币种、价格有效的已配置模型，按选路时的时段价格及输出上限估算。
- 任意服务商可批量导入 OpenRouter USD 参考价，无需逐个指定模型。导入时记录采集时间，默认设 7 天后的平台复核期限；这不是 OpenRouter 官方报价的有效期承诺。手动价格未填写到期时间时长期有效。自动匹配相同模型 ID、唯一同名模型或唯一的 Hugging Face 原始 ID（例如硅基流动的 `zai-org/GLM-5.3` 对应 OpenRouter 的 `z-ai/glm-5.3`）；不匹配时仍可单独指定映射。手动价格、服务商自身报价及其他非 OpenRouter 价格优先于导入参考价，不会被覆盖。

OpenRouter 参考价只是经济路由和用量展示的估算依据，**不代表其他服务商的合同价、优惠价或实际账单**。应优先手动录入实际采购价格；不同币种不混合比较。价格数据属于部署实例，费用不作为计费结算凭据。
自动导入使用 OpenRouter 模型目录中的基础 Token 报价和已提供的缓存读写价，不涵盖阶梯价、多模态、套餐或供应商折扣；不适合直接用于结算。

已有价格可在停机后执行 `node scripts/set-price-expiry.mjs data` 预览，再执行 `node scripts/set-price-expiry.mjs data --apply` 将期限统一设为无限期。脚本会先把原始状态文件备份到权限受限的 `.price-backups/`；备份含已加密的服务商凭据，请妥善保管。无限期只表示平台不自动让该价格失效，不代表参考价永远准确；来源和采集时间仍保留供定期复核。再次同步已设为无限期的参考价会更新报价和采集时间，但保留无限期；首次导入的 OpenRouter 参考价仍默认在 7 天后提醒复核。

## 思考、图片与工具的边界

实验室支持图片附件和直接粘贴截图，最多 4 张、单张不超过 4 MB；包含历史及 Base64 的总请求上限为 10 MB。选择具备视觉能力的上游模型后才能处理图片。

在「多模型对比」中可选择 2–4 个不同模型，对同一文本问题进行独立调用。对比界面显示每个模型的回答、耗时、上游报告的 Token 用量与失败原因，并可导出 JSON。协议和密钥由平台自动选择。最多同时发出 2 个请求；每个请求单独计费。未返回用量时显示“未知”，不会估算为 0。

单模型对话生成回复时仍可在输入框编写下一条草稿。生成中不会发送第二个请求；完成或停止后草稿保留，可再按 Enter 发送。生成时 Enter 插入换行，Shift + Enter 也可换行。

开发栈采用渐进迁移：网关保留 Node.js 原生 HTTP/SSE/WebSocket 传输层；服务商密钥路由和模型实验请求已使用 TypeScript，模型对比界面使用 Vue 3 + Vite。其余控制台页面仍是 ES Modules，后续可逐页迁移，避免一次性重写影响现有租户和 API。`npm run typecheck` 检查 TypeScript/Vue，`npm run build:web` 生成可部署的控制台资源。

重构后的模块边界、数据流与部署取舍参见 [ARCHITECTURE.md](ARCHITECTURE.md)。

"显示思考"仅影响界面；`thinking_mode: "disabled"` 控制实际推理。不支持关闭的模型会明确拒绝，不能通过隐藏文字减少推理费用。模型返回的思考会占用输出预算。

函数工具由调用方验证参数、执行并回传结果；网关不执行工具。当前不支持聊天消息中的音视频内容块、通用文件存储、内置联网／代码执行工具、Responses 服务端会话存储，以及 JSON Schema 结构化输出。兼容范围以 [API.md](API.md) 为准。

## 媒体生成

外部客户端使用 `/v1/images/generations`、`/v1/images/edits`、`/v1/audio/speech`、`/v1/audio/transcriptions`、`/v1/audio/translations`（后两者为 multipart）；嵌入与重排为 `/v1/embeddings`、`/v1/rerank`；视频采用硅基流动 `/v1/video/submit` 与 `/v1/video/status`。

- 媒体需显式指定已注册的 `provider::model`，不使用聊天自动路由；上游必须支持所选模型与接口。
- 视频任务仅支持硅基流动（`api.siliconflow.*`）。
- 任务归属提交 Key / 账户及当前租户，元数据保存在 `data/media-jobs.json`，应随数据目录一起备份。
- 音频返回二进制；视频返回异步任务，按 `requestId` 轮询。
- 控制台「媒体实验室」提供对应界面入口，与模型实验室按能力严格分桶。

## 配额、备份与升级

调用配额按开始执行的生成请求计数；上游失败或取消也计一次，内部回退不重复扣次数。每日额度按 UTC 零点（北京时间 08:00）重置。停用或过期阻止新请求，已开始请求允许完成。

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

整体备份数据目录，不可丢失 `master.key`。不要提交 `.env`、密钥或数据目录到公开仓库。

需要清除历史调用、用量和组织操作审计，但保留账户、登录会话、API Key、密钥配额规则及服务商/路由配置时，先停止容器或进程，再运行 `node scripts/clear-history.mjs data --apply --backup-root=/安全的备份目录`，最后启动服务。省略 `--apply` 仅预览各租户记录数。脚本会先创建权限受限的完整备份，随后清空历史、重置 API Key 用量计数，并移除数据目录内旧的历史备份副本；注意总调用限额也会从零重新计数。完整备份仍含旧记录，应按组织留存政策安全保管或单独销毁。

当前使用本地文件、SQLite 和进程内限流，**只支持单副本运行**，不要让多个进程共享同一数据目录。默认日志保留 90 天。

升级前备份数据，然后执行：

```sh
git pull --ff-only
# 停止原进程后
npm ci
npm start
```

Docker 升级：

```sh
cp -a data "data.backup.$(date +%Y%m%d-%H%M%S)"
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:2.0.10
SWITCHBOARD_VERSION=2.0.10 docker compose up -d
docker compose ps
```

## 验证与项目结构

```sh
npm ci
npm run check
npm test
SWITCHBOARD_TOKEN=你的产品API密钥 node scripts/smoke.mjs
# 额外发送一次可能产生费用的真实模型调用
SWITCHBOARD_TOKEN=你的产品API密钥 node scripts/smoke.mjs --live
```

| 文件 / 目录 | 职责 |
| --- | --- |
| `platform.mjs` / `accounts.mjs` | 账户、租户与访问控制 |
| `server.mjs` / `routing.mjs` | API 服务、选路与调用 |
| `protocols.mjs` / `protocol-stream.mjs` / `realtime.mjs` | 协议转换与流式传输 |
| `model-catalog.mjs` / `openapi.mjs` | 模型目录与接口定义 |
| `pricing.mjs` / `usage-store.mjs` / `media.mjs` | 价格计算、用量记录与媒体任务 |
| `key-store.mjs` / `network.mjs` / `thinking.mjs` | API Key 存储、上游安全请求与思考开关 |
| `public/` | 控制台、实验室和 API 文档 |
| `test/` | 自动化测试（`npm test`） |
| `scripts/setup.mjs` | 初始化 `.env` 与令牌（`npm run setup`） |
| `scripts/reset-admin-password.mjs` | owner 密码重置（scrypt 哈希） |
| `scripts/deploy-run.sh` / `scripts/recover.sh` | 后台 supervisor / 手动恢复 |

## 维护者联系

仓库维护联系邮箱：`15652641985@163.com`。
