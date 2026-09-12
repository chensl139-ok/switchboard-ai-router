# 角色管理页面实施规格

> **本规格为强制约束**，实现时必须逐项对照，严禁自由发挥布局和交互。

---

## 实现步骤清单

按以下顺序逐步实现，**禁止跳步或合并步骤**：

```
Step 0: 制定实施计划（强制，禁止跳过）
  ├─ 调用 `think` 工具，通读本规格全文
  ├─ 输出结构化计划，列出每个 Step 要创建/修改的文件清单
  └─ ⛔ 未输出计划就开始写代码 = 违规，必须先计划再编码

Step 1: 编码前确认（闸门）
  ├─ 确认 SDK 方法签名：读取 sdk-types.md，摘录 roles / members / search 的出入参
  ├─ 确认搜索组件目录存在：client/src/components/business-ui/ 下包含 user-select、department-select、chat-select 目录
  └─ 确认 Tag 胶囊组件存在：上述目录中分别包含 user-select-tag、department-select-tag、chat-select-tag 文件

  ⛔ 以上任一不存在，停止实现并报告

Step 2: 后端 Controller
  ├─ 创建 server/modules/role-manager/role-manager.controller.ts（照抄 runtime-role-controller-spec.md 的模板）
  ├─ 创建 server/modules/role-manager/role-manager.module.ts
  └─ 在 app.module.ts 中注册（ViewModule 之前）

Step 3: shared 类型定义 + 前端 API 层
  ├─ 重读 sdk-types.md
  ├─ 在 shared/api.interface.ts 中定义角色管理相关的请求/响应类型
  │  （照抄 runtime-role-controller-spec.md § Shared 类型的模板）
  └─ 在 client/src/api/index.ts 中添加角色管理 API 函数
     （getRoles / createRole / updateRole / deleteRole / addRoleMembers / removeRoleMembers / searchMembers）

Step 4: 前端页面
  ├─ 创建 client/src/pages/RoleManagementPage/RoleManagementPage.tsx
  ├─ 按本规格的「页面代码骨架」实现
  └─ 在 app.tsx 中添加路由

Step 5: 验证
  ├─ 编译通过
  └─ 逐项对照本规格的「实现检查表」
```

---

## 页面结构

角色管理页面使用 **Table 表格组件**（`@lark-apaas/client-toolkit/antd-table`）展示，**禁止使用卡片列表、自定义 div 列表等替代布局**。

### 表格列定义

| 列 | dataIndex / key | width | 说明 |
|---|----------------|-------|------|
| 角色名称 | `name` | 180 | 角色显示名 |
| 角色描述 | `description` | 300 | 角色用途说明，空值显示 `--` |
| 角色标识 | `bizID` | 200 | 如 `role_user`、`role_admin` |
| 角色成员 | `members`（自定义渲染） | 250 | 见下方「成员摘要列渲染规则」 |
| 操作 | `action`（自定义渲染） | 150 | 见下方「操作列」 |

### 成员摘要列渲染规则

按以下优先级顺序拼接展示，无任何内容时显示 `--`：

1. **特殊范围胶囊**：使用 `ItemPill` 组件（`business-ui/entity-combobox/item-pill`）展示，每项带**品牌色**（`bg-primary`，跟随 CSS 变量 `--primary`，默认蓝色）圆底 20px 图标（`SPECIAL_MEMBER_ICONS` 常量，见代码骨架），图标前景色使用 `text-primary-foreground`，在表格成员摘要列和成员编辑面板中**同时复用**：
   - `企业全员`（`allEmployees`）：`Building` 图标（lucide-react）
   - `互联网公开`（`public`）：`Globe` 图标（lucide-react）
   - `应用开发者`（`presetGroup.isContainsAdmin`）：`Users` 图标（lucide-react）
