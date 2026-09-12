# 动态权限点位鉴权实施规格

> **本规格为强制约束**，实现时必须逐项对照，严禁自由发挥。

---

## 本地 lark-cli 执行适配

本节只替换旧工具的本地执行入口，**不改变后续数据库结构、权限模型、Controller 或页面模板**。

- 从当前 `apps init` 工程的 `.spark/meta.json` 读取真实 `app_id`。
- 平台角色用 `lark-cli apps +role-list` 查询，并对 SQL 将引用的每个 `role_id` 执行 `+role-get`；示例中的 `admin` / `member` 只是占位，不得未经核验直接落库。
- DDL、DML、SELECT 都通过 `lark-cli apps +db-execute` 执行。SQL 文件使用当前工程内的相对路径；固定多环境目标时显式传 `--environment dev|online`，未开启多环境时不强行传 `dev`。
- 先用 `--dry-run` 预演；真实执行获得确认后改用 `--yes`。dry-run 不会改变数据库，不能在预演后执行 SELECT 并声称已验证落库结果。
- `+db-execute` 不会自动包事务。继续保留下文既有的 DDL、权限点位、角色映射分步顺序；若业务要求原子性，在 SQL 内显式使用事务。

命令骨架：

```bash
lark-cli apps +db-execute --app-id <app_id> --file ./path/to/step.sql --dry-run --as user --format json
# 用户确认真实写入后：
lark-cli apps +db-execute --app-id <app_id> --file ./path/to/step.sql --yes --as user --format json
```

---

## 技术架构

```
角色管理页面（增强）              前端应用                       后端 API
┌──────────────────┐          ┌──────────────┐          ┌──────────────────┐
│ 角色-权限映射配置  │          │ AppContainer │          │ @Can('read','Task')│
│ （配置权限菜单项） │          │  <Can>/useCan│          │       Guard       │
└──────┬───────────┘          └──────┬───────┘          └────────┬─────────┘
       │                             │                           │
       │ 映射 CRUD API               │ 自动请求内置端点            │ 鉴权时查询
       ▼                             ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  PlatformPermissionController (内置端点，自动提供)                │
│  authz_permissions 表 + authz_role_permissions 表                      │
│  DbPermissionResolver (IPermissionResolver)                      │
└─────────────────────────────────────────────────────────────────┘
```

> **前端无需手动配置权限点位获取**：auth-sdk 的 `AuthProvider` 会自动请求内置端点获取当前用户的权限点位，业务侧不需要传任何额外配置。

**关键约束**：
- 权限点位（`authz_permissions` 表）的增删改**由 Agent 通过 DDL 操作**，确保与代码中的 `@Can`/`<Can>` 保持一致
- 管理页面**只负责角色-点位映射**的勾选/取消，不提供权限点位的 CRUD
- **⛔ 启用动态权限后禁止使用 CanRole**：所有鉴权（包括管理 API）统一使用 `@Can`/`<Can>`，不允许 CanRole 与 Can 混用

---

## 实现步骤清单

按以下顺序逐步实现，**禁止跳步或合并步骤**：

