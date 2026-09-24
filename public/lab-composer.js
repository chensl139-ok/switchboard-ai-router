export function setLabBusy(root,value){
 const get=id=>root.querySelector('#'+id);
 for(const id of ['lab-model','lab-transport','lab-thinking','lab-max-tokens','lab-clear','lab-send','lab-tools','lab-image-button','lab-image-input']){
  const element=get(id);if(element)element.disabled=value;
 }
 const prompt=get('lab-prompt');if(prompt)prompt.disabled=false;
 const stop=get('lab-stop');if(stop)stop.hidden=!value;
 const send=get('lab-send');if(send)send.hidden=value;
 const hint=get('lab-compose-hint');if(hint)hint.textContent=value?'生成中可输入下一条草稿 · 完成后按 Enter 发送':'Enter 发送 · Shift + Enter 换行';
 const draftState=get('lab-draft-state');if(draftState)draftState.hidden=!value;
 const state=get('lab-state');if(state){state.textContent=value?'正在生成':'准备就绪';state.classList.toggle('running',value);}
}