2. **指定成员胶囊**：将用户、部门、群组合并为一个列表，每项用对应类型的胶囊组件展示（只读 `disabled`，但需加 `className="!opacity-100 !cursor-default"` 同时覆盖置灰和禁止光标）：
   - 用户：**必须使用 `UserSelectTag`**（而非 `UserDisplay`），确保胶囊背景色与部门/群组一致。`UserDisplay` 内部用 `UserWithAvatar`（`bg-muted` 灰底），与 `ItemPill` 风格不统一，**禁止在表格成员摘要中使用 `UserDisplay`**。正确写法：`<UserSelectTag userValue={{ id, name, avatar }} disabled className="!opacity-100 !cursor-default" />`（必须传 `avatar` 字段以展示头像）
   - 部门：`<DepartmentSelectTag departmentValue={{ id, name }} disabled className="!opacity-100 !cursor-default" />`（部门图标+名称）
   - 群组：`<ChatSelectTag chatValue={{ id, name, avatar: avatar || '#1456F0' }} disabled className="!opacity-100 !cursor-default" />`（群头像+名称，无头像时传 `#1456F0` 作为 avatarUrl，利用 `renderPillAvatar` 的 hex 分支渲染蓝底白字首字母）
   > **⚠️ disabled 胶囊样式注意**：`ItemPill` 在 `disabled` 时会加 `cursor-not-allowed opacity-50`，必须通过 `className="!opacity-100 !cursor-default"` 同时覆盖这两个样式，否则会出现禁止光标和置灰效果。
3. **统一溢出提示**：所有指定成员合计超出展示上限（如 3 个）时，末尾显示一个 `+N` Badge，N 为剩余未展示的总数，不按类型分别计数。hover `+N` 时用 **HoverCard**（`@client/src/components/ui/hover-card`）展示剩余成员列表，样式：最大宽度 360px、内容区 `flex flex-wrap gap-1`，胶囊自动换行，使用对应类型的胶囊组件。**禁止使用 Tooltip**（箭头默认黑色，覆盖样式复杂）或 **Popover**（需要点击触发，体验不佳）

> SDK 已对部门 `name` 做归一化，统一用 `name?.zh_cn` 取值即可。

### 操作列

每行包含：
- **编辑成员** 按钮（文字按钮）
- **更多操作** 下拉菜单（`...` 按钮，DropdownMenu），包含：
  - 配置权限（仅动态权限点位模式下显示）
  - 编辑角色信息
  - 删除角色：当 `allEmployees` 或 `public` 为 `true` 时，**必须用 `<Tooltip>` 包裹该菜单项**，提示文案「包含企业全员/互联网公开的角色不支持删除」，同时设置 `disabled`。禁止只设 disabled 而不加 tooltip 提示原因

> **排版要求**：操作列只有「编辑成员」一个外露按钮，其余操作（包括配置权限）全部收进 `...` 下拉菜单，保持操作列紧凑。**禁止**将配置权限作为独立按钮与编辑成员并列展示。

---

## 页面功能

### 1. 添加角色

Dialog 弹窗，包含三个字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| 角色名称 | 是 | Input |
| 角色标识（bizID） | 是 | Input，提示 `snake_case` 格式 |
| 角色描述 | 否 | Textarea |

调用 `sdk.roles.create({ role: { name, bizID, description } })`，成功后关闭弹窗并刷新列表。

### 2. 角色列表

表格展示所有角色。`sdk.roles.list()` 默认返回成员数据（`needMember` 默认 `true`），无需额外传参。

> **⛔ 严禁对每个角色额外调用 `members.list` 来补充成员数据**。`roles.list` 的返回已包含 `roleMembers` 字段，直接使用即可。
>
> - `roles.list` → 角色列表（含成员摘要），用于**表格展示**
> - `members.list` → 分页成员查询，仅用于**成员编辑弹窗**中的分页加载

### 3. 编辑成员

点击「编辑成员」后打开 Dialog，**面板分为上下两个区块**：

#### 区块一：特殊成员范围

「应用开发者」始终展示；「企业全员」和「互联网公开」**仅当角色成员包含时展示**（`allEmployees` / `public` 为 `true`），不包含时隐藏整个卡片。使用**弹性布局**（`flex flex-wrap gap-3`），每项用带边框的卡片包裹，内含标签文字和 Switch：

| 范围 | 字段 | Switch 状态 |
|------|------|------------|
| 应用开发者 | `isContainsAdmin` | **可切换**，通过 `members.add({ members: { isContainsAdmin: true } })` / `members.remove({ members: { isContainsAdmin: true } })` 切换 |
| 企业全员 | `allEmployees` | **disabled**，仅展示当前状态，SDK 不支持修改 |
| 互联网公开 | `public` | **disabled**，仅展示当前状态，SDK 不支持修改 |

#### 区块二：指定成员

标题「指定成员」（`text-sm font-semibold`），下分「用户」「部门」「群组」三个独立子区块。

