---
name: openapi-guide
description: "OpenAPI 对外开放接口编码规范 + docs/openapi.json 产物维护。覆盖鉴权、用户身份、模块组织、OpenAPI 3.0 JSON 的结构与写入规则。Use when: 创建或修改 /openapi 路由、编写对外开放接口、维护 docs/openapi.json。触发词：openapi, 开放接口, 对外接口, 对外 API, open api, openapi controller, docs/openapi.json"
---

# OpenAPI 对外开放接口编码规范

本规范适用于以 `/openapi` 为前缀的对外开放接口。**除下述差异外，均遵循 `/api` 的接口编码规范**。与 `/api` 的差异速查：

| 维度 | `/api`（内部业务接口） | `/openapi`（对外开放接口） |
|------|----------------------|--------------------------|
| 鉴权 | 写操作加 `@NeedLogin()` | **不加** `@NeedLogin()`，鉴权在网关层通过 API Key 完成 |
| 用户身份 | `req.userContext.userId` 区分用户 | 统一走系统身份，不依赖 `userId` 做业务区分 |
| Controller 文件 | `xxx.controller.ts` | `xxx.openapi.controller.ts`，放在同一 module 下 |
| OpenAPI 文档 | 不需要 | **必须**同步维护 `docs/openapi.json`（见下文） |

## 鉴权

`/openapi` 路由的鉴权完全在网关层通过 API Key 完成，Controller 层不需要任何鉴权相关代码。

```typescript
// ✅ 正确：/openapi 路由不加鉴权装饰器
@Controller('openapi/orders')
export class OpenApiOrdersController {
  @Post()
  create(@Body() body: CreateOrderRequest) { ... }
}

// ❌ 错误：给 /openapi 路由加 @NeedLogin()
@Controller('openapi/orders')
export class OpenApiOrdersController {
  @NeedLogin()  // 不需要！
  @Post()
  create(@Body() body: CreateOrderRequest) { ... }
}
```

## 用户身份

OpenAPI 场景下不区分用户，统一走系统身份。禁止在 `/openapi` Controller 中使用 `req.userContext.userId` 做业务逻辑区分。

```typescript
// ✅ 正确：不依赖用户身份
@Get()
findAll(@Query() query: FindOrdersQuery) {
  return this.ordersService.findAll(query);
}

// ❌ 错误：用 userId 过滤数据
@Get()
findAll(@Req() req: Request) {
  return this.ordersService.findByUser(req.userContext.userId);  // OpenAPI 下无意义
}
```

## 模块组织

`/openapi` Controller 和 `/api` Controller 放在**同一个 module** 下，共享 Service 层。用文件名 `xxx.openapi.controller.ts` 区分。

```
modules/orders/
├── orders.module.ts              # 同时注册两个 Controller
├── orders.controller.ts          # @Controller('api/orders')      — 内部接口
├── orders.openapi.controller.ts  # @Controller('openapi/orders')  — 开放接口
└── orders.service.ts             # 共享业务逻辑
```

在 `orders.module.ts` 中注册：

```typescript
@Module({
  controllers: [OrdersController, OpenApiOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
```

## OpenAPI 文档产物（必须维护）

整个应用所有 `/openapi` 路由**汇总在一份** `docs/openapi.json` 文件里（仓库根目录）。

- 路径 = 仓库根 `docs/openapi.json`
- 所有 `*.openapi.controller.ts` 的 endpoint 共享这一个文件的 `paths`
- 新仓库若没有该文件，Agent 自行创建
- 该文件是对外 OpenAPI 的**权威 spec**（运行时被读取并对外暴露，不是纯文档）——精确性要求高，写错/漏写会直接影响外部调用方
- 内部 `/api` 路由**不**写进来

## 何时创建/更新

| 修改场景 | 文档动作 |
|---|---|
| 新建 `*.openapi.controller.ts` | 在 `docs/openapi.json` 的 `paths` 下新增对应 path 项 |
| 已有 openapi controller 上增删 endpoint、改方法/路径/参数 | 精准增删/改对应 `paths["/openapi/..."]` 条目 |
| 修改 `shared/api.interface.ts` 里被 openapi 路由引用的 interface / type | 同步更新所有受影响 path 的 schema |
| 修改 service 返回值或 drizzle schema，且类型变化反映到 openapi 路由的响应 | 同步更新对应 path 的 responses schema |

> 编辑 service / interface / schema 时本 skill 不会被 file-match 自动注入；此时 `coding-guide` 的 `## API 规范` 第 8 条会提醒 Agent 主动加载本 skill 完成同步。

## 安全更新协议（避免误删其它 path）

单文件聚合场景下最大的风险是 Agent 编辑某个 path 时意外丢掉其它 controller 的 path。**必须**按以下步骤：

