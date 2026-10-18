# Windows 桌面版

Windows 版使用 WinForms / Microsoft WebView2 原生窗口，内置独立 Node 运行环境。不需要自行安装 Docker、Node 或 npm，也不打包一份完整 Chromium。

## 安装

1. 在 Windows 电脑上解压 `Switchboard-<版本>-Windows-x64.zip`。不要直接在压缩包内运行程序。
2. 双击其中的 `Switchboard-<版本>-Windows-x64-Setup.exe`，按向导完成当前用户安装。
3. 从开始菜单的 Switchboard 打开。首次启动创建本机管理员账户，再配置服务商；已有账号数据在升级时保留。

安装器只安装程序；分享 ZIP 不会共享发送者的账号、模型密钥、个人订阅授权或历史。每台电脑是独立平台，若需要多人共用组织，应访问同一中心部署地址。

系统要求：Windows 10 / 11 **x64**、.NET Framework 4.8，以及 Microsoft Edge WebView2 Evergreen Runtime。当前不提供 Windows ARM64 或 32 位包。缺少系统组件时按提示从 Microsoft 官方网站安装，不要从不明站点下载 DLL。

当前构建尚无 Windows Authenticode 代码签名，下载或启动时可能出现 SmartScreen 提示；这不等同于已经通过 Microsoft 信誉认证。企业电脑应由 IT 核验来源、校验值并按安全策略部署，不要关闭系统防护。

## 数据与升级

- 程序安装在当前用户的应用程序目录；用户数据在 `%LOCALAPPDATA%\Switchboard`，与程序分开保存。
- 升级前退出 Switchboard；运行新安装器替换程序。卸载程序保留用户数据，不会清除账号、密钥和实验历史。
- 备份前退出 App，再复制完整数据目录。该目录含凭证，不应随安装包分发。
- 关闭窗口后保留托盘图标和本机 API；从托盘或应用菜单选择“退出”才会停止服务。
- 本机 API 默认 `http://127.0.0.1:3110/v1`，端口占用时以 App 显示的地址为准。它不向其他电脑开放。

飞书登录仍需在各企业应用配置本机回调 `http://127.0.0.1:3110/api/account/sso/feishu/callback`。授权由系统浏览器完成，再回到 App；不要把企业密钥发给其他人。Windows 的 `switchboard:` 回调由安装器为当前用户注册，卸载时移除。个人订阅的隔离与调用范围与 [桌面版说明](../README.md#个人订阅连接本机预览)一致。

## 构建和验证

在 Windows 构建环境准备 Node.js ≥ 22.18、.NET SDK 与 Inno Setup，执行：

```sh
npm ci
npm run check
npm test
npm run build:windows
```

`Windows desktop` GitHub Actions 工作流可手动运行；它构建 Windows x64 安装器，检查打包内容，使用隔离数据目录验证启动、页面加载、退出、安装和卸载。生成的安装包、ZIP 与 SHA256 校验文件位于 `dist/windows/`，作为 Actions 构建附件保存，不会自动创建 Release 或版本标签。

安装包使用官方 Node 发布归档并核对 SHA256，保留 Node 和依赖许可证。不复制 `.env`、`data/`、开发依赖或本机账号信息。WebView2 使用系统运行时；打包 SDK 加载器不代表已经内置浏览器运行时。

自动化测试使用模拟上游与临时账户，不代表已替用户完成真实飞书授权、订阅登录或实际计费模型调用。
