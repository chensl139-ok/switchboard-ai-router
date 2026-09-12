---
name: user-identity
description: "Use when getting current user info/profile, displaying user name/avatar/email, converting miaoda userId ↔ lark_user_id (both directions via AuthNPaasService), or reading req.userContext fields (userId/roles/tenantId): useCurrentUserProfile, AuthNPaasService, FeishuID conversion. 触发词：用户身份, 用户信息, 用户资料, 当前用户, userProfile, useCurrentUserProfile, 飞书ID, FeishuID, 飞书用户ID, lark_user_id, 用户ID转换, AuthNPaasService, getBatchMiaodaUserIds, 飞书ID转妙搭, employee_id 转 userId, 用户上下文, userContext, userContext.roles, 用户角色, 当前用户角色, 获取请求者角色, 展示用户, 显示用户, 用户面板, 我是谁, 获取用户"
steering: true
steering-topic: user_identity
match-template-name: nestjs-react-fullstack
---

# 用户身份与上下文

本 skill 专注于**用户身份**：ID 体系、`req.userContext` 字段、`useCurrentUserProfile`、妙搭 ↔ 飞书 ID 转换。

**接口认证**（`@NeedLogin()` 装饰器、`AuthNPaasGuard` opt-in 模式、公开接口处理、401）请使用 [`authn-guide`](../authn-guide/SKILL.md) skill。

## 零、ID 体系警告（CRITICAL）

⚠️ "user_id" 这个字面在本项目里指**三个不同的东西**，必须先区分清楚再写代码：

**作为身份 ID 字段名（指代具体某个用户的 ID 值）：**

| 出现位置 | 实际含义 | 体系 |
|---|---|---|
| `useCurrentUserProfile().user_id`、`req.userContext.userId` | 妙搭用户 ID（纯数字字符串） | 妙搭 |
| `useCurrentUserProfile().lark_user_id`、`AuthNPaasService.getCurrentUserLarkUserId()` 返回值 | 飞书 user_id（== `employee_id`，企业内身份，**无固定前缀**） | 飞书 |

**作为 API 参数的取值（不是一个 ID，而是告诉接口"我传入哪种类型的 ID"）：**

| 出现位置 | 实际含义 |
|---|---|
| 飞书 OpenAPI 参数 `user_id_type: 'user_id'`（也可取 `'open_id'` / `'union_id'`） | 字符串字面，与上方的飞书 user_id 字段是一致体系但用途不同 |

**严禁**：把 `useCurrentUserProfile().user_id`（妙搭 ID）直接当飞书 ID 传给飞书 API。飞书 ID 必须通过 `lark_user_id` 字段或 `AuthNPaasService` 获取。

`useCurrentUserProfile()` 返回的字段中涉及**两套完全独立的 ID 体系**，严禁混用或互相回退：

| 字段 | 体系 | 格式 | 说明 |
|------|------|------|------|
| `user_id` | 妙搭 | 纯数字字符串 | 妙搭平台用户 ID |
| `lark_user_id` | 飞书 | 字符串 | 飞书 user_id（== employee_id），通过额外异步请求获取 |

> **严禁**：`useCurrentUserProfile()` 返回值里**没有** `open_id`、`feishu_id`、`openId` 字段——飞书 ID 在这个 Hook 里**只通过 `lark_user_id`** 暴露。如果在本 Hook 的消费代码里看到 `userInfo.open_id` 等写法，属于历史错误，必须改成 `lark_user_id`。
>
> （范围限定：上一条只约束 `useCurrentUserProfile()` 的消费代码。**项目其他场景** —— 例如调 spark `id_convert`、调飞书通讯录 API —— 出现 `open_id` / `union_id` 是正常且必要的，不在禁止之列。）
>
> **严禁**：当 `lark_user_id` 为空时回退到 `user_id` 展示。两套 ID 含义完全不同，回退会误导用户。正确做法是条件渲染：有值则展示，无值则不展示或展示"未关联飞书账号"。
>
> **严禁（大整数精度）**：妙搭 `user_id` 与飞书 `lark_user_id` / `employee_id` 虽是"纯数字字符串"，但实为 **I64 大整数（可超 9e15，超出 JS `Number.MAX_SAFE_INTEGER` 53 位安全整数上限）**。跨 JS ↔ SQL / Dataloom / 飞书插件边界一律**按 string 透传**，严禁 `Number()` / `parseInt()` / `+id` 转换——会静默丢精度，把通知/查询打到错误用户。

---

## 一、功能决策树

