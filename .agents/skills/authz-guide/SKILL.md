---
name: authz-guide
description: "Use when writing permission control code with CanRole/@Can/useCan decorator, managing roles/members at runtime via AuthorizationSDK, implementing dynamic permission-point-based auth, designing RBAC role/permission system, debugging 403 errors, or checking role panel entry. 触发词：权限控制, CanRole, @Can, useCan, RBAC, 403, permission, access control, 鉴权代码, 角色面板, 运行时角色, 成员管理, AuthorizationSDK, 权限点位, 动态鉴权, 权限配置, authz_permissions, authz_role_permissions, IPermissionResolver, 设计权限体系, 开启权限服务, 规划角色, 开启角色服务, 设计角色"
steering: true
steering-topic: authz_guide
match-template-name: nestjs-react-fullstack
---

# RBAC 权限编码指南

## 本地 lark-cli 开发适配

本节只规定 `apps init` 后的本地工程识别、平台资源核验和验证流程，**不改变下方既有的权限模式、模板代码或页面规格**。

1. 以当前 `apps init` 工程为唯一项目根，先读取 `.spark/meta.json` 获取真实 `app_id`，再读取工程内 `.agents/skills/authz-guide/SKILL.md` 及当前模式引用的 reference。不得用目录名、用户口述的 ID 或工作区外同名 skill 代替。
2. 应用源码仍按本 skill 使用 `CanRole`、`AuthorizationSDK`、`@Can` / `<Can>` 实现；`lark-cli` 只负责平台角色、成员和应用数据库等外部资源操作，不能替代模板代码。
3. 代码或 SQL 使用具体角色标识前，先执行 `lark-cli apps +role-list --app-id <app_id> --as user --format json`；对每个已存在的目标 `role_id` 再执行 `lark-cli apps +role-get --app-id <app_id> --role-id <role_id> --as user --format json`。禁止把示例中的 `admin`、`editor` 等名称直接当作真实 `role_id`；新建角色则使用创建响应返回的 `role_id` 并独立回读。
4. 平台角色查询和变更统一使用 `lark-cli apps +role-*` / `+role-member-*`。真实写操作遵守命令自身的确认与回读要求；诊断和预演不得声称平台状态已经改变。
5. 收尾按项目 `package.json` 的真实脚本运行 typecheck、测试和 build，并确认新增页面、Controller、Module 已进入实际 router/bootstrap 注册链；只创建未接线文件不算完成。

如果请求只操作平台角色或成员、完全不修改应用源码，应停止使用本 skill，改用当前环境中的 `lark-apps` skill；只有应用代码改造才继续执行下方模板。

## 零、模式决策与实施

### 决策总表

| 信号 | 先 DESIGN？ | 模式 | 实施章节 | CanRole |
|------|------------|------|---------|---------|
| "加权限控制"、"按角色控制可见性" | 否 | 静态角色鉴权 | 第一节 | ✅ 使用 |
| "应用内管理角色成员"、"角色管理页面" | ✅ 是 | 静态 + 运行态角色管理 | 第一节 + 第二节 | ✅ 使用 |
| "开启权限服务"、"设计权限体系"、"规划角色" | ✅ 是 | 按方案决定 | 按方案 | 按方案 |
| "动态配置权限"、"无需改代码调整权限"、"权限点位" | ✅ 是 | 动态权限点位（新建） | 第二节 + 第三节 | ⛔ 禁止 |
| "升级为动态权限"、"CanRole 迁移到 Can" | ✅ 是 | 动态权限点位（升级） | 第三节（升级分支） | ⛔ 禁止 |

> **⛔ 互斥硬规则**：选择动态权限点位鉴权后，**全部业务鉴权和管理 API 鉴权必须用 `@Can`/`<Can>`**，禁止混用 `CanRole`。需求明确需要动态权限时，禁止先用 `CanRole` 实现再升级为 `@Can`，直接进入第三节，一步到位。

