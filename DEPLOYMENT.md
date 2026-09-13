# 部署前检查

1. Node.js >=22.13 或 Docker + Compose v2 可用。
2. 当前只运行一个副本，数据目录在持久化磁盘上。
3. ADMIN_TOKEN 与 GATEWAY_TOKEN 使用不同随机值，生产密钥不提交到 Git。
4. 公网入口启用 HTTPS/WSS；反向代理不缓冲 SSE，并允许 WebSocket Upgrade。
5. 从 `/healthz` 验证服务；再登录产品配置服务商，使用一次真实生成验收。
6. 配置业务专用 API Key 的配额和有效期，按需关闭旧环境令牌。
7. 备份整个 data；首次升级先备份，检查 `.env` 和原始主密钥保持不变。

## Render

点击 README 部署按钮，登录 Render 并确认部署配置。Blueprint 会配置 1GB 持久磁盘、单实例和自动生成令牌。登录令牌在 Render 环境变量中查看。

## Railway

在 Railway 新建项目 → Deploy from GitHub repo → 选择本仓库。添加 Volume 挂载 `/app/data`，设置 ADMIN_TOKEN、GATEWAY_TOKEN、HOST=0.0.0.0、DATA_DIR=/app/data。保持单副本，创建服务域名。Railway 配置文件不能替代 Volume 的创建。

## Fly.io

安装并登录 flyctl，然后在根目录运行：

```sh
fly launch --no-deploy
fly volumes create router_data --region sin --size 1
# 在 Fly 控制台或 fly secrets import 设置 ADMIN_TOKEN / GATEWAY_TOKEN
fly deploy --ha=false
```

保持一个 Machine，并确认挂载正确。跨区域多卷不会自动同步配置，不能作为横向扩容方案。

## 通用 Docker 平台

使用根目录 Dockerfile；容器内部端口默认 3000（支持平台注入 PORT）；健康路径 `/healthz`。
在服务配置中添加两个令牌和持久卷 `/app/data`。权限初始化依赖容器启动用户对挂载目录可写；若平台强制非 root 用户，预先将挂载目录属主设置为 uid 1000。