```text
用户需求
    │
    ├─ 接口认证（@NeedLogin / 公开接口 / 401 / 守卫流程）？
    │   └─ 跳到 `authn-guide` skill
    │
    ├─ 需要在服务端读取当前用户 ID / 租户 / 角色等？
    │   └─ 是 ──→ req.userContext（第二节）
    │
    ├─ 需要在前端展示当前用户信息（名称/头像/邮箱）？
    │   └─ 是 ──→ useCurrentUserProfile()（第三节）
    │
    ├─ 需要获取当前用户的飞书 user_id（即 employee_id，企业内身份）？
    │   ├─ 后端 ──→ AuthNPaasService.getCurrentUserLarkUserId()（第三节）
    │   └─ 前端 ──→ useCurrentUserProfile().lark_user_id（第三节）
    │
    ├─ 需要批量把 妙搭 userId 转成 飞书 **user_id (employee_id，无前缀)** —— 不是 open_id (`ou_`)、不是 union_id (`on_`)？
    │   └─ 是 ──→ AuthNPaasService.getBatchLarkUserIds()（第三节）
    │
    ├─ 需要 飞书 open_id（`ou_` 开头）/ union_id（`on_` 开头）？
    │   └─ ⚠️ **AuthNPaasService 不产出 open_id/union_id**，只能 user_id
    │       └─ 跳到 `feishu` skill 的 `references/id-convert.md`（spark id_convert type 10/11）
    │
    ├─ 需要把 飞书 open_id / union_id 反查成 妙搭 userId？
    │   └─ 跳到 `feishu` skill 的 `references/id-convert.md`（spark id_convert type 20/21）
    │
    ├─ 需要把 飞书 user_id（employee_id）反查成 妙搭 userId？
    │   └─ 后端 ──→ `AuthNPaasService.getBatchMiaodaUserIds()`（第三节，SDK 一步，convertType 31）；非模板项目 ──→ `feishu` skill 两步兜底
    │
    └─ 需要自定义飞书 ID 转换接口？
        └─ 是 ──→ 注入 AuthNPaasService 编写 Controller（第四节，仅适用于 user_id）
```

> **相关技能**：接口认证/守卫/401 参见 `authn-guide`；登录/登出/获取用户信息等 Dataloom SDK 操作参见 `client-builtins-user-service`；**搜人 / 人员·部门·群组选择器返回的 ID 处理与字段获取**（employee_id / open_department_id、禁用字段、id_convert）参见 `contacts-service`；**"用户能做什么"**（角色/权限点位鉴权）参见 `authz-guide`。本 skill 只解决**"用户是谁"**（当前登录用户），其 `lark_user_id` == `employee_id`。

---

## 二、用户上下文（req.userContext）

`UserContextMiddleware` 解析 Gateway 注入的 `x-larkgw-suda-webuser` 头，把当前用户上下文挂到 `req.userContext`，所有 Controller 均可通过 `@Req() req: Request` 读取。

> 完整的解析→守卫流程见 `authn-guide` skill 第二节"认证流程"。

类型使用规则：Controller 直接用 `@Req() req: Request` 读取 SDK 增强的 `req.userContext`。测试、mock 或局部业务需要窄类型时，定义独立接口，只声明实际读取字段；不要继承 Express `Request`，也不要重声明平台增强的 `userContext`。未读取的 `tenantId` 省略；必须保留时用 `unknown` 或 SDK 兼容类型。

### 字段表

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | `string` | 妙搭用户 ID |
| `tenantId` | `number \| undefined` | 租户 ID；按 SDK Express `Request.userContext` 增强：可选 number |
| `appId` | `string` | 应用 ID |
| `loginUrl` | `string` | 登录跳转 URL |
| `userType` | `string` | 用户类型（如 `_employee`） |
| `env` | `string` | 环境（`preview` 预览态、`runtime` 发布运行态） |
| `userName` | `string` | 用户名 |
| `userNameI18n` | `{ zh_cn, en_us, ja_jp }` | 多语言用户名 |
| `isSystemAccount` | `boolean` | 是否系统账号 |
| `roles` | `string[] \| null` | 用户角色列表。**未开启权限服务或用户无角色时为 `null`** |
| `baseUrl` | `string` | 网关内部地址 |

### 服务端读取角色示例

`roles` 字段记录当前用户在应用中的角色列表，可在 Controller 业务逻辑中消费（如根据角色返回不同数据）：

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';   // ⚠️ Request 类型必须来自 'express'，不要 import 自 'http' / 'undici' 或漏掉 import
import { TaskService } from './task.service';   // 按项目实际路径 import 业务 Service

