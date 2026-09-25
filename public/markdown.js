import {Marked} from 'marked';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl=value=>{
 try{const url=new URL(String(value));return ['https:','http:','mailto:'].includes(url.protocol)?url.href:'';}catch{return '';}
};
const markdown=new Marked({gfm:true,breaks:true,renderer:{
 html({text}){return escapeHtml(text);},
 link({href,title,tokens}){
  const label=this.parser.parseInline(tokens),url=safeUrl(href);
  return url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title?` title="${escapeHtml(title)}"`:''}>${label}</a>`:label;
 },
 image({href,text}){
  const url=safeUrl(href),label=escapeHtml(text||'图片');
  return url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="lab-markdown-image-link">图片：${label}</a>`:`<span>图片：${label}</span>`;
 },
 code({text,lang}){
  const language=String(lang||'').split(/\s+/)[0].slice(0,32);
  return `<div class="lab-code-block"><div class="lab-code-head"><span>${escapeHtml(language||'代码')}</span><button type="button" data-copy-code aria-label="复制代码">复制代码</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
 }
}});

export function renderAssistantMarkdown(value){
 const text=String(value??'');
 if(!text)return '';
 if(text.length>250000)return `<p>${escapeHtml(text)}</p>`;
 return String(markdown.parse(text));
}
