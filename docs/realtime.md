# 自建 SSE / WebSocket

`standalone/` 是独立服务，使用自己的 `.env`、API Key 和加密存储；与妙搭配置不自动同步。

```sh
cd standalone
cp .env.example .env
# 分别生成并填写 ADMIN_TOKEN 和 GATEWAY_TOKEN，至少 24 位：openssl rand -hex 32
npm ci
npm start
# 或 docker compose up -d --build
```

在本机 `http://127.0.0.1:3000` 登录后配置模型，实验室可选择 SSE / WebSocket / HTTP。

## SSE

```sh
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_GATEWAY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

返回 OpenAI 风格 `data: {...}` 增量，成功终态是 `data: [DONE]`。输出首个增量后禁止换模型重试，失败以 error 事件结束。Anthropic Messages 流转换为同一格式。

## WebSocket

连接 `wss://你的网关域名/v1/realtime`，5 秒内发送认证消息（不将密钥放进 URL）：

```json
{"type":"auth","token":"YOUR_GATEWAY_TOKEN"}
```

收到 `ready` 后：

```json
{"type":"chat","id":"request-1","input":{"model":"auto","messages":[{"role":"user","content":"你好"}]}}
```

增量：`{type:"delta",id,chunk}`；完成：`{type:"done",id}`；错误：`{type:"error",id,message}`。
发送 `{type:"cancel",id:"request-1"}` 取消。每连接只允许一个生成请求，服务端有 ping/pong 心跳与慢客户端缓冲上限。

## Nginx 反向代理示例

已有 HTTPS server 块中加入：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 75s;
}
```

跨域浏览器 WebSocket 需要设置精确的 `WS_ALLOWED_ORIGINS`（逗号分隔）；默认只接受同源和无 Origin 的客户端，所有连接仍须令牌认证。SSE 默认同源，不公开宽泛 CORS。

实时网关目前保留单实例本地存储（30 秒请求总超时、每分钟 60 次、5 并发）。需要多副本时应先将配置和限流迁到共享存储。妙搭官方文档限制自建长连接，因此独立网关须部署到支持长连接的 Docker/VPS/Kubernetes 环境；当前任务没有提供此类服务器，尚未公网托管实时网关。

## 对外 HTTPS/WSS 一键部署

准备一台允许 80/443 入站的 Docker 服务器，以及指向该服务器的域名。
在 `standalone/.env` 配置新的 ADMIN_TOKEN、GATEWAY_TOKEN 和 GATEWAY_DOMAIN（只填域名，不含协议），然后：

```sh
docker compose -f compose.public.yaml up -d --build
```

Caddy 自动申请 HTTPS 证书，SSE 禁用缓冲，WebSocket 自动升级。网关的 3000 端口只在容器网络中暴露。
首次打开 `https://你的域名` 配置此独立网关的服务商与默认路由。

外部地址：
- SSE：`POST https://你的域名/v1/chat/completions`，`stream: true`
- WebSocket：`wss://你的域名/v1/realtime`

此处使用独立网关的 `GATEWAY_TOKEN`，不是妙搭开放 API 密钥。当前网关配置独立，auto 使用其本机路由设置，不会自动读取妙搭策略。

可运行客户端示例：

```sh
export GATEWAY_URL=https://你的域名
# 在环境中设置 GATEWAY_TOKEN，避免写入源代码或分享的命令历史。
node examples/stream.mjs sse
node examples/stream.mjs ws
```

示例校验完成事件，连接截断会报错；Ctrl+C 取消。未提供服务器和域名前，不存在可用的公网实时地址。
