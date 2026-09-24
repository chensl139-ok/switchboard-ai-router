import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));

// 构建后对产物做 gzip/brotli 预压缩，运行时只走磁盘 + ETag
const precompress={
 name:'switchboard:precompress',
 apply:'build',
 async closeBundle(){
  const {readdirSync,readFileSync,writeFileSync,statSync}=await import('node:fs');
  const {gzipSync,constants:{Z_BEST_COMPRESSION}}=await import('node:zlib');
  const out=path.join(root,'public/build');
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name));
  for(const f of walk(out)){
   if(!/\.(js|css|html|json|svg)$/.test(f))continue;
   const raw=readFileSync(f);
   if(raw.length<1024)continue;
   writeFileSync(f+'.gz',gzipSync(raw,{level:Z_BEST_COMPRESSION}));
  }
 }
};

export default defineConfig({
 base:'/build/',
 publicDir:false,
 plugins:[vue(),precompress],
 build:{
  outDir:'public/build',
  emptyOutDir:true,
  rollupOptions:{
   input:path.resolve('public/app.js'),
   output:{entryFileNames:'app.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}
  }
 }
});
