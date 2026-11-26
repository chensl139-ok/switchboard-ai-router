# 升级与实例核对

文档版本：**3.1.1，2026-11-26**。使用固定版本命令前，先核对对应 Release／GHCR 产物存在且标签正确。参阅 [中文首页](../README.zh-CN.md)、[English](../README.md)、[更新记录](../CHANGELOG.md) 和 [发布维护](../.github/RELEASING.md)。

## 先明确实例

浏览器地址决定连接哪个服务。Docker 默认 `127.0.0.1:3100`；桌面 App 通常为 `127.0.0.1:3110`，端口被占用时以 App 菜单显示为准。公网地址可能转发到其他机器，更新本机不会自动更新公网。

Docker 默认挂载仓库 `data/`，配置来自本地 `.env`；macOS 使用 `~/Library/Application Support/Switchboard/` 中的配置档案和数据。Windows 路径及升级方式见 [Windows 桌面说明](../desktop/windows/README.md)。桌面和 Docker 共用核心代码，但数据独立；Docker 的组织 API 不会因此获得桌面个人订阅连接能力。

不允许多个进程读写同一数据目录。迁移前停止源与目标，完整备份，再按原结构迁移；不能只复制 SQLite 主文件、漏掉 master.key 或覆盖现有账号／飞书凭据。

## 判断是否同一版本

在「账户与租户 → 版本与运行环境」查看版本与构建指纹，或从源码目录运行：

```sh
npm run doctor -- --url http://127.0.0.1:3100
npm run doctor -- --url http://127.0.0.1:3100 --url http://127.0.0.1:3110
```

Doctor 只读 `/readyz` 与 `/api/account/status`，无需模型密钥，不产生模型调用。全部实例就绪且版本、指纹一致时返回 `consistent: true` 与退出码 0；不一致、旧版无指纹或连接失败返回非零。指纹比较核心程序与发布网页资源，不包含用户数据、凭据、原生外壳或构建时间，不能证明数据同步或所有业务功能通过验收。

## 首次工作台升级与数据迁移

3.1.1 汇总首次工作台功能及后续修复，不表示中间 2.3／3.0／3.1 曾正式发布。从旧网关／实验室版本升级时：

1. 停机备份完整配置和数据，特别是主密钥、账户、全部租户目录、飞书绑定与 SQLite 文件。备份含敏感内容，应限制访问。
2. 新版在原 `lab-history.sqlite` 内创建／迁移 `conversations` 和 `workspace_preferences`；原 history 保留，不批量自动变成会话。旧会话 titleMode 为 manual，防止自动标题覆盖原名。
3. 需要长期继续的旧记录应尽早显式导入：仅完整、已结束、没有工具链或缺失图片／视频等素材的文本聊天符合条件。导入保留原快照和 sourceHistoryId，同一用户／租户的相同来源去重；这不是任意 JSON 文件导入。
4. history 仍是每用户／租户最近 100 条、全局 5000 条短期快照；清理 history 不裁剪 conversations，也不能把旧快照保留策略当成新会话保证。
5. 会话正文、草稿与收藏按本人和当前租户隔离。单会话 1 MiB、单草稿 64 KiB，本人／租户 200 条及 32 MiB，租户合计 256 MiB、全局 1 GiB；包括归档，超限拒写而非静默删旧记录。载荷限制不等于磁盘文件上限。
6. 素材不永久保存；刷新缺附件或工具上下文时不能继续原上下文。导出 JSON／Markdown／文本可作内容副本，不代替完整实例备份；Markdown／文本默认不含思考，分享前检查 JSON 的私人内容。媒体结果链接可能过期，应及时下载。

