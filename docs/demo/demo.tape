# Switchboard 终端演示（VHS tape）
# 用法：brew install vhs ffmpeg ttyd 之后，在仓库根目录执行：vhs docs/demo/demo.tape
# 输出 docs/demo/demo-terminal.gif（建议压缩到 < 5MB 再替换 README 中的链接或作为补充）

Output docs/demo/demo-terminal.gif

Set FontSize 16
Set Width 1280
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 24
Set Shell "zsh"

Type "git clone https://github.com/chensl139-ok/switchboard-ai-router.git"
Sleep 600ms
Enter
Type "cd switchboard-ai-router"
Sleep 400ms
Enter
Type "npm run setup   # 生成 ADMIN_TOKEN / GATEWAY_TOKEN（仅在 .env 不存在时）"
Sleep 900ms
Enter
Sleep 800ms
Type "docker compose up -d --build"
Sleep 500ms
Enter
Sleep 3500ms
Type "docker compose ps"
Enter
Sleep 1500ms
Type "curl -s http://127.0.0.1:3100/readyz"
Sleep 500ms
Enter
Sleep 800ms
Type "open http://127.0.0.1:3100   # 用 .env 里的 ADMIN_TOKEN 初始化管理员账户"
Sleep 700ms
Enter
Sleep 1200ms
Type "# 配置服务商与模型后，创建业务 Key，然后任意 OpenAI 兼容端点接入："
Sleep 900ms
Enter
Type 'curl http://127.0.0.1:3100/v1/chat/completions -H "Authorization: Bearer YOUR_KEY" -d ''
Sleep 200ms
Type '"{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"'
Sleep 1200ms
Enter
Sleep 2500ms
