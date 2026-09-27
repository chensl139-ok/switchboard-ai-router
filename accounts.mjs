import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
import {auditAction} from './public/audit-format.js';
const derive=promisify(scrypt);
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const roles=['owner','admin','member','viewer'];
export class Accounts {
 constructor(dir,bootstrapToken,{now=()=>Date.now()}={}){
  mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'accounts.json');this.bootstrapToken=bootstrapToken;this.now=now;this.kdf=0;
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{users:[],tenants:[{id:'default',name:'默认租户',createdAt:new Date(now()).toISOString()}],members:[],sessions:[],invites:[],passwordResets:[],audit:[]};
  this.state.passwordResets??=[];this.feishuAppsByTenant=null;this.platformFeishuAppId='';
 }
 save(){
  const snapshot=this.state;
  writeFileSync(this.file+'.tmp',JSON.stringify(snapshot),{mode:0o600});
  renameSync(this.file+'.tmp',this.file);
 }
 mutate(fn){const before=structuredClone(this.state);let result;try{const ownerId=this.platformOwnerId();if(!this.state.platformOwnerUserId&&ownerId)this.state.platformOwnerUserId=ownerId;result=fn();}catch(error){this.state=before;throw error;}
  try{this.save();}catch(error){this.state=before;throw error;}
  return result;}
 event(tenantId,actorId,action,target){
  this.state.audit.unshift({id:randomUUID(),tenantId,actorId,action,target,time:new Date(this.now()).toISOString()});
  const counts=new Map();this.state.audit=this.state.audit.filter(item=>{const count=counts.get(item.tenantId)||0;counts.set(item.tenantId,count+1);return count<2000;});
 }
 validateUser(input){
  if(!input||typeof input.email!=='string'||input.email.length>254||!/^\S+@\S+\.\S+$/.test(input.email))throw fail('邮箱格式无效');
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw fail('密码长度需为 12–256 个字符');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw fail('姓名长度需为 1–80 个字符');
  return {email:input.email.trim().toLowerCase(),name:input.name.trim()};
 }
 async derivePassword(password,salt){if(this.kdf>=4)throw fail('密码校验繁忙，请稍后重试',429);this.kdf++;try{return await derive(password,salt,64);}finally{this.kdf--;}}
 async passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+(await this.derivePassword(password,salt)).toString('hex');}
 async checkPassword(password,stored){const [salt,expected]=stored.split(':');const actual=await this.derivePassword(password,salt);return timingSafeEqual(actual,Buffer.from(expected,'hex'));}
 platformOwnerId(){
  const id=this.state.platformOwnerUserId||this.state.users[0]?.id;
  return this.state.members.some(member=>member.userId===id&&member.tenantId==='default'&&member.role==='owner')?id:'';
 }
 session(userId,tenantId,{platformSource=''}={}){
  const token=randomBytes(32).toString('hex');const now=this.now();
  this.state.sessions=this.state.sessions.filter(s=>s.expiresAt>now).slice(-999);
  this.state.sessions.push({hash:hash(token),userId,tenantId,platformSource:userId===this.platformOwnerId()?platformSource:'',expiresAt:now+12*3600000});return token;
 }
 resolve(token){
  if(typeof token!=='string'||token.length>128)throw fail('请登录账户',401);
  const session=this.state.sessions.find(s=>s.hash===hash(token)&&s.expiresAt>this.now());
  const user=session&&this.state.users.find(u=>u.id===session.userId);
  const platformAccess=session?.userId===this.platformOwnerId()&&(session.platformSource==='password'||session.platformSource==='feishu-primary'&&Boolean(this.platformFeishuAppId)&&this.feishuAppsByTenant?.get('default')===this.platformFeishuAppId);
  const membership=session&&(platformAccess&&this.state.tenants.some(t=>t.id===session.tenantId)?{role:'owner'}:this.state.members.find(m=>m.userId===session.userId&&m.tenantId===session.tenantId));
  if(!user||!membership)throw fail('会话无效或当前租户权限已被移除，请重新登录',401);
  const appId=this.feishuAppsByTenant?.get(session.tenantId),legacyLink=session.tenantId==='default'&&user.feishuOpenId&&!user.feishuIdentities?.some(identity=>identity.tenantId==='default'),linked=this.feishuAppsByTenant?Boolean(appId&&(user.feishuIdentities?.some(identity=>identity.appId===appId&&identity.tenantId===session.tenantId)||legacyLink)):Boolean(user.feishuIdentities?.some(identity=>identity.tenantId===session.tenantId)||legacyLink);
  return {userId:user.id,tenantId:session.tenantId,role:membership.role,platformAccess,sessionHash:session.hash,name:user.name,email:user.email,hasPassword:typeof user.password==='string',feishuLinked:linked};
 }
 me(caller){return {user:{id:caller.userId,name:caller.name,email:caller.email,hasPassword:caller.hasPassword,feishuLinked:caller.feishuLinked},tenantId:caller.tenantId,role:caller.role,platformAccess:caller.platformAccess,
  tenants:(caller.platformAccess?this.state.tenants.map(t=>({...t,role:'owner',ssoProtected:Boolean(this.feishuAppsByTenant?.has(t.id))})):this.state.members.filter(m=>m.userId===caller.userId&&m.tenantId===caller.tenantId).map(m=>({...this.state.tenants.find(t=>t.id===m.tenantId),role:m.role,ssoProtected:Boolean(this.feishuAppsByTenant?.has(m.tenantId))}))),roles};}
 async setup(input){
  if(this.state.users.length)throw fail('已完成初始化',409);
  if(!equal(input?.bootstrapToken,this.bootstrapToken))throw fail('初始化管理令牌无效',403);
  const value=this.validateUser(input);const password=await this.passwordHash(input.password);
  return this.mutate(()=>{if(this.state.users.length)throw fail('已完成初始化',409);const id=randomUUID();this.state.platformOwnerUserId=id;this.state.users.push({id,...value,password,createdAt:new Date(this.now()).toISOString()});this.state.members.push({tenantId:'default',userId:id,role:'owner'});this.event('default',id,'account.setup',value.email);return this.session(id,'default',{platformSource:'password'});});
 }
 async login(input){
  if(!input||typeof input.email!=='string'||typeof input.password!=='string'||input.password.length>256)throw fail('邮箱或密码错误',401);
  const user=this.state.users.find(u=>u.email===input.email.trim().toLowerCase());
  const valid=user&&typeof user.password==='string'?await this.checkPassword(input.password,user.password):await this.checkPassword(input.password,'00000000000000000000000000000000:'+ '00'.repeat(64));
  if(!user||!valid)throw fail('邮箱或密码错误',401);
  const member=this.state.members.find(m=>m.userId===user.id);if(!member)throw fail('账户未加入任何租户',403);
  return this.mutate(()=>this.session(user.id,member.tenantId,{platformSource:'password'}));
 }
 feishuIdentity(user,{appId,tenantId,legacy}){
  return user.feishuIdentities?.find(item=>item.appId===appId&&item.tenantId===tenantId)||(legacy&&tenantId==='default'&&user.feishuOpenId&&!user.feishuIdentities?.some(item=>item.tenantId==='default')?{appId,tenantId,openId:user.feishuOpenId,unionId:user.feishuUnionId}:null);
 }
 loginWithFeishu(identity,{appId='legacy',tenantId='default',legacy=false,autoJoin=false,allowedTenantKey='',defaultRole='member'}={}){
  legacy=legacy||appId==='legacy'&&tenantId==='default';
  if(allowedTenantKey&&identity.tenantKey!==allowedTenantKey)throw fail('当前飞书企业无权访问此工作空间',403);
  if(!this.state.tenants.some(tenant=>tenant.id===tenantId))throw fail('飞书应用对应的平台租户不存在',503);
  if(!this.state.users.length)throw fail('请先使用管理令牌创建首个管理员账户',409);
  return this.mutate(()=>{
   let user=this.state.users.find(u=>this.feishuIdentity(u,{appId,tenantId,legacy})?.openId===identity.openId);
   if(!user){
    if(identity.email&&this.state.users.some(u=>u.email===identity.email))throw fail('该邮箱已有账户，请先用密码登录，并在账户与租户中连接飞书',409);
    if(!autoJoin||!allowedTenantKey)throw fail('飞书账户尚未连接；请先用邀请码注册，再在账户与租户中连接飞书',403);
    if(!identity.email)throw fail('自动加入需要飞书企业邮箱权限；请先用邀请码注册并连接飞书',403);
    user={id:randomUUID(),email:identity.email,name:identity.name,password:null,feishuIdentities:[{appId,tenantId,openId:identity.openId,unionId:identity.unionId||undefined}],createdAt:new Date(this.now()).toISOString()};this.state.users.push(user);
    this.state.members.push({tenantId,userId:user.id,role:defaultRole});this.event(tenantId,user.id,'member.join.sso',appId+'/'+identity.openId);
   }
   const member=this.state.members.find(m=>m.userId===user.id&&m.tenantId===tenantId);if(!member&&!(user.id===this.platformOwnerId()&&tenantId==='default'&&appId===this.platformFeishuAppId))throw fail('飞书账户未加入对应的平台租户',403);
   user.feishuIdentities??=[];
   if(!user.feishuIdentities.some(item=>item.appId===appId&&item.tenantId===tenantId))user.feishuIdentities.push({appId,tenantId,openId:identity.openId,unionId:identity.unionId||undefined});
   return this.session(user.id,tenantId,{platformSource:tenantId==='default'&&appId===this.platformFeishuAppId?'feishu-primary':''});
  });
 }
 linkFeishu(identity,{userId,tenantId,sessionHash,appId='legacy',providerTenantId=tenantId,legacy=false,allowedTenantKey=''}){
  legacy=legacy||appId==='legacy'&&tenantId==='default';
  if(tenantId!==providerTenantId)throw fail('飞书应用与当前平台租户不匹配',403);
  if(allowedTenantKey&&identity.tenantKey!==allowedTenantKey)throw fail('当前飞书企业无权访问此工作空间',403);
  return this.mutate(()=>{
   const session=this.state.sessions.find(s=>s.hash===sessionHash&&s.userId===userId&&s.tenantId===tenantId&&s.expiresAt>this.now());
   if(!session||!this.state.members.some(m=>m.userId===userId&&m.tenantId===tenantId)&&!(userId===this.platformOwnerId()&&session.platformSource))throw fail('连接飞书的账户会话已失效，请重新登录',401);
   const user=this.state.users.find(u=>u.id===userId);
   if(!user)throw fail('账户不存在',404);
   if(this.state.users.some(u=>u.id!==userId&&this.feishuIdentity(u,{appId,tenantId,legacy})?.openId===identity.openId))throw fail('此飞书账户已连接其他平台账户',409);
   const existing=user.feishuIdentities?.find(item=>item.tenantId===tenantId)||this.feishuIdentity(user,{appId,tenantId,legacy});
   if(existing&&(existing.appId!==appId||existing.openId!==identity.openId))throw fail('当前租户已连接其他飞书账户',409);
   user.feishuIdentities??=[];
   if(!user.feishuIdentities.some(item=>item.appId===appId&&item.tenantId===tenantId))user.feishuIdentities.push({appId,tenantId,openId:identity.openId,unionId:identity.unionId||undefined});
   if(legacy){user.feishuOpenId=identity.openId;user.feishuUnionId=identity.unionId||undefined;}
   this.event(tenantId,userId,'account.link.feishu',appId+'/'+identity.openId);
  });
 }
 logout(token){if(typeof token!=='string')return;this.mutate(()=>{this.state.sessions=this.state.sessions.filter(s=>s.hash!==hash(token));});}
 requireAdmin(caller){if(!['owner','admin'].includes(caller.role))throw fail('此操作需要租户管理员权限',403);}
 requirePlatformOwner(caller){if(!caller.platformAccess||caller.userId!==this.platformOwnerId())throw fail('仅平台主账号可管理租户',403);}
 validateRole(caller,role){this.requireAdmin(caller);if(!roles.includes(role))throw fail('角色无效');if(role==='owner'&&caller.role!=='owner')throw fail('只有所有者可授予所有者角色',403);}
 validateDeleteTenant(caller,tenantId){
  this.requirePlatformOwner(caller);
  if(tenantId==='default')throw fail('默认租户不能删除');
  if(tenantId===caller.tenantId)throw fail('请先切换到其他租户，再删除当前租户');
  const tenant=this.state.tenants.find(t=>t.id===tenantId);if(!tenant)throw fail('租户不存在',404);
  return tenant;
 }
 deleteTenant(caller,tenantId){
  const tenant=this.validateDeleteTenant(caller,tenantId);
  this.mutate(()=>{
   this.state.tenants=this.state.tenants.filter(t=>t.id!==tenantId);
   this.state.members=this.state.members.filter(m=>m.tenantId!==tenantId);
   this.state.invites=this.state.invites.filter(i=>i.tenantId!==tenantId);
   this.state.passwordResets=this.state.passwordResets.filter(r=>r.tenantId!==tenantId);
   this.state.sessions=this.state.sessions.filter(s=>s.tenantId!==tenantId);
   this.state.audit=this.state.audit.filter(a=>a.tenantId!==tenantId);
   this.event('default',caller.userId,'tenant.delete',tenant.name+' · '+tenant.id);
  });
  return {deleted:tenantId,name:tenant.name};
 }
 createTenant(caller,name){
  this.requirePlatformOwner(caller);
  if(typeof name!=='string'||!name.trim()||name.length>80)throw fail('租户名称长度需为 1–80');
  const value=name.trim();if(this.state.tenants.some(tenant=>tenant.name.toLowerCase()===value.toLowerCase()))throw fail('租户名称已存在',409);
  if(this.state.tenants.length>=50)throw fail('当前单实例最多支持 50 个租户');
  return this.mutate(()=>{const tenant={id:randomUUID(),name:value,createdAt:new Date(this.now()).toISOString()};this.state.tenants.push(tenant);this.state.members.push({tenantId:tenant.id,userId:caller.userId,role:'owner'});this.event('default',caller.userId,'tenant.create',tenant.name);this.event(tenant.id,caller.userId,'tenant.create',tenant.name);return tenant;});
 }
 switchTenant(caller,id){this.requirePlatformOwner(caller);if(!this.state.tenants.some(tenant=>tenant.id===id))throw fail('租户不存在',404);this.mutate(()=>{this.state.sessions.find(s=>s.hash===caller.sessionHash).tenantId=id;});}
 renameTenant(caller,name){
  this.requireAdmin(caller);
  if(typeof name!=='string'||!name.trim()||name.length>80)throw fail('租户名称长度需为 1–80');
  const value=name.trim(),tenant=this.state.tenants.find(item=>item.id===caller.tenantId);
  if(!tenant)throw fail('租户不存在',404);
  if(tenant.name===value)return tenant;
  if(this.state.tenants.some(item=>item.id!==tenant.id&&item.name.toLowerCase()===value.toLowerCase()))throw fail('租户名称已存在',409);
  return this.mutate(()=>{const previous=tenant.name;tenant.name=value;this.event(tenant.id,caller.userId,'tenant.rename',previous+' → '+value);return tenant;});
 }
 members(caller){this.requireAdmin(caller);return {members:this.state.members.filter(m=>m.tenantId===caller.tenantId).map(m=>{const u=this.state.users.find(u=>u.id===m.userId);return {userId:u.id,name:u.name,email:u.email,role:m.role};}),invites:this.state.invites.filter(i=>i.tenantId===caller.tenantId&&!i.usedAt).map(({digest,...i})=>i)};}
 invite(caller,input){
  this.validateRole(caller,input?.role);
  if(typeof input.email!=='string'||input.email.length>254||!/^\S+@\S+\.\S+$/.test(input.email))throw fail('邮箱格式无效');
  const email=input.email.trim().toLowerCase();const target=this.state.users.find(u=>u.email===email);
  if(target&&this.state.members.some(m=>m.userId===target.id&&m.tenantId===caller.tenantId))throw fail('该账户已是租户成员',409);
  if(target&&target.id!==this.platformOwnerId()&&this.state.members.some(m=>m.userId===target.id&&m.tenantId!==caller.tenantId))throw fail('该账户已归属其他租户，请使用独立账户',409);
  const code=randomBytes(24).toString('hex');
  return this.mutate(()=>{this.state.invites=this.state.invites.filter(i=>i.expiresAt>this.now()&&!i.usedAt);if(this.state.invites.length>=500)throw fail('待处理邀请过多');this.state.invites.push({id:randomUUID(),tenantId:caller.tenantId,email,role:input.role,digest:hash(code),expiresAt:this.now()+72*3600000});this.event(caller.tenantId,caller.userId,'member.invite',email);return {code,expiresAt:this.now()+72*3600000};});
 }
 revokeInvite(caller,id){this.requireAdmin(caller);return this.mutate(()=>{const invite=this.state.invites.find(i=>i.id===id&&i.tenantId===caller.tenantId&&!i.usedAt);if(!invite)throw fail('邀请不存在',404);if(invite.role==='owner'&&caller.role!=='owner')throw fail('仅所有者可撤销所有者邀请',403);invite.expiresAt=this.now();invite.revokedAt=this.now();this.event(caller.tenantId,caller.userId,'invite.revoke',invite.email);});}
 findInvite(code){if(typeof code!=='string'||code.length>128)throw fail('邀请码无效或已过期');const invite=this.state.invites.find(i=>i.digest===hash(code)&&!i.usedAt&&i.expiresAt>this.now());if(!invite)throw fail('邀请码无效或已过期');return invite;}
 async register(input){
  const value=this.validateUser(input);const invite=this.findInvite(input.inviteCode);if(invite.email!==value.email)throw fail('邀请码与邮箱不匹配');
  const password=await this.passwordHash(input.password);
  return this.mutate(()=>{const current=this.findInvite(input.inviteCode);if(this.state.users.some(u=>u.email===value.email))throw fail('此邮箱已注册，请登录后接受邀请',409);const id=randomUUID();this.state.users.push({id,...value,password,createdAt:new Date(this.now()).toISOString()});this.state.members.push({tenantId:current.tenantId,userId:id,role:current.role});current.usedAt=this.now();this.event(current.tenantId,id,'member.join',value.email);return this.session(id,current.tenantId);});
 }
 accept(caller,code){return this.mutate(()=>{const invite=this.findInvite(code);if(invite.email!==caller.email)throw fail('邀请码与当前账户不匹配');if(!caller.platformAccess&&invite.tenantId!==caller.tenantId)throw fail('当前账户仅可加入所属租户，请使用独立账户',403);if(!this.state.members.some(m=>m.userId===caller.userId&&m.tenantId===invite.tenantId))this.state.members.push({userId:caller.userId,tenantId:invite.tenantId,role:invite.role});invite.usedAt=this.now();this.event(invite.tenantId,caller.userId,'member.join',caller.email);});}
 updateMember(caller,input,remove=false){
  this.requireAdmin(caller);if(!remove)this.validateRole(caller,input.role);
  return this.mutate(()=>{const member=this.state.members.find(m=>m.tenantId===caller.tenantId&&m.userId===input.userId);if(!member)throw fail('成员不存在',404);
   if(caller.tenantId==='default'&&member.userId===this.platformOwnerId()&&(remove||input.role!=='owner'))throw fail('平台主账号不能被移除或降级',403);
   if(member.role==='owner'&&caller.role!=='owner')throw fail('仅所有者可修改其他所有者',403);
   if(member.role==='owner'&&(remove||input.role!=='owner')&&this.state.members.filter(m=>m.tenantId===caller.tenantId&&m.role==='owner').length<=1)throw fail('不能移除或降级最后一个所有者');
   if(remove)this.state.members.splice(this.state.members.indexOf(member),1);else member.role=input.role;
   this.event(caller.tenantId,caller.userId,remove?'member.remove':'member.role',input.userId);
  });
 }
 async changePassword(caller,input){
  const user=this.state.users.find(u=>u.id===caller.userId),previous=user.password;
  if(user.password&&(typeof input.currentPassword!=='string'||input.currentPassword.length>256||!await this.checkPassword(input.currentPassword,user.password)))throw fail('原密码错误',403);
  this.validateUser({name:user.name,email:user.email,password:input.newPassword});const password=await this.passwordHash(input.newPassword);
  return this.mutate(()=>{const current=this.state.users.find(u=>u.id===caller.userId);if(current.password!==previous)throw fail('密码已发生变化，请重新登录',409);const platformSource=this.state.sessions.find(session=>session.hash===caller.sessionHash)?.platformSource||'';current.password=password;this.state.passwordResets=this.state.passwordResets.filter(r=>r.userId!==user.id);this.state.sessions=this.state.sessions.filter(s=>s.userId!==user.id);this.event(caller.tenantId,user.id,'account.password','密码已更改');return this.session(user.id,caller.tenantId,{platformSource});});
 }
 issuePasswordReset(caller,userId){
  this.requireAdmin(caller);
  const member=this.state.members.find(m=>m.tenantId===caller.tenantId&&m.userId===userId);
  if(!member)throw fail('成员不存在',404);
  if(userId===caller.userId)throw fail('请在账户与租户中修改自己的密码',400);
  for(const targetMembership of this.state.members.filter(m=>m.userId===userId)){
   const issuer=this.state.members.find(m=>m.userId===caller.userId&&m.tenantId===targetMembership.tenantId);
   if(!issuer||!['owner','admin'].includes(issuer.role)||targetMembership.role==='owner'&&issuer.role!=='owner')throw fail('该账户还属于其他租户，请由所有相关租户的管理员签发重置码',403);
  }
  const code=randomBytes(24).toString('hex'),expiresAt=this.now()+30*60000;
  return this.mutate(()=>{
   this.state.passwordResets=this.state.passwordResets.filter(r=>r.expiresAt>this.now()&&r.userId!==userId);
   if(this.state.passwordResets.length>=500)throw fail('待使用重置码过多，请稍后重试',429);
   this.state.passwordResets.push({userId,tenantId:caller.tenantId,digest:hash(code),expiresAt});
   this.event(caller.tenantId,caller.userId,'account.password.reset.issue',userId);
   return {code,expiresAt};
  });
 }
 async completePasswordReset(input){
  const invalid=()=>fail('重置码无效或已过期',400);
  if(typeof input?.email!=='string'||typeof input?.code!=='string'||input.code.length>128)throw invalid();
  const email=input.email.trim().toLowerCase();
  const user=this.state.users.find(u=>u.email===email);
  const reset=user&&this.state.passwordResets.find(r=>r.userId===user.id&&r.expiresAt>this.now()&&timingSafeEqual(Buffer.from(hash(input.code)),Buffer.from(r.digest)));
  if(!reset)throw invalid();
  this.validateUser({name:user.name,email:user.email,password:input.newPassword});
  const password=await this.passwordHash(input.newPassword);
  return this.mutate(()=>{
   const current=this.state.passwordResets.find(r=>r.userId===user.id&&r.digest===reset.digest&&r.expiresAt>this.now());
   if(!current)throw invalid();
   this.state.users.find(u=>u.id===user.id).password=password;
   this.state.passwordResets=this.state.passwordResets.filter(r=>r.userId!==user.id);
   this.state.sessions=this.state.sessions.filter(s=>s.userId!==user.id);
   this.event(current.tenantId,user.id,'account.password.reset',user.id);
   return {ok:true};
  });
 }
 audit(caller){this.requireAdmin(caller);return this.state.audit.filter(a=>a.tenantId===caller.tenantId&&(caller.platformAccess||!['tenant.create','tenant.delete'].includes(a.action))).map(item=>{const actor=this.state.users.find(user=>user.id===item.actorId),targetUser=this.state.users.find(user=>user.id===item.target);return {...item,actorName:actor?.name||'未知成员',actorEmail:actor?.email||'',targetName:item.target==='配置已更新'?'旧版记录 · 未记录具体对象':targetUser?.name||item.target,...auditAction(item.action)};});}
 clearAudit(caller,confirmation){
  this.requirePlatformOwner(caller);
  if(confirmation!=='清除全部审计日志')throw fail('请输入指定确认文字',400);
  return this.mutate(()=>{const deleted=this.state.audit.length;this.state.audit=[];return {deleted};});
 }
 auditPage(caller,{page=1,limit=25,days='',actor='',category='',q='',includeRoutine=''}={}){
  const all=this.audit(caller).filter(item=>includeRoutine==='1'||!['account.login.feishu','/api/models/discover'].includes(item.action));
  const actors=[...new Map(all.map(item=>[item.actorId,{id:item.actorId,name:item.actorName}])).values()];
  const period=Math.max(0,Math.min(365,Math.trunc(Number(days))||0)),since=period?this.now()-period*86400000:0;
  const query=String(q).trim().toLowerCase().slice(0,200);
  const rows=all.filter(item=>(!since||Date.parse(item.time)>=since)&&(!actor||item.actorId===actor)&&(!category||item.category===category)&&(!query||[item.actorName,item.actorEmail,item.action,item.label,item.target,item.targetName,item.id].some(value=>String(value||'').toLowerCase().includes(query))));
  limit=Math.max(1,Math.min(100,Math.trunc(Number(limit))||25));
  page=Math.min(Math.max(1,Math.trunc(Number(page))||1),Math.max(1,Math.ceil(rows.length/limit)));
  return {items:rows.slice((page-1)*limit,page*limit),total:rows.length,page,limit,actors};
 }
}
