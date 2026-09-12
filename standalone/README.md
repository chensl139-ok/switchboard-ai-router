# Switchboard 实时网关

支持 SSE、WebSocket 与标准 HTTP 的单实例网关。运行 `npm ci`，复制 `.env.example` 为 `.env` 并配置两个随机令牌，再 `npm start`。

完整协议、部署方法与限制见 [实时网关文档](../docs/realtime.md)。服务商密钥在本机加密保存，目录 data 必须持久化并备份，不与妙搭配置同步。