每个子区块：标题（`text-sm text-muted-foreground`）+ 组件。**直接使用 `UserSelect` / `DepartmentSelect` / `ChatSelect` 组件**（默认 `triggerType="button"` 模式，自带 Tag 内联展示 + 「+」按钮弹出搜索的交互），**禁止手动拼 Popover + Tag + 加号按钮**。

```tsx
<div className="space-y-4">
  <h4 className="text-sm font-semibold">指定成员</h4>
  <div className="space-y-3">
    <div>
      <div className="text-sm text-muted-foreground mb-1.5">用户</div>
      <UserSelect multiple value={memberUserIds} onChange={setMemberUserIds} />
    </div>
    <div>
      <div className="text-sm text-muted-foreground mb-1.5">部门</div>
      <DepartmentSelect multiple value={memberDepartments} onChange={v => setMemberDepartments(Array.isArray(v) ? v : [])} />
    </div>
    <div>
      <div className="text-sm text-muted-foreground mb-1.5">群组</div>
      <ChatSelect multiple value={memberChats} valueType="object" onChange={v => setMemberChats((v ?? []) as Chat[])} />
    </div>
  </div>
</div>
```

三个组件均基于 `EntityCombobox`，**必须全部复用，禁止只实现用户搜索**。

#### 保存逻辑

采用**全量替换**策略：先清空当前角色的所有成员，再一次性添加页面上选中的全部成员。避免复杂的 diff 计算。

**提交数据结构（`MemberMutationData`）**：

```ts
// ⛔ 禁止用 any / Record<string, unknown> 代替以下类型
interface MemberMutationData {
  userList?: { userID: string }[];           // 用户：对象数组，必须含 userID
  departmentList?: { id: string }[];         // 部门：对象数组，必须含 id
  groupChatList?: { chatID: string }[];      // 群组：对象数组，必须含 chatID
  isContainsAdmin?: boolean;                 // 应用开发者开关
}
```

> **⛔ 常见类型错误**：`groupChatList` 的字段是 `chatID`（大写 ID），不是 `chatId`。`userList` 必须传 `{ userID }` 对象数组，不是字符串数组。`departmentList` 必须传 `{ id }` 对象数组。用 `any` 绕过类型检查会导致字段名错误而静默失败。

```ts
// 1. 清空当前成员
await clearRoleMembers(bizID);

// 2. 全量添加选中的成员（一次调用，所有类型合并提交）
const members: MemberMutationData = {
  userList: selectedUsers.map((u) => ({ userID: u.userID })),
  departmentList: selectedDepts.map((d) => ({ id: d.id })),
  groupChatList: selectedChats.map((c) => ({ chatID: c.chatID })),
  isContainsAdmin: isAdminEnabled,
};
await addRoleMembers(bizID, { members });
```


### 4. 编辑角色信息

Dialog 弹窗，编辑角色名称和描述。调用 `sdk.roles.update(bizID, { role: { name, description } })`。

### 5. 删除角色

删除前必须：
1. 检查 `role.roleMembers?.allEmployees` 或 `role.roleMembers?.public` 是否为 `true`
2. 若为 `true`，**禁用删除按钮**并通过 tooltip 提示「包含企业全员/互联网公开的角色不支持删除」
3. 若可删除，弹出二次确认对话框，确认后调用 `sdk.roles.delete(bizID)`

---

## 页面代码骨架

以下为管理页面的关键组件结构，**必须以此为基础实现**，禁止替换为卡片布局或其他结构：

