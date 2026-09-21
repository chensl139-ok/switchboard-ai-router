# 架构说明

## 选择：模块化单体

当前平台以一个 Node.js 进程提供网关、控制台、认证与用量记录。对于本地单机 Docker 部署，拆分为微服务会增加密钥分发、网络跳转和数据一致性成本，却不能改善当前最主要的协议适配与实验室可维护性问题。因此保留单一进程和现有 `data/` 卷，按职责拆分模块，不要求用户迁移密钥、价格或历史记录。

语言与框架采用渐进迁移。网关传输层保留 Node 原生 HTTP/SSE/WebSocket：现有流式、升级握手和多租户请求分发已经紧密集成，替换为通用 Web 框架在当前规模下收益有限、回归风险较高。业务边界从 TypeScript 开始，Node 22.18+ 直接运行仅含可擦除类型的 `.ts` 模块；Vue 3 用于交互最密集的模型对比界面，Vite 负责生产构建。其余控制台模块仍为原生 ES Modules，按页面逐步迁移，不宣称已全面转成 Vue/TypeScript。

## 边界

| 模块 | 职责 |
| --- | --- |
| `server.mjs` | HTTP 入口、鉴权、调用编排、配置接口 |
| `routing.mjs`、`provider-key.ts` | 候选模型选择、订阅/计量密钥渠道 |
| `upstream-adapter.mjs` | 每个模型的上游协议路径、负载与认证头 |
| `protocols.mjs`、`protocol-stream.mjs` | OpenAI、Responses、Anthropic 的输入输出转换 |
| `pricing.mjs`、`usage-store.mjs` | 费用估算、用量持久化 |
| `public/lab-request.ts` | 实验室请求构造、结果标准化 |
| `public/ModelCompare.vue` | 多模型并发控制、状态、结果导出 |
| `public/model-compare.js` | Vue 组件在原控制台中的挂载与卸载 |
| `public/playground.js` | 单模型对话界面 |

调用流程：客户端请求 → 鉴权/限额 → 路由选模型与密钥渠道 → 上游协议适配 → 安全网络访问 → 统一响应/用量记录。实验室只调用已有网关接口，不接触服务商密钥；对比中每个模型单独发请求，不共享对话上下文，最多并发两个。

## 部署与数据

Docker 多阶段构建先用 Vite 生成 `public/build/`，运行镜像只安装生产依赖；`.env`、`data/` 不进入镜像。重新构建后仍挂载原 `data/`，保留主密钥和配置。升级前应同时备份 `data/state.json`、`data/master.key` 及 SQLite 文件；只备份配置而丢失主密钥将无法解密已存储的服务商密钥。

## 验证边界

单元和集成测试覆盖路由、协议转换、密钥渠道、实验室请求、鉴权与费用。真实上游是否可用仍取决于服务商状态、账号额度和本机网络；测试通过不等于保证外部服务可用。
