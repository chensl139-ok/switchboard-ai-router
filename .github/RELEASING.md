# 发布维护

## 什么时候发布

- 日常代码和文档提交进入 `main`，由 `ci.yml` 验证；**仅修改文档不创建新 tag 或 Release**。
- 将经过验证、值得部署的变更合并为一个语义化版本；紧急故障修复可以单独发布补丁版本。不要为每次界面微调都创建 Release。
- 不重新使用已公开的版本号或让 tag 改指其他提交；需要修复时发布下一个版本。

## 发布前检查

1. 更新 `package.json` / `package-lock.json`、`compose.yaml` 的镜像版本，以及 `public/index.html` 的静态资源版本参数。
2. 在 `CHANGELOG.md` 顶部增加对应版本和面向用户的说明，更新 `README.md` 的最新版本链接与部署命令。
3. 运行 `npm run check`、`npm test`；按变更范围做本地 Docker 和真实界面/API 验收。上游调用可能计费，应明确区分模拟测试与真实调用。
4. 推送 `main` 后创建并推送 `vX.Y.Z` 标签。`release.yml` 会再次验证、构建 `linux/amd64` 与 `linux/arm64` 镜像、推送 GHCR，并发布含说明和校验值的 GitHub Release。
5. 核对工作流完成状态、Release 正文与附件、GHCR 多架构清单。
6. 如果只保留当前版 GHCR 镜像，应在新镜像可拉取且依赖方已迁移后，再单独清理旧版标签和旧无标签构建；Release 工作流不会自动删除历史镜像。不要删除当前镜像索引关联的架构清单与证明清单。

## 版本清理

当前工作流为 Release 附加源码归档、离线 OCI 镜像包和 `SHA256SUMS`。删除 Release 会使其附件链接失效，但不会自动删除 Git tag 或 GHCR 镜像。清理旧版本前须先验证新版本可部署，再分别核对这三类资源；不要删除当前镜像的多架构子清单。
