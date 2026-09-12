# AuthorizationSDK 类型定义

> 所有类型均从 `@lark-apaas/fullstack-nestjs-core` 导入。
>
> **ID 字段语义**（哪个用于飞书 API、哪个禁用、employee_id/open_department_id/open_chat_id 含义）见 [`contacts-service`](../../contacts-service/SKILL.md) skill。下表 `larkUserID`/`larkDepartmentID` 为纯数字内部 ID（禁用），飞书 API 用 `employeeID`/`openDepartmentID`/`openChatID`。

```typescript
// ===================== 通用 =====================

interface I18nText {
  [locale: string]: string;
}

/** 部门名称的国际化格式（language_code: 2052=zh_cn, 1033=en_us） */
interface I18nLangItem {
  language_code: number;
  text: string;
}

// ===================== 角色 =====================

interface ForceRoleDTO {
  id?: number;                    // 数据库自增 ID
  apiID?: string;                 // 平台 API 标识
  bizID?: string;                 // 角色唯一 key
  tenantID?: number;              // 租户 ID
  name?: string;                  // 角色名称
  description?: string;           // 角色描述
  type?: number;                  // 0-普通角色, 1-预置角色
  source?: string;                // 来源: 'aPaaS' | 'MiaoDa'
  status?: number;
  memberScope?: string;           // 'all' | 'custom'
  envScope?: string;              // 'all' | 'custom'
  feature?: string;
  deletedAt?: number;
  version?: number;
  createdBy?: number;
  createdAt?: number;
  updatedBy?: number;
  updatedAt?: number;
  roleMembers?: RoleMemberDTO;    // 仅 needMember=true 时返回
}

interface ListRolesParams {
  needMember?: boolean;           // 是否返回成员信息，默认 true
  userID?: string;       // 可不传，默认为当前登录用户
}

interface CreateRoleParams {
  role: {
    name: string;                 // 角色名称（必填）
    description?: string;
    bizID: string;                // 角色唯一 key（必填）
  };
  userID?: string;       // 可不传，默认为当前登录用户
}

interface CreateRoleResponse {
  bizID: string;                  // 角色唯一 key
  apiID: string;                  // 平台 API 标识
}

interface UpdateRoleParams {
  role: { name?: string; description?: string };
  userID?: string;       // 可不传，默认为当前登录用户
}

// ===================== 成员 =====================

type MemberType =
  | 'User'
  | 'Department'
  | 'GroupChat'
  | 'Tenant'
  | 'PresetGroup'
  | 'Public'
  | 'AllEmployee';

interface UserSimpleDTO {
  userID?: string;       // 妙搭用户 ID（入库/插件用它）
  name?: I18nText;
  avatar?: string;
  email?: string;
  userType?: string;
  larkUserID?: number;   // 飞书内部数字 ID，禁用（飞书 API 不认）
  department?: DepartmentSimpleDTO;
  employeeID?: string;   // 飞书企业内 user_id，调飞书开放平台 API 用它
  larkID?: string;       // 飞书用户全局唯一 ID（larkUserID 别名），禁用
  miaodaUserID?: string; // 妙搭用户 ID（userID 别名）
}

interface DepartmentSimpleDTO {
  departmentID?: number;
  larkDepartmentID?: number;       // 纯数字内部 ID，禁用
  name?: I18nText;                // SDK 归一化后统一为 { zh_cn, en_us } 格式
  openDepartmentID?: string;       // 飞书部门 open id（od- 开头），部门统一用它
}

/** 查询响应中的部门（SDK 已将平台的数组格式归一化为 I18nText） */
interface DepartmentDTO {
  id?: string;           // 部门 ID
  name?: I18nText;                // 部门名称，SDK 归一化后统一为 { zh_cn, en_us } 格式
  openDepartmentID?: string;       // 飞书部门 open id（od- 开头）；需后端确认成员部门是否返回
}

/** 变更入参中的部门（提交接口只需 id） */
interface DepartmentMutationDTO {
  id?: string;           // 部门 ID
}

interface ChatSimpleDTO {
  chatID?: string;       // 群组 ID
  name?: I18nText;
  avatar?: string;
  isExternal?: boolean;
  openChatID?: string;             // 飞书群组 open id（oc_ 开头），群组统一用它
}

interface PresetGroupDTO {
  isContainsAdmin?: boolean;
}

/** 平台返回的成员数据（list 响应中使用） */
interface RoleMemberDTO {
  userList?: UserSimpleDTO[];
  departmentList?: DepartmentDTO[];
  groupChatList?: ChatSimpleDTO[];
  allEmployees?: boolean;         // 是否包含企业全员（只读）
  public?: boolean;               // 是否互联网公开（只读）
  presetGroup?: PresetGroupDTO;   // 是否包含应用开发者
}

/** 用户接口的成员变更数据（add/remove 参数中使用），SDK 内部自动映射 isContainsAdmin 为 presetGroup */
interface MemberMutationData {
  userList?: UserSimpleDTO[];
  departmentList?: DepartmentMutationDTO[];
  groupChatList?: ChatSimpleDTO[];
  isContainsAdmin?: boolean;      // 是否包含应用开发者，SDK 内部映射为 presetGroup.isContainsAdmin
}

interface ListMembersParams {
  type?: MemberType;              // 不传返回所有类型
  page?: number;
  pageSize?: number;
  userID?: string;       // 可不传，默认为当前登录用户
}

interface ListMembersResponse {
  members: RoleMemberDTO;         // 按类型分组
  total: number;
  hasMore: boolean;
}

interface AddMembersParams {
  members: MemberMutationData;
  userID?: string;       // 可不传，默认为当前登录用户
}

interface RemoveMembersParams {
  members: MemberMutationData;
  userID?: string;       // 可不传，默认为当前登录用户
}

// ===================== 搜索 =====================

interface CommonParam {
  searchable?: boolean;
  pageSize?: number;
  offset?: number;
}

interface FilterParams {
  userParam?: { commonParam?: CommonParam };
  departmentParam?: { commonParam?: CommonParam; searchType?: string };
  chatParam?: { commonParam?: CommonParam };
}

interface SearchParams {
  query: string;                  // 关键词（必填）
  filters?: FilterParams;        // 不传时默认三种类型各 pageSize=20
  includeExternalUser?: boolean;  // 默认 true
  includeExternalGroup?: boolean; // 默认 true
  pageSize?: number;              // 默认 20
  page?: number;                  // 默认 1
  userID?: string;       // 可不传，默认为当前登录用户
}

interface SearchUserEntity {
  userID?: string;
  larkUserID?: number;             // 纯数字内部 ID，禁用
  name?: I18nText;
  avatar?: string;
  department?: DepartmentSimpleDTO; // 用户所属部门（name 已归一化）
  userType?: string;
  email?: string;
  userStatus?: number;
  employeeID?: string;             // 飞书企业内 user_id，调飞书开放平台 API 用它
  larkID?: string;                 // larkUserID 别名，禁用
  miaodaUserID?: string;           // userID 别名
}

interface DepartmentEntity {
  departmentID?: number;
  larkDepartmentID?: number;
  name?: I18nText;                // SDK 归一化后统一为 { zh_cn, en_us } 格式
  openDepartmentID?: string;       // 飞书部门 open id（od- 开头）
}

interface SearchChatEntity {
  chatID?: number;
  name?: I18nText;
  avatar?: string;
  isExternal?: boolean;
  userCount?: number;
  openChatID?: string;             // 飞书群组 open id（oc_ 开头）
}

interface SearchResult {
  userResult?: { total?: number; items?: SearchUserEntity[] };
  departmentResult?: { total?: number; items?: DepartmentEntity[] };
  chatResult?: { total?: number; items?: SearchChatEntity[] };
}

interface SearchResponse {
  result: SearchResult;
}
```

> **部门名称归一化**：平台返回的部门 `name` 有两种格式（`I18nText` 对象或 `[{ language_code, text }]` 数组），SDK 在所有查询接口（`roles.list`、`roles.get`、`members.list`、`search.search`）中已统一归一化为 `I18nText`（`{ zh_cn: "...", en_us: "..." }`），下游直接用 `name?.zh_cn` 取值即可。