> **⛔ 点位全覆盖**：编写鉴权代码时，必须对照权限设计方案的**功能权限表**，将每个权限点位逐一落实到对应的后端 API（`@CanRole` / `@Can`）和前端入口（`<CanRole>` / `<Can>`），完成后逐行核对确认无遗漏。

> **⛔ 角色来源一律是平台，禁止另搞一套平台不认的权限系统**：多级审批、按城市/部门分权、多角色组合等复杂授权，角色必须是**平台真实角色**（先用 `lark-cli apps +role-list` 查询；需要创建时使用 `+role-create`，并让返回的 `role_id` 与代码对齐）。**消费平台角色的方式不限**——`@CanRole`/`@Can` 是语法糖；在 service 里读 `req.userContext.roles` 再判断是否包含已核验的角色标识，同样是走平台机制（roles 来自平台），按场景选用即可，**不强制每个 API 都用 `@CanRole`**（注解 cover 不了的细粒度场景就读 `userContext.roles` 自行判断）。**真正要禁止的是绕开平台另起炉灶**：自建任何平行的角色/权限存储（自建角色表 / 角色字段 / 用户名单，不限具体命名）、引用平台上不存在的角色标识——这些 dev 看似能跑、线上必失效。复杂度用「**平台角色（组合）+ 数据层行级过滤**」表达——例如"审核人只审本城市"=`reviewer` 角色把门 + service 按 `cityBranchId` 过滤；"多级审批"=每级一个平台角色 + 把"当前在第几级"存成业务数据状态。

### DESIGN 前置步骤

"开启权限服务"/"设计权限体系"/"规划角色"/"升级鉴权模式"/"开启角色服务" → **必须先结合现有代码和平台真实角色产出结构化权限设计方案**，用户确认后再实施。日常"给某功能加权限"不触发 DESIGN。

> **本地命令**：角色查询、创建、更新、成员维护和用户角色匹配分别使用 `lark-cli apps +role-*`、`+role-member-*`、`+role-match-list`；命令参数以当前 `lark-apps` skill 和 `--help` 为准。

### 403 统一处理（所有模式通用）

403 进入 response 分支还是 reject 分支取决于当前工程 `axiosForBackend` 的 `validateStatus` 和拦截器合同，**禁止断言 catch 永远捕获不到 403**。先读取工程内真实请求封装；在统一 API 层同时按其实际合同识别 403，业务组件只消费归一化后的无权限错误。

若当前请求器会 resolve 403，则在前端统一请求层按 response 检查并抛错，**禁止**在业务组件中单独处理：

```typescript
const response = await axiosForBackend(config);
if (response.status === 403) throw new Error('无操作权限，请联系管理员分配角色');
```

若请求器会 reject 403，则在同一 API 层从结构化错误中读取 HTTP status 后转换，并保留原始 cause；不要在页面 catch 中用错误字符串猜测。

本地只读排查 403 时，读取 `.spark/meta.json` 和真实 handler/policy 后，依次用 `+role-list`、`+role-match-list --user-id <open_id>`、`+role-get --role-id <required_role_id>` 对比“代码要求角色”和“用户实际命中角色”。只有代码绑定链和平台结果都能对上时才下根因结论，不为排查自动创建角色、添加成员或修改可见范围。

### 平台的角色面板入口

**只允许在对话中给其入口链接，严禁写到代码中**：`[角色面板](BaseURL?openPanel=auth)` 或 `[角色面板](?openPanel=auth)`

---

## 一、静态角色鉴权

### 核心原则

1. 系统已内置角色权限表，**无需也禁止自建任何平行的角色/权限存储**（自建角色表 / 角色字段 / 用户名单等，不限具体命名）——@CanRole 只读平台角色，应用自建的存储对鉴权无效
2. 统一使用 `useAuth()` 获取 `{ ability, isLoading }`，**禁止** `useAuthAbility` / `useCanRole`（已移除）
3. 必须处理 `isLoading`——加载期间 `ability.can()` 返回 false，不检查会误判无权限
4. 创建角色后必须编写鉴权代码，切忌只创建角色不编写代码
5. **`@CanRole([X])`/`<CanRole roles={[X]}>` 里的 X 必须等于平台实际角色标识，不能凭语义臆造**——需要稳定标识时用 `lark-cli apps +role-create --app-id <app_id> --name <name> --role-id <X> --as user` 创建并回读，已有角色先用 `+role-list` / `+role-get` 取得真实 `role_id` 再写代码。若代码写 `'admin'`/`'reviewer'` 但平台分配给用户的角色标识是 `role_xxx`，两者对不上 → 线上恒 403（日志可见 `用户角色 [role_xxx], 需要 [admin, reviewer]`）

