# 统一模型 API

外部调用使用产品中签发的租户 API Key。接口共享租户隔离、Key 有效期、配额、全局并发和路由策略，不提供匿名调用。

## 3 步开始

1. 在平台「API Key 管理」创建当前组织的 Key；完整值仅展示一次。
2. 在「服务商与模型」启用上游并注册模型；`auto` 表示按本组织的路由策略选择模型。
3. 在本地终端设置 `ROUTER_API_KEY`，执行下方请求：

```sh
export ROUTER_API_KEY='你的平台调用密钥'
curl -sS 'http://127.0.0.1:3100/v1/chat/completions' \
  -H "Authorization: Bearer $ROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"max_tokens":128}'
```

应返回包含 `choices` 的 JSON。非本机调用时将 `127.0.0.1` 换成实际可访问的 HTTPS 域名。完整可交互说明位于控制台 `/#api`。

## 接口矩阵

| 接口 | 支持范围 | 流式 |
| --- | --- | --- |
| POST /v1/chat/completions | OpenAI Chat：文本、图片、函数工具与结果 | OpenAI chat.completion.chunk + [DONE] |
| POST /v1/responses | 无状态 Responses：文本、input_image、function_call/output | Responses 命名 SSE 事件 |
| POST /v1/completions | 单个文本 prompt，单个生成结果 | text_completion + [DONE] |
| POST /v1/messages | Anthropic Messages：文本、image、tool_use/result | Anthropic 命名 SSE 事件 |
| POST /v1/messages/count_tokens | 仅原生 Anthropic 上游真实计数 | 否 |
| GET /v1/models | 当前租户已启用的可调用模型 | 否 |
| GET /v1/models/{id} | 单个模型信息，id 建议 URL 编码 | 否 |
| GET /v1/models/discover | 查询当前租户已启用服务商的完整模型目录 | 否 |

鉴权可以使用 `Authorization: Bearer KEY` 或 `x-api-key: KEY`；两者同时存在时必须相同。
Anthropic SDK 自动携带 `anthropic-version`，模型列表将返回 Anthropic 分页结构；不带此头时返回 OpenAI 列表结构。

## 模型 ID 与路由

客户端协议与上游协议相互独立。同一平台 Key 可调用 Chat Completions、Responses、Messages；网关先将请求规范化，再按实际服务商模型适配上游，最后转换回客户端协议。接入向导不再按上游协议限制模型列表；只有对话模型可用于这些客户端。

路由页以“首选模型 → 失败后怎么办”为主线。失败时可自动挑选备用、手动指定模型顺序，或不换模型；进阶选路、关键词例外和调用限制默认收起。右侧按当前草稿检查真实顺序，不请求上游、不保存设置，只有「保存并生效」会影响后续调用。个人实验室默认继承团队设置，只保存覆盖项；订阅凭证仍仅限本人，不进入业务 API Key 调用链。

管理接口 `/api/routing` 的 `routing.primaryModel` 可指定 `active` 服务商内的首选模型，不改变服务商自身的当前模型。`routing.backupMode="selected"` 与 `routing.backups=[{"providerId":"backup-provider","model":"model-id"}]` 表示严格手动备用顺序，需使用 `fallback` 策略；不会隐式加入列表外的其他模型（已启用的关键词例外除外）。备用密钥同样占用尝试次数。`POST /api/routing/preview` 可携带完整 `policy` 检查草稿；不携带时检查已保存策略。外部调用的 `provider::model` 固定语义不变。

- `auto`：使用当前租户路由策略。
- `siliconflow` 等服务商 ID：固定服务商的当前模型。
- `siliconflow::zai-org/GLM-5.3`：固定服务商及已注册模型。
- 原始模型名称：仅当在已启用服务商中唯一匹配时可用；重名时要求使用 `provider::model`。

