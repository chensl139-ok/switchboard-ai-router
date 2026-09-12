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
