# README 演示素材

`workspace.png` 是当前主分支工作台截图（2026-10-18，浏览器视口 1280 × 900），供中英文 README 共用。截图使用独立测试租户、虚构服务商和本机模拟上游；不含生产账号、真实密钥或用户请求内容。

更新截图时应使用隔离数据目录，不连接生产数据库或真实模型凭证；先验收页面，再保存未经内容修改的截图。检查截图不含个人信息、令牌和内部地址，并同步更新两份 README 的引用。

## switchboard-tour.gif

旧版控制台导览 GIF（9 帧，约 0.7 MB），保留供素材制作参考；不代表当前界面，也不参与应用运行或桌面打包。README 已改用新版截图。

### 如何重新生成截图帧

要求：本机装有 Google Chrome，Node.js ≥ 22.18。

```sh
# 1. 启动一个演示实例（独立数据目录，不污染真实部署）
ADMIN_TOKEN=$(openssl rand -hex 24) GATEWAY_TOKEN=$(openssl rand -hex 24) \
  HOST=127.0.0.1 PORT=3199 DATA_DIR=/tmp/switchboard-demo-data node platform.mjs

# 2. 在另一个终端运行截图脚本（自动建号、配置演示服务商并逐页截图）
cd docs/demo
AMIN_TOKEN=<上一步的令牌> node shoot.mjs
```

脚本输出 `docs/demo/frames/*.png`（1440×900 @2x）。注意演示密钥均为 `sk-demo-…` 假值，不要替换为真实密钥——截图会被提交到公开仓库。

合成 GIF（Python + Pillow）见 `make_gif.py`；目标 < 5 MB、宽度 1120px、每帧 1.6–3.2s。

### 更好的一版：手录 60 秒 GIF（v2 素材）

可用录屏工具制作带鼠标轨迹的短视频；以下为旧版脚本参考，必须使用虚构演示数据，不可录入真实密钥：

| 时间 | 画面 | 台词/强调 |
| --- | --- | --- |
| 0–8s | 终端：`npm run setup` + `docker compose up -d` | "5 分钟自托管"（配合 demo.tape 终端段） |
| 8–18s | 打开隔离演示实例，添加本机模拟服务商，点「获取模型」，勾选 3 个模型保存 | "填地址和密钥即完成接入" |
| 18–30s | 路由策略页切换「故障转移」，打开路由预览输入一句话，展示候选排序与熔断说明 | "路由透明可预览，不调用上游" |
| 30–45s | 模型实验室发一句"你好"，SSE 流式输出，展示 TTFB/TTFT/TPS 指标与 x-router 命中头 | "看得见实际命中谁" |
| 45–52s | 多模型对比：同一题 3 模型并排出结果 | |
| 52–60s | API Key 页创建 key → Cherry Studio 填 base_url 接入 | "改 base_url 即可" |

录制要点：窗口 1440×900、缩放 100%、关闭通知；转 GIF 用 `ffmpeg -i in.mov -vf "fps=12,scale=1120:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" out.gif`。

## demo.tape

终端部分可用 [VHS](https://github.com/charmbracelet/vhs) 自动录制：

```sh
brew install vhs ffmpeg ttyd
vhs docs/demo/demo.tape   # 输出 docs/demo/demo-terminal.gif
```
