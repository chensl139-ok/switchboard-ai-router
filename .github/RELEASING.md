# 发布维护

## 本次目标与发布状态

文档暂定 **3.1.1，2026-11-26**，用于首次工作台整合发布与会话可靠性补丁。此文件不代表 tag、GHCR 或 GitHub Release 已创建，也不将中间开发版本 2.3／3.0／3.1 追认为正式发布。

发布负责人应在获得发布授权后核对远端版号是否占用；若 3.1.1 已公开，选下一个可用补丁号并统一调整文档和版本元数据。**不复用公开版号、不移动既有 tag、不覆盖历史 Release。** 本次文档编辑本身不触发提交、部署或发布。

此前 Unreleased 累积功能已并入 [CHANGELOG 的 3.1.1 条目](../CHANGELOG.md)，保留既有历史版本。功能证据见[验收矩阵](../docs/VALIDATION.md)；公开产物是否可用须另行检查，不能只根据源码版号判断。

## 发布渠道

| 触发 | 校验与产物 | 不会做什么 |
| --- | --- | --- |
| 普通 main 提交 | `ci.yml` 校验 | 不自动发镜像或 Release |
| main 上手动 `workflow_dispatch` | `image-main.yml` 校验测试与隔离容器验证，推送 `main` 和 `sha-<完整提交 SHA>` | 不覆盖 `latest`／稳定版号，不创建 Release |
| `v*` 版本标签 | `release.yml` 校验测试，发布稳定镜像与 Release 归档 | 不自动清理历史镜像 |
| Windows 手动构建 | 独立桌面 ZIP 工作流附件（保留 14 天） | 不自动附加到既有 Release |

GHCR 仓库为 `ghcr.io/chensl139-ok/switchboard-ai-router`，稳定标签为 `X.Y.Z`、`X.Y`、`latest`，支持 `linux/amd64` 与 `linux/arm64`。本次目标对应 `3.1.1`、`3.1`、`latest`，仅工作流成功后才可用。精确部署优先记录 digest；`main` 与移动的 minor／latest 标签不能替代提交溯源。

Release 附件包括**源码 ZIP／TGZ、离线 OCI 镜像包、SHA256SUMS**。主分支镜像、桌面安装器、稳定 Release 是不同产物，不能互相冒充。

## 发布前检查

1. 确认提交范围和实际版本号，处理本地修改；不要为了发布文档丢弃其他人的源码或测试改动。仅文档修改通常不单独创建新 Release。
2. 由发布负责人同步 `package.json`／`package-lock.json`、`compose.yaml` 镜像版本、`public/index.html` 静态资源版本参数等实际版本元数据。release.yml 会预检目标 tag、包版本和 CHANGELOG 条目一致。
3. 同步双语 README 的发布状态、固定镜像与安装示例、CHANGELOG 条目、API／TENANCY／ARCHITECTURE、[运维说明](../docs/OPERATIONS.md)和[演示说明](../docs/demo/README.md)。首次工作台发布须说明数据库迁移、备份／回退、旧 history 与 conversations 的不同保留策略。
4. 执行可重复校验，按实际输出记录结果，不预填测试数量或成功结论：

   ```sh
   npm ci
   npm run check
   npm test
   npm run demo
   npm run doctor -- --url http://127.0.0.1:3100
   ```

   doctor 需要对应实例已启动；demo 使用隔离模拟账号／上游，不是性能、真实账单或供应商可用性验证。真实调用可能计费，须单独授权和记录；**真实飞书扫码 OAuth 当前未验证**。
5. 验收本地容器与真实界面：空白不落库、首次输入保存、删除不产生替代记录、队列竞态、404／409／网络失败、创建结果不确定提示、多页 CAS、租约恢复、分支与费用确认、导出、容量、收藏及跨用户／租户隔离。保留原飞书和凭据配置，检查旧库迁移及匹配备份回退，详见运维清单。
6. 更新 `docs/demo/{providers,routing,playground,history,connect,analytics}.jpg` 和新增 `workspace.jpg` 后，核对双语引用与实际画面；使用虚构账号和模拟上游，不带真实密钥、内部地址或私人对话。文档先引用素材不等于已完成截图验收。
7. 获得发布授权、确认验证边界后，再由发布负责人推送 main 与新的 `vX.Y.Z` 标签；发布工作流再次校验测试、构建双架构、推送 GHCR 并从对应 CHANGELOG 条目生成 Release 说明。
8. 工作流完成后检查实际 Release 正文、附件、SHA256 校验、GHCR 双架构清单与 digest，并使用干净数据验证启动及既有数据副本验证升级。仅看到绿色 CI 不等于所有发布产物已可用。

README 应明确 Docker 是组织 BYOK 网关，桌面个人订阅仅对授权用户当前租户开放，不进入业务 Key；不要把协议子集写成完整 Codex 支持，也不要扩大供应商官方支持承诺。

## 历史产物与清理

不要在发布新版本时顺手删除历史 tag、Release 或 GHCR。若确需清理，应单独获得授权，先确认新版本可拉取、可部署且依赖方已迁移，再分别核对三类资源。删除 Release 会使附件链接失效，不会自动删除 tag 或镜像；清理镜像时不得删除当前多架构索引所依赖的子清单与证明清单。

需要长期保留的桌面工作流附件应及时下载到受控位置；备份、演示数据和任何真实凭据不得打入公开产物。