1. **先 Read**：完整读入 `docs/openapi.json`
2. **再 Edit**：用精确 `Edit` 改特定 `"/openapi/<path>": { ... }` 块，不要 `Write` 全文件
3. **最后自检**：见末尾「写后自检」小节——确认 `paths` 下所有条目都在、且每条都有 `operationId` + `responses`

## 文件格式

顶层结构**固定**：

```json
{
  "paths": {
    "/openapi/<feature>": { <pathItem> },
    "/openapi/<feature>/{id}": { <pathItem> }
  }
}
```

硬性规定：

- **path 键**写完整绝对路径（含 `/openapi/` 前缀），与 `@Controller(...)` + `@Get/Post/...(...)` 拼接结果一致
- **不**放 `basePath`、**不**放 `components`、**不**放 `info`/`servers`——所有 schema 内联，中间件会补齐其它顶层字段
- 每个 operation 对象**必须**有：`operationId`（= controller 方法名，驼峰）、`summary`（一句中文说明）、`responses`（至少 `"200"`）
- 路径参数、查询参数、请求体、响应体的位置由 controller 装饰器决定（见下）
- 同一 URL 上的多个 HTTP 方法共用一个 path 键（如 `@Controller('openapi/tickets')` 下的 `@Post()` 与 `@Get()` 都映射到 `/openapi/tickets`，共享 pathItem）

## Controller 装饰器 → OpenAPI 位置

**位置看装饰器，类型看 TS**——两者缺一不可。

| Nest 装饰器 | OpenAPI 位置 | 备注 |
|---|---|---|
| `@Body() body: T` | `requestBody.content['application/json'].schema` = `T` 的 schema | `T` 通常是 `shared/api.interface.ts` 的 interface |
| `@Query('foo') foo: T` | `parameters[]` 一项：`in: 'query'`, `name: 'foo'`, `schema: T`；`?` → `required: false` | 每个 `@Query('x')` 产一项 |
| `@Query() q: T` | `parameters[]` 每字段一项：`in: 'query'`, `name: <field>`, `schema: <field 类型>` | 整个 interface 被摊平到 query params |
| `@Param('id') id: T` | `parameters[]` 一项：`in: 'path'`, `name: 'id'`, **`required: true`**, `schema: T` | path 参数恒 `required: true` |
| `@Headers('x-foo') v: T` | `parameters[]` 一项：`in: 'header'`, `name: 'x-foo'`, `schema: T` | `X-Api-Key` 等鉴权头走网关层，不写进 spec |

## Schema 权威来源

对外接口的请求/响应类型统一在 `shared/api.interface.ts` 用 TS `interface` / `type` 维护，前后端共享。

三层优先级（从高到低）：

1. **`shared/api.interface.ts` 中的 TS interface** — 请求体类型 / controller 返回值类型的唯一权威。从 controller 方法签名找到对应 interface 名称，再递归展开成 JSON Schema。
2. **controller 方法签名** — 各参数的 TS 类型与方法返回值类型，就是对应 OpenAPI 位置的 schema 来源（装饰器到 OpenAPI 位置的映射见上表）。类型可以是 `shared/api.interface.ts` 里的 interface、primitive、或 controller 文件内的内联类型声明；方法返回值类型即 OpenAPI 响应 schema 所描述的对象。
3. **drizzle schema** — 仅作字段底层类型的辅助参考；**绝不**用来扩展 interface 里没有的字段（interface 已显式定义对外字段集合；drizzle 里多出来的内部字段如 `userId`/`internalRemark` 不得出现在 `docs/openapi.json` 里）。

若 service 实现与 interface 脱节，属代码 bug；JSON schema 一律以 interface 为准。

## TS → JSON Schema 映射

| TS 写法 | JSON Schema |
|---|---|
| `foo: string` | `{ "type": "string" }`，`"foo"` 进 `required` |
| `foo?: string` / `foo: string \| undefined` | `{ "type": "string" }`，**不**进 `required` |
| `foo: number` | `{ "type": "number" }` 或 `"integer"`（看 drizzle 是 `integer()` 还是 `real()`） |
| `foo: boolean` | `{ "type": "boolean" }` |
| `type X = 'a' \| 'b' \| 'c'` 或直接字面量联合 | `{ "type": "string", "enum": ["a","b","c"] }` |
| `foo: SomeInterface` | 递归展开 `{ "type": "object", "required": [...], "properties": { ... } }` |
| `foo: T[]` | `{ "type": "array", "items": <T 的 schema> }` |
| `foo: Date` | `{ "type": "string", "format": "date-time" }`（序列化多为 ISO 字符串） |
| `foo: T \| null`（可空，非"可选"） | 在 `T` 的 schema 上加 `"nullable": true`；`"foo"` 仍进 `required` |

