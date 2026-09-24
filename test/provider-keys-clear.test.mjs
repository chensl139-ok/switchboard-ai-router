import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

test('清除已保存密钥同时移除主备密钥并停用服务商',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-clear-keys-'));
 const app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:()=>{throw Error('已清除密钥不应调用上游');}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(data)=>{const response=await fetch(base+'/api/provider',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};};
 const provider={id:'dual',name:'双密钥服务商',baseUrl:'https://dual.example/v1',protocol:'openai',model:'chat',models:['chat'],enabled:true};
 try{
  let result=await request({...provider,apiKey:'primary-secret',meteredApiKey:'backup-secret'});
  assert.equal(result.status,200);
  assert.equal(result.body.providers.find(p=>p.id==='dual').hasKey,true);
  assert.equal(result.body.providers.find(p=>p.id==='dual').hasMeteredKey,true);
  result=await request({...provider,apiKey:'',meteredApiKey:'',clearKey:true,clearMeteredKey:true});
  assert.equal(result.status,200);
  const cleared=result.body.providers.find(p=>p.id==='dual');
  assert.equal(cleared.hasKey,false);
  assert.equal(cleared.hasMeteredKey,false);
  assert.equal(cleared.enabled,false);
  assert.equal(result.body.active,'');
  await new Promise(resolve=>setImmediate(resolve));
  const saved=JSON.parse(readFileSync(path.join(dir,'state.json'),'utf8')).providers.find(p=>p.id==='dual');
  assert.equal(saved.secret,undefined);
  assert.equal(saved.meteredSecret,undefined);
  assert.equal(saved.enabled,false);
  assert.ok(!JSON.stringify(result.body).includes('primary-secret'));
  assert.ok(!JSON.stringify(result.body).includes('backup-secret'));
  result=await request({...provider,apiKey:'new-primary',meteredApiKey:'new-backup'});
  assert.equal(result.status,200);
  result=await request({...provider,apiKey:'',meteredApiKey:'',clearMeteredKey:true});
  assert.equal(result.status,200);
  assert.equal(result.body.providers.find(p=>p.id==='dual').hasKey,true);
  assert.equal(result.body.providers.find(p=>p.id==='dual').hasMeteredKey,false);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
