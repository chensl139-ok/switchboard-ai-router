# Switchboard

自托管的多服务商 AI 模型路由网关。用一个 API 接入已配置的模型，在控制台管理路由、密钥、成员和用量，并在模型实验室验证调用效果。

[![CI](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/chensl139-ok/switchboard-ai-router/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chensl139-ok/switchboard-ai-router)](https://github.com/chensl139-ok/switchboard-ai-router/releases/latest)
[![GHCR](https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/chensl139-ok/switchboard-ai-router/pkgs/container/switchboard-ai-router)

[v2.0.1 Release](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.0.1) · [更新记录](CHANGELOG.md) · [API 细节](API.md) · [租户与权限](TENANCY.md) · [架构](ARCHITECTURE.md)

## 能做什么

| 模块 | 能力 |
| --- | --- |
| 模型路由 | 固定、故障转移、加权、延迟优先、关键词规则、经济优先；服务商内不同模型及跨服务商回退 |
| 协议网关 | OpenAI Chat Completions / Responses / Legacy Completions、Anthropic Messages、SSE，以及自建 WebSocket 文本协议 |
| 服务商与模型 | 配置上游地址和主／备密钥，获取并选择可调用模型，按模型自动匹配协议 |
| 模型实验室 | 对话、同题多模型对比、图片／音频／视频任务、视觉理解；显示实际命中模型、失败原因和可测得的延迟指标 |
| 团队管理 | 邮箱密码或飞书 OAuth 登录、邀请、角色、租户隔离、操作审计、密码重置 |
| 运营观测 | 业务 API Key 配额、请求日志、最终成功率、用量、费用估算与模型价格 |

这是**单实例部署**：配置和账户使用本地文件，用量使用 SQLite，限流和部分状态在进程内。不要让多个进程或容器同时读写同一个 `data/` 目录。对外服务请置于 HTTPS 反向代理之后，做好数据备份和访问控制。

当前发布版本为 v2.0.1。GHCR 提供 `2.0.1`、`2.0` 和 `latest` 镜像标签；升级前请备份数据，并核对实际运行的镜像版本。GitHub 仍保留 [v1.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.0)、[v1.1.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v1.1.0) 和 [v2.0.0](https://github.com/chensl139-ok/switchboard-ai-router/releases/tag/v2.0.0) 的 tag 与 Release，但这些版本的 GHCR 在线镜像已清理。

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
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:2.0.1
docker run -d --name switchboard-ai-router \
  --restart unless-stopped \
  -p 127.0.0.1:3100:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 -e DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  ghcr.io/chensl139-ok/switchboard-ai-router:2.0.1
```

上述 `docker run` 与 Compose 是**两种部署方式，二选一**，不要同时启动占用 3100 端口的实例。Release 另提供源码包、离线 OCI 镜像包和 `SHA256SUMS`。

不用 Docker 时运行 `npm ci && npm run setup && npm start`；默认端口为 3000，可在 `.env` 设置 `HOST=127.0.0.1`、`PORT=3100`。

## 首次配置与调用

1. 在「服务商与模型」添加上游 Base URL 和 API Key；获取模型列表，勾选需要开放的模型并保存。支持自定义兼容服务商，同一服务商可添加备用密钥。
2. 在「路由策略」选择默认服务商、候选顺序、策略和最多尝试次数。路由预览只计算候选，不向上游发送请求。
3. 在「模型实验室」调用模型，确认实际命中、协议、输出和错误信息。媒体任务应选择对应的图片、音频、视频或视觉理解入口。
4. 在「API Key 管理」为应用创建 Key、设置有效期和配额。明文仅在创建时显示一次。

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

成员通过邀请加入租户；所有者、管理员、成员、只读角色具有不同权限，详见 [TENANCY.md](TENANCY.md)。忘记密码时，所有者／管理员可为成员签发一次性重置码，通过安全渠道交付；系统不会自动发邮件。唯一所有者失去登录能力时，部署管理员需停机后使用 `scripts/reset-admin-password.mjs` 本地恢复。

飞书登录为可选功能：创建企业自建应用，配置网页 OAuth 回调 `/api/account/sso/feishu/callback`，在 `.env` 填写 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_REDIRECT_URI` 后重启。默认仍需邀请；若要同企业自动加入，先配置 `FEISHU_ALLOWED_TENANT_KEY`，再启用 `FEISHU_AUTO_JOIN=true`。不要在没有租户限制时开放自动加入。

「请求日志」记录请求与上游尝试的元数据，不保存提示词或回复正文；「用量分析」展示成员、模型和 Key 用量及估算费用；「租户操作审计」记录配置和成员操作。租户所有者可以重置统计起点，或清除本租户请求日志与用量，操作本身会留下审计记录。

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
