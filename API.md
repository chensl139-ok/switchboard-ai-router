# 统一模型 API

外部调用使用产品中签发的租户 API Key。接口共享租户隔离、Key 有效期、配额、全局并发和路由策略，不提供匿名调用。

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
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:3100/v1", api_key="YOUR_ROUTER_KEY")
response = client.responses.create(model="auto", input="你好", store=False)
print(response.output_text)
```

```python
from anthropic import Anthropic
client = Anthropic(base_url="http://127.0.0.1:3100", api_key="YOUR_ROUTER_KEY")
message = client.messages.create(
    model="auto", max_tokens=512,
    messages=[{"role": "user", "content": "你好"}]
)
print(message.content)
```

如果机器设置了额外的 ANTHROPIC_AUTH_TOKEN，需清除它或显式禁用 SDK 的 authToken，避免与路由 Key 冲突。Node 示例已设置 authToken:null。

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

## 上游协议选择

服务商配置中可选 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages。相同的对外入口可转换到这三种上游。选择 Responses 时上游 Base URL 仍以 `/v1` 或相应 API 根路径结束，网关会追加 `/responses`。

原生 Anthropic 请求/响应保留思考块；原生到原生的流式事件直接透传，并继续核对用量。跨协议不会伪造 Anthropic 思考签名。显式 Anthropic thinking budget 仅支持 Anthropic 上游。

## 明确不支持

- 聊天消息中的音视频内容块、通用文档文件存储、内置工具。图片／语音／视频生成使用下方专用媒体接口。
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

本机已验证 API 地址 `http://127.0.0.1:3100/v1`，使用平台签发的 Key。旧的 3000 端口由 Grafana 使用。API 地址不要包含 `/chat/completions` 或 `/models`。标准获取模型列表访问 `/v1/models`，仅列出已配置的可调用模型；完整上游目录请调用 `/v1/models/all`。

Cherry Studio 若能聊天但无法获取模型列表，请检查代理绕过规则。本机复现的错误为列表请求经过系统代理后断开；改用原代理地址的自定义代理，并明确绕过 `localhost,127.0.0.1,::1` 后已验证成功。保留原有绕过规则，不要照抄其他机器的代理端口。

## 媒体与专用模型接口

3.2 版加入专用接口；在「媒体实验室」可测试图片生成、语音合成、音频转文字和视频任务。

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

必须显式指定已注册模型，例如 `siliconflow::Kwai-Kolors/Kolors`，不支持 auto。JSON 上限 10 MB；multipart 上限 52 MB；单音频文件上限 50 MB；单次上游超时 180 秒，音频响应上限 64 MB。不自动回退或重试，避免重复生成。生成使用共同 Key 配额；视频轮询不扣生成次数，但受频率和并发限制。

硅基流动图片请求将 n / size 转换为 batch_size / image_size，支持 URL；请求 response_format=b64_json 时，网关从 HTTPS 结果地址读取图片并转为 Base64（不向图片地址转发上游密钥，总图片大小限制 24 MB）。链接有效期由服务商决定，请及时保存。

视频仅适配硅基流动异步协议，不等同于 OpenAI Videos API。任务在网关持久化 24 小时，仅提交 Key / 账户及当前租户管理员可查询；上游链接可能提前过期。提交后的任务可能继续在上游执行，取消本地等待不保证取消视频生成。

```sh
curl 'http://127.0.0.1:3100/v1/audio/transcriptions' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -F 'model=siliconflow::FunAudioLLM/SenseVoiceSmall' \
  -F 'file=@recording.wav'
```

图片按张价格可用于成功图片生成的费用估算；语音／视频若没有可核实计价，则记录未知费用。未开通或未注册对应模型仍会失败；查询目录并加入调用列表后再调用。