保留已有 `.env`、初始化令牌、加密凭据、业务 Key、租户／路由及飞书配置，不为升级重新初始化平台。飞书别名入口会规范到配置的回调地址；在规范地址重新登录，核对域名／端口／路径、应用可用范围与默认租户身份。**本次真实飞书扫码 OAuth 尚未验证**，详见 [飞书配置](../TENANCY.md#飞书登录详解自托管运维向)。

## Docker 升级顺序

### 源码与 Compose

先处理本地修改，确认目标 tag 已发布。以下在原仓库目录操作，`git switch` 若因本地修改拒绝，不要强制覆盖：

```sh
git status --short
git fetch --tags
git switch --detach v3.1.1
docker compose build switchboard
# 构建成功后停止实例，再备份：
docker compose stop switchboard
umask 077
BACKUP_DIR="$HOME/switchboard-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$BACKUP_DIR"
cp -a .env data "$BACKUP_DIR/"
# 确认完整备份可用后重建容器：
docker compose up -d --build
docker compose ps
npm run doctor -- --url http://127.0.0.1:3100
```

如果实际数据目录或配置来源不同，按原挂载完整备份，不照搬默认路径。不要用 `docker compose down -v` 清理数据。源码构建以检出提交为准；仅 `git pull` 主分支不等于升级到某个稳定 Release。

### GHCR 的 docker run 部署

与 Compose 二选一。在原部署目录，先拉取已发布的明确版本／digest，再停止容器和备份：

```sh
docker pull ghcr.io/chensl139-ok/switchboard-ai-router:3.1.1
docker stop switchboard-ai-router
umask 077
BACKUP_DIR="$HOME/switchboard-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$BACKUP_DIR"
cp -a .env data "$BACKUP_DIR/"
```

确认备份后，可将停止的旧容器改名留存，再按 [README 的 docker run 示例](../README.zh-CN.md#使用预构建镜像) 用原名称创建新容器，镜像固定为 `3.1.1` 或已核对 digest，**保留部署原有的端口、环境文件、卷、网络与其他选项**。不要直接在仍占用原名称的旧容器旁重复执行示例，也不要让旧容器与新容器共用目录运行。检查 `/healthz`、`/readyz` 和 doctor。

`latest` 只在稳定发布成功后更新；main 上手动触发镜像工作流仅发布 `main` 与 `sha-<完整 SHA>`，不覆盖 `latest`／稳定版本标签、不创建 Release。`v*` Release 流程发布双架构 `X.Y.Z`／`X.Y`／`latest` 及源码 ZIP／TGZ、OCI、SHA256SUMS。离线附件先核对校验值，再使用支持 OCI 的工具导入；不要把 OCI 包当作任意 Docker save 格式。

## 升级后的功能核对

以下是待执行的检查单，不是通过记录。真实模型调用需另行授权并接受可能计费；模拟账号和模拟上游不构成性能基准。

- 登录正确实例与租户，检查原服务商、业务 Key、飞书配置、模型目录和原有历史仍在；不要在截图或日志中输出凭据。
- 打开空白新会话并切换／刷新，不增加空记录；首次文字草稿保存后可恢复，首次发送得到本地自动标题，旧手动标题保持。
- 重命名、置顶、归档、搜索与收藏只影响本人当前租户；viewer 写入被拒绝。
- 删除已保存会话后刷新，不出现替代空记录；排队保存不能复活已删会话。404 清本地，409 重新加载并确认；网络失败留本地，不显示假成功。
- 创建结果不确定时先导出本地副本，再刷新按 ID 核对；不要盲目重复创建或按同名标题删除。
- 多页修改触发 CAS 冲突时不静默覆盖。运行租约 120 秒、25 秒续租、5 秒输出检查点；过期后显式恢复，不自动重发生成。
- 用户编辑只生成新分支草稿，助手重试确认费用后新建分支，原文不变；检查 JSON／Markdown／文本导出和默认思考过滤。
- 导入合格旧文本历史，缺素材／工具的记录不假装可恢复；媒体查询不触发重新生成，过期 URL 不显示为永久文件。

可重复的源码验证命令：

```sh
npm ci
npm run check
npm test
npm run demo
```

不预报测试数量、真实上游成功或 OAuth 结果。主发布验收应记录实际命令、环境、结果与未验证项。

## 回退与桌面升级

回退先停新实例，保留失败现场的独立副本，再恢复**匹配旧代码的完整备份**和配置，最后启动对应旧镜像；不要让旧版直接打开已迁移的数据结构。备份之后新增的会话不会自动出现在旧备份中，必要时先导出可读内容。

macOS 退出 App 后备份完整应用支持目录，再替换 `/Applications/Switchboard.app`。安装包不含用户数据；程序替换与数据迁移是不同步骤。确认运行实例与指纹后再清理重复 App，保留原始备份。Windows 按其桌面指南升级，同样先退出并备份独立数据。两者都不会自动更新远端 Docker 服务。
