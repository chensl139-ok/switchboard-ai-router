import {copyFileSync,readFileSync,renameSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(process.env.DATA_DIR||path.join(root,'data'),'state.json');
const state=JSON.parse(readFileSync(file,'utf8'));
const subscription=state.providers.find(p=>p.id==='mosi');
const metered=state.providers.find(p=>p.id==='mosi-metered');
if(!subscription?.secret||!metered?.secret)throw Error('两个服务商的密钥未全部配置；未修改任何数据');
if(subscription.baseUrl!==metered.baseUrl)throw Error('两服务商的 Base URL 不一致；未修改任何数据');
const overlap=new Set(subscription.models);
const channels=Object.fromEntries(metered.models.filter(model=>!overlap.has(model)).map(model=>[model,'metered']));
if(process.argv[2]!=='--apply'){
 console.log(`预览：${subscription.models.length} 个 Subscription 模型、${metered.models.length} 个 Metered 模型、${Object.keys(metered.prices||{}).length} 条价格；重复模型默认 Subscription。`);
 process.exit(0);
}
const backup=file+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-');
copyFileSync(file,backup);chmodSync(backup,0o600);
subscription.models=[...new Set([...subscription.models,...metered.models])];
subscription.modelProtocols={...metered.modelProtocols,...subscription.modelProtocols};
subscription.modelChannels={...metered.modelChannels,...channels};
for(const model of overlap)delete subscription.modelChannels[model];
subscription.meteredSecret=metered.secret;
subscription.anthropicAuth=metered.anthropicAuth||subscription.anthropicAuth||'bearer';
subscription.prices={...subscription.prices,...metered.prices};
subscription.name='moss';
state.providers=state.providers.filter(p=>p.id!=='mosi-metered');
state.providerAliases={...(state.providerAliases||{}),'mosi-metered':{id:'mosi',channel:'metered'}};
if(state.active==='mosi-metered')state.active='mosi';
for(const rule of state.rules||[])if(rule.providerId==='mosi-metered')rule.providerId='mosi';
if(state.catalog){delete state.catalog.mosi;delete state.catalog['mosi-metered'];}
const temporary=file+'.tmp';writeFileSync(temporary,JSON.stringify(state),{mode:0o600});renameSync(temporary,file);
console.log(`已合并为单个 moss 服务商，保留两把密钥与旧 metered 路由别名；备份：${backup}`);