```
Step 0: 权限设计方案 + 实施计划（强制，禁止跳过。本清单即为完整说明，无独立章节）
  ├─ 通读本规格全文，理解完整实施流程
  ├─ 判断当前是新建还是升级场景
  ├─ 新建和升级场景都必须先结合现有代码与平台真实角色产出权限设计方案
  │   ├─ 升级场景：DESIGN 基于现有代码和用户升级需求产出新版方案
  │   └─ 向用户展示方案，等待确认
  ├─ 输出结构化实施计划，列出每个 Step 要创建/修改的文件清单
  └─ ⛔ 未完成权限设计方案就开始写代码/修改数据库 = 违规

Step 1: 数据库表 + 数据初始化（⛔ 必须严格按 1.1→1.2→1.3→1.4 顺序，禁止合并）
  ├─ 1.1 DDL 建表，等待确认执行完成
  ├─ 1.2 单独 INSERT authz_permissions（权限点位定义）
  ├─ 1.3 确认 1.2 成功后，单独 INSERT authz_role_permissions（角色-点位映射，依赖 1.2 的 id）
  └─ 1.4 SELECT 验证两张表 row_count > 0，authz_role_permissions 为 0 则重新执行 1.3

Step 2: 后端权限解析器
  └─ 创建 DbPermissionResolver，实现 IPermissionResolver 接口

Step 3: 后端模块注册
  ├─ 创建 PermissionModule
  └─ 在 app.module.ts 中通过 PlatformModule.forRoot({ authz: { permissionResolver } }) 注册

Step 4: 后端权限管理 API
  ├─ 权限点位只读查询 GET /api/permissions（供管理页面展示可勾选列表）
  └─ 角色-权限映射 CRUD
  （用户权限查询由内置 PlatformPermissionController 自动提供，无需实现）

Step 5: 鉴权代码
  ├─ 新建场景：直接使用 @Can('action', 'Subject') 和 <Can action subject>
  ├─ 升级场景：将所有 @CanRole → @Can，<CanRole> → <Can>（包括管理 API）
  │   ⛔ 必须全量替换，不允许保留任何 CanRole
  │   完成替换后，执行 grep 确认零残留（见 Step 9 验证）
  └─ ⛔ 对照功能权限表，将每个点位逐一落实到后端 API 和前端入口，完成后逐行核对确认无遗漏

Step 6: 前端权限初始化
  └─ 在 api 层添加权限管理相关的请求函数（权限点位列表、角色映射 CRUD）
  （用户权限点位获取由 auth-sdk 自动完成，无需手动配置）

Step 7: 前端 UI 权限控制
  └─ 统一使用 Can 组件 / useCan Hook

Step 8: 管理页面增强
  ├─ 新建场景：创建角色管理页面时直接包含权限增强
  ├─ 升级场景：在已有角色管理页面上增加
  ├─ 角色表格新增「权限点位」列
  └─ 操作列「更多操作」`...` 菜单新增「配置权限」项 + Dialog（不外露为按钮）

Step 9: 验证（禁止跳过）
  ├─ 编译通过
  ├─ grep 确认 CanRole 零残留：
  │   grep -r "CanRole\|useCanRole\|ROLE_SUBJECT" --include="*.ts" --include="*.tsx" server/ client/ shared/
  │   ⛔ 结果必须为空，否则回到 Step 5 继续替换
  └─ 逐项对照「实现检查表」
```

---

## Step 1: 数据库表 + 数据初始化

> 本地依次使用 `lark-cli apps +db-execute` 执行 Step 1.1、1.2、1.3；Step 1.4 仍使用同一命令执行只读 SELECT。每一步先预演，真实执行时等待上一条命令成功返回后再继续。

**⛔ 必须严格按以下三步顺序执行，禁止合并步骤或跳步。`authz_role_permissions` 有外键依赖 `authz_permissions`，合并执行会导致映射表静默为空。**

### 1.1 建表（DDL）

将以下 DDL 保存到当前工程内的 SQL 文件，通过 `lark-cli apps +db-execute --file <relative.sql>` 预演和执行（禁止用手工修改 `database/schema.ts` 代替真实 DDL；执行后按项目现有机制核对生成或同步的 schema）。**必须等真实 DDL 执行成功后，再进入 1.2；只有 dry-run 时不得声称 schema 已生成。**

```sql
CREATE TABLE authz_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  _created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  _created_by user_profile,
  _updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  _updated_by user_profile,
  UNIQUE(action, subject)
);

CREATE TABLE authz_role_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role_key VARCHAR(100) NOT NULL,
  permission_id UUID NOT NULL REFERENCES authz_permissions(id) ON DELETE CASCADE,
  _created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  _created_by user_profile,
  _updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  _updated_by user_profile,
  UNIQUE(role_key, permission_id)
);
```

### 1.2 预填权限点位（DML 第一步）

DDL 确认执行完成后，**单独执行** `authz_permissions` 的 INSERT：

```sql
-- ⚠️ 必须包含 manage:Permission 点位，用于保护权限管理 API（替代 CanRole）
INSERT INTO authz_permissions (action, subject, description) VALUES
  ('manage', 'Permission', '管理权限配置'),
  ('read', 'Task', '查看任务'),
  ('create', 'Task', '创建任务'),
  ('update', 'Task', '编辑任务'),
  ('delete', 'Task', '删除任务');
```

### 1.3 预填角色-点位映射（DML 第二步）

**确认 1.2 执行成功后**，再执行 `authz_role_permissions` 的 INSERT（依赖 `authz_permissions` 的 id）：

