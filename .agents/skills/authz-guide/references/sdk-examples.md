# AuthorizationSDK 调用示例

> 完整类型定义见 [sdk-types.md](./sdk-types.md)

```typescript
import { logger } from "@lark-apaas/client-toolkit/logger";

// ===================== 角色管理 =====================

// 获取所有角色列表，needMember=true 会在每个角色中附带成员数据
const roles: ForceRoleDTO[] = await sdk.roles.list({ needMember: true });

// 获取单个角色详情
const role: ForceRoleDTO = await sdk.roles.get('editor');

// 创建角色，bizID 为角色唯一 key，应用内不可重复
const created: CreateRoleResponse = await sdk.roles.create({
  role: { bizID: 'editor', name: '编辑者', description: '可编辑内容' },
});
// created.bizID → 'editor', created.apiID → 平台分配的 API 标识

// 更新角色名称或描述
await sdk.roles.update('editor', { role: { name: '高级编辑者' } });

// 删除角色（⚠️ 包含「企业全员」或「互联网公开」成员的角色不支持删除）
await sdk.roles.delete('editor');

// ===================== 成员管理 =====================
// 成员按类型分组传递（MemberMutationData），不是扁平数组

// 添加用户到角色
await sdk.members.add('admin', {
  members: { userList: [{ userID: '1826968659245100' }] },
});

// 添加部门到角色（ID 保持字符串）
await sdk.members.add('admin', {
  members: { departmentList: [{ id: '7579138586559286811' }] },
});

// 添加群组到角色
await sdk.members.add('admin', {
  members: { groupChatList: [{ chatID: '123456' }] },
});

// 设置包含应用开发者（唯一可通过 SDK 修改的特殊范围）
await sdk.members.add('admin', { members: { isContainsAdmin: true } });
// 取消包含应用开发者
await sdk.members.remove('admin', { members: { isContainsAdmin: true } });

// 查询成员列表，不传 type 返回所有类型（用户+部门+群组）
const membersRes: ListMembersResponse = await sdk.members.list('admin');
// 响应按类型分组：
// membersRes.members.userList       → 用户列表
// membersRes.members.departmentList → 部门列表
// membersRes.members.groupChatList  → 群组列表
// membersRes.members.allEmployees   → 是否包含企业全员（只读）
// membersRes.members.public         → 是否互联网公开（只读）
// membersRes.members.presetGroup?.isContainsAdmin → 是否包含应用开发者
// membersRes.total / membersRes.hasMore → 分页信息

// 按类型过滤查询，只获取用户成员
const userMembers = await sdk.members.list('admin', { type: 'User', pageSize: 20 });

// 从角色移除指定用户
await sdk.members.remove('admin', {
  members: { userList: [{ userID: '1826968659245100' }] },
});

// 清空角色下所有成员
await sdk.members.clear('admin');

// ===================== 混合搜索 =====================
// 同时搜索用户、部门、群组，不传 filters 时默认三种类型各 pageSize=20

const searchRes: SearchResponse = await sdk.search.search({
  query: '张三',
  pageSize: 20,
  page: 1,
});

// 响应按类型分组，分别遍历
searchRes.result.userResult?.items?.forEach(u =>
  logger.info('用户:', u.name, u.userID, u.avatar),
);
searchRes.result.departmentResult?.items?.forEach(d =>
  logger.info('部门:', d.name, d.departmentID),
);
searchRes.result.chatResult?.items?.forEach(c =>
  logger.info('群组:', c.name, c.chatID, '成员数:', c.userCount),
);
```
