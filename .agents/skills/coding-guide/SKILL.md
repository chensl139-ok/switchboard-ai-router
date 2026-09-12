---
name: coding-guide
description: '项目全局编码规范，必须在任何代码编写、阅读、修改、排查前加载。覆盖：项目结构、目录组织、文件命名、NestJS 后端（MVCS/Drizzle ORM/API 规范/异常处理/用户上下文）、React 19 前端（shadcn/ui/Tailwind/路由/样式/组件规范）、前后端联调（shared 类型/axiosForBackend）、数据库操作、质量保障流程、日志规范。Use when: 编写任意前端或后端代码、新建页面或模块、修改接口或数据库操作、排查编译错误或运行时问题、代码审查、理解项目架构。'
---

# 项目结构

## 根目录组织

```
├── client/          # React 前端
├── server/          # NestJS 后端
├── shared/          # 共享类型定义
└── package.json     # 根配置
```

任何需要被代码引用的文件均需在 `client`、`server`、`shared` 目录中，你需要将文件复制到正确位置。

## 后端结构 (`server/`)

基于 MVCS 架构，**禁止新增一级目录**。

```
server/ # 符合 NestJS 项目基本规范
├── main.ts                  # 应用程序入口点，内容不可改动
├── app.module.ts            # 根模块，模块需要在该文件中导入
├── config/                  # 配置文件
│   └── app.config.ts        # 主要应用配置
├── modules/                 # 功能模块（领域驱动）。新 module 在 app.module.ts 中的引入必须在 ViewModule 之前！编写代码前请 glob `server/modules/**` 目录，检查已有的文件。注意，module 修改或编写完成后，必须检查 app.module.ts 中是否已经引入该模块。
│   ├── view/                # 模板渲染模块
│   └── hello/               # 演示 hello world 端点（参考该结构即可）。遵循 Nest.js 最佳实践进行文件组织
│       ├── hello.controller.ts # controller 示例
│       ├── hello.module.ts  # module 示例
│       └── hello.service.ts # service 示例（可选）
├── database/                # Drizzle ORM 数据库相关。表结构变更(DDL)用 `lark-cli apps +db-execute` 执行,再 npm run gen:db-schema 根据数据库重新生成 schema.ts。
│   ├── schema.ts              # Drizzle ORM 数据库 Schema 定义。必须从该文件导入数据库类型,禁止自行编写或修改 — 由 npm run gen:db-schema 根据数据库重新生成。
└── common/                  # 共享工具和接口
│      ├── filters/          # 通用错误处理。
│      ├── constants/         # 通用常量。
│      └── utils/          # 通用工具方法。
shared/ # 前后端共享的目录
│   └── api.interface.ts             # 前后端共享的类型定义
```

## 前端结构 (`client/`)

```
client/
├── index.html              # HTML 模板
├── public/                 # 静态资源
├── src/
│   ├── index.tsx          # React 应用入口点，内容不可改动
│   ├── index.css          # 全局样式
│   ├── tailwind-theme.css          # tailwindcss 全局css主题变量定制
│   ├── app.tsx            # 主应用组件(包含路由定义)
│   ├── api/
│   │   └── index.ts       # 所有请求后端的 API 的逻辑均应聚合在该文件内。请先读取该文件再修改，禁止直接编写该文件
│   ├── pages/             # 页面目录
│   │   ├── HomePage     # 单个页面目录
│   │    |        ├── HomePage.tsx             # 页面文件
│   │    |        └── HomeComponentA.tsx  # 页面依赖的组件（非必须，除非页面文件大于 500 行，否则组件应该写在页面文件内）
│   │   └── NotFound       # 404 页面所在目录
 |     │   |        └── NotFound.tsx   # 404 页面文件
│   ├── components/        # 可复用的 UI 组件
│   │   ├── ui/            # shadcn/ui 组件[Use the components for functionality, but heavily style them.]
│   │   │   ├── README.md      # shadcn/ui 组件库使用说明 [请务必参考该文档进行组件使用]
│   │   ├── business-ui/            # 封装好的用户，部门选择组件以及展示组件
│   │   │   ├── README.md      # 用户展示，用户头像展示，部门选择展示逻辑必须使用 [请务必参考该文档进行组件使用]，禁止直接使用avatar组件等方式自行实现
│   │   ├── Layout.tsx     # 布局包装器
│   ├── hooks/             # 自定义 React hooks
│   └── utils/             # 工具函数
│   │   └── config.ts      # 应用初始化执行的配置
shared/ # 前后端共享的目录
│   └── api.interface.ts    # 前后端共享的类型定义
```

---

# 全局编码约定

## TypeScript 规范

- **TypeScript 优先**：所有代码都用 TypeScript 编写，具有适当的类型
- **路径别名**：`@client/` → `client/`；`@server/` → `server/`；`@shared/` → `shared/`。优先使用别名
- **环境配置**：不支持配置文件，写在代码中即可
- **命名约定**：Class → PascalCase，函数/变量 → camelCase，常量 → UPPER_CASE
- **跨子组件共享常量加语义前缀**：父级桶导出聚合多子组件时，子组件中相同语义的常量必须前缀化（如 `USER_DEFAULTS` / `ORDER_DEFAULTS`），禁止跨子组件复用裸通用名（`DEFAULT_CONFIG` / `STYLES` / `OPTIONS`），避免 barrel re-export 触发 `no-redeclare`
- **类型约束**：
  - 使用 interface 定义类型，type 用于复杂类型。禁止 `any`
  - 禁止自定义与 TypeScript 内置工具类型同名的类型（如 `Record`, `Omit`）
  - 类型转换必须显式（如 `String(num)`），优先让 TS 自动推断泛型
  - **禁止将 interface/type 作为值使用**（如 `instanceof`），运行时判断用 enum/const 对象
  - **禁止 `{} as T` 和 `as any` 类型断言**：用 `useState<T | null>(null)` + 空值检查代替。修复类型错误时必须找到根因，禁止用 `as any` 绕过
  - **`import type` 只能导入类型**：不能导入 const/enum/function（编译后被擦除→undefined）
  - **变量和函数参数必须显式声明类型**（禁止隐式 `any`）：所有变量声明必须有明确类型注解；`.map()/.filter()/.forEach()/.reduce()` 等回调的参数必须显式标注类型，否则触发 TS7006

  ```typescript
  // ❌ 错误：变量无类型注解 → 回调参数隐式 any → TS7006
  const items = await this.service.getItems();
  items.map((item) => item.name); // TS7006: item 隐式具有 any 类型

  // ✅ 正确：变量显式类型 + 回调参数显式类型
  const items: Item[] = await this.service.getItems();
  items.map((item: Item) => item.name);
  ```

## shared/api.interface.ts 规范（CRITICAL）

- 新建/修改后端接口时，**必须先完成 shared/api.interface.ts 中的类型定义，再编写后端实现**
- 编写前后端代码前，**必须先读取该文件**，严格按照定义实现。禁止凭记忆编写
- **严格使用已定义的属性名和类型**，禁止使用不存在的属性名。需要新增字段必须先在此文件添加
- **import 类型前必须确认实际导出**：先读取文件确认类型名称存在且拼写一致，禁止臆造类型名
- 属性统一 camelCase（禁止 snake_case），server 端 schema 的 snake_case 不应泄漏到接口类型
- shared 目录是前后端共享文件，**禁止反向引用** `@server/*`、`@client/*` 等路径别名

## 代码质量约束

- **代码行长度**：单行不超过 80-120 字符，import 成员多时及时换行
- **嵌套层级**：不超过 4 层，用 early return 减少嵌套
- **单文件长度**：前端页面和服务端模块业务逻辑优先写在一个文件中。超过 500 行时必须按功能模块拆分，避免"上帝文件"。**自定义 Hook 超过 100 行时应拆分为多个 Hook**
- **大型闭包风险**：组件内大型回调/处理函数（如 handleApplyResults）应拆到独立文件（如 `apply-results.ts`），避免 Vite React Refresh 循环引用导致白屏
- **将风格问题视为编码错误**：项目使用 `@eslint/js` + `typescript-eslint` 推荐配置
- **ESLint 规范**（`@eslint/js` + `typescript-eslint`）：
  - 正则控制字符用 unicode 标志：`/\x1b\[/u`
  - 避免无意义转义：字符串 `"'"` 非 `"\'"`, 正则 `[.]` 非 `[\.]`
  - switch-case 中声明变量用 `{}` 包裹作用域

## 依赖使用规范

1. 优先使用项目已有依赖，仅在无法实现时安装新依赖
2. 使用前先查看 `package.json` 确保依赖已存在
3. **子包完整性检查**：部分库有多个子包（如 `@radix-ui/react-*` 系列每个组件都是独立子包），添加 import 后必须确认 package.json 中包含所有需要的子包
4. 用法不清时查看 readme，可进一步搜索或网页访问获取信息

## 文件命名约定

- **语言**：文件/文件夹命名全部英文
- **组件**：PascalCase（`HelloWorld.tsx`）
- **模块**：kebab-case 文件夹，PascalCase 文件（`hello/hello.controller.ts`）
- **配置**：dot.case（`app.config.ts`）
- **导入导出**：使用桶导出，优先命名导出，使用路径别名避免相对导入；**同一符号 `export const X` 与底部 `export { X }` 二选一**，优先底部桶导出作为单一来源，禁止行内 + 桶导出双轨

## 开发环境与内置服务

- **登录/注册/用户系统**：内置，禁止自行实现
- 项目依赖已安装完整，前后端 devServer 已启动并自动重启（无需怀疑），文件变更自动热重载
- `/api` 和 `/openapi` 代理已配置，前端 TS 严格模式已禁用，后端已启用
- Rspack 用于构建，已配置好，**禁止修改**

### 平台 runtime 接口（`__runtime__`）在本地要靠 env pull 才通

dev server 自己只代理 `/api`、`/openapi`、`/__innerapi__`。`/app/<appId>/__runtime__/*` 这一整类平台 runtime 接口走的是另一条路：`npm run dev:local` 会先跑 `lark-cli apps +env-pull` 把沙箱身份/凭证拉进 `.env.local`，其中的 `MIAODA_DEV_PLATFORM_BASE`（或 legacy `SANDBOX_PUBLIC_URL`）才让 dev-proxy 把 `__runtime__` 反代到远端沙箱。

**env pull 失败、未装 lark-cli、或 `.spark/meta.json` 缺 app_id 时，启动脚本只 warn 不中断**，反代就不会挂上。此时这些端点的症状是：**POST 返回 404；GET 落到 Vite 的 SPA fallback，返回 200 + `index.html`**（业务侧表现为「返回一坨 HTML，JSON 解析失败」）。

常踩到的端点：

| 端点 | 方法 | 谁会打到它 |
|------|------|-----------|
| `api/v1/permissions/roles` | GET | `AppContainer` 每次加载应用自动打 |
| `api/v1/observability/{logs,traces,metrics}/collect`、`current_server_timestamp` | POST/GET | 平台埋点上报，自动打 |
| `api/v1/account/login/user` | POST | `useCurrentUserProfile()` → `authClient.session.getUserInfo()` |
| `api/v1/account/search_user`、`list_users`、`user_profile`、`search_department`、`convert_lark_user` | POST / `user_profile` 是 GET | `business-ui` 的 UserSelect / DepartmentSelect / UserDisplay |
| `api/v1/account/search`、`api/v1/account/chat/list_chats` | POST | ChatSelect 选群组件 |
| `api/v1/studio/user/profile` | GET | `getUserProfile()` |
| `api/v1/storage/object/<bucket>/pre_upload` | POST | `dataloom.storage.uploadFile()` 前端上传 |
| `api/v1/studio/plugins/tmp_files/acquire_upload_url`、`acquire_download_url` | POST | `capabilityClient` 的文件类入参 |

> `useCurrentUserProfile()` 打的是 `account/login/user`，**不是** `user_profile`/`search_user` 那一排；它另外还打一个 `GET /api/authnpaas/lark-user-id`，那条走 `/api`、被代理、正常。

排查顺序：先看 `.env.local` 里有没有 `MIAODA_DEV_PLATFORM_BASE`，没有就重跑 `env pull`。确认拉不到时：

- **禁止**改 `client/src/components/business-ui/**`（平台保护文件）、**禁止**给组件加兜底请求或改用自研选人控件绕过——发布后这些端点是正常的，绕过写法反而是错的
- 需要验证「按当前用户过滤」「展示用户姓名」这类逻辑：改由服务端出数据。服务端的 `req.userContext` 和 `AuthNPaasService` 由网关注入，不受此限制（见 `user-identity` / `contacts-service` skill）。`useCurrentUserProfile()` 长期停在加载态就是这个原因
- 需要验证上传链路：改用接口测试直接打后端接口，或复用库里已有的文件 URL

另外，`UserSelect` 弹层是**搜索驱动**的：不输关键词时列表为空属预期行为，不是接口挂了。

### 服务端启动即崩、`/api` 全部 502

报错形如 `UnknownDependenciesException: Nest can't resolve dependencies of the XxxService (?)... argument Function at index [0]` 时，先查构造函数有没有空参 `@Inject()`（见 plugin-guide），不要先去改 Module 的 `imports` / `providers`。

## 质量保障流程

修改代码后：

1. 运行代码检查工具检查语法错误
2. 改动服务端代码 → 进行接口测试，确保新增接口测试通过
3. 提交前 **必须** 读取相关日志确认无错误（服务端: server/server-devserver 日志；客户端: client-devserver 日志）

如果用户反馈编译失败、服务无法启动:

1. 跑 `tsc --noEmit` / `eslint` 等代码检查
2. 查看 `logs/server.log` / `logs/server.std.log` / `logs/dev.log` 找具体错误
3. dev 服务无响应:在跑 `npm run dev` 的终端 Ctrl+C 后重新启动即可

---

# 后端开发指南

- **运行时**: Node.js >=22.0.0
- **框架**: NestJS 10.x + TypeScript，每个功能组织为 NestJS 模块，利用内置 DI 容器
- **控制器-服务模式**：Controller 处理 HTTP 请求响应，Service 负责业务逻辑和数据层交互
- **通信协议**：仅支持标准 HTTP（POST/GET/PUT/PATCH/DELETE），不支持 SSE/WebSocket。流式输出改为一次性返回；状态同步用短轮询
- **模板引擎**: Nunjucks
- **数据库**：Drizzle ORM + Postgres
- **验证（可选）**: class-validator + class-transformer
- **一方插件**：服务端内置 AI 和飞书相关插件，PluginInstance 属于平台插件调用链路，不等同于自建 SSE/WS。涉及插件调用**必须先阅读 Plugin 集成指南**。**调用侧选择原则**：结果不需存储（即时展示/发消息）→ Client 侧调用；结果需要持久化到数据库 → Server 侧调用并落库，或 Client 侧调用后通过 CRUD 接口保存
- **聚合文件与模块边界（CRITICAL — 启动失败 + 并发编辑冲突 Top 原因）**：

  项目有三个**聚合文件**：`server/app.module.ts`、`client/src/app.tsx`、`client/src/api/index.ts`。它们是所有业务模块的汇聚入口，**必须由主 agent 在派发任何业务模块任务之前一次性串行预填**，业务模块任务（可能并行执行）**不得编辑**这三个文件。多方并发编辑同一聚合文件会触发 `old_string` mismatch 和 LLM 兜底重写，显著拖慢生成。

  **主 agent 预填职责**（规划阶段产出**业务模块清单**后立即执行，任务派发前完成）：
  - 清单命名约定：目录名 / 路由 / namespace / `api_prefix` 末段统一 `kebab-case`；`module_class` / 页面组件名统一 `PascalCase`；目录名与模块 `name` 一致
  - **严格串行**编辑以下三个文件（一次一个 tool 调用）：
    - `server/app.module.ts`：在文件顶部追加 `import { UsersModule } from './modules/users/users.module';`，在 `@Module` 的 `imports` 数组里加入 `UsersModule`；`ViewModule` 必须保持 `imports` 数组最后一项（fallback 路由）
    - `client/src/app.tsx`：顶部追加 `import UsersPage from './pages/users';`，在 `<Routes>` 内保留 `<Route index element={<Welcome />} />`，并加 `<Route path="users" element={<UsersPage />} />`
    - `client/src/api/index.ts`：每行 `export * as <namespace> from './<name>';`（用命名空间导出避免跨模块 export 名冲突）
  - 预填完成后才派发业务模块任务；聚合文件引用的符号（`UsersModule` / `UsersPage` / `./users`）在任务产出前暂时悬空，任务完成后自然对齐

  **业务模块任务的工作边界**：
  - 产出只能落在以下目录之一：`server/modules/<name>/`（Module / Controller / Service / DTO）、`client/src/pages/<name>/`、`client/src/api/<name>/`
  - **禁止编辑** `server/app.module.ts` / `client/src/app.tsx` / `client/src/api/index.ts`（已由主 agent 预填）
  - 跨模块依赖（不涉及聚合文件）：在源 Module 的 `exports` 中导出即可
  - 若开发中发现规划外的跨模块需求（罕见，如发现需要一个主 agent 未规划的 shared helper 模块），**不要擅自改聚合文件**，在完成摘要里声明：

    ```yaml
    cross_module_needs:
      - type: extra_module # 或 extra_route / extra_provider
        reason: '需要 SharedAuthModule 让 UsersController 使用 @Auth'
        module_class: SharedAuthModule
        module_file: server/modules/shared-auth/shared-auth.module.ts
    ```

    主 agent 在所有模块任务完成后统一串行处理 `cross_module_needs`（补丁阶段，仍是单 agent 编辑聚合文件，无并发冲突）

- **@Injectable() Service 注册**：创建 `@Injectable()` Service → 在对应 Module 的 `providers` 中注册（这条在模块目录内部完成，与聚合文件无关）
- **三方集成**：调用第三方 API 需在后端实现，使用 @nestjs/axios
- **文件上传**：前端用 dataloom SDK 上传,服务端仅保存元信息(不要在服务端处理 multipart/form-data)
- **环境判断**：`process.env.NODE_ENV === "production"` 表示生产环境

## 日志约定

- 后端禁止 console，**必须总使用** `@nestjs/common` 的 Logger（无 info 方法，用 `logger.log` 代替）
- Logger 参数必须为 string，对象需 `JSON.stringify`
- 输出完整错误堆栈

## Database

**必须使用注入的 Drizzle 实例**，禁止自建连接：

```typescript
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

@Injectable()
export class TestService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}
}
```

- **每次编写或修改数据库操作代码前，必须重新读取 `server/database/schema.ts`**——该文件由系统在 DDL 执行后自动重新生成，内容随时可能变化。禁止凭记忆或之前读取的版本编写字段名和类型，否则会引用不存在的字段导致 TS2339 批量报错
- **禁止事务**（`db.transaction`），每个操作独立原子
- 条件查询用三元分支，禁止 `let query` 重赋值（类型不兼容）：

```typescript
// ✅ 条件查询
const conditions = [];
if (status) conditions.push(eq(users.status, status));
const query =
  conditions.length > 0
    ? db
        .select()
        .from(users)
        .where(and(...conditions))
    : db.select().from(users);
```

- Count 查询：

```typescript
// 简单 count
const result = await this.db
  .select({ count: count() })
  .from(users)
  .where(eq(users.status, 'active'));
// 子查询 count（关联计数）
const users = await this.db
  .select({
    ...users,
    postsCount: this.db.$count(posts, eq(posts.authorId, users.id)),
  })
  .from(users);
```

### userProfile 自定义类型

`userProfile` 是 Drizzle ORM custom_type，TypeScript 中对应 `string`。所有相关变量**必须显式类型注解**，禁止隐式推断。

```typescript
// schema 示例
export const mockTable = pgTable('mock_table', {
  adminUser: userProfile('admin_user'), // custom_type, TS 中为 string
});
// 使用示例
const userId: string = 'user123'; // ✅ 显式注解
await db.insert(users).values({ adminUser: userId });
await db.select().from(users).where(eq(users.adminUser, userId));
```

### 使用侧边界陷阱

- **`count()` 返回 string**（PostgreSQL bigint）。

- **UUID 列 `inArray` 必须显式 `::uuid[]`**：标准 `inArray(col, ids)` 会运行时报 `42809: op ANY/ALL (array) requires array on right side`。

  ```typescript
  where: sql`${tasks.id} = ANY(${ids}::uuid[])`;
  ```

- **`customTimestamptz` 跨网络后是 string**：service 内查询返回 `Date`，但 API 响应经 JSON 序列化后前端拿到 ISO string。`shared/api.interface.ts` 中 timestamptz 字段声明为 `string`，前端需要 Date 时手动 `new Date(value)`。

### 业务日期

需求里的日期是**自然日**（哪一天 / 哪一周 / 哪一月）而不是精确时刻时，按业务时区计算，未指定时默认 `Asia/Shanghai`。

项目里放一个 helper 统一产出 `day` / `month` / `weekStart` / `shiftDay`；服务端写入、统计聚合、前端展示都比较它的返回值。

### 数据库使用强约束

- 仅通过 schema.ts 暴露的客户端和类型读写，禁止手写 SQL/临时类型
- **schema变更流程（CRITICAL）**：变更数据表结构后，运行 npm run gen:db-schema 重新生成 schema.ts → **立即重新读取 schema.ts** → 再编写业务代码。跳过重新读取直接编码是 TS2339 批量错误的主要根因
- 连接失败/SSL 错误：先检查 `.env.local` 里 `SUDA_DATABASE_URL` 是否正确(走过 `lark-cli apps +env-pull`),再排查网络/代理

## API 规范

1. **必须遵循 JSON API 规范**：GET=读、POST=创建、PUT=全量更新、PATCH=部分更新、DELETE=删除
2. **路径前缀约定**：
   - `/api` — 内部业务接口（默认）：`@Controller('api/hello')`
   - `/openapi` — 对外开放接口（鉴权/用户身份规则不同，详见 `openapi-guide` skill）：`@Controller('openapi/hello')`
3. **路由设计最佳实践**：
   - 静态路由在前，动态路由在后（`/search` 必须在 `/:id` 之前）
   - 使用描述性路径如 `/meetings/detail/:id` 避免冲突
4. **前后端一致性**（CRITICAL）：
   - 前端 API 调用的 HTTP method 和 path **必须**与后端 Controller 装饰器完全匹配（`GET≠POST` → 405）
   - 后端 Service 返回值结构**必须**与 `shared/api.interface.ts` 中定义的响应类型完全匹配（禁止后端直接返回数组而 shared 定义为 `{items: T[]}`）
   - 编写前端 API 时必须先读取对应 Controller 确认 method 和路径
5. **路由注册验证**：创建新 Controller 后必须用接口测试工具验证路由是否生效。**遇到 404 排查路径**：① 检查 `@Controller(...)` 是否以 `api/` 或 `openapi/` 开头 ② 检查 Module 是否在 `app.module.ts` 注册 ③ 检查静态路由是否在动态路由 `/:id` 之前
6. **@Query/@Param 类型转换**：默认 string，必须在 controller 层手动转换（如 `parseInt(limit, 10)`）
7. **写操作加 @NeedLogin**：POST/PUT/PATCH/DELETE 接口显式加 `@NeedLogin()` 装饰器：

   ```typescript
   import { NeedLogin } from "@lark-apaas/fullstack-nestjs-core";
   @NeedLogin()
   @Post()
   async createItem(@Req() req, @Body() dto) { ... }
   ```

8. **OpenAPI 文档同步**：改动 `*.openapi.controller.ts` 或其引用的 interface / service 返回值 / schema 字段时，加载 `openapi-guide` skill，同步更新 `docs/openapi.json`

## 异常处理

| 分层       | 目标                            |
| ---------- | ------------------------------- |
| service    | 抛出业务异常                    |
| controller | 不处理异常，交全局 Error Filter |

## 当前用户信息

- **必须从 `req.userContext` 获取**，禁止从前端传递，禁止硬编码
- 依赖用户信息的接口不要用 API 测试工具测试，用 `think` 工具思考
- 后端按 `user-identity` 和 `@lark-apaas/fullstack-nestjs-core` 的 Express `Request` 增强读取 `req.userContext`；`tenantId` 为可选 number，不能套用前端 `window.tenantId` / `viewContext` 字符串语义。
- Controller 直接用 `@Req() req: Request`；测试、mock 或业务窄类型用独立接口，只声明实际读取字段。不要继承 Express `Request` 或重声明 `userContext`；未读 `tenantId` 就省略，必须保留时用 `unknown` 或 SDK 兼容类型。

```typescript
// req.userContext 字段（由身份认证中间件挂载，完整合同见 user-identity）：
// - userId/appId: string
// - tenantId: SDK Request.userContext 的可选 number
// - env: 'preview' | 'runtime'  (preview=预览态, runtime=发布运行态)
// - userName/userNameEn: string
// - userNameI18n: string  (多语名字, 如 {zh_cn: '用户', en_us: 'user'})

@Post('articles')
async createArticle(@Req() req: Request, @Body() dto: CreateArticleDto) {
  const { userId } = req.userContext;
  return this.articleService.create({ ...dto, author: userId });
}
```

## 自动化任务

需要设计自动化任务配置与开发时，请调用文档工具召回自动化任务配置与代码编写文档

## 分页最佳实践

### 传统分页（后台管理表格、跳页场景）

- 1-indexed page，`@Max()` 限制 pageSize
- 响应含 items/total/page/pageSize，page 超出返回空数组
- 深分页性能差，大数据集考虑游标分页

### 游标分页（移动端/无限滚动，优先推荐）

- 使用「唯一 + 可排序」字段作为游标排序依据，默认 创建时间+id 降序
- cursor(首次空) + limit(默认12, @Max(50))
- 响应仅 items/nextCursor/hasMore，不返回 total
- **最后一页时 nextCursor 必须为 undefined**
- DESC 降序配 LessThan(游标)，ASC 升序配 GreaterThan(游标)

## 本地 dev API 调试

### 入口端口和 base path：**只走 vite/rspack dev server**

本地 dev 跑起来有**两个端口 + 一个前缀**，都由 `.env.local` 里的 env 控制：

| Env                | 进程 / 用途                                 | 默认   | 沙箱 env-pull 下发？ | 备注                                                                                                                               |
| ------------------ | ------------------------------------------- | ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CLIENT_DEV_PORT`  | vite / rspack dev server                    | `8080` | ❌ 不下发            | **唯一入口**：serve 前端 + 反代 `/api/*` 给 NestJS + 注入 `x-larkgw-suda-webuser` 模拟登录态。端口被占就 Agent 自己改 `.env.local` |
| `SERVER_PORT`      | NestJS                                      | `3000` | ❌ 不下发            | 仅 vite/rspack 反代用，不直接给 agent / curl 用。端口被占就 Agent 自己改 `.env.local`                                              |
| `CLIENT_BASE_PATH` | 前端路由 base + 后端 routes.json serve 路径 | `/`    | ✅ `/app/<app_id>`   | 浏览器 URL 前缀；agent / curl 调 `/api/*` 也必须带这个前缀                                                                         |

完整入口形态 = `http://localhost:<CLIENT_DEV_PORT><CLIENT_BASE_PATH>/...`。启动日志里
vite/rspack 打印的 `Local: http://localhost:<port>/...` 才是入口，具体值以 `.env.local`
为准（沙箱 `lark-cli +env-pull` 会把 `CLIENT_BASE_PATH` 下发成 `/app/<app_id>`，本地裸
跑不设则退到 `/`）。

> **端口冲突时**：`CLIENT_DEV_PORT` / `SERVER_PORT` 不归 env-pull 管，Agent 自己在
> `.env.local` 加 `CLIENT_DEV_PORT=8001`（或别的空闲端口）然后重启 `npm run dev`
> 即可。**不要去改 `vite.config.ts` / NestJS bootstrap 里的硬编码端口**，preset 已经
> 自己读这两个 env，业务侧改源码反而会跟 sandbox 配置发散。

> **dev vs prod 的 base path 差异**：dev 模式下 vite/rspack 把前端组件 basePath 强制
> 成 `''`（preset 里 `isDev ? { basePath: '' } : ...`），所以前端 router 用相对路径就
> 行；但 dev server 自己 serve 路由 / 反代 `/api/*` 的路径**仍然带 `CLIENT_BASE_PATH`
> 前缀**，浏览器 URL 跟 prod 一样长。这也是 agent / curl 必须带前缀的原因。

**绕过 vite/rspack 直连 NestJS 端口的后果**：vite/rspack dev server 是从
`SUDA_WEBUSER` env 读出 webuser 拼到 `x-larkgw-suda-webuser` header 再转发给 NestJS 的，
NestJS 自己不读 env。直连 NestJS 端口 → header 缺失 → `req.userContext.userId === ""` →
任何依赖 `userContext` 的逻辑（`drizzle eq(table.createdBy, userId)`、`@NeedLogin()` 拒
访等）行为异常，但表面看接口是 200 / 返回值正常，**症状难追到根因**。

### CSRF token（double-submit cookie）

后端 csrf 中间件用 **double-submit cookie** 模式守门所有 `/api/*` 请求：
`Cookie: suda-csrf-token=<X>` 和 `X-Suda-Csrf-Token: <X>` header 两个值**字面相等**
才放行。缺 cookie 直接 403；cookie 在但 header 跟它不等也 403。

- **浏览器侧零感知**：首页加载时后端 Set-Cookie 写入 csrf cookie + 把同值注入到
  `window.csrfToken`，前端 axios 拦截器读取这个值塞到 `X-Suda-Csrf-Token` header，
  浏览器又自动随请求带上 cookie —— 业务代码不需要管。**优先用浏览器/DevTools Network
  调试**：cookie 链由浏览器一次性建立，是验证接口最自然的方式。

- **`curl` / 第三方 HTTP 客户端 / agent 工具直接打 `/api/*` 接口**：必须同时塞 cookie
  和 header，值字面相等才放行。任意非空相等值都行（注意打**client dev port**，不是
  NestJS 端口）：

  ```bash
  # <PORT> = .env.local 里的 CLIENT_DEV_PORT（常见 8080 / 8001）
  # <BASE_PATH> = .env.local 里的 CLIENT_BASE_PATH（沙箱下发为 /app/<app_id>，本地裸跑可能为空）
  curl -H 'Cookie: suda-csrf-token=x' \
       -H 'X-Suda-Csrf-Token: x' \
       http://localhost:<PORT><BASE_PATH>/api/notes
  ```

  **不要**因为撞 403 就去改后端 csrf 中间件或者怀疑业务逻辑 —— csrf 保护是有意的，
  业务本身没问题。

- **依赖用户信息的接口**（看 `req.userContext` 的）即便过了 csrf 也拿不到用户身份，
  浏览器才能补齐 webuser header。这种接口直接 `curl` 永远拿不到合理响应，**用浏览器
  或者 `think` 工具推理**，别陷在 curl 里反复调。

## 问题排查指引

1. 用 `curl` / 浏览器 DevTools / 第三方 HTTP 客户端测试不依赖用户信息的接口（**必须**
   带 csrf cookie + header + 打 client dev port，见上节"本地 dev API 调试"）
2. 查看 `logs/server.log` / `logs/server.std.log` 找后端报错;无有效日志时主动补 logger 打印
3. dev 服务无响应:在跑 `npm run dev` 的终端 Ctrl+C 后重新启动
4. API 测试返回 HTML 内容时:检查模块注册顺序、路由顺序、请求路径。禁止修改内置 ViewController

---

# 前端开发指南

## 技术栈

- **框架**: React 19 + TypeScript
- **路由**: React Router DOM v6
- **样式**: tailwindcss（语义化 token）
- **UI 组件库**: shadcn/ui — Use components for functionality, heavily style them
- **图表**: ReactECharts，**开发前必须调用 `/charts-skill`**
- **图标**: Lucide React（唯一图标库，禁止 Emoji 和其他图标库）
- **表格/表单/图表**: 见下方"组件 Skill 召回规则"，开发前必须先调用对应 Skill
- **用户**: 用户信息展示/选择必须用 `business-ui` 组件（阅读 README.md），禁止直接展示 userId
- **Markdown 渲染**: `components/ui/markdown`（react-markdown + remark-gfm，内置 prose 排版）

## API 请求

**禁止** `fetch`，必须使用 `axiosForBackend` **函数调用方式**（不用会报 `Tenant not found`）：

```typescript
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
// ✅ axiosForBackend({ url: '/api/users', method: 'GET' })
// ❌ axiosForBackend.get(...) / .post(...) / .put(...) / .delete(...) ← 不是 axios 实例，所有实例方法都会 TypeError
```

- **前后端联调**：编写前端 API 对接代码前**必须先读取后端接口定义**，禁止对后端接口请求进行兜底和过度封装
- **全栈项目禁止 mock 数据**：只要有服务端接口就当全栈对待，严禁 mock。纯前端项目（静态展示、无后端）可以使用 mock
- **提交前检查 mock 残留**：禁止硬编码用户 ID、项目 ID 等 mock 数据。提交前确认无 `"user_xxx"`、`"project_1"` 等占位值

## 日志与错误处理

- **日志**: 必须用 `logger` from `@lark-apaas/client-toolkit/logger`，**禁止所有 console 方法**
- **禁止静默处理异常**：显示明确错误信息，禁止掩盖问题
- **无内置多语言/深浅色切换**：如需要需自行实现

## 工程规范

- **glob 文件查找**：目录存在嵌套，glob 前端页面时必须使用 `client/src/pages/**`
- **先看后写**：修改文件前先理解已有代码风格，模仿现有 pattern 和库的使用方式

## 官方内置组件

| 组件                                                | 来源                                    | 用途                              |
| --------------------------------------------------- | --------------------------------------- | --------------------------------- |
| Table                                               | `@lark-apaas/client-toolkit/antd-table` | 数据表格，**先调 `/table-skill`** |
| UserSelect/UserDisplay/UserProfile/DepartmentSelect | `business-ui/*`                         | 用户/部门选择展示                 |
| Markdown                                            | `components/ui/markdown`                | Markdown 渲染（react-markdown + remark-gfm） |

### 组件 Skill 召回规则（强制执行）

| 场景                 | Skill           | 说明                                |
| -------------------- | --------------- | ----------------------------------- |
| 表单、Form、Zod      | `/forms-skill`  | Shadcn Form + React Hook Form + Zod |
| 图表、Chart、ECharts | `/charts-skill` | shadcn/ui + ReactECharts            |
| 表格、Table          | `/table-skill`  | antd-table                          |

禁止未调用 Skill 直接编写表单/图表/表格代码。

### 组件使用规范

- 优先使用 `client/src/components` 下已有组件（Card/Button/Badge 等）
- 使用前查看 `ui/README.md` 或组件源码
- 禁止 Card 嵌套 Card
- shadcn props 值必须从实际联合类型中选取（如 Button variant），不确定时看源码
- 输入组件用 shadcn，**禁止原生 `<input>`/`<textarea>`/`<select>`/`input[type="date"]`**
- SelectItem 的 value 禁止空值，占位用 `<SelectValue placeholder="..." />`
- 版本锁定、按需导入、唯一图标库 lucide-react

## @lark-apaas/client-toolkit

**零假设原则**：绝不基于假设使用任何子模块。使用任何 `@lark-apaas/client-toolkit` 子模块前**必须**：① 先查询本地已加载的 Skills 或对应包文档 → ② 严格按文档编码。**禁止直接调用 `@lark-apaas/client-toolkit` 任何函数/方法**（不基于查询到的文档）。该库**仅可在前端代码中使用，禁止在后端代码中引用**。

| 功能               | 导入路径                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| 插件调用（Client） | `import { capabilityClient } from "@lark-apaas/client-toolkit"`                                  |
| 日志               | `import { logger } from "@lark-apaas/client-toolkit/logger"`                                     |
| 文件上传下载       | `import { getDataloom } from "@lark-apaas/client-toolkit/dataloom"`                              |
| 应用信息           | `import { useAppInfo } from "@lark-apaas/client-toolkit/hooks/useAppInfo"`                       |
| 当前用户           | `import { useCurrentUserProfile } from "@lark-apaas/client-toolkit/hooks/useCurrentUserProfile"` |
| URL 解析           | `import { resolveAppUrl } from "@lark-apaas/client-toolkit/utils/resolveAppUrl"`                 |
| 批量用户信息       | `import { UserService } from "@lark-apaas/client-toolkit/tools/services"`                        |

**useCurrentUserProfile** 返回 `Partial<IUserProfile>`，初始为空对象：访问字段用 `?.`，判断加载完成用 `if (!userInfo?.user_id)`。

**UserService.listUsersByIds**: 根据用户 ID 获取用户详细信息（姓名/头像/邮箱/部门）时**必须使用**，**禁止自行实现用户信息查询逻辑**。非组件上下文需要批量获取用户信息时使用。返回 `result.data.userInfoMap: Record<string, UserInfo>`，UserInfo 含 `userID: string`, `name: I18nText { zh_cn, en_us?, ja_jp? }`, `avatar: string`, `email?: string`, `userType: "_employee"|"_externalUser"|"_anonymousUser"`, `department: { departmentID, name: I18nText }`。展示场景仍优先用 UserDisplay/UserProfile 组件。

> ⚠️ `UserInfo` 不含任何飞书 ID 字段（`lark_user_id` / `open_id` / `union_id` 都没有）。需要飞书 ID 一律见 `user-identity` skill（当前用户、任意用户 user_id、open_id、union_id 各种场景都在那里）。

## 样式开发

**设计规范遵从（最高优先级）**：必须严格遵循 `AGENTS.md` 中定义的设计规范，代码实现必须是对设计文档的精准还原，**严禁随意简化**。所有设计必须响应式。项目使用单套色彩系统，无需支持深色/浅色模式切换。

### 样式技术选型

```
需要写样式？
├─ 基础布局/间距/颜色 → Tailwind ✅
└─ JS动态计算值 → 行内 style ✅
```

### Tailwind 规范

- `justify-between/around/evenly` 必须配合 `space-x-*` 或 `gap`
- `justify-start/end` 的水平 flex 行应加 `flex-wrap`
- shadcn Button 不要显式控制 padding/height，用 sizes/variants API
- 颜色优先级：语义化 token（`bg-primary`）> 自定义 token > Tailwind 预设。禁止 `bg-[--primary]`（Tailwind 4 限制）
- **arbitrary values 中空格用下划线**：`from-[hsl(215_60%_18%)]` 非 `from-[hsl(215 60% 18%)]`
- `tailwind-theme.css` 自定义属性用 `hsl(H, S%, L%)` 格式（非 `23 10% 23%`）

### 布局/排版

- Spacing 保持一致（small/medium/large 三级），Panel 风格统一
- 文本溢出：用户输入/URL 用 `break-words`，标题用 `truncate`

## 页面与路由

- **新增页面流程**：判断是否需要隔离布局 → 创建 `pages/` 下组件 → `app.tsx` 配置路由 → 更新导航
- **数据获取**：页面级数据获取在页面组件顶层处理，通过 props 向下传递
- **禁止 React.lazy**：严禁异步加载路由组件
- **页面跳转**：必须用 `NavLink`/`Link`/`useNavigate`，**严禁 `window.location.href`**
- **分享链接/二维码**（CRITICAL）：应用部署后 URL 与本地路由不同，**必须**用 `resolveAppUrl` 转换：

  ```typescript
  import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
  const shareUrl = resolveAppUrl(`/detail/${id}`); // ✅ 路由路径→完整 URL
  const fixedUrl = resolveAppUrl(`${origin}/detail/${id}`); // ✅ 自动修正
  resolveAppUrl('https://other-site.com/page'); // ✅ 外部链接原样返回
  // ❌ 严禁自行拼接：`${window.location.origin}/detail/${id}`
  ```

- **首页路由**：必须含指向 `/` 的 index 路由
- **路由唯一性**：每页一个唯一路由
- **导航**：NavLink + active 高亮，路径必须与 `app.tsx` 路由精确对应。全局 Layout 中使用 `useAppInfo`/`useCurrentUserProfile` 获取站点和用户信息
- **路由动态调整**：更新路由时检查现有路由表，及时将 index 路由指向最合适的页面
- **禁止混用页面跳转和页内锚点**

### 组件代码风格

- 箭头函数 + React.FC，Props 接口用 `组件名Props`
- 编写顺序：① Hook 声明 → ② useEffect → ③ 事件处理 → ④ JSX
- 导入顺序：React → 三方库 → 内置工具 → 相对路径
- 交互对话框用 Dialog 组件
- 弹窗禁止 `alert`/`confirm`/`prompt`

### 数据安全渲染

- **渲染前必须检查数据是否存在**
- **使用条件渲染处理 loading/error 状态**
- **为可能 undefined 的数据提供 fallback UI**

```jsx
if (loading) return <div>加载中...</div>;
if (!data) return <div>暂无数据</div>;
return <h1>{data?.title || '未知标题'}</h1>;
```

## 组件区块类型标记

为特定功能的顶层容器添加 `data-ai-section-type` 属性：

| 值          | 场景                      |
| ----------- | ------------------------- |
| `card-stat` | 横向指标卡容器            |
| `card-list` | Card 组件的 flex 列表     |
| `button`    | 任意 Button               |
| `card-menu` | Card 组件的 grid 网格菜单 |

## 图片规范

- **展示**：必须用 `@client/src/components/ui/image` 组件（非原生 `<img>`），响应式设 `sizes`，固定宽设 `width`
- 用户头像用 business-ui 组件

### 图片资源优先级

1. 用户上传图片(最高)
2. 用户自带的素材库 / 设计资源 — 放到 `client/public/` 或 CDN
3. 内置 Avatar(仅头像)— `@client/src/utils/img-resources/avatar-placeholders.ts`
4. Picsum(临时)— `https://picsum.photos/seed/${seed}/${w}/${h}`(必须带 seed)

> 本地开发态不接 AI 图片生成,需要 AI 生图请走云端发布后由平台插件链路承接

## 核心功能依赖

| 类别       | 库                                                                       |
| ---------- | ------------------------------------------------------------------------ |
| 动画       | Framer Motion, GSAP                                                      |
| 日期       | dayjs                                                                    |
| 日期选择器 | shadcn Calendar + Popover（禁止 input[type="date"]）                     |
| 验证       | zod                                                                      |
| 工具函数   | lodash                                                                   |
| 样式       | clsx                                                                     |
| 用户反馈   | sonner                                                                   |


## 滚动分页最佳实践

- 使用 `useInfiniteQuery` 管理数据
- `IntersectionObserver` 实现自动加载（防抖 200ms）
- 调用 `fetchNextPage()` 前检查 `!isFetchingNextPage && hasNextPage`
- 底部状态：loading → 加载中；无更多 → "没有更多"；空 → 空状态

## 数据筛选器

- 用 shadcn 组件（Date Picker/Input），禁止原生 input
- 筛选项合理宽度分布
