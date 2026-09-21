import {copyFileSync,readFileSync,renameSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(process.env.DATA_DIR||path.join(root,'data'),'state.json');
const state=JSON.parse(readFileSync(file,'utf8'));
const provider=state.providers.find(p=>p.id==='siliconflow');
if(!provider){console.log('硅基流动已不存在');process.exit(0);}
if(provider.enabled||provider.secret||provider.meteredSecret||provider.models?.length||state.active==='siliconflow'||state.rules?.some(r=>r.providerId==='siliconflow')){
 throw Error('硅基流动仍有配置或引用，已停止删除');
}
const backup=file+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-');
copyFileSync(file,backup);chmodSync(backup,0o600);
state.providers=state.providers.filter(p=>p.id!=='siliconflow');
if(state.catalog)delete state.catalog.siliconflow;
if(state.providerAliases)delete state.providerAliases.siliconflow;
const temporary=file+'.tmp';
writeFileSync(temporary,JSON.stringify(state),{mode:0o600});
renameSync(temporary,file);
console.log(`已删除硅基流动；备份：${backup}`);