## `required` 三个位置

OpenAPI 3.0 里 `required` 按上下文有三种写法，判定依据**统一是 TS `?` 修饰符**。

| 上下文 | 写法 | 放在哪 |
|---|---|---|
| Parameter Object（query/path/header） | `"required": true/false` | 参数对象顶层 |
| RequestBody Object（请求体整体） | `"required": true` | requestBody 顶层 |
| Object Schema（对象字段） | `"required": ["field1","field2"]` 字段名数组 | object schema 顶层，**不**在每个 property 内 |

## description 与 example

TS interface 本身不带 `description` 和 `example`。**按字段名语义自行生成**，不改 interface 源码或加 JSDoc hack。

- `description`：一句中文解释，聚焦业务含义，别复述类型
- `example`：选一个**真实合理**的值（`"13800000000"` 而不是 `"xxx"`）

## 深层嵌套省略规则

响应/请求结构很深时允许偷懒：

- **第一层 properties** — 永远不省略
- **深层嵌套对象** — 允许只写 `{ "type": "object" }` 不列 properties，但**必须**在这一层写 `example`（swagger-ui 合成不到深层）
- **展开了 properties 的 object** — 不写顶层 `example`（swagger-ui 会从 property-level 合成）
- **primitive 字段**（string/number/boolean） — 必须写 property-level `example`
- **数组** — `items` 写一个元素的 schema + example，数组外层不写 `example`（由 `items` 合成）

## 规则表讲不透的片段示例

TS interface 怎么翻译、装饰器映射到 parameter 的哪个 `in`、`required` 怎么标——全部看上面各节的表。**本节只示范规则表替代不了的 3 件事**：混用装饰器形成的 parameters 数组、第一层完整展开 vs 深层对象省略的对照、description / example 的风格。

```json
{
  "paths": {
    "/openapi/tickets/{assigneeId}": {
      "get": {
        "operationId": "listByAssignee",
        "summary": "按受理人查询工单列表（游标分页）",
        "parameters": [
          { "in": "path",  "name": "assigneeId", "required": true,
            "schema": { "type": "string" }, "description": "受理人 ID", "example": "usr_007" },
          { "in": "query", "name": "priority", "required": false,
            "schema": { "type": "string", "enum": ["low","normal","urgent"] },
            "description": "按优先级过滤", "example": "urgent" },
          { "in": "query", "name": "cursor", "required": false,
            "schema": { "type": "string" },
            "description": "游标（首次请求省略）", "example": "tk_abc" }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["items", "hasMore"],
                  "properties": {
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "description": "Ticket 详情（深层省略，schema 见 example）",
                        "example": {
                          "id": "tk_abc", "title": "空调故障报修", "priority": "urgent",
                          "assigneeCount": 2, "location": { "building": "A 栋", "floor": 3 }
                        }
                      }
                    },
                    "nextCursor": { "type": "string", "description": "下一页游标（最后一页省略）", "example": "tk_abc" },
                    "hasMore": { "type": "boolean", "description": "是否还有下一页", "example": true }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

要点：

- **装饰器混用 → parameters 数组**：`@Param('assigneeId') + @Query('priority') + @Query('cursor')` 合并成 3 项 parameter，path 参数 `required: true`、query 参数 `required: false`
- **第一层完整展开 + 深层对象省略**：响应外层对象展开，`items` / `hasMore` 进 `required` 数组而 `nextCursor` 不进；数组元素是 `Ticket`，这一层用深层省略——`type: 'object'` + `example` 示范元素结构，不重复翻译 Ticket 的 schema
- **description / example 风格**：一句中文语义（"按优先级过滤" 而非"过滤参数"）、真实合理值（`"usr_007"` / `"tk_abc"` / `"A 栋"`，不是 `"xxx"` / `"foo"`）

## 写后自检（强制）

每次 Write/Edit 完 `docs/openapi.json` 之后，**必须**立即在项目根执行下面这条自检命令。未通过要当场修到通过为止，才视为本次任务完成：

```bash
node -e "const M=['get','post','put','patch','delete','head','options'];const s=require('fs').readFileSync('docs/openapi.json','utf8');const o=JSON.parse(s);if(!o.paths||typeof o.paths!=='object')throw new Error('missing paths');for(const [p,item] of Object.entries(o.paths))for(const [m,op] of Object.entries(item)){if(!M.includes(m))continue;if(!op.operationId||!op.responses)throw new Error(p+' '+m+' missing operationId/responses');}console.log('ok, '+Object.keys(o.paths).length+' paths');"
```

覆盖：JSON 语法错 / 顶层缺 `paths` / 某个 operation 缺 `operationId` 或 `responses`；最后打印 path 数量方便和修改前做比对，防止误删。
