import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
 base:'/build/',
 publicDir:false,
 plugins:[vue()],
 build:{
  outDir:'public/build',
  emptyOutDir:true,
  rollupOptions:{
   input:path.resolve('public/app.js'),
   output:{entryFileNames:'app.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}
  }
 }
});