### 前端

```typescript
import { CanRole, useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';

// 组件级 —— CanRole 内置 isLoading 保护，fallback 仅用于加载态占位（Skeleton/Spinner）
// ⛔ fallback 禁止传入 <Navigate> 等重定向组件
<CanRole roles={['admin', 'super_admin']} fallback={<MenuSkeleton />}>
  <NavLink to="/admin">后台管理</NavLink>
</CanRole>

// 路由级 —— 必须用 ProtectedRoute + useAuth，禁止用 CanRole 做路由守卫
const ProtectedRoute: React.FC<{ children: React.ReactNode; requiredRoles: string[] }> = ({ children, requiredRoles }) => {
  const { ability, isLoading } = useAuth();
  if (isLoading) return <Loading />;
  const hasPermission = requiredRoles.some((role) => ability.can(role, ROLE_SUBJECT));
  return hasPermission ? <>{children}</> : <Navigate to="/unauthorized" replace />;
};
```

### 后端

```typescript
import { CanRole } from '@lark-apaas/fullstack-nestjs-core';

@CanRole(['admin'])           // 单角色
@CanRole(['admin', 'editor']) // 多角色（OR 逻辑：任一即可）
```

---

## 二、运行态角色管理（AuthorizationSDK）

**前置条件**：应用已开启角色服务。

### 核心原则

1. 必须通过 `AuthorizationSDK` 操作，禁止自行封装 HTTP 或操作数据库
2. 通过 NestJS 依赖注入获取实例（`constructor(private readonly authzSDK: AuthorizationSDK)`），禁止手动实例化
3. 先根据 SDK 出入参签名定义接口规格（DTO / API Path / 请求方式），再写 Controller 和前端代码
4. 管理页面严格对标规格，禁止自由发挥

### 实施指引

| 内容 | 参考文档 |
|------|---------|
| Controller 注入 + DTO | [runtime-role-controller-spec.md](references/runtime-role-controller-spec.md) |
| Shared 类型定义 | [runtime-role-controller-spec.md § Shared 类型](references/runtime-role-controller-spec.md) |
| 管理页面 UI（从 Step 0 开始，禁止跳步） | [management-page-spec.md](references/management-page-spec.md) |
| SDK 完整类型 | [sdk-types.md](references/sdk-types.md) |
| SDK 调用示例 | [sdk-examples.md](references/sdk-examples.md) |

**关键约束**：
- 成员按类型分组传递（`MemberMutationData`），不是扁平数组
- `allEmployees`/`public` 只读，包含「企业全员」或「互联网公开」的角色不支持删除
- `userID` 可不传，默认为当前登录用户

---

## 三、动态权限点位鉴权（`@Can` + `<Can>`）

**适用场景**：运行时配置「哪个角色拥有哪些权限」，无需改代码调整权限策略。

| | 静态角色鉴权 | 动态权限点位鉴权 |
|---|---|---|
| 判断依据 | 用户是否属于某角色 | 角色是否拥有某权限点位 |
| 配置方式 | 代码硬编码角色名 | 运行时管理页面配置 |
| 后端 | `@CanRole(['admin'])` | `@Can('create', 'Task')` |
| 前端 | `<CanRole roles={[...]}>` | `<Can action="read" subject="Task">` |
| 数据存储 | 平台角色 API | 平台角色 API + 业务库 `authz_permissions` 和 `authz_role_permissions` 表 |

**必须严格遵循 [dynamic-permission-guide.md](references/dynamic-permission-guide.md) 实施，从 Step 0 开始逐步执行。** 禁止跳步或自由发挥。


