---
name: client-builtins-user-service
description: 前端用户鉴权服务与组件指南，提供 authClient（来自 @lark-apaas/client-toolkit/auth）用户认证 API 和 React 用户组件。Use when 需要：(1) 实现登录/登出功能，(2) 获取当前用户信息或展示用户头像姓名，(3) 使用用户/部门选择器组件的 props 与挂载（选完拿哪个 ID/传飞书/字段获取见 contacts-service），(4) 处理 401 未授权错误
steering: true
steering-topic: client_builtins_user_service
match-template-name: nestjs-react-fullstack
---

# 账户/会话 SDK (authClient)

## 概述

项目通过 `authClient`（来自 `@lark-apaas/client-toolkit/auth`）提供用户信息与鉴权服务，用于用户登录、登出、获取用户信息等身份认证相关功能。

> **边界说明**：`authClient.session` 仅用于用户登录/登出/获取用户信息等鉴权操作。**插件调用（capability）不属于账户 SDK**，须使用独立的 `capabilityClient`（参见 plugin-guide）。
>
> **本地 dev 限制**：本 skill 的能力底层打 `/app/<appId>/__runtime__/api/v1/account/*`。这类端点只有在 `npm run dev:local` 成功 `env pull` 到 `MIAODA_DEV_PLATFORM_BASE`（或 `SANDBOX_PUBLIC_URL`）时才由 dev-proxy 反代到远端沙箱；**env pull 失败或未装 lark-cli 时该反代不挂**（启动脚本只 warn 不中断），表现为 POST 404 / GET 返回 200 + index.html。`useCurrentUserProfile()` 打的是 `account/login/user`；UserSelect / DepartmentSelect / UserDisplay 打 `search_user` / `list_users` / `user_profile` / `search_department`。先确认 `.env.local` 里有 `MIAODA_DEV_PLATFORM_BASE`；确实缺失时禁止改 `business-ui` 组件或换自研控件绕过，改由服务端出数据（`req.userContext` / `AuthNPaasService`）。
>
> **运行时边界**：本 skill 所有能力（`authClient`、`useCurrentUserProfile`、UserSelect/UserDisplay 等）仅限前端代码使用，**严禁在 `server/**` 中 import**。服务端获取用户身份用 `req.userContext` / `AuthNPaasService`（见 `user-identity` skill），完整边界规则见 coding-guide。

## 怎么选（决策指引）

- **React 组件内展示当前用户**（名称/头像/邮箱/飞书 ID）→ 用 `useCurrentUserProfile()`（见下文），不要手动调 `getUserInfo`
- **登录/登出/跳转用户详情页，或非 React 上下文取用户信息** → `authClient.session.*`（本节）
- **选人/选部门/展示任意用户** → UserSelect / DepartmentSelect / UserDisplay 组件（见下文）

## 统一响应结构

所有 `authClient.session.*` 接口返回统一的 `DataloomServiceResponse<T>` 结构。在非浏览器环境调用会返回失败结构（`status: 400`，`error.message: 'Incompatible runtime environment'`）。

```typescript
interface DataloomServiceBase {
  status: number;
  statusText: string;
}

interface DataloomServiceSuccess<T> extends DataloomServiceBase {
  error: null;
  data: T;
}

interface DataloomServiceFailure extends DataloomServiceBase {
  error: {
    code: number;
    details: string;
    hint: string | null;
    message: string;
  };
  data: null;
}

type DataloomServiceResponse<T> = DataloomServiceSuccess<T> | DataloomServiceFailure;
```

## authClient 引入方式

```typescript
import { authClient } from "@lark-apaas/client-toolkit/auth";
// authClient 是 SDK 内置的 singleton，零参可用，不需要异步初始化
```

## 接口速查表

| 方法                                      | 入参                           | 成功时 data 类型           | 说明                                           |
| ----------------------------------------- | ------------------------------ | -------------------------- | ---------------------------------------------- |
| `session.redirectToLogin(options?)`       | `SignInRedirectionOptions`     | `'success'`                | 跳转至 Dataloom 登录页（身份认证/单点登录）    |
| `session.signOut()`                       | 无                             | `null`（异步）             | 退出登录，删除 cookie 中的登录态               |
| `session.navigateToUserProfile(options?)` | `NavigateToUserProfileOptions` | `'success'`                | 跳转至当前登录用户详情页（头像/姓名点击进入）  |
| `session.getUserInfo()`                   | 无                             | `UserInfoResponse`（异步） | 获取当前登录用户信息，未登录返回 `status: 401` |

### 入参类型定义

```typescript
interface SignInRedirectionOptions {
  /** 选填，登录成功后跳转回的页面。省略默认用当前页面 URL */
  returnUrl?: string;
  /** 选填，是否在新浏览器 tab 打开登录页。默认 false */
  newTab?: boolean;
}

interface NavigateToUserProfileOptions {
  /** 选填，是否在新浏览器 tab 打开详情页。默认 false */
  newTab?: boolean;
}
```

### getUserInfo 返回类型定义

```typescript
interface I18n {
  language_code: number;
  text: string;
}

type I18ns = I18n[];

interface Avatar {
  source?: string;
  image?: {
    large?: string; // 图片url, 可能不返回
  };
  color?: string; // 颜色，可能不返回。
}

interface UserBaseInfo {
  user_id?: number;
  name?: I18ns;
  avatar?: Avatar;
  email?: string;
  phone_number?: string;
  tenant_name?: string;
}

interface UserInfoResponse {
  user_info?: UserBaseInfo;
}
```

### 综合示例

