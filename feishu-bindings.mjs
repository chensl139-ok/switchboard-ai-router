import {existsSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import path from 'node:path';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const keyFor=token=>createHash('sha256').update('switchboard-feishu-bindings-v1:').update(token).digest();

export class FeishuBindings {
 constructor(dir,admin,envConfigs=[]){
  this.file=path.join(dir,'feishu-bindings.json');this.key=keyFor(admin);this.envConfigs=envConfigs;
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{overrides:{}};
  this.state.overrides??={};
 }
 seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');}
 unseal(value){try{const [iv,tag,data]=value.split('.').map(part=>Buffer.from(part,'base64')),decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}catch{throw Error('飞书企业配置无法解密；请检查 ADMIN_TOKEN 是否与加密时一致');}}
 configs(){
  const configs=this.envConfigs.filter(config=>!Object.hasOwn(this.state.overrides,config.tenantId));
  for(const [tenantId,entry] of Object.entries(this.state.overrides))if(entry){configs.push({...entry,tenantId,appSecret:this.unseal(entry.secretCiphertext),enabled:true,legacy:false,autoJoin:entry.autoJoin!==false,defaultRole:'member'});}
  if(new Set(configs.map(config=>config.key)).size!==configs.length||new Set(configs.map(config=>config.appId)).size!==configs.length||new Set(configs.map(config=>config.tenantId)).size!==configs.length)throw Error('飞书应用标识、App ID 和平台租户必须一一对应');
  return configs;
 }
 metadata(){return this.configs().map(({key,label,tenantId,appId,allowedTenantKey,autoJoin})=>({key,label,tenantId,appId,tenantKey:allowedTenantKey||'',autoJoin:Boolean(autoJoin),source:Object.hasOwn(this.state.overrides,tenantId)?'managed':'environment'}));}
 save(next){const file=this.file+'.tmp';writeFileSync(file,JSON.stringify(next),{mode:0o600});renameSync(file,this.file);this.state=next;}
 bind(input,tenants){
  const tenantId=String(input?.tenantId||''),label=String(input?.label||'').trim(),appId=String(input?.appId||'').trim(),secret=String(input?.appSecret||''),tenantKey=String(input?.tenantKey||'').trim();
  if(!tenants.some(t=>t.id===tenantId))throw fail('租户不存在',404);
  if(!label||label.length>40||!/^cli_[a-zA-Z0-9]{8,40}$/.test(appId)||tenantKey.length>128)throw fail('请填写有效的企业名称、飞书 App ID 和 Tenant Key');
  const existing=this.configs().find(config=>config.tenantId===tenantId),redirectUri=existing?.redirectUri||this.envConfigs[0]?.redirectUri;
  if(!redirectUri)throw fail('请先在服务端配置 FEISHU_REDIRECT_URI',409);
  if(!secret&&(!existing?.appSecret||existing.appId!==appId)||secret&&secret.length>256)throw fail('首次绑定或更换 App ID 时必须填写对应的 App Secret');
  if(this.configs().some(config=>config.tenantId!==tenantId&&config.appId===appId))throw fail('此飞书应用已绑定其他租户',409);
  const key=existing?.key||'bound-'+tenantId.replaceAll('-','').slice(0,24);if(this.configs().some(config=>config.tenantId!==tenantId&&config.key===key))throw fail('飞书企业标识冲突',409);
  const next=structuredClone(this.state);
  next.overrides[tenantId]={key,label,appId,secretCiphertext:this.seal(secret||existing.appSecret),redirectUri,allowedTenantKey:tenantKey,autoJoin:input?.autoJoin===true||input?.autoJoin==='on',legacy:tenantId==='default'&&this.envConfigs.some(config=>config.tenantId==='default'&&config.appId===appId)};
  this.save(next);return this.metadata().find(item=>item.tenantId===tenantId);
 }
 unbind(tenantId){
  if(!this.configs().some(config=>config.tenantId===tenantId))throw fail('此租户未绑定飞书企业',404);
  const next=structuredClone(this.state);next.overrides[tenantId]=null;this.save(next);
 }
}
