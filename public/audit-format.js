const actions={
 'account.setup':['初始化账户','account'],'account.login.feishu':['飞书登录','account'],'account.password':['修改密码','account'],
 'account.password.reset.issue':['签发密码重置码','account'],'account.password.reset':['重置密码','account'],
 'member.join':['加入组织','member'],'member.join.sso':['通过飞书加入','member'],'member.invite':['邀请成员','member'],
 'member.remove':['移除成员','member'],'member.role':['修改角色','member'],'invite.revoke':['撤销邀请','member'],
 'tenant.create':['创建租户','tenant'],'tenant.delete':['删除租户','tenant'],
 'usage.statistics.reset':['重置统计起点','tenant'],'usage.statistics.clear':['清除请求记录','tenant'],
 '/api/models/discover':['旧版模型发现记录（不代表配置变更）','other'],
 '/api/provider':['保存服务商','provider'],'/api/provider/delete':['删除服务商','provider'],
 '/api/provider/reorder':['调整服务商顺序','provider'],'/api/provider/switch-model':['切换默认模型','provider'],'/api/models/register':['加入模型调用列表','provider'],
 '/api/activate':['切换默认服务商','routing'],'/api/strategy':['修改路由策略','routing'],
 '/api/routing':['更新路由配置','routing'],'/api/keys':['创建 API Key','key'],
 '/api/keys/update':['修改 Key 限制','key'],'/api/keys/toggle':['启停 API Key','key'],'/api/keys/delete':['删除 API Key','key'],'/api/keys/legacy':['切换旧版调用令牌','key'],
 '/api/prices':['更新模型价格','price'],'/api/prices/sync':['导入参考价格','price']
};
export const auditCategories={account:'账户安全',member:'成员权限',tenant:'租户管理',provider:'服务商与模型',routing:'模型路由',key:'API Key',price:'模型价格',other:'其他操作'};
export function auditAction(action){
 const found=actions[action];
 if(found)return {label:found[0],category:found[1]};
 const category=action.startsWith('/api/provider')?'provider':action.startsWith('/api/rout')?'routing':action.startsWith('/api/keys')?'key':action.startsWith('/api/price')?'price':'other';
 return {label:category==='other'?action:auditCategories[category]+'变更',category};
}