// req.userContext 的类型由 @lark-apaas/fullstack-nestjs-core 通过 declare module 'express' 自动注入到 Request，无需手动声明
@Controller('api/tasks')
export class TasksController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  async listTasks(@Req() req: Request) {
    const roles: string[] | null = req.userContext?.roles ?? null;
    // roles 示例：['text_editor', 'visitor', 'admin']
    // ⚠️ 未开启权限服务或用户无角色时为 null
    if (roles?.includes('admin')) {
      return this.taskService.findAll();
    }
    return this.taskService.findByUser(req.userContext?.userId);
  }
}
```

> **注意**：`roles` 在未开启权限服务或用户无角色时为 `null`，使用前必须做空值处理。

---

## 三、飞书 ID 转换（FeishuID Converter）

### 核心概念

妙搭平台的用户 ID（`userId`）与飞书用户 ID 是两套独立体系。调用飞书 OpenAPI 时需要传入某种飞书侧 ID（`open_id` / `union_id` / `user_id` 任选其一，具体通过哪个参数指定取决于 API：消息 API 用 `receive_id_type`，多数其他 API 用 `user_id_type`，文档协作者用 `member_id_type`）。

`AuthNPaasService` 暴露的飞书 ID 是 **`user_id`**（即 `employee_id`，飞书企业内的用户标识）这一种，支持 **妙搭 userId ↔ 飞书 user_id 双向**转换（正向 `getBatchLarkUserIds`/`getCurrentUserLarkUserId`，反向 `getBatchMiaodaUserIds`）。

> 如果需要 `open_id` / `union_id`（无论正反向），请改用飞书开放平台 `spark id_convert` 接口，参见 `feishu` skill 的 `references/id-convert.md`。`employee_id` ↔ 妙搭 userId 双向都在本 SDK 内（见下方方法表）。

### 后端 API

```typescript
import { Injectable } from '@nestjs/common';
import { AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';

@Injectable()
export class MyService {
  constructor(private readonly authnService: AuthNPaasService) {}

  async example() {
    // 获取当前登录用户的飞书 user_id
    const larkUserId = await this.authnService.getCurrentUserLarkUserId();
    // => '<飞书 user_id>' | null

    // 批量转换（最多 100 个）
    const larkUserIds = await this.authnService.getBatchLarkUserIds(['uid1', 'uid2']);
    // => ['<飞书 user_id>', null]  顺序与输入对应，失败项为 null

    // 反向：飞书 user_id（employee_id） → 妙搭 userId
    const miaodaUserIds = await this.authnService.getBatchMiaodaUserIds(['emp1', 'emp2']);
    // => ['<妙搭 userId>', null]  顺序与输入对应，失败项为 null
  }
}
```

| 方法 | 签名 | 说明 |
|------|------|------|
| `getCurrentUserLarkUserId` | `() → Promise<string \| null>` | 从请求上下文获取当前用户的飞书 ID |
| `getBatchLarkUserIds` | `(userIds: string[]) → Promise<(string \| null)[]>` | 批量转换，最多 100 个，与输入顺序一一对应 |
| `getBatchMiaodaUserIds` | `(employeeIds: string[]) → Promise<(string \| null)[]>` | 反向：批量把飞书 user_id（employee_id）转为妙搭 userId，最多 100 个，顺序一一对应，失败项 `null`（底层 convertType 31） |

### 内置接口

模块自动注册了 `GET /api/authnpaas/lark-user-id`，返回当前登录用户的飞书 ID：

```json
{ "lark_user_id": "<飞书 user_id>" }
```

### 前端获取

`useCurrentUserProfile()` Hook 已自动调用上述内置接口，返回值中包含 `lark_user_id` 字段：

> 本节示例只涉及 ID 相关字段（`user_id` / `lark_user_id`）和顺手的 `name`。完整返回值（`name` / `avatar` / `email` / `tenantId` 等）见 `client-builtins-user-service` skill。

```typescript
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';

const UserInfoPanel = () => {
  const userInfo = useCurrentUserProfile();

  if (!userInfo?.user_id) return <div>加载中...</div>;

  return (
    <div>
      <p>用户名: {userInfo.name}</p>
      <p>用户 ID: {userInfo.user_id}</p>
      {userInfo.lark_user_id && <p>飞书用户 ID: {userInfo.lark_user_id}</p>}
    </div>
  );
};
```

**注意**：
- `lark_user_id` 通过额外异步请求获取，可能晚于 `user_id` 等基础字段就绪
- 请求失败或用户无对应飞书账号时值为 `undefined`，**必须用条件渲染**
- `useCurrentUserProfile()` 的返回值里**不存在** `open_id`、`feishu_id`、`openId` 字段——在这个 Hook 的消费代码里飞书 ID 唯一字段名是 `lark_user_id`（仅约束本 Hook；项目其他场景调 spark `id_convert` / 通讯录 API 出现 `open_id` 是正常的）

---

## 四、自定义飞书 ID 转换接口

当内置接口不满足需求（如需要批量转换），可注入 `AuthNPaasService` 编写自定义 Controller：

```typescript
import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';

// 生产环境建议加 class-validator 装饰器（如 @IsArray() @IsString({ each: true })
// @ArrayMaxSize(100)）并启用全局 ValidationPipe；本示例聚焦 AuthNPaas 用法，省略校验
class BatchConvertDto {
  userIds!: string[];
}

@Controller('api/feishu-id')
export class FeishuIdController {
  constructor(private readonly authnService: AuthNPaasService) {}

  @Get('current')
  async getCurrent() {
    const larkUserId = await this.authnService.getCurrentUserLarkUserId();
    return { larkUserId };
  }

  @Post('batch')
  @HttpCode(200)
  async batchConvert(@Body() dto: BatchConvertDto) {
    const larkUserIds = await this.authnService.getBatchLarkUserIds(dto.userIds);
    return { larkUserIds };
  }
}
```

> 反向转换（employee_id → 妙搭 userId）同理，把 `getBatchLarkUserIds` 换成 `getBatchMiaodaUserIds` 即可，无需新增 Controller。

前端调用示例：

```typescript
// 获取当前用户飞书 ID
const { larkUserId } = await request<{ larkUserId: string | null }>({
  url: '/api/feishu-id/current',
  method: 'GET',
});

// 批量转换
const { larkUserIds } = await request<{ larkUserIds: (string | null)[] }>({
  url: '/api/feishu-id/batch',
  method: 'POST',
  data: { userIds: ['uid1', 'uid2', 'uid3'] },
});
```

---

## 五、禁止行为清单

| 禁止行为 | 正确做法 |
|---------|---------|
| 在 `useCurrentUserProfile()` 消费代码里使用 `open_id`、`feishu_id`、`openId` 等字段名 | `useCurrentUserProfile()` 中飞书 ID 的**唯一字段名**是 `lark_user_id`（限本 Hook；调 spark `id_convert` / 通讯录 API 出现 `open_id` 正常） |
| `lark_user_id` 为空时回退到 `user_id` 展示 | 两套 ID 体系完全不同，严禁互相回退。无值时不展示或展示"未关联飞书账号" |
| 前端直接展示 `lark_user_id` 而不处理空值 | `lark_user_id` 可能为 `undefined`（加载中/获取失败/无飞书账号），必须用条件渲染 |
| 用 `if (!userInfo)` 判断加载状态 | 初始值为空对象（truthy），必须用 `if (!userInfo?.user_id)` |
| 手动实例化 `AuthNPaasService` | 通过 NestJS 依赖注入获取：`constructor(private readonly authnService: AuthNPaasService)` |
| 单独注册 `AuthNPaasModule.forRoot()` | 已通过 `PlatformModule.forRoot()` 自动注册，无需手动导入 |
| 自行调用平台 `/v1/app/{appId}/account/user/convert` 接口 | 必须使用 `AuthNPaasService` 的方法，内置错误处理和可观测性 |
| `getBatchLarkUserIds` 传入超过 100 个 ID | 分批调用，每批最多 100 个 |
| 在前端自行封装飞书 ID 转换请求 | 使用 `useCurrentUserProfile()` 获取当前用户飞书 ID；批量转换通过后端接口 |

---

## 六、常见问题

> 接口 401 / 登录跳转相关问题见 `authn-guide` skill 第四节"常见问题"。

### 飞书 ID 返回 null

1. 确认用户已登录（`req.userContext.userId` 存在）
2. 确认 `appId` 在请求上下文中存在
3. 检查平台转换接口是否正常（查看后端日志中 `[batchConvertUserIds]` 相关输出）
4. 部分用户可能无对应飞书账号，此时转换结果为 null 是预期行为

### 前端 lark_user_id 一直为 undefined

1. 确认后端 `AuthNPaasModule` 已注册（内置接口 `/api/authnpaas/lark-user-id` 可访问）
2. 检查浏览器开发者工具中该接口的请求和响应
3. `lark_user_id` 异步加载，确保组件正确处理了加载态
