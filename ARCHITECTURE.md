# 架构说明

本文对应 3.1.1（2026-11-26），描述工作台与网关边界；可用发布产物以 GitHub Release 为准。部署与迁移见 [OPERATIONS](docs/OPERATIONS.md)，协议见 [API](API.md)，权限见 [TENANCY](TENANCY.md)。

## 选择：模块化单体

一个 Node.js 进程提供账户、控制台、模型网关、持久会话与用量记录。工作台／网关双区是交互和职责划分，不是拆分服务，也不要求迁移到新的基础设施。继续使用现有数据卷，保留账户、凭据、飞书绑定、路由和用量。

传输层保留 Node 原生 HTTP／SSE／WebSocket。Node 22.18+ 运行仅含可擦除类型的 TypeScript 模块；Vue 3 用于模型对比，Vite 负责生产构建，其余控制台仍以原生 ES Modules 为主，不宣称全面迁移 Vue／TypeScript。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `platform.mjs` | 平台入口、账户／当前租户上下文、工作台账户接口分发与 viewer 写入拦截 |
| `server.mjs` | 网关 HTTP 入口、业务鉴权、限额、调用编排和配置接口 |
| `lab-history.mjs` | SQLite 短期 history、持久 conversations、个人 workspace_preferences；事务、CAS、租约、容量与归属检查 |
| `routing.mjs`、`provider-key.ts` | 模型候选选择、订阅／计量密钥渠道 |
| `upstream-adapter.mjs` | 上游协议路径、负载和认证头 |
| `protocols.mjs`、`protocol-stream.mjs` | Chat、Responses、Anthropic 输入输出转换 |
| `pricing.mjs`、`usage-store.mjs` | 参考费用估算、请求尝试与用量持久化 |
| `public/app.js` | 工作台／网关导航、角色和租户上下文、页面生命周期 |
| `public/conversations.js` | 个人会话请求、串行保存队列、revision／runId、续租与删除竞态保护 |
| `public/playground.js`、`public/lab-request.ts` | 对话界面、请求构造、生成状态和结果标准化 |
| `public/ModelCompare.vue`、`public/model-compare.js` | 多模型比较、并发／导出以及组件挂载与卸载 |
| `public/analytics.js` | 用量摘要、连续日期趋势与模型明细 |
| `public/style.css`、`public/interface.css` | 共享组件与主题变量、布局、响应式和深色模式 |

网关调用：客户端 → 鉴权／租户／配额 → 路由模型与凭据 → 协议适配 → 安全网络访问 → 响应与用量。实验室不接触服务商密钥；对比中每个模型独立发请求，不共享上下文，最多并发两个。个人订阅连接限授权用户当前租户的个人调用，不进入组织业务 Key 链路。

控制台按权限和当前页加载模块；异步响应需与账号、租户和页面生命周期匹配，避免迟到结果覆盖新页面。个人订阅目录后台补齐不能重置对话和草稿。明暗主题共享布局与语义变量，不以主题规则重复定义不同尺寸。

## 会话持久化与运行状态

`/api/account/conversations*` 使用账户 session 和 `X-Tenant-ID`，服务端以当前 userId／tenantId 查询，所有写入拒绝 viewer。外部业务 Key 不提供这些能力；它们也不是 Responses 的服务端 conversation 功能。

- `history`：旧实验快照，每用户／租户最近 100 条、全局 5000 条，单条结果上限 256 KiB。保留原记录语义，裁剪仅作用于 history。
- `conversations`：持续可编辑的个人会话，包含文本、草稿、设置、状态、revision 和受限元数据。最大 1 MiB／条，64 KiB／草稿；每用户／租户 200 条及 32 MiB，租户合计 256 MiB、全局 1 GiB。限额按载荷计算，不是数据库文件大小；不通过静默裁剪释放容量。
- `workspace_preferences`：按用户／租户存储带 revision 的 favorites，CAS 替换，不改变模型权限或共享路由。

启动在现有 `lab-history.sqlite` 内建表／迁移，旧 titleMode 默认 manual。新 auto 标题从首条用户文本本地提取，不调用模型；显式改名或历史导入保持 manual，客户端不能直接指定 titleMode。完整、已结束、无缺失附件和工具链的旧聊天快照可显式导入，以来源 ID 和用户／租户唯一约束去重，不全量搬迁 history。

写入使用 SQLite 事务核对 `expectedRevision`，成功更新递增 revision。start 创建 `runId` 和 120 秒 lease；checkpoint 校验 runId／revision／租约并延长租约；finish 校验运行凭证和版本，写最终状态并清除凭证；recover 仅将过期 running 改为 interrupted。运行中拒绝普通更新和删除，归档记录须先取消归档才能 start。运行 API 不执行模型生成，也不承诺浏览器退出后后台续跑。

客户端每 25 秒续租，输出按 5 秒间隔做检查点，串行队列使用服务器返回的最新 revision。空白新会话只驻留本地，普通保存等待首次文字；明确 metadata／branch／start 可强制保存。force 仅控制客户端是否持久化，不绕过服务端 CAS。

删除在队列中以 deleting／deleted 阻止新保存和迟到结果复活记录，不通过 new + flush 创建替代项。404 可清除本地失效项；409 需重新读取并由用户确认，不能自动“升级 revision 再删”；网络失败保留本地。创建响应不确定时不盲目重发或按标题猜删，提示导出并刷新核对 ID。

用户消息编辑只生成新分支草稿；助手重试确认可能计费后新建分支，不修改原文。JSON／Markdown／文本导出在客户端完成，Markdown／文本默认不含思考。媒体输入不永久保存，工具仅保留受限标记而非执行链；刷新后缺失上下文不能按纯文本假装恢复。媒体状态查询与重新生成分离，链接有效期取决于上游。

## 部署与数据

Docker 多阶段构建生成 `public/build/`，运行镜像只安装生产依赖，不包含 `.env`、用户 `data/` 或演示截图。桌面与 Docker 共用核心代码和构建指纹，但有独立运行时数据与桌面专属能力；相同版本／指纹不是数据同步证明。

这是单实例设计，不支持多个进程共享同一目录。升级前停机，完整备份配置与全部 data（含 master.key、账户／租户配置、SQLite 及其相关文件）；丢失主密钥会使上游凭据无法解密。保留飞书回调和绑定配置，回退恢复匹配旧代码的完整备份，不直接让旧版打开迁移后的数据库。

请求／操作日志不保存提示词与回复正文；会话、草稿及实验历史保存文本，备份和导出包含私人内容。租户隔离不防御有文件访问权的宿主机管理员。

## 验证边界

可重复执行 `npm ci`、`npm run check`、`npm test`；`npm run demo` 使用临时账号和模拟上游，`npm run doctor -- --url http://127.0.0.1:3100` 只读核对已运行实例。应覆盖空白不落库、删除竞态、网络不确定结果、多页 CAS、租约恢复、分支、限额、隔离和旧库迁移。

本文件不预报测试数量或本次真实上游结果。模拟测试和截图不是性能／账单基准，真实飞书扫码 OAuth 尚未验证；真实模型可用性取决于账号、额度、渠道和网络。Responses／CLI 兼容子集不构成完整 Codex 或非 Claude 模型的官方 Claude Code 支持保证。