```typescript
import { authClient } from "@lark-apaas/client-toolkit/auth";
import { logger } from "@lark-apaas/client-toolkit/logger";

// 获取用户信息（React 组件内展示当前用户请优先用 useCurrentUserProfile，见下文）
const result = await authClient.session.getUserInfo();
if (result.error) {
  logger.error("获取用户信息失败:", result.error.message);
  if (result.status === 401) {
    // 未登录：跳转登录页（可传 returnUrl / newTab，默认回到当前页）
    authClient.session.redirectToLogin();
  }
} else if (result.data?.user_info) {
  const info = result.data.user_info;
  const userName = info.name?.[0]?.text || "未知用户"; // 名称是多语言数组
  const avatarUrl = info.avatar?.image?.large; // 头像 URL 可能不返回
  // React 中通过 state 渲染上述字段，禁止 document.getElementById 等直接 DOM 操作
}

// 退出登录后回到登录页
const signOutResult = await authClient.session.signOut();
if (!signOutResult.error) {
  authClient.session.redirectToLogin();
}

// 跳转当前用户详情页（新标签页打开）
authClient.session.navigateToUserProfile({ newTab: true });
```

## 错误处理

| 错误码 | 说明           | 处理建议               |
| ------ | -------------- | ---------------------- |
| `400`  | 请求参数错误   | 检查传入参数是否正确   |
| `401`  | 未授权访问     | 需要重新登录           |
| `403`  | 权限不足       | 联系管理员分配权限     |
| `404`  | 资源不存在     | 检查请求的资源是否存在 |
| `500`  | 服务器内部错误 | 稍后重试或联系技术支持 |

统一处理建议：`401` 调用 `authClient.session.redirectToLogin()`（见综合示例）；`403`/`500` 用 toast（如 `sonner`）提示用户；其余情况展示 `error.message`。

## 注意事项

1. **环境限制**：本 skill 涉及的 `@lark-apaas/client-toolkit/**` 能力只能在前端/浏览器环境中使用，服务端调用会返回环境不兼容错误；更重要的是，服务端代码中禁止 import 这些前端 SDK
2. **跨域配置**：确保应用域名已在 Dataloom 后台配置白名单
3. **安全性**：不要在客户端代码中暴露敏感的配置信息

# 用户系统前端相关规范

## 概述

内置用户前端组件：UserSelect（单选/多选用户选择器，onChange 返回用户对象）、DepartmentSelect（部门选择组件，交互与受控规范与 UserSelect 一致）、UserDisplay（用户信息展示组件）。均基于统一的 userid 数据，用于用户相关的表单输入和数据展示场景。

## 类型定义

### 用户数据类型

```typescript
import type { User } from "@/types/common";
```

`User` 接口包含用户的基本信息，如用户 ID、姓名、头像字段。

```typescript
export type User = {
  /** 妙搭用户 ID：入库、传飞书内置插件、跨边界透传一律用它 */
  user_id: string;
  /** 飞书企业内 user_id（仅内部飞书用户），调飞书开放平台 API 用它 */
  employee_id?: string;
  name: string;
  avatar: string;
};
```

> **用户/部门 ID 怎么选、字段获取与权限引导 → 见 [`contacts-service`](../contacts-service/SKILL.md) skill；本 skill 只讲组件 API 用法。**

## 当前用户信息的获取方案

### Hooks 方法: `useCurrentUserProfile` - 在 React 中获取当前用户信息

- **文件路径**：`@lark-apaas/client-toolkit/hooks/useCurrentUserProfile`
- **功能**：获取当前登录用户的个人信息（含飞书 user_id）
- **返回值**：`Partial<IUserProfile>`（初始为空对象 `{}`，异步获取后填充完整字段）

**IUserProfile 字段**：

| 字段           | 类型     | 说明                                                     |
| -------------- | -------- | -------------------------------------------------------- |
| `user_id`      | `string` | 妙搭用户 ID                                              |
| `email`        | `string` | 用户邮箱                                                 |
| `name`         | `string` | 用户名称                                                 |
| `avatar`       | `string` | 用户头像 URL                                             |
| `lark_user_id` | `string` | 飞书 user_id，通过额外异步请求获取，可能晚于其他字段就绪 |

> ⚠️ **空值处理（CRITICAL）**：Hook 初始返回空对象 `{}`（truthy），**MUST** 用 `if (!userInfo?.user_id)` 判加载态（不是 `!userInfo`）；`lark_user_id` 可能为 `undefined`，使用前条件渲染。完整禁止行为清单与飞书 ID 转换指南（后端 `AuthNPaasService` 等）参见 `user-identity` skill。

```typescript
import { useCurrentUserProfile } from "@lark-apaas/client-toolkit/hooks/useCurrentUserProfile";

const MyComponent = () => {
  const userInfo = useCurrentUserProfile();
  if (!userInfo?.user_id) return <div>加载中...</div>;
  return <p>{userInfo.name}</p>;
};
```

## 用户展示与选择方案

这些组件在使用之前必须读取 client/src/components/business-ui/README.md文件来理解用法

目前可用的组件有：

- UserSelect 用户选择组件（@/components/business-ui/user-select）
- DepartmentSelect 部门选择组件（@/components/business-ui/department-select）
- UserDisplay - 用户展示组件（@/components/business-ui/user-display）

## 使用注意事项

### 最佳实践

- 根据展示场景选择合适的组件尺寸（`small`、`medium`、`large`）
- 对于用户信息 userId，禁止直接展示文本，总是使用 UserDisplay 组件展示