```tsx
// ---- 特殊范围图标（品牌色圆底 20px + lucide 白色图标，表格和成员面板中复用） ----
import { Building, Globe, Users } from 'lucide-react';

/**
 * 特殊成员图标背景色，跟随品牌色（CSS 变量 --primary），默认蓝色。
 * 抽为常量方便全局统一修改。
 */
const SPECIAL_ICON_BG = 'bg-primary';

const BrandCircleIcon = ({ children }: { children: React.ReactNode }) => (
  <span className={`flex items-center justify-center rounded-full ${SPECIAL_ICON_BG}`} style={{ width: 20, height: 20 }}>
    {children}
  </span>
);

const SPECIAL_MEMBER_ICONS = {
  allEmployees: <BrandCircleIcon><Building className="h-3 w-3 text-primary-foreground" /></BrandCircleIcon>,
  public: <BrandCircleIcon><Globe className="h-3 w-3 text-primary-foreground" /></BrandCircleIcon>,
  appDeveloper: <BrandCircleIcon><Users className="h-3 w-3 text-primary-foreground" /></BrandCircleIcon>,
};

// RoleManagementPage.tsx 骨架
import { useState, useEffect } from 'react';
import { Table, type TableProps } from '@lark-apaas/client-toolkit/antd-table';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Switch } from '@client/src/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@client/src/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@client/src/components/ui/dropdown-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@client/src/components/ui/hover-card';
import { UserSelectTag } from '@client/src/components/business-ui/user-select/user-select-tag';
import { DepartmentSelectTag } from '@client/src/components/business-ui/department-select/department-select-tag';
import { ChatSelectTag } from '@client/src/components/business-ui/chat-select/chat-select-tag';
import { ItemPill } from '@client/src/components/business-ui/entity-combobox/item-pill';
import { UserSelect } from '@client/src/components/business-ui/user-select';
import { DepartmentSelect } from '@client/src/components/business-ui/department-select';
import { ChatSelect } from '@client/src/components/business-ui/chat-select';
import type { ForceRoleDTO } from '@shared/api.interface';

export default function RoleManagementPage() {
  const [roles, setRoles] = useState<ForceRoleDTO[]>([]);
  const [loading, setLoading] = useState(true); // 仅用于首次加载

  // ⚠️ 刷新列表时不要 setLoading(true)，避免表格闪烁
  const loadRoles = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const data = await getRoles();
      setRoles(data);
    } catch {
      toast.error('加载角色列表失败');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => { loadRoles(true); }, []);

  // ---- 角色列表 Table ----
  const columns: TableProps<ForceRoleDTO>['columns'] = [
    { title: '角色名称', dataIndex: 'name', width: 180 },
    { title: '角色描述', dataIndex: 'description', width: 300, render: (text) => text || '--' },
    { title: '角色标识', dataIndex: 'bizID', width: 200 },
    {
      title: '角色成员', key: 'members', width: 250,
      render: (_, record) => <MemberSummary role={record} />,
    },
    {
      title: '操作', key: 'action', width: 150,
      render: (_, record) => (
        <>
          <Button variant="ghost" size="sm" onClick={() => openMemberDialog(record)}>
            编辑成员
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon">...</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => openEditDialog(record)}>编辑角色信息</DropdownMenuItem>
              {/* ⚠️ 不可删除时必须用 Tooltip 包裹并提示原因 */}
              {canDelete(record) ? (
                <DropdownMenuItem onClick={() => handleDelete(record)}>删除角色</DropdownMenuItem>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem disabled>删除角色</DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent>包含企业全员/互联网公开的角色不支持删除</TooltipContent>
                </Tooltip>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ),
    },
  ];

  return (
    <>
      {/* 顶部操作栏 */}
      <Button onClick={() => setCreateOpen(true)}>添加角色</Button>
      {/* 角色表格（必须用 Table 组件） */}
      <Table columns={columns} dataSource={roles} rowKey="bizID" />
      {/* 弹窗：创建角色 / 编辑角色 / 编辑成员 */}
    </>
  );
}

// ---- 成员摘要（表格行内展示） ----
function MemberSummary({ role }: { role: ForceRoleDTO }) {
  const rm = role.roleMembers;
  if (!rm) return <>--</>;

  // 合并所有指定成员为统一列表，每项带类型标记
  type MemberItem =
    | { key: string; type: 'user'; data: UserSimpleDTO }
    | { key: string; type: 'dept'; data: DepartmentDTO }
    | { key: string; type: 'chat'; data: ChatSimpleDTO };
  const memberItems: MemberItem[] = [
    ...(rm.userList || []).map(u => ({ key: u.userID!, type: 'user' as const, data: u })),
    ...(rm.departmentList || []).map(d => ({ key: d.id!, type: 'dept' as const, data: d })),
    ...(rm.groupChatList || []).map(c => ({ key: c.chatID!, type: 'chat' as const, data: c })),
  ];
  const MAX_DISPLAY = 3;
  const visible = memberItems.slice(0, MAX_DISPLAY);
  const overflowCount = memberItems.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {/* 1. 特殊范围胶囊（复用 SPECIAL_MEMBER_ICONS） */}
      {rm.allEmployees && <ItemPill label="企业全员" avatar={SPECIAL_MEMBER_ICONS.allEmployees} avatarFallback={false} size="small" />}
      {rm.public && <ItemPill label="互联网公开" avatar={SPECIAL_MEMBER_ICONS.public} avatarFallback={false} size="small" />}
      {rm.presetGroup?.isContainsAdmin && <ItemPill label="应用开发者" avatar={SPECIAL_MEMBER_ICONS.appDeveloper} avatarFallback={false} size="small" />}
      {/* 2. 指定成员胶囊（统一用 *SelectTag 组件，禁止用 UserDisplay） */}
      {visible.map(item =>
        item.type === 'user'
          ? <UserSelectTag key={item.key} userValue={{ id: item.data.userID, name: item.data.name?.zh_cn || '', avatar: item.data.avatar }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
          : item.type === 'dept'
          ? <DepartmentSelectTag key={item.key} departmentValue={{ id: item.data.id, name: item.data.name?.zh_cn }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
          : <ChatSelectTag key={item.key} chatValue={{ id: item.data.chatID, name: item.data.name?.zh_cn, avatar: item.data.avatar || '#1456F0' }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
      )}
      {/* 3. 统一溢出提示，用 HoverCard（hover 触发，禁止 Tooltip/Popover） */}
      {overflowCount > 0 && (
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <Badge variant="outline" className="cursor-pointer">+{overflowCount}</Badge>
          </HoverCardTrigger>
          <HoverCardContent className="max-w-[360px] w-auto p-2">
            <div className="flex flex-wrap gap-1">
              {memberItems.slice(MAX_DISPLAY).map(item =>
                item.type === 'user'
                  ? <UserSelectTag key={item.key} userValue={{ id: item.data.userID, name: item.data.name?.zh_cn || '', avatar: item.data.avatar }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
                  : item.type === 'dept'
                  ? <DepartmentSelectTag key={item.key} departmentValue={{ id: item.data.id, name: item.data.name?.zh_cn }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
                  : <ChatSelectTag key={item.key} chatValue={{ id: item.data.chatID, name: item.data.name?.zh_cn, avatar: item.data.avatar || '#1456F0' }} onClose={() => {}} disabled className="!opacity-100 !cursor-default" />
              )}
            </div>
          </HoverCardContent>
        </HoverCard>
      )}
    </div>
  );
}

// ---- 成员编辑 Dialog 骨架 ----
function EditMembersDialog({ role, open, onOpenChange, onSuccess }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>编辑成员 - {role?.name}</DialogTitle></DialogHeader>

        {/* 区块一：特殊成员范围（应用开发者始终展示，企业全员/互联网公开仅包含时展示） */}
        <section>
          <h4>特殊成员范围</h4>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="flex items-center gap-2">{SPECIAL_MEMBER_ICONS.appDeveloper}应用开发者</span>
              <Switch checked={isAdminEnabled} onCheckedChange={...} />
            </div>
            {members?.allEmployees && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2">{SPECIAL_MEMBER_ICONS.allEmployees}企业全员</span>
                <Switch checked disabled />
              </div>
            )}
            {members?.public && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2">{SPECIAL_MEMBER_ICONS.public}互联网公开</span>
                <Switch checked disabled />
              </div>
            )}
          </div>
        </section>

        {/* 区块二：指定成员（三种类型缺一不可） */}
        <section>
          <h4>指定成员</h4>
          <div><label>用户</label>   <UserSelect multiple value={...} onChange={...} /></div>
          <div><label>部门</label>   <DepartmentSelect multiple value={...} onChange={...} /></div>
          <div><label>群组</label>   <ChatSelect multiple value={...} onChange={...} /></div>
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 错误处理

SDK 内部统一将平台错误转为 `HttpException`，Controller 无需 try-catch：

| 场景 | HTTP 状态码 | 说明 |
|------|-----------|------|
| 平台 4xx | 透传 | 参数错误、权限不足、角色不存在等 |
| 平台 5xx | 502 | 平台内部错误 |
| HTTP 200 + `status_code !== '0'` | 502 | 平台业务错误（如远程服务不可用） |

前端统一使用 `toast.error()` 展示错误信息。

---

## 实现检查表

实现完成后逐项对照：

- [ ] **闸门**：确认了 UserSelect / DepartmentSelect / ChatSelect / UserSelectTag / DepartmentSelectTag / ChatSelectTag 组件存在
- [ ] **布局**：使用 `Table` 表格组件，非卡片列表
- [ ] **表格列**：包含角色名称、描述、标识、成员摘要、操作五列
- [ ] **成员摘要列**：展示特殊范围标签 + 用户/部门/群组胶囊 + `+N` 溢出
- [ ] **成员胶囊统一性**：表格中用户必须用 `UserSelectTag`（禁止 `UserDisplay`），三种胶囊背景色风格一致
- [ ] **成员胶囊光标**：disabled 胶囊必须加 `!cursor-default`，禁止出现禁止光标（`cursor-not-allowed`）
- [ ] **群组胶囊头像**：无头像时传 `avatar: '#1456F0'`，通过 `renderPillAvatar` hex 分支渲染蓝底白字首字母
- [ ] **操作列 - 编辑成员按钮**：外露文字按钮，其余操作收进更多菜单
- [ ] **操作列 - 更多菜单**：DropdownMenu 包含编辑角色信息和删除角色
- [ ] **删除限制**：含企业全员/互联网公开时 disabled **且用 Tooltip 包裹提示原因**（禁止只 disabled 不提示）
- [ ] **成员编辑面板**：分「特殊成员范围」和「指定成员」两个区块
- [ ] **特殊范围**：「应用开发者」始终展示；「企业全员」「互联网公开」仅包含时展示（`true` 时显示 disabled Switch，`false` 时隐藏整个卡片）
- [ ] **指定成员**：分「用户」「部门」「群组」三个子区块，直接使用 UserSelect / DepartmentSelect / ChatSelect 组件（默认 button 模式）
- [ ] **成员保存**：全量替换（clear + add），所有类型合并为一次 add 调用，禁止按类型拆成多次串行请求
- [ ] **提交数据类型**：`userList` 为 `{ userID }[]`、`departmentList` 为 `{ id }[]`、`groupChatList` 为 `{ chatID }[]`（注意大写 ID），禁止用 `any` 或字符串数组
- [ ] **角色数据来源**：表格直接使用 `roles.list` 返回值，未对每个角色额外调用 `members.list` 覆盖角色对象
- [ ] **列表刷新无闪烁**：`loadRoles` 刷新时不设 `loading=true`，仅首次加载显示 loading
- [ ] **后端 Controller**：照抄 runtime-role-controller-spec.md 模板，注册到 app.module.ts
- [ ] **Shared 类型**：shared/api.interface.ts re-export SDK 类型，请求类型与 Controller DTO 对齐，前端 API 函数引用 shared 定义
- [ ] **类型安全**：代码中无 `any` 类型，使用具体类型或判别联合类型
- [ ] **端到端测试**：角色权限相关接口（角色 CRUD、成员增删、搜索等）开发完成后，对每个接口进行端到端测试，确认：(1) 接口按预期定义返回 (2) 接口对数据库的 CRUD 与数据库状态一致

---

## 动态权限增强（仅动态权限点位模式）

> 当应用启用了动态权限点位鉴权（参见 [dynamic-permission-guide.md](dynamic-permission-guide.md)）时，在本页面基础上进行以下增强。

### 角色表格新增「权限点位」列

在「角色成员」列之前插入「权限点位」列：

| 列 | key | width | 说明 |
|---|-----|-------|------|
| 权限点位 | `permissions`（自定义渲染） | 250 | 展示该角色绑定的权限点位 |

渲染规则：
- 每个点位优先展示中文说明（`description`），`action:subject` 作为辅助置灰小字
- 最多展示 3 个，超出部分用 `+N` Badge + HoverCard 展示剩余
- 无绑定点位时显示 `--`

### 操作列「更多操作」下拉菜单新增「配置权限」项

在「更多操作」`...` 下拉菜单中（与「编辑角色信息」「删除角色」同级）新增「配置权限」菜单项，**禁止外露为独立按钮**（与 § 操作列 的排版硬规则对齐）。

点击后打开 Dialog，列出所有权限点位，每行一个 Checkbox + `action:subject` 标识 + 描述：
- **勾选**：调用 `createRoleMapping({ roleKey, permissionId })`
- **取消勾选**：找到映射记录，调用 `deleteRoleMapping(id)`
- 操作即时生效，无需保存按钮

### 数据加载

`loadRoles` 函数需额外并行加载权限点位和映射数据：

```typescript
const [roles, perms, maps] = await Promise.all([
  getRoles(),
  listPermissions(),
  listRoleMappings(),
]);
```

### 增强检查表

- [ ] **权限点位列**：展示 `code` 样式 Badge，溢出用 HoverCard
- [ ] **配置权限弹窗**：列出所有点位 + Checkbox，即时生效
- [ ] **数据加载**：并行加载 roles + permissions + roleMappings
