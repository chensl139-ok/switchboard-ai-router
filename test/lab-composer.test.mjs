import test from 'node:test';
import assert from 'node:assert/strict';
import {setLabBusy} from '../public/lab-composer.js';

test('生成过程中输入框保持可编辑，草稿不被清空，发送暂不可用',()=>{
 const ids=['lab-model','lab-transport','lab-thinking','lab-max-tokens','lab-clear','lab-send','lab-tools','lab-image-button','lab-image-input','lab-prompt','lab-stop','lab-compose-hint','lab-state','lab-draft-state'];
 const elements=Object.fromEntries(ids.map(id=>[id,{disabled:false,hidden:false,textContent:'',value:id==='lab-prompt'?'下一条草稿':'',classList:{toggle(){}}}]));
 const root={querySelector:selector=>elements[selector.slice(1)]};
 setLabBusy(root,true);
 assert.equal(elements['lab-prompt'].disabled,false);
 assert.equal(elements['lab-prompt'].value,'下一条草稿');
 assert.equal(elements['lab-send'].disabled,true);
 assert.equal(elements['lab-send'].hidden,true);
 assert.equal(elements['lab-stop'].hidden,false);
 assert.equal(elements['lab-draft-state'].hidden,false);
 assert.match(elements['lab-compose-hint'].textContent,/生成中可输入下一条草稿/);
 setLabBusy(root,false);
 assert.equal(elements['lab-prompt'].value,'下一条草稿');
 assert.equal(elements['lab-send'].disabled,false);
 assert.equal(elements['lab-send'].hidden,false);
 assert.equal(elements['lab-stop'].hidden,true);
 assert.equal(elements['lab-draft-state'].hidden,true);
});
