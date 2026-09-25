import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVisionRequest,visionOutputText} from '../public/vision-form.js';
import {visionPayload} from '../media.mjs';

const base={model:'moss::moss-vl-1.0',instruction:'描述图像',mediaKind:'image',source:'url',entries:'https://example.test/a.png',maxOutputTokens:'8192'};

test('视觉理解页面请求与网关参数校验一致',()=>{
 const image=buildVisionRequest({...base,entries:'https://example.test/a.png\nhttps://example.test/b.png'});
 assert.equal(image.input[0].content.length,3);
 assert.equal(image.max_output_tokens,8192);
 assert.deepEqual(visionPayload(image,'moss-vl-1.0'),{...image,model:'moss-vl-1.0'});
 const video=buildVisionRequest({...base,mediaKind:'video',source:'file_id',entries:'file_abc-123',maxOutputTokens:1024});
 assert.deepEqual(video.input[0].content[1],{type:'input_video',file_id:'file_abc-123'});
 assert.deepEqual(visionPayload(video,'moss-vl-1.0'),{...video,model:'moss-vl-1.0'});
});

test('视觉理解页面拒绝混乱素材与输出上限',()=>{
 assert.throws(()=>buildVisionRequest({...base,entries:'http://example.test/a.png'}),/HTTPS/);
 assert.throws(()=>buildVisionRequest({...base,source:'file_id',entries:'file/with/slash'}),/file_id/);
 assert.throws(()=>buildVisionRequest({...base,mediaKind:'video',entries:'https://example.test/a.mp4\nhttps://example.test/b.mp4'}),/1 个视频/);
 assert.throws(()=>buildVisionRequest({...base,maxOutputTokens:8193}),/8192/);
 assert.throws(()=>buildVisionRequest({...base,instruction:' '}),/理解指令/);
});

test('视觉理解结果合并多段文本',()=>{
 assert.equal(visionOutputText({output:[{type:'message',content:[{type:'output_text',text:'第一段'},{type:'output_text',text:'第二段'}]}]}),'第一段\n第二段');
 assert.equal(visionOutputText({output:[]}), '');
});