指定 `model` 为服务商 ID 并提供 `upstream_model` 时，默认将该模型作为起始目标；后台故障转移策略可尝试同服务商其他模型。加上 `allow_fallback: true` 可显式启用高可用候选链，在其他策略下也会继续尝试同服务商其他模型及其他服务商。模型实验室选定模型时自动使用此选项。`provider::model` 始终固定模型，仅允许同模型备用密钥容灾。已开始输出的流不会跨模型拼接。

查询模型不会自动启用全部模型。「模型目录」中可一键查询，然后逐个加入调用列表。查询会处理已支持的分页，最多 3 个服务商并发、45 秒总期限；返回每个服务商的成功/失败状态，不把部分结果说成全部成功。管理员查询包含已配置密钥但未启用的服务商；外部 Key 查询只查询已启用服务商。缓存中的新模型需在 24 小时内注册，修改密钥/地址/协议会使旧目录失效。

模型目录不是能力保证：视觉输入、工具调用和思考能力最终仍取决于具体模型与服务商。应先使用具备相关能力的模型验收，再对外开放。

## SDK

示例统一使用 `ROUTER_API_KEY` 环境变量，避免误用机器环境中已有的 OpenAI/Anthropic 供应商密钥。

```python
import os
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:3100/v1", api_key=os.environ["ROUTER_API_KEY"])
response = client.responses.create(model="auto", input="你好", store=False)
print(response.output_text)
```

```python
import os
from anthropic import Anthropic
client = Anthropic(base_url="http://127.0.0.1:3100", api_key=os.environ["ROUTER_API_KEY"])
message = client.messages.create(
    model="auto", max_tokens=512,
    messages=[{"role": "user", "content": "你好"}]
)
print(message.content)
```

如果机器设置了额外的 ANTHROPIC_AUTH_TOKEN，需清除它或显式禁用 SDK 的 authToken，避免与路由 Key 冲突。Node 示例已设置 authToken:null。

### Codex CLI（基础 Responses 兼容）

在用户级 `~/.codex/config.toml` 配置自定义提供商；模型 ID 要替换为本组织明确支持 Responses 的已注册模型，不建议使用 `auto`：

```toml
model_provider = "switchboard"
model = "auto"

[model_providers.switchboard]
name = "Switchboard"
base_url = "http://127.0.0.1:3100/v1"
env_key = "SWITCHBOARD_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
```

