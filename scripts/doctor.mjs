import {pathToFileURL} from 'node:url';

export async function inspectDeployment(address,{fetcher=fetch}={}){
 const url=new URL(address);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('请使用不含凭证的 HTTP(S) 地址');
 const result={url:url.origin,ready:false,build:null};
 try{
  const ready=await fetcher(url.origin+'/readyz',{signal:AbortSignal.timeout(5000)});
  result.ready=ready.ok&&(await ready.json()).ok===true;
  const status=await fetcher(url.origin+'/api/account/status',{signal:AbortSignal.timeout(5000)});
  if(status.ok){const body=await status.json();if(typeof body.build?.version==='string'&&/^[a-f0-9]{16}$/.test(body.build?.fingerprint))result.build=body.build;}
  if(!result.ready)result.error='服务未就绪';
  else if(!result.build)result.error='服务未返回构建指纹，可能仍是旧版';
 }catch{result.error='连接失败或响应无效，请确认该地址对应的实例正在运行';}
 return result;
}

export function deploymentsMatch(results){return results.length>0&&results.every(r=>r.ready&&r.build&&!r.error&&r.build.version===results[0].build?.version&&r.build.fingerprint===results[0].build?.fingerprint);}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),urls=[];
  for(let i=0;i<args.length;i++){if(args[i]!=='--url'||!args[i+1])throw Error('用法：npm run doctor -- --url http://127.0.0.1:3100 [--url http://127.0.0.1:3110]');urls.push(args[++i]);}
  const results=await Promise.all((urls.length?urls:['http://127.0.0.1:3100']).map(url=>inspectDeployment(url)));
  const consistent=deploymentsMatch(results);
  console.log(JSON.stringify({consistent,instances:results,note:'只读检查，不调用模型、不读取密钥。构建相同不代表数据已同步。'},null,2));
  if(!consistent)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