---

## 四、禁止行为清单

| 禁止行为 | 正确做法 |
|----------|----------|
| 动态权限模式下使用 `CanRole`/`@CanRole`/`<CanRole>` | 全部用 `@Can`/`<Can>`，grep 确认零残留 |
| 需要动态权限时先落 CanRole 再升级 | 直接用 `@Can`/`<Can>`，一步到位 |
| 使用 `useAuthAbility` 或 `useCanRole` | 已移除，统一用 `useAuth()` |
| 不检查 `isLoading` 直接判断权限 | 必须先判断 `isLoading`，加载期间显示 Loading |
| `fallback` 中使用 `<Navigate>` 或重定向 | `fallback` 仅用于加载态占位（Skeleton/Spinner） |
| 绕过 AuthorizationSDK 自行封装接口 | 必须通过 SDK 操作运行时角色和权限点位 |
| 升级权限体系时未完成 DESIGN 就编码 | 先基于现有代码和平台角色产出方案，确认后再动手 |
| 在业务组件中单独处理 403 | API 层统一拦截 403 |
| 自建任意平行的角色/权限存储（自建角色表 / 角色字段 / 用户名单，不限具体命名）来做鉴权判断 | @CanRole 只认平台角色，应用自建的存储不会被鉴权读取；角色一律用平台真实角色 |
| 复杂授权就**另起炉灶搞一套平台不认的权限**（自建角色表 / 引用平台没 create 过的标识 / 写死 user_id 名单） | 角色一律用平台真实角色；消费方式不限（`@CanRole` 或读 `req.userContext.roles` 都行），复杂度用「平台角色 + 数据层行级过滤」表达 |
| `@CanRole([X])` 的 X 凭语义臆造、与平台真实角色标识不一致 | 用 `lark-cli apps +role-list` / `+role-get` 获取真实 `role_id`；需要稳定 ID 时创建角色显式传 `--role-id` |
| 未读取请求器合同就断言 403 只会进入 response 或 catch | 按实际 `validateStatus` / 拦截器合同在统一 API 层处理两种交付方式 |

---

## 五、常见问题

| 问题 | 处理方式 |
|------|---------|
| 403 错误 | 明确告知是无权限报错；用 `+role-match-list` 查询用户实际命中角色，并用 `+role-get` 核验代码要求的角色 |
| 线上 403 但 dev 正常 / 用户"已授权"仍 403 | 先核对两件事：(1) `+role-match-list` 返回的真实 `role_id` 是否等于代码 `@CanRole` 里的字符串；(2) 是否另搞了一套平台不认的权限（自建角色表 / 引用平台不存在的标识 / user_id 名单）绕开平台。再结合 handler/policy 的真实绑定链判断根因 |
| 开发环境授权不生效 | 用 `+role-match-list` 和 `+role-member-list` 核对平台真实状态，不尝试本地模拟角色 |
| 用户要求管理角色 | 开发态：`[角色面板](BaseURL?openPanel=auth)`；运行态：按第二节实施 |

---

## 六、自查清单

- [ ] 创建角色后编写了对应鉴权代码
- [ ] 对照功能权限表，每个点位均已落实到后端 API 和前端入口，无遗漏
- [ ] 前端从 `@lark-apaas/client-toolkit/auth` 导入
- [ ] `useAuth()` 已处理 `isLoading` 状态
- [ ] 前端 API 层统一处理了 403
- [ ] 前后端权限规则一致
- [ ] 开发完成后已用 `+role-match-list` 核对测试用户的真实角色；需要人工授权时给出角色面板入口
- [ ] 动态权限：通过 `PlatformModule.forRoot({ authz })` 注册 resolver，未单独注册 `AuthZPaasModule`
- [ ] 动态权限：grep 确认 `CanRole`/`useCanRole`/`@CanRole`/`<CanRole>` 零残留
- [ ] 运行态：管理页面对照 [management-page-spec.md 检查表](references/management-page-spec.md)
- [ ] 接口端到端测试通过