运行前在本地设置 `SWITCHBOARD_API_KEY`。`auto` 按组织策略选路，`provider::model` 固定模型；上游不必使用 Responses 协议。网关目前只实现无状态 Responses 子集；思考参数、推理历史、服务端会话续接、内置／自定义工具等尚未完整适配，**不保证 Codex CLI 完整功能可用**。先验证简单对话与函数工具，不支持的请求会明确报错。配置字段以 [Codex 官方文档](https://developers.openai.com/codex/config-reference)为准。

### Claude Code CLI（Messages 入口）

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:3100"
export ANTHROPIC_AUTH_TOKEN="$ROUTER_API_KEY"
export ANTHROPIC_MODEL="auto"
claude
```

`auto` 使用组织路由，可改为 `provider::model` 固定模型；网关根据目标上游自动转换协议。`ANTHROPIC_BASE_URL` 是网关根地址，**不加 `/v1`**。Anthropic 官方不支持把 Claude Code 路由到非 Claude 模型，基础请求可转换不代表官方或完整兼容。复杂工具调用、原生 Token 计数等需单独验证；计数接口仍要求 Anthropic 上游，不把估算值伪装成原生计数。此方案针对 CLI，而非 Claude 桌面端。参阅 [Claude Code 网关接入说明](https://code.claude.com/docs/en/llm-gateway-connect)。

需要长期使用时，可将相同变量放入用户级 `~/.claude/settings.json` 的 `env` 中（以下为示范，请替换 Key 和模型 ID）：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://switchboard.tail7fa45b.ts.net",
    "ANTHROPIC_AUTH_TOKEN": "替换为本组织的 Switchboard API Key",
    "ANTHROPIC_MODEL": "auto"
  }
}
```

若文件已存在，只合并 `env` 字段，不要覆盖其他 Claude Code 设置。此方式会在本机以明文保存 Key；不要将 Key 放进可能被提交的项目级 `.claude/settings.json`。启动 `claude` 后用 `/status` 核对网关地址和认证来源。Claude 桌面 App 不读取这份 CLI 配置，应在其第三方推理设置中单独配置。[官方持久化配置说明](https://code.claude.com/docs/en/llm-gateway-connect#set-in-a-settings-file)

`ANTHROPIC_AUTH_TOKEN` **只填写平台签发的完整原始 Key**，不要写 `Bearer ` 前缀，也不要使用服务商的上游密钥。Claude Code 会自动生成 `Authorization: Bearer <Key>`。若已有自己的权限、插件或主题设置，仅合并上述 `env` 属性；不要把示例当成整份文件覆盖。`CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576` 不是网关所需项，只有选定模型确实支持 1M 上下文时才能设置。

先在本机设置 `ROUTER_API_KEY`，做一个不消耗生成次数的鉴权检查：

```sh
curl -sS 'https://switchboard.tail7fa45b.ts.net/v1/models' \
  -H "Authorization: Bearer $ROUTER_API_KEY"
```

通过后运行 `claude doctor`，进入 Claude Code 用 `/status` 检查 Base URL 和凭据来源，再执行 `claude -p 'Reply exactly OK.'` 进行最小调用。`401 Authorization 重复包含 Bearer` 说明配置值多写了前缀；`401 API Key 无效` 说明格式已通过，但 Key 与当前租户已保存的有效 Key 不匹配，可在「API Key 管理」创建新 Key。错误响应不会回显密钥；如需排查，请记录 `x-request-id`。

**关于自动路由：** `model=auto` 可能命中 Kimi 等非 Claude 模型。平台支持附加 `system` 消息和 `adaptive` 思考参数，但简单对话／函数工具的协议互转测试不等同于完整 Claude Code 端到端验收。严格按官方支持范围部署时，应固定已注册的 Claude 模型，或将组织候选配置为 Claude 模型；不要把任意模型的自动路由当作完整 Claude Code 兼容保证。[Claude Code 网关兼容说明](https://code.claude.com/docs/en/llm-gateway)

## 图片

Chat 使用 `image_url`；Responses 使用 `input_image`；Messages 使用 `image.source`（url 或 base64）。可使用 PNG/JPEG/GIF/WebP Base64 或 HTTP(S) 图片 URL。网关将图片转发给模型服务商，不自行下载 URL，不执行图片中的内容。

```json
{
  "model": "provider::vision-model",
  "messages": [{"role": "user", "content": [
    {"type": "text", "text": "描述这张图片"},
    {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
  ]}],
  "stream": true
}
```

请求体（包含历史和 Base64）上限 10 MB。实验室可附加最多四张图片，单张最多 4 MB，总请求仍受 10 MB 限制。
经济优先暂不估算图片输入费用：含图片时请显式指定模型或使用其他策略，避免错误地声称该请求是最低价。

## 工具

支持调用方执行的 function 工具，不包含内置搜索、代码执行或浏览器工具。

1. 请求中提供 tools/schema。
2. 读取模型返回的调用 ID、函数名称和 JSON 参数。
3. 在自己的应用中验证参数、执行已注册工具。
4. 带原调用 ID 回传结果，继续请求模型。

OpenAI Chat 使用 `assistant.tool_calls` 和 `role:tool/tool_call_id`；Responses 使用 `function_call` 和 `function_call_output/call_id`；Messages 使用 `tool_use` 与 `tool_result/tool_use_id`。网关不执行工具，也不会 eval 模型输出。示例中的 add 工具只在调用方显式执行两个数字相加。

支持多工具调用及流式 JSON 参数增量。图片型工具结果可用于 Anthropic/Responses 上游；Chat Completions 上游不支持该类型时会明确拒绝。
实验室允许填写工具定义并查看模型请求的工具调用；工具执行和结果回传需由 API 客户端完成。

## Kimi K3 视频理解

对话实验室选择 `kimi-k3` 后可添加本地视频，并在同一对话继续追问。媒体实验室也提供独立的视觉理解任务。默认采用抽帧理解：MP4/WebM/MOV，最大 6 MB、10 分钟，最多 12 帧，附带时间戳；不含音轨，可能遗漏短暂事件。对话使用固定模型，不回退至其他模型；历史只保留文字，不保存视频和图片，恢复时需重新添加素材。

原生视频是否可用取决于渠道；支持图片或文本不代表支持 `video_url`。当前验证的 MOSS 渠道接受抽帧输入，原生视频返回 400。支持原生视频的渠道可使用：

```sh
curl http://127.0.0.1:3100/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"provider::kimi-k3","allow_fallback":false,"max_tokens":8192,"messages":[{"role":"user","content":[{"type":"text","text":"描述视频中的变化"},{"type":"video_url","video_url":{"url":"ms://YOUR_FILE_ID"}}]}]}'
```

将 `provider` 替换为服务商 ID。`ms://` 文件必须来自同一上游账号的 `purpose=video` 上传，且必须指定服务商并关闭回退；平台不代理文件上传接口。网关也接受 HTTPS 视频地址及不超过 6 MB 的视频 Base64，但需上游明确支持对应格式。参考 [Kimi 官方视觉输入说明](https://platform.kimi.com/docs/guide/use-kimi-vision-model)。

## 上游协议选择

服务商配置中可选 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages。相同的对外入口可转换到这三种上游。选择 Responses 时上游 Base URL 仍以 `/v1` 或相应 API 根路径结束，网关会追加 `/responses`。

原生 Anthropic 请求/响应保留思考块；原生到原生的流式事件直接透传，并继续核对用量。跨协议不会伪造 Anthropic 思考签名。显式 Anthropic thinking budget 仅支持 Anthropic 上游。

## 明确不支持

- 聊天消息中的音频内容块、通用文档文件存储、内置工具。视频输入仅适用于支持原生 `video_url` 的 Kimi K3 Chat Completions 上游，不转换为 Anthropic / Responses。图片／语音／视频生成使用下方专用媒体接口。
- Responses 服务端会话：previous_response_id、conversation、background、store=true。
- 传统 Completions 的多 prompt、token 数组、n>1、best_of、echo。
- logprobs、JSON schema 结构化输出、模型特有的 reasoning 参数；现有 thinking_mode 扩展仍按模型能力校验。
- 官方 Realtime 音频协议：`/v1/realtime` 是本项目的 WebSocket 协议，不冒充 OpenAI Realtime。

不支持的内容类型会返回 400/501，不静默把图片/工具转换成空文本。流中发生错误时发送错误事件且不发送完成事件；已经输出内容后不会换模型拼接。

参考：[OpenAI 流式响应](https://developers.openai.com/api/docs/guides/streaming-responses)、[OpenAI 函数工具](https://developers.openai.com/api/docs/guides/function-calling)、[Anthropic 流式 Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)。

### 一次获取所有服务商模型

```sh
curl 'http://127.0.0.1:3100/v1/models/all' \
  -H "Authorization: Bearer $ROUTER_API_KEY"
```

返回统一的 `data` 列表，`id` 为 `provider::model`，`callable` 表示是否已配置可调用。只查询 Key 所属租户已启用的服务商，不自动注册模型；没有 Key 的私有服务商无法查询。最长等待 45 秒，10 秒内限制一次，与 `/v1/models/discover` 共用限频；查询不消耗生成次数额度。部分查询失败时 HTTP 200 且 `partial: true`，具体见 `errors`，不能将其视为完整列表。`/v1/models` 仍用于获取已经配置可调用的模型。

`GET /v1/openapi.json` 提供模型查询、生成与 Token 计数的 OpenAPI 3.1 文档，使用同样的 API Key 鉴权。示例 3100 为本地端口，其他部署请替换地址。

产品内完整文档入口：`/#api`。支持接口目录跳转、cURL / Python / WebSocket 示例复制，以及下载自动填入当前部署地址的 OpenAPI JSON。WebSocket 为自定义协议，在文档与 OpenAPI 扩展字段 x-websocket 中描述。管理 /api/* 接口使用账户会话，不接受外部调用 Key。

## Cherry Studio

本地 Compose 部署的 API 地址为 `http://127.0.0.1:3100/v1`，使用平台签发的 Key；其他部署请替换为实际域名与端口。API 地址不要包含 `/chat/completions` 或 `/models`。标准获取模型列表访问 `/v1/models`，仅列出已配置的可调用模型；完整上游目录请调用 `/v1/models/all`。

Cherry Studio 若能聊天但无法获取模型列表，请先检查客户端代理与本地地址的绕过规则；本机部署通常应绕过 `localhost,127.0.0.1,::1`。不要照抄其他机器的代理端口。

## 媒体与专用模型接口

除通用对话接口外，平台还提供下列专用接口；在「媒体实验室」可测试图片生成、语音合成、音频转文字、视频生成和视觉理解任务。

| POST 接口 | 输入与输出 |
| --- | --- |
| /v1/images/generations | JSON，model + prompt；返回 data 图片列表，硅基流动同时保留 images |
| /v1/images/edits | 兼容上游 multipart 图片编辑；硅基流动请在 generations 使用 image 字段 |
| /v1/audio/speech | JSON，model + input + 模型适配的 voice；返回音频二进制，非 SSE |
| /v1/audio/transcriptions | multipart，model + file；返回转录 |
| /v1/audio/translations | 兼容上游的 multipart 翻译；取决于服务商支持 |
| /v1/video/submit | 硅基流动 JSON 视频提交；返回网关 requestId |
| /v1/video/status | 使用提交返回的 requestId 轮询，返回 status / results |
| /v1/embeddings | 兼容上游 JSON 向量嵌入 |
| /v1/rerank | 兼容上游 JSON 重排 |
| /v1/responses（MOSS-VL 专用用法） | 单轮视觉理解：一条文字指令 + 1～5 张图片，或一段视频；同步返回文本 |

`moss-vl-1.0` 属于视觉语言模型架构，但 [MOSS 官方接口](https://platform.mosi.cn/docs/reference/responses/)将它作为图片／视频理解任务提供：必须使用 `/v1/responses`，不能只发文本、不能混合图片与视频、不能流式输出。它不进入普通对话模型列表或 `auto` 对话路由。先在服务商中注册模型，然后在媒体实验室选择「视觉理解」，或使用下列请求；图片／视频地址必须为 HTTPS，也可使用上游已上传文件的 `file_id`。

```json
{
  "model": "moss::moss-vl-1.0",
  "input": [{"role": "user", "content": [
    {"type": "input_text", "text": "描述这张图片"},
    {"type": "input_image", "image_url": "https://example.com/photo.jpg"}
  ]}],
  "max_output_tokens": 1024
}
```

必须显式指定已注册模型，例如 `siliconflow::Kwai-Kolors/Kolors`，不支持 auto。JSON 上限 10 MB；multipart 上限 52 MB；单音频文件上限 50 MB；一般媒体上游超时 180 秒，MOSS 图片生成等待上限为 15 分钟；音频响应上限 64 MB。不自动回退或重试，避免重复生成。生成使用共同 Key 配额；视频轮询不扣生成次数，但受频率和并发限制。

MOSS 图片表单支持水印、同请求内提示词增强、种子、推理步数、引导系数与反向提示词，参数按具体上游校验，保留显式 0／false；历史保存提交参数，不把增强失败当成生成成功。提示词增强不是独立的对话／生图候选模型。

硅基流动图片请求将 n / size 转换为 batch_size / image_size，支持 URL；请求 response_format=b64_json 时，网关从 HTTPS 结果地址读取图片并转为 Base64（不向图片地址转发上游密钥，总图片大小限制 24 MB）。链接有效期由服务商决定，请及时保存。

视频仅适配硅基流动异步协议，不等同于 OpenAI Videos API。任务在网关持久化 24 小时，仅提交 Key / 账户及当前租户管理员可查询；上游链接可能提前过期。提交后的任务可能继续在上游执行，取消本地等待不保证取消视频生成。**查询已有任务与重新生成是不同操作**，重新生成会提交新请求、可能再次计费；查询成功不保证结果 URL 仍有效。

```sh
curl 'http://127.0.0.1:3100/v1/audio/transcriptions' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -F 'model=siliconflow::FunAudioLLM/SenseVoiceSmall' \
  -F 'file=@recording.wav'
```

图片按张价格可用于成功图片生成的费用估算；语音／视频若没有可核实计价，则记录未知费用。未开通或未注册对应模型仍会失败；查询目录并加入调用列表后再调用。

## 任务关联、输出验收与成本追踪

普通 Chat / Responses / Messages / Completions 的 HTTP 和 SSE 请求支持可选请求头 `X-Task-ID`。同一业务任务的后续重试复用此 ID；每次进入网关仍生成独立 `x-request-id`，每次上游尝试有独立 `x-attempt-id`。ID 为 1–128 位字母、数字、点、冒号、下划线或短横线；省略时任务 ID 等于请求 ID。

```sh
curl -sS -D response-headers.txt 'http://127.0.0.1:3100/v1/chat/completions' \
  -H "Authorization: Bearer $ROUTER_API_KEY" \
  -H 'X-Task-ID: extraction-001' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"返回一个 JSON 对象"}]}'

# 从响应头 x-request-id 读取实际值。由调用方解析输出后反馈：
REQUEST_ID='替换为实际请求ID'
curl -sS "http://127.0.0.1:3100/v1/requests/$REQUEST_ID/feedback" \
  -H "Authorization: Bearer $ROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"outcome":"rejected","reason":"parse_error"}'

# 再次生成时沿用 X-Task-ID，可按业务需要指定备用模型；
# 新请求验收通过后，向它自己的反馈地址提交 {"outcome":"accepted"}。
curl -sS 'http://127.0.0.1:3100/v1/tasks/extraction-001' \
  -H "Authorization: Bearer $ROUTER_API_KEY"
```

- **调用结果与输出验收分开**：HTTP 200 不等于业务成功，流式调用需检查结束与错误事件。反馈只允许 `accepted` 或 `rejected`；拒绝时 `reason` 必填：`parse_error`、`schema_error`、`business_error` 或 `other`。不接收回复正文、提示词或错误堆栈。
- **反馈不可篡改历史**：仅原调用 Key 对正常完成请求反馈；相同结果重复提交幂等，不同结果返回 409。未完成或调用失败也返回 409。反馈不触发模型调用、不消耗次数、不改变服务商健康度。后续尝试创建新请求，不改写前次结果。
- **身份隔离**：任务按租户与 API Key 隔离，同名 ID 在不同 Key 下独立。账户会话按用户隔离，不与该用户的业务 Key 混合。控制台管理员可查看本租户任务，成员仅查看自己的调用。不存在或无权访问均返回 404。
- **汇总口径**：`elapsedMs` 为首次请求开始至最后活动的跨度（包含重试间隔与验收等待），`attemptLatencyMs` 是所有上游尝试耗时之和，并发可能重叠。`costs` 按币种分别累计，包含验收失败的调用；`unknownCostAttempts` / `unknownUsageAttempts` 单独标识未知项，不能当作免费。
- **状态**：有运行中请求为 `running`；否则按最新发起请求显示 `gateway_failed`、`unverified`、`accepted` 或 `rejected`。后续通过不会删除早先验收失败记录。旧的分析成功率仍衡量网关调用，不是业务验收成功率。
- **边界**：任务 ID 不是幂等键，不自动重试、去重或排除之前模型；每次生成都可能计费。一个任务最多 1000 次请求，超过返回 409。保留期 90 天，清除日志同时清除任务记录；旧日志不推断补齐。媒体生成、专用视觉理解以及 WebSocket 的自定义任务关联尚不支持；媒体入口携带此头会返回 400，避免产生“已关联”的误解。

请求日志新增“输出验收”筛选，搜索支持任务 ID；展开详情可进入任务汇总，汇总不受分页和当前筛选限制。OpenAPI 包含反馈与查询接口；完整交互说明见控制台“API 文档 → 任务追踪与验收”。

## 工作台会话与偏好接口

本节对应 **3.1.1 文档（2026-11-26）**。这是账户管理 API，不是 `/v1/responses` 服务端会话，也不会使 `previous_response_id`、`store=true` 或 Codex 完整会话能力变为可用。

使用同源账户 session Cookie，并发送 `X-Tenant-ID` 核对当前租户；Header 不能切换或扩大授权范围，业务 API Key 不能代替 session。POST 使用 `Content-Type: application/json`。所有会话、来源历史与收藏都限定为**本人 + 当前租户**，管理员不因此获得他人的会话访问权。viewer 可读本人记录，但所有写入（包括删除、导入、运行与收藏）返回 403。

以下会话路径均以 `/api/account/conversations` 为前缀：

| 方法与后缀 | 输入 | 响应／语义 |
| --- | --- | --- |
| GET 根路径 | `q`、`archived=false\|true\|all`、`page`、`limit` | 分页摘要与本人容量 |
| GET `/item?id=<UUID>` | 会话 ID | 完整记录；不存在或非本人返回 404 |
| POST 根路径 | 可选 `title`、`messages`、`draft`、`settings` | 显式创建，返回完整记录，`revision=1` |
| POST `/update` | `id`、`expectedRevision`，及待修改字段 | 更新标题／正文／草稿／设置／`pinned`／`archived`，返回新 revision |
| POST `/delete` | `id`、`expectedRevision` | 删除非运行记录，返回 `{ "ok": true }` |
| POST `/import` | `{ "historyId": "<UUID>" }` | 将符合条件的旧历史导入，返回会话 |
| POST `/run/start` | `id`、`expectedRevision`、`messages`、`draft`、`settings` | 设置 running，返回 `runId` 与 `leaseUntil` |
| POST `/run/checkpoint` | start 字段 + `runId` | 保存当前文本并续租，返回新 revision |
| POST `/run/finish` | checkpoint 字段 + `status` | `completed`／`failed`／`stopped`，清除运行凭证与租约 |
| POST `/run/recover` | `id`、`expectedRevision` | 仅已过期的 running 可恢复为 interrupted，不发起模型调用 |

列表默认 `page=1`、`limit=20`、`archived=false`，limit 为 1–100，q 最多 200 字符，搜索标题、草稿及消息；置顶优先，再按最近更新时间排序。返回结构如下（空列表示例，不代表实际使用量）：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "pages": 1,
  "usage": {
    "count": 0,
    "bytes": 0,
    "limits": {
      "count": 200,
      "bytes": 33554432,
      "conversationBytes": 1048576,
      "draftBytes": 65536
    }
  }
}
```

`usage` 统计本人在当前租户的全部会话，不随搜索或归档过滤变化。列表仅含摘要；`/item` 和创建／更新／运行响应是记录本身，不额外包在 `item` 内。完整记录包括 `id`、`title`、`titleMode`、`messages`、`draft`、`settings`、`pinned`、`archived`、`status`、`revision`、`runId`、`leaseUntil`、`bytes`、`sourceHistoryId`、`createdAt`、`updatedAt`。时间戳字段 createdAt／updatedAt 为 ISO 文本，leaseUntil 为毫秒时间戳或 null。

### 保存、标题和运行约束

- 可创建的文本消息为 `user`／`assistant` + 字符串 `content`，可保留思考及受限路由／统计元数据。缺失附件使用 `missingAttachments` 标记；工具调用只保存标记，不是可恢复的完整工具执行链。不要提交二进制、Data URL 或 blob 素材作为会话存储。
- `settings` 支持 `target`、`transport`（sse／ws／http）、`thinking`（auto／enabled／disabled）、`showThinking`、`maxTokens`（1–131072）和最多 16 KiB 的 JSON 数组字符串 `tools`。保存工具定义不等于恢复工具结果。
- `title` 最多 180 字符；`titleMode` 由服务端管理，客户端赋值不生效。空标题／默认“新对话”新记录使用 auto，start 时可从首条用户文本生成标题，不调用上游；显式改标题、导入与旧记录使用 manual，不自动改名。
- 服务端 POST 根路径是**显式创建**，可以创建空记录；“打开空白新会话不落库”是工作台的客户端保存策略，不是服务端禁止空记录。普通 autosave 等到文字输入；明确 metadata／branch／start 可强制持久化。客户端 `force` 不构成服务端越过 CAS 的参数。
- 对已有记录的写入必须带最新 `expectedRevision`，每次成功更新递增 revision；不得拿旧值重试覆盖。start／checkpoint／finish 都要求完整的 messages、draft、settings。运行接口只管理持久化状态，实际模型生成是独立网关调用。
- start 不能用于已运行或已归档会话；归档需先取消。运行中只能通过带同一 `runId` 的 checkpoint／finish 保存，不能普通 update 或 delete。租约 120 秒，客户端 25 秒续租、输出按 5 秒间隔做检查点；这不是逐 Token 同步或后台继续生成保证。
- checkpoint 必须持有效租约；过期需显式 recover，旧 runId 失效。finish 校验 revision 与 runId 并清理租约。刷新／恢复不自动重发生成请求。

### 限额、冲突与删除

单会话序列化 `{title,messages,draft,settings}` 最多 1 MiB；draft 最多 64 KiB（UTF-8）。本人在当前租户最多 200 条／32 MiB，包含归档；租户合计 256 MiB、全局 1 GiB。这些是载荷限额，不是 SQLite 文件大小承诺。条数上限返回 409，容量超限返回 413；不会静默删除旧会话。

- 404：不存在或无权访问；删除时清除本地失效记录即可，不建立替代项。
- 409：可能是 revision／租户上下文冲突、运行状态或条数上限，需按错误信息重新加载核对；删除冲突必须再次确认，不自动采用新版 revision 删除。
- 网络／响应解析失败：保留本地内容，不当成服务端已删除或已保存。创建没有自动幂等保证，结果不确定时先导出本地副本并刷新列表核对 ID，不盲目重建、不按标题猜删。
- 客户端以 deleting／deleted 保护队列竞态；删除不调用 new + flush 保存替代记录。服务端运行状态或 CAS 检查仍是最终约束。

### 历史导入、分支、导出与收藏

旧 history 仍保留每用户／租户最近 100 条、全局 5000 条快照，清理它不会裁剪 conversations。import 只接受本人当前租户的完整已结束聊天快照，拒绝截断、缺失附件、工具链或未完成记录；保留原历史，保存 `sourceHistoryId`，同一来源已有会话时返回该会话，不重复创建。它是旧 history 导入接口，不是任意 JSON 文件上传接口。

用户消息编辑在客户端创建新分支草稿，不自动发送；助手重试确认费用后新建分支并调用模型，不覆盖旧回答。导出为客户端 JSON／Markdown／文本操作，不是额外服务端导出路由；Markdown／文本默认不含思考，JSON 分享前须检查敏感内容。刷新后缺素材或工具上下文不能继续原上下文，工作台不是永久媒体仓库。

`GET /api/account/workspace/preferences` 返回 `{ "revision": 0, "favorites": [] }`（尚无偏好时）。`POST` 同路径以 CAS **替换完整收藏列表**：

```json
{ "expectedRevision": 0, "favorites": ["provider-id::model-id"] }
```

成功返回递增后的 `{revision,favorites}`；冲突 409，先重新读取再确认合并。最多 200 个字符串，每个不超过 512 字符。收藏属于本人当前租户，不会启用模型、改变路由或取得模型调用权限。

验证命令与升级顺序见 [OPERATIONS](docs/OPERATIONS.md)，权限见 [TENANCY](TENANCY.md)。本次文档不新增测试数量、真实上游或 OAuth 成功结论；文中历史渠道观察也不保证当前供应商状态。
