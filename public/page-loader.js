// Only load a feature when it is opened. Failed imports remain retryable;
// concurrent opens share the same request without reviving a departed view.
export function createPageLoader(importers){
 const pending=new Map(),loaded=new Map();
 function load(name){
  if(loaded.has(name))return Promise.resolve(loaded.get(name));
  if(pending.has(name))return pending.get(name);
  if(!Object.hasOwn(importers,name))return Promise.reject(Error('未知页面模块'));
  const task=Promise.resolve().then(()=>importers[name]()).then(module=>{
   loaded.set(name,module);pending.delete(name);return module;
  },error=>{pending.delete(name);throw error;});
  pending.set(name,task);return task;
 }
 return {load,peek:name=>loaded.get(name)};
}
