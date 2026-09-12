# 运行态角色管理 Controller 实施规格

> **前置条件**：应用必须已开启角色服务。

---

## 1. 注入

```typescript
import { AuthorizationSDK } from '@lark-apaas/fullstack-nestjs-core';

// AuthorizationSDK 由 AuthZPaasModule 全局注册，直接注入即可
// SDK 自动从请求上下文获取 appId 和 userId
constructor(private readonly authzSDK: AuthorizationSDK) {}
```

## 2. DTO 定义

```typescript
import type { MemberMutationData, FilterParams, MemberType } from '@lark-apaas/fullstack-nestjs-core';

export class CreateRoleDto {
  role: { name: string; description?: string; bizID: string };
  userID?: string;  // 可不传，默认为当前登录用户
}

export class UpdateRoleDto {
  role: { name?: string; description?: string };
  userID?: string;
}

export class AddMembersDto {
  members: MemberMutationData;
  userID?: string;
}

export class RemoveMembersDto {
  members: MemberMutationData;
  userID?: string;
}

export class SearchDto {
  query: string;
  filters?: FilterParams;
  includeExternalUser?: boolean;
  includeExternalGroup?: boolean;
  pageSize?: number;
  page?: number;
  userID?: string;
}

export class ListMembersQueryDto {
  type?: MemberType;
  page?: number;
  pageSize?: number;
}
```

## 3. Controller

管理接口可按需改为 `@CanRole(['admin'])`：

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { AuthorizationSDK } from '@lark-apaas/fullstack-nestjs-core';

@Controller('api/role_manager')
export class AuthorizationController {
  constructor(private readonly authzSDK: AuthorizationSDK) {}

  @Get('roles')
  listRoles() { return this.authzSDK.roles.list(); }

  @Get('roles/:bizID')
  getRole(@Param('bizID') bizID: string) { return this.authzSDK.roles.get(bizID); }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) { return this.authzSDK.roles.create(dto); }

  @Put('roles/:bizID')
  updateRole(@Param('bizID') bizID: string, @Body() dto: UpdateRoleDto) {
    return this.authzSDK.roles.update(bizID, dto);
  }

  @Delete('roles/:bizID')
  deleteRole(@Param('bizID') bizID: string) { return this.authzSDK.roles.delete(bizID); }

  @Get('roles/:bizID/members')
  listMembers(@Param('bizID') bizID: string, @Query() query: ListMembersQueryDto) {
    return this.authzSDK.members.list(bizID, query);
  }

  @Post('roles/:bizID/members')
  addMembers(@Param('bizID') bizID: string, @Body() dto: AddMembersDto) {
    return this.authzSDK.members.add(bizID, dto);
  }

  @Post('roles/:bizID/members/batch_remove')
  removeMembers(@Param('bizID') bizID: string, @Body() dto: RemoveMembersDto) {
    return this.authzSDK.members.remove(bizID, dto);
  }

  @Delete('roles/:bizID/members')
  clearMembers(@Param('bizID') bizID: string) { return this.authzSDK.members.clear(bizID); }

  @Post('search')
  search(@Body() dto: SearchDto) { return this.authzSDK.search.search(dto); }
}
```

## 4. Shared 类型定义

在 `shared/api.interface.ts` 中定义前后端共享的接口类型。SDK 已导出的类型直接 re-export，请求/响应类型与 Controller DTO 对齐。

```typescript
// shared/api.interface.ts — 角色管理相关类型

// ---- re-export SDK 类型，前后端统一引用 ----
export type {
  ForceRoleDTO,
  RoleMemberDTO,
  MemberMutationData,
  MemberType,
  UserSimpleDTO,
  DepartmentDTO,
  DepartmentMutationDTO,
  ChatSimpleDTO,
  PresetGroupDTO,
  SearchResponse,
  SearchResult,
  FilterParams,
  I18nText,
} from '@lark-apaas/fullstack-nestjs-core';

// ---- 请求类型（与 Controller DTO 一致） ----

/** POST /api/role_manager/roles */
export interface CreateRoleRequest {
  role: { name: string; description?: string; bizID: string };
}

/** PUT /api/role_manager/roles/:bizID */
export interface UpdateRoleRequest {
  role: { name?: string; description?: string };
}

/** POST /api/role_manager/roles/:bizID/members */
export interface AddMembersRequest {
  members: MemberMutationData;
}

/** POST /api/role_manager/roles/:bizID/members/batch_remove */
export interface RemoveMembersRequest {
  members: MemberMutationData;
}

/** POST /api/role_manager/search */
export interface SearchMembersRequest {
  query: string;
  filters?: FilterParams;
  pageSize?: number;
  page?: number;
}
```

> **注意**：请求类型省略了 `userID` 字段——`userID` 由后端从请求上下文自动注入，前端无需传递。

### 前端 API 层引用示例

```typescript
// client/src/api/index.ts
import type {
  ForceRoleDTO,
  CreateRoleRequest,
  UpdateRoleRequest,
  AddMembersRequest,
  RemoveMembersRequest,
  SearchMembersRequest,
  SearchResponse,
} from '@shared/api.interface';

export async function getRoles(): Promise<ForceRoleDTO[]> { ... }
export async function createRole(data: CreateRoleRequest): Promise<void> { ... }
export async function updateRole(bizID: string, data: UpdateRoleRequest): Promise<void> { ... }
export async function deleteRole(bizID: string): Promise<void> { ... }
export async function addRoleMembers(bizID: string, data: AddMembersRequest): Promise<void> { ... }
export async function removeRoleMembers(bizID: string, data: RemoveMembersRequest): Promise<void> { ... }
export async function searchMembers(data: SearchMembersRequest): Promise<SearchResponse> { ... }
```

## 5. 模块注册

创建 `server/modules/role-manager/role-manager.module.ts`，并在 `app.module.ts` 中注册（ViewModule 之前）。

## 错误处理

SDK 内部统一将平台错误转为 `HttpException`，Controller 无需 try-catch：

| 场景 | HTTP 状态码 | 说明 |
|------|-----------|------|
| 平台 4xx | 透传 | 参数错误、权限不足、角色不存在等 |
| 平台 5xx | 502 | 平台内部错误 |
| HTTP 200 + `status_code !== '0'` | 502 | 平台业务错误（如远程服务不可用） |
