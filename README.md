# Switchboard

自托管的多服务商 AI 模型路由网关。用一个 API 接入已配置的模型，在控制台管理路由、密钥、成员和用量，并在模型实验室验证调用效果。

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chensl139-ok/switchboard-ai-router)](https://github.com/chensl139-ok/switchboard-ai-router/releases/latest)
[![GHCR](https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router)

[v2.1.3 Release](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.1.3) · [更新记录](CHANGELOG.md) · [API 细节](API.md) · [租户与权限](TENANCY.md) · [架构](ARCHITECTURE.md)

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

当前发布版本为 v2.1.3。GHCR 提供 `2.1.3`、`2.1` 和 `latest` 镜像标签；升级前请备份数据，并核对实际运行的镜像版本。历史镜像标签可能仍可拉取，但不要用于新部署。GitHub 仍保留 [v1.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.0)、[v1.1.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.1.0) 和 [v2.0.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.0.0) 的 tag 与 Release。

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

### 使用已发布镜像

不想在本机构建镜像时，可从 [GHCR](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router) 拉取 `linux/amd64` 或 `linux/arm64` 版本。先在仓库目录运行一次 `npm run setup`，再执行：

```sh
mkdir -p data
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:2.1.3
docker run -d --name switchboard-ai-router \
  --restart unless-stopped \
  -p 127.0.0.1:3100:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 -e DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  ghcr.io/chensl139-ok/switchboard-ai-router:2.1.3
```

上述 `docker run` 与 Compose 是**两种部署方式，二选一**，不要同时启动占用 3100 端口的实例。Release 另提供源码包、离线 OCI 镜像包和 `SHA256SUMS`。

不用 Docker 时运行 `npm ci && npm run setup && npm start`；默认端口为 3000，可在 `.env` 设置 `HOST=127.0.0.1`、`PORT=3100`。

## 首次配置与调用

1. 在「服务商与模型」添加上游 Base URL 和 API Key；获取模型列表，勾选需要开放的模型并保存。支持自定义兼容服务商，同一服务商可添加备用密钥。
2. 在「路由策略」选择默认服务商、候选顺序、策略和最多尝试次数。路由预览只计算候选，不向上游发送请求。
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

## 模型实验室与媒体

对话页支持 SSE 输出、Markdown、代码复制、图片输入、函数工具和 2–4 个模型的同题对比。生成期间可继续编辑下一条草稿，但当前生成结束或停止前不会发送第二个请求。函数工具由调用方定义、执行并回传，网关不执行模型生成的代码。

实验室显示总耗时、输出 Token、TTFB（首个响应数据）、TTFT（首个可见内容或思考增量）、端到端 TPS 和**估算** TPOT。TPS 包含首字延迟及可能的故障转移；TPOT 根据多个流式增量的时间跨度和上游输出 Token 用量估算，并非供应商精确的逐 Token 解码耗时。缺少可靠数据时显示「—」，非流式完整响应不能测量 TTFT／TPOT。

媒体实验室按任务筛选模型：图片生成、语音合成、音频转文字、视频生成和视觉理解。媒体调用需指定已配置的模型，不使用对话的 `auto` 路由；视频任务当前仅适配硅基流动。更多媒体 API（包括图片编辑、音频翻译、嵌入和重排）见 [API.md](API.md#媒体与专用模型接口)，不一定都有实验室表单。

`moss-vl-1.0` 在当前上游接口属于**单轮视觉理解任务**，不进入普通文本对话或自动对话路由。使用媒体实验室「视觉理解」或同步 `/v1/responses`：一条文字指令搭配 1–5 张图片，或搭配 1 个视频；不能混用、不能仅发文字、不能设置 `stream=true`。素材可填写上游可访问的 HTTPS URL，或上游已经上传素材的 `file_id`；平台目前不提供视觉素材上传。

## 团队、价格和审计

「组织订阅」目前是**不启用付费墙的 BYOK 订阅框架**：现有租户继续使用自己的服务商密钥，模型费用由上游服务商收取。平台主账号可保存套餐草案，配置 API Key 数量、成员数量及对话／媒体／模型对比实验室权益，并手动分配内部试用套餐；租户所有者／管理员可查看本组织的规划权益。**所有权益限制目前仅展示、不执行**，不会拦截既有 Key、成员、实验室或模型调用。草案标价不构成账单，手动分配不代表已收款。当前没有微信／支付宝付款入口、自动续费、充值钱包或按 Token 扣费；正式售卖前需明确商户资料、定价、权益生效和存量租户迁移规则。订阅配置保存在 `data/subscriptions.json`，与账户和上游密钥一同备份。

成员通过邀请加入租户；所有者、管理员、成员、只读角色具有不同权限，详见 [TENANCY.md](TENANCY.md)。忘记密码时，所有者／管理员可为成员签发一次性重置码，通过安全渠道交付；系统不会自动发邮件。唯一所有者失去登录能力时，部署管理员需停机后使用 `scripts/reset-admin-password.mjs` 本地恢复。

首次初始化的账户是平台主账号：只有该账号的邮箱密码登录，或该账号已连接的**模思智能（默认租户）飞书身份**登录，才可查看、切换和管理全部租户。即使同一账号连接了其他企业飞书，从其他企业入口登录也只拥有该企业租户权限。只有平台主账号可为租户绑定／解绑飞书企业应用；其他同事只看到自己的租户，不能跨租户切换、创建或删除。本租户所有者／管理员可修改租户显示名称。默认租户和已绑定飞书应用的租户不可删除。升级后旧会话须重新登录，才会按新的登录来源取得权限。

飞书登录为可选功能。一个飞书企业自建应用仅服务其所在企业；多个独立企业可各自提供一枚企业自建应用，映射到平台中各自独立的租户：

1. 在[飞书开放平台](https://open.feishu.cn/app)使用企业自建应用，并将要登录的同事纳入应用发布版本的可用范围；在「安全设置 → 重定向 URL」添加 `https://你的访问地址/api/account/sso/feishu/callback`。
2. 第一家企业在本地 `.env` 填写 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI`，可用 `FEISHU_PROVIDER_LABEL` 设置名称。平台主账号可在「账户与租户 → 飞书企业绑定」给新租户添加应用，填写企业名称、App ID、App Secret 和可选 Tenant Key；配置在服务端加密保存，密钥不回显。已有 `FEISHU_ADDITIONAL_APPS_JSON` 配置仍可使用，平台内修改会覆盖对应租户的环境配置，解绑会停用该租户入口。各飞书应用都须登记**同一个** HTTPS 回调 URL。`App Secret` 不要提交到仓库或发送到聊天。对外 HTTPS 访问时设置 `COOKIE_SECURE=true`。
3. 登录页选择所属企业。平台内绑定的飞书企业应用默认允许该应用可用范围内的成员首次飞书登录时自动创建本租户普通账号，无需邀请码，也不要求飞书邮箱权限；平台主账号可在「账户与租户 → 飞书企业绑定」关闭自动加入。已有邮箱密码账户仍须先登录并在对应租户点「连接飞书账户」，**不会仅凭飞书返回的邮箱自动认领现有账户**。系统按 **App ID + Open ID + 平台租户**识别身份，不能跨企业进入别的租户。Tenant Key 不是 App Secret；它是可选的额外企业校验，可从飞书授权返回的用户身份信息中取得，不必在应用「凭证与基础信息」页寻找。未配置 Tenant Key 时仍以企业自建应用本身的可用范围为准；请确保应用已发布且可用范围符合预期。

**跨企业单入口迁移方案（尚未启用）：**若配置两家独立企业，目前各用一套企业自建应用。飞书 OAuth 发起时就要给出 App ID，因此网页无法在授权前可靠读取用户“当前所在企业”；把其中一家设为默认会让另一家员工进入错误授权流程。要实现真正的单个「使用飞书登录」入口，应申请一套可由两家企业分别安装/授权的跨企业应用，确认其网页授权与回调配置，然后在回调中验证飞书返回的 `tenant_key`，用服务端唯一映射表定位平台租户；未绑定的企业必须拒绝登录。迁移时保留旧入口至两家均安装并完成账户重新连接，不能用邮箱自动合并旧 App 的 Open ID。只有平台主账号能维护企业映射，模思主账号的跨租户权限仍须额外核验模思企业身份。**在该跨企业应用安装前，登录页保留企业选择；不把界面合并误称为自动识别。**

仅通过环境变量配置而未在平台内绑定的旧应用仍遵循 `FEISHU_AUTO_JOIN`（默认关闭）；开启时须配置 `FEISHU_ALLOWED_TENANT_KEY`，但不再强制要求邮箱字段权限。平台内绑定的应用以「允许本企业成员首次飞书登录时自动加入」开关为准，默认开启；每个应用只映射一个平台租户，已绑定应用的租户不能直接删除。[飞书应用类型说明](https://open.feishu.cn/document/home/app-types-introduction/robots-web-applications-and-mini-programs)

如果没有自有域名，但同事需要直接在浏览器访问，可用主机上的 [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) 获取固定的 `https://主机名.尾网名.ts.net` 地址，转发到本机 `127.0.0.1:3100`；同事无需安装 Tailscale。**Funnel 会把登录页公开到互联网**，不是仅对受邀者可见；应保持强密码和 HTTPS、严格管理飞书应用的可用范围，并持续运行主机与 Funnel。启用企业成员自动加入后，该应用可用范围内的成员无需邀请码即可访问对应租户。不要用随机临时隧道地址作为长期 OAuth 回调。

「请求日志」记录请求与上游尝试的元数据，不保存提示词或回复正文；「用量分析」展示成员、模型和 Key 用量及估算费用；「组织审计 → 租户操作」记录配置和成员操作，每个租户最多保留最近 2000 条。默认查看最近 7 天的管理变更、每页 10 条；例行成功飞书登录不再产生操作记录，既有的登录和旧版只读发现记录默认隐藏，勾选后仍可查。账户页不再重复铺开同一份审计。**仅平台主账号**可在租户操作页输入指定确认文字后清空**所有租户**的操作审计；此操作不可从平台恢复，不影响请求日志、用量、API Key、账号或实验室历史。租户所有者可以重置统计起点，或清除本租户请求日志与用量，操作本身会留下审计记录。

「模型实验室 → 历史记录」按当前账号和租户保存最近 100 条对话与媒体任务记录，支持服务端搜索（标题、模型、任务 ID）、状态筛选、排序和每页 20 条的分页。详情支持 Markdown、代码复制、性能指标、媒体预览、复制全文、JSON 导出与单条删除。列表不加载完整结果；展开历史面板后才读取和定时刷新，搜索使用防抖并取消过期请求。新对话记录按总容量保存文本，单条上限 256 KiB，超过时优先保留最近消息并明确提示截断；旧版未保存的内容无法补回。实验室不展示缓存命中指标，后台仍保留上游缓存用量用于费用统计。

视频历史仅在点击「刷新远程任务状态」后查询上游；结果链接失效时预览也可能不可用。历史存储在 `data/lab-history.sqlite`；首次升级会从旧 `data/lab-history.json` 自动迁移，旧文件保留作备份。切换工作区页面不会取消已发出的实验请求；视频任务保存任务 ID，可返回历史记录继续查询远端状态。浏览器刷新时尚未拿到任务 ID 的请求无法恢复；图片输入和语音二进制不保存在历史中。实验历史不属于请求日志，删除历史不会删除调用日志或用量统计。

经济优先使用已配置且有效的同币种价格做**预估**，不是结算系统。可以把 OpenRouter 模型报价导入其他服务商作为参考；手动价格和服务商自身报价优先，不会被参考价覆盖。导入时间是采集时间，平台建议复核期限不代表上游报价有效期。实际采购价、缓存命中、时段和多模态收费应以服务商账单为准。

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

其余选项和注释见 [.env.example](.env.example)。默认拒绝非安全上游和私网／保留地址访问；仅在了解风险时精确放行。上游密钥在服务端以 AES-256-GCM 加密保存，业务 Key 哈希保存。公网暴露时必须配置 HTTPS、可信反向代理和访问控制。

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
npm test               # 自动化测试
npm start              # 构建并启动本地服务
```

`scripts/smoke.mjs` 默认只检查就绪状态和可调用模型列表；`--live` 会发起一次可能计费的真实对话调用：

```sh
SWITCHBOARD_TOKEN=YOUR_API_KEY node scripts/smoke.mjs
SWITCHBOARD_TOKEN=YOUR_API_KEY node scripts/smoke.mjs --live
```

推送 `v*` 标签会触发 [Release 工作流](.github/workflows/release.yml)：运行检查和测试、构建并推送 GHCR 的 amd64／arm64 镜像、从对应 [CHANGELOG.md](CHANGELOG.md) 条目生成 Release 说明和归档附件。普通提交由 [CI 工作流](.github/workflows/ci.yml) 验证，**不会**自动发布新版本。发布步骤见 [发布维护说明](.github/RELEASING.md)，维护脚本用途见 [脚本索引](scripts/README.md)。

项目架构和模块边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。问题反馈请提交 [GitHub Issue](https://github.com/chensl139-ok/switchboard-ai-router/issues)；仓库维护邮箱：`15652641985@163.com`。