```sql
-- ⚠️ admin 角色必须映射 manage:Permission，否则管理 API 无人可访问
INSERT INTO authz_role_permissions (role_key, permission_id) VALUES
  ('admin', (SELECT id FROM authz_permissions WHERE action='manage' AND subject='Permission')),
  ('admin', (SELECT id FROM authz_permissions WHERE action='read' AND subject='Task')),
  ('admin', (SELECT id FROM authz_permissions WHERE action='create' AND subject='Task')),
  ('admin', (SELECT id FROM authz_permissions WHERE action='update' AND subject='Task')),
  ('admin', (SELECT id FROM authz_permissions WHERE action='delete' AND subject='Task')),
  ('member', (SELECT id FROM authz_permissions WHERE action='read' AND subject='Task')),
  ('member', (SELECT id FROM authz_permissions WHERE action='create' AND subject='Task'));
```

执行前必须把示例 `admin` / `member` 替换为 `+role-list` 返回并经 `+role-get` 逐个核验的真实 `role_id`，然后在 SQL 和相关源码中搜索确认占位值已零残留。

### 1.4 验证（禁止跳过）

真实执行完 1.3 后，**必须立即通过 `+db-execute` 查询两张表确认数据条数**；纯 dry-run 场景跳过本节并明确数据库未改变：

```sql
SELECT 'authz_permissions' AS table_name, COUNT(*) AS row_count FROM authz_permissions
UNION ALL
SELECT 'authz_role_permissions', COUNT(*) FROM authz_role_permissions;
```

⛔ 两张表的 `row_count` 都必须 > 0。如果 `authz_role_permissions` 为 0，说明 1.3 未成功执行，必须重新执行。

> 以上 SQL 仅为示例，实际数据根据权限设计方案的第 4、5 节生成。`manage:Permission` 点位为必选项，确保管理 API 通过动态权限而非 CanRole 保护。

---

## Step 2: 后端权限解析器

创建 `server/modules/permission/db-permission-resolver.ts`：

```typescript
import { Injectable, Inject } from '@nestjs/common';
import type { IPermissionResolver, PermissionPoint } from '@lark-apaas/fullstack-nestjs-core';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { authzRolePermissions, authzPermissions } from '../../database/schema';
import { inArray, eq } from 'drizzle-orm';

@Injectable()
export class DbPermissionResolver implements IPermissionResolver {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async resolvePermissions(roleKeys: string[]): Promise<PermissionPoint[]> {
    if (roleKeys.length === 0) return [];
    const rows = await this.db
      .select({
        id: authzPermissions.id,
        action: authzPermissions.action,
        subject: authzPermissions.subject,
        description: authzPermissions.description,
      })
      .from(authzRolePermissions)
      .innerJoin(authzPermissions, eq(authzRolePermissions.permissionId, authzPermissions.id))
      .where(inArray(authzRolePermissions.roleKey, roleKeys));
    const seen = new Set<string>();
    return rows.filter(r => {
      const key = `${r.action}:${r.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(r => ({
      id: r.id,
      action: r.action,
      subject: r.subject,
      description: r.description ?? undefined,
    }));
  }
}
```

---

## Step 3: 后端模块注册

### 3.1 创建 PermissionModule

```typescript
import { Module } from '@nestjs/common';
import { DbPermissionResolver } from './db-permission-resolver';
import { PermissionController } from './permission.controller';

@Module({
  controllers: [PermissionController],
  providers: [DbPermissionResolver],
  exports: [DbPermissionResolver],
})
export class PermissionModule {}
```

### 3.2 在 app.module.ts 中注册

通过 `PlatformModule.forRoot()` 的 `authz` 选项透传 `permissionResolver`，**不要单独注册 `AuthZPaasModule.forRoot()`**（`PlatformModule` 内部已注册，重复注册会导致全局模块冲突，`permissionResolver` 被空注册覆盖为 null）。

```typescript
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';
import { DbPermissionResolver } from './modules/permission/db-permission-resolver';
import { PermissionModule } from './modules/permission/permission.module';

@Module({
  imports: [
    PlatformModule.forRoot({
      authz: { permissionResolver: DbPermissionResolver },
    }),
    PermissionModule,
    // ... 其他业务模块
    ViewModule,
  ],
})
export class AppModule {}
```

---

## Step 4: 后端权限管理 API

创建 `server/modules/permission/permission.controller.ts`：

```typescript
import { Controller, Get, Post, Body, Inject } from '@nestjs/common';
import { Can } from '@lark-apaas/fullstack-nestjs-core';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { authzPermissions, authzRolePermissions } from '../../database/schema';
import { eq, and, inArray } from 'drizzle-orm';

