import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A dark variant of a shared rule has higher specificity. Even identical
// dimensions there can defeat a later mobile rule or workspace override.
test('theme-qualified rules cannot change layout or typography',()=>{
 const paint=/^(?:--[\w-]+|color|color-scheme|background(?:-[\w-]+)?|border(?:-(?:top|right|bottom|left))?-color|box-shadow|text-shadow|outline(?:-[\w-]+)?|fill|stroke|opacity|filter|backdrop-filter)$/;
 for(const file of ['style.css','interface.css','workspaces.css','providers.css']){
  const css=readFileSync(new URL('../public/'+file,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  for(const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   if(!selector.includes('.theme-dark'))continue;
   for(const declaration of body.split(';')){
    const property=declaration.split(':')[0].trim();
    if(property)assert.ok(paint.test(property),`${file}: ${selector.trim()} must share ${property} across themes`);
   }
  }
 }
});
