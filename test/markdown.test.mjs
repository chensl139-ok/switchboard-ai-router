import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAssistantMarkdown} from '../public/markdown.js';

test('模型回答支持标题、列表、表格、引用、链接与可复制代码块',()=>{
 const html=renderAssistantMarkdown('# 方案\n\n- **第一步**\n- 第二步\n\n> 注意\n\n|模型|价格|\n|---|---:|\n|A|1|\n\n```js\nconst a = 1 < 2;\n```\n\n[文档](https://example.com/docs)');
 for(const element of ['<h1>方案</h1>','<ul>','<strong>第一步</strong>','<blockquote>','<table>','data-copy-code','&lt; 2','https://example.com/docs','rel="noopener noreferrer"'])assert.ok(html.includes(element),element);
});

test('模型返回的 HTML 与危险链接不会执行；不自动加载外链图片',()=>{
 const html=renderAssistantMarkdown('<script>alert(1)</script>\n\n[点击](javascript:alert(1))\n\n![跟踪图](https://example.com/track.png)\n\n```html\n<img src=x onerror=alert(1)>\n```');
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('href="javascript:'));
 assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.ok(html.includes('图片：跟踪图'));
});

test('流式输出的未闭合 Markdown 也可渐进渲染，超大内容安全降级',()=>{
 assert.ok(renderAssistantMarkdown('```js\nconst x = 1').includes('lab-code-block'));
 const huge=renderAssistantMarkdown('<b>'.repeat(90000));
 assert.ok(huge.includes('&lt;b&gt;'));
 assert.ok(!huge.includes('<b>'));
});