@Controller('api/permissions')
export class PermissionController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ---- 权限点位只读查询（供管理页面展示可勾选列表） ----

  @Can('manage', 'Permission')
  @Get()
  async listPermissions() {
    return this.db.select().from(authzPermissions);
  }

  // ---- 角色-权限映射 ----

  @Can('manage', 'Permission')
  @Get('role-mappings')
  async listRoleMappings() {
    return this.db.select().from(authzRolePermissions);
  }

  @Can('manage', 'Permission')
  @Post('role-mappings/batch')
  async batchUpdateRoleMappings(
    @Body() dto: { roleKey: string; add: string[]; remove: string[] },
  ) {
    await this.db.transaction(async (tx) => {
      if (dto.remove.length > 0) {
        await tx.delete(authzRolePermissions).where(
          and(
            eq(authzRolePermissions.roleKey, dto.roleKey),
            inArray(authzRolePermissions.permissionId, dto.remove),
          ),
        );
      }
      if (dto.add.length > 0) {
        await tx.insert(authzRolePermissions).values(
          dto.add.map((permissionId) => ({ roleKey: dto.roleKey, permissionId })),
        );
      }
    });
  }
}
```

API 端点汇总：

| 端点 | 方法 | 说明 | 来源 |
|------|------|------|------|
| `/api/permissions` | GET | 权限点位列表（只读） | 业务 Controller |
| `/api/permissions/role-mappings` | GET | 角色-权限映射列表 | 业务 Controller |
| `/api/permissions/role-mappings/batch` | POST | 批量更新映射（Body: `{ roleKey, add: permissionId[], remove: permissionId[] }`） | 业务 Controller |
| （内置端点） | GET | 当前用户的权限点位 | **内置**（PlatformPermissionController，自动注册） |

> - 当前用户权限点位查询由 `AuthZPaasModule` 内置的 `PlatformPermissionController` 自动提供，**业务侧无需实现**
> - 权限点位的增删改由 Agent 通过 DDL 操作，不提供 POST/PUT/DELETE 接口，确保点位定义与代码中的 `@Can`/`<Can>` 保持一致

---

## Step 5: 鉴权代码

**⛔ 必须对照权限设计方案的功能权限表，将每个权限点位逐一落实到对应的后端 API（`@Can`）和前端入口（`<Can>`），完成后逐行核对确认无遗漏。**

```typescript
import { Can } from '@lark-apaas/fullstack-nestjs-core';

// 后端：新建直接用 @Can；升级则将 @CanRole(['admin']) → @Can('action', 'Subject')
@Can('read', 'Task')   @Get()    findAll() { ... }
@Can('create', 'Task')  @Post()   create() { ... }
@Can('update', 'Task')  @Put(':id')  update() { ... }
@Can('delete', 'Task')  @Delete(':id') remove() { ... }

// 前端：<CanRole roles={['admin']}> → <Can action="update" subject="Task">
<Can action="update" subject="Task">
  <Button>编辑</Button>
</Can>
```

**关键约束**：
- **⛔ 动态权限模式下禁止 `@CanRole`**，所有鉴权（含管理 API）统一用 `@Can`
- 未注入 `permissionResolver` 时使用 `@Can` 会抛出 500 错误
- 多权限叠加装饰器：`@Can('read', 'Task') @Can('read', 'User')`

---

## Step 6: 前端权限初始化

### 前端 API 函数

在 `client/src/api/index.ts` 中添加**管理页面所需**的请求函数：
- 权限点位查询 API（listPermissions）
- 角色-权限映射 CRUD API（listRoleMappings / createRoleMapping / deleteRoleMapping）

> **无需添加用户权限查询 API**：auth-sdk 的 `AuthProvider` 会自动请求内置端点获取当前用户的权限点位，业务侧不需要手动配置。`AppContainer` 也无需传入任何额外 prop。

---

## Step 7: 前端 UI 权限控制

统一使用 `Can` 组件和 `useCan` Hook（**禁止**旧的 `CanPermission` / `useCanPermission`，已删除）：

```typescript
import { Can, useCan, useAuth } from '@lark-apaas/client-toolkit/auth';

// 组件方式（推荐，自动处理 isLoading）
<Can action="delete" subject="Task">
  <Button variant="destructive">删除</Button>
</Can>

// Hook 方式 — 返回 { allowed, isLoading }，必须手动处理 isLoading
const { allowed: canDelete, isLoading } = useCan('delete', 'Task');
```

### 路由守卫（ProtectedRoute）

动态权限模式下，路由守卫必须基于权限点位判断（`requiredPermissions`），**禁止使用 `requiredRoles` + `ability.can(role, ROLE_SUBJECT)` 的静态角色模式**：

```typescript
const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  requiredPermissions: { action: string; subject: string }[];
}> = ({ children, requiredPermissions }) => {
  const { ability, isLoading } = useAuth();
  if (isLoading) return <Loading />;
  const hasPermission = requiredPermissions.every(
    ({ action, subject }) => ability.can(action, subject),
  );
  return hasPermission ? <>{children}</> : <Navigate to="/unauthorized" replace />;
};

// 使用示例
<ProtectedRoute requiredPermissions={[{ action: 'manage', subject: 'Permission' }]}>
  <RoleManagementPage />
</ProtectedRoute>
```

---

## Step 8: 管理页面增强

**不创建独立的权限管理页面**，在角色管理页面基础上增强。完整 UI 规格和代码模板见 [management-page-spec.md § 动态权限增强](management-page-spec.md#动态权限增强仅动态权限点位模式)。

新增两项功能：

### 1. 角色表格新增「权限点位」列

| 列 | key | width | 渲染规则 |
|---|-----|-------|---------|
| 权限点位 | `permissions` | 250 | 只展示 `description`；最多 3 个，超出用 `+N` Badge + HoverCard；无绑定显示 `--` |

### 2. 操作列新增「配置权限」

收进 `...` 更多操作下拉菜单，**不单独外露**。点击打开 Dialog：

```
┌──────────────────────────────────────────────┐
│  配置权限 - 销售专员                           │
│  勾选后保存将替换当前权限。                      │
├──────────────────────────────────────────────┤
│  ▼ 客户 (1/4)                                │
│  │ ☑ 查看客户列表与详情   read:Customer        │
│  │ ☐ 创建客户            create:Customer      │
│  ▶ 权限管理 (0/1)                            │
├──────────────────────────────────────────────┤
│                          [取消]  [保存]        │
└──────────────────────────────────────────────┘
```

**Subject 中文映射**：

```ts
const SUBJECT_LABELS: Record<string, string> = {
  Customer: '客户',
  Task: '任务',
  Permission: '权限管理',
  // 按权限设计方案的 Subject 补充...
};
const getSubjectLabel = (subject: string) => SUBJECT_LABELS[subject] ?? subject;
```

**ConfigPermissionsDialog 组件**：

```tsx
import { useMemo, useState } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function ConfigPermissionsDialog({ role, permissions, mappings, open, onOpenChange, onRefresh }) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>();
    permissions.forEach(p => {
      const list = map.get(p.subject) || [];
      list.push(p);
      map.set(p.subject, list);
    });
    return map;
  }, [permissions]);

  const initialIds = useMemo(() => new Set(
    mappings.filter(m => m.roleKey === role?.bizID).map(m => m.permissionId)
  ), [mappings, role]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialIds));

  const defaultExpanded = useMemo(() =>
    Array.from(grouped.keys()).filter(subject =>
      grouped.get(subject)!.some(p => initialIds.has(p.id))
    ),
  [grouped, initialIds]);

  const handleToggle = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleSave = async () => {
    const add = [...selectedIds].filter(id => !initialIds.has(id));
    const remove = [...initialIds].filter(id => !selectedIds.has(id));
    if (add.length > 0 || remove.length > 0) {
      await batchUpdateRoleMappings({ roleKey: role.bizID, add, remove });
    }
    onRefresh();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>配置权限 - {role?.name}</DialogTitle>
          <DialogDescription>勾选后保存将替换当前权限。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Accordion type="multiple" defaultValue={defaultExpanded}>
            {Array.from(grouped.entries()).map(([subject, perms]) => {
              const enabledCount = perms.filter(p => selectedIds.has(p.id)).length;
              const allSelected = enabledCount === perms.length;
              return (
                <AccordionItem key={subject} value={subject}>
                  <div className="flex items-center gap-2 px-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => {
                        const ids = perms.map(p => p.id);
                        setSelectedIds(prev => {
                          const without = new Set([...prev].filter(id => !ids.includes(id)));
                          if (checked) ids.forEach(id => without.add(id));
                          return without;
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <AccordionTrigger className="py-2 text-sm flex-1">
                      {getSubjectLabel(subject)} ({enabledCount}/{perms.length})
                    </AccordionTrigger>
                  </div>
                  <AccordionContent className="px-3 bg-muted/50 rounded-b-md">
                    {perms.map(p => (
                      <label key={p.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={v => handleToggle(p.id, !!v)} />
                        <span className="text-sm">{p.description}</span>
                        <code className="text-xs text-muted-foreground">{p.action}:{p.subject}</code>
                      </label>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**布局规则**：
- 按 `subject` 分组为可展开/收起的 Accordion 卡片，标题 `Subject中文名 (已开启/总数)`
- 有已勾选权限的 Subject 默认展开，全未勾选的默认收起
- 每行：`Checkbox + description + action:subject badge（置灰小字）`
- 保存时对比初始/当前状态算 diff，调用 `batchUpdateRoleMappings` 提交 `{ roleKey, add, remove }`
- 复用 `Accordion`、`Checkbox`、`Dialog` 组件

### 数据加载

`loadRoles` 需额外并行加载权限点位和映射数据：

```typescript
const [roles, perms, maps] = await Promise.all([
  getRoles(), listPermissions(), listRoleMappings(),
]);
```

---

## 错误处理

SDK 内部统一将平台错误转为 `HttpException`，Controller 无需 try-catch：

| 场景 | HTTP 状态码 | 说明 |
|------|-----------|------|
| 平台 4xx | 透传 | 参数错误、权限不足等 |
| 平台 5xx | 502 | 平台内部错误 |
| HTTP 200 + `status_code !== '0'` | 502 | 平台业务错误 |

---

## Step 9: 验证（禁止跳过）

1. 确认编译通过
2. grep 确认 CanRole 零残留：
   ```bash
   grep -r "CanRole\|useCanRole\|ROLE_SUBJECT" --include="*.ts" --include="*.tsx" server/ client/ shared/
   ```
   ⛔ 结果必须为空，否则回到 Step 5 继续替换
3. 逐项对照下方「实现检查表」

---

## 实现检查表

- [ ] **权限设计方案**：升级场景已结合用户需求和现有实现产出新版权限设计方案，并获得用户确认
- [ ] **场景判断**：明确判断了是新建还是升级场景
- [ ] **数据库**：通过 `lark-cli apps +db-execute` 创建了 `authz_permissions` 和 `authz_role_permissions` 两张表；已区分 dry-run 与真实执行，真实 DDL 确认完成后才继续
- [ ] **数据预填**：分两步 INSERT（先 `authz_permissions`，再 `authz_role_permissions`），SELECT 验证两张表 row_count > 0
- [ ] **Resolver**：`DbPermissionResolver` 实现了 `IPermissionResolver` 接口
- [ ] **模块注册**：`app.module.ts` 中通过 `PlatformModule.forRoot({ authz: { permissionResolver: DbPermissionResolver } })` 注册（不要单独注册 `AuthZPaasModule.forRoot()`）
- [ ] **权限管理 API**：权限点位只读 GET + 角色映射 CRUD（用户权限查询由内置端点自动提供）
- [ ] **鉴权代码**：新建用 `@Can`/`<Can>`；升级已将所有 `@CanRole` → `@Can`，`<CanRole>` → `<Can>`（包括管理 API），grep 确认项目中 `CanRole`/`useCanRole` 零残留
- [ ] **manage:Permission 点位**：`authz_permissions` 表中包含 `manage:Permission` 点位，admin 角色已映射该点位，PermissionController 使用 `@Can('manage', 'Permission')`
- [ ] **前端权限控制**：使用 `<Can action subject>` 组件或 `useCan(action, subject)` Hook
- [ ] **isLoading 处理**：`useCan` 使用处检查了 `isLoading`
- [ ] **管理页面增强**：角色表格有权限点位列 + 配置权限菜单项（收在 `...` 下拉内，不外露）
- [ ] **类型安全**：代码中无 `any` 类型，使用具体类型或判别联合类型
- [ ] **前后端统一**：后端 `@Can('read', 'Task')` 对应前端 `<Can action="read" subject="Task">`
- [ ] **端到端测试**：角色权限相关接口（权限点位查询、角色-权限映射 CRUD 等）开发完成后，对每个接口进行端到端测试，确认：(1) 接口按预期定义返回 (2) 接口对数据库的 CRUD 与数据库状态一致
