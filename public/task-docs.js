export function taskDocs(base,esc){
 const example=[
  `curl -sS -D response-headers.txt '${base}/v1/chat/completions' \\`,
  '  -H "Authorization: Bearer $ROUTER_API_KEY" \\',
  "  -H 'X-Task-ID: order-check-001' -H 'Content-Type: application/json' \\",
  `  -d '{"model":"auto","messages":[{"role":"user","content":"返回一个 JSON 对象"}]}'`,
  '', '# 将实际响应头 x-request-id 的值填入 REQUEST_ID', "REQUEST_ID='替换为请求ID'",
  `curl -sS '${base}/v1/requests/'"$REQUEST_ID"'/feedback' \\`,
  '  -H "Authorization: Bearer $ROUTER_API_KEY" -H "Content-Type: application/json" \\',
  `  -d '{"outcome":"rejected","reason":"parse_error"}'`,
  '', '# 重试时复用 X-Task-ID，可明确指定备用模型。新请求验收通过后提交 {"outcome":"accepted"}。',
  `curl -sS '${base}/v1/tasks/order-check-001' \\`,
  '  -H "Authorization: Bearer $ROUTER_API_KEY"'
 ].join('\n');
 return `<p>HTTP 200 不代表输出满足业务要求。SSE 还需检查结束和错误事件。网关调用结果、调用方输出验收分别记录；用量分析中的成功率仍是网关调用成功率。</p>
 <ol><li>生成时携带 <code>X-Task-ID: order-check-001</code>，保存响应头 <code>x-request-id</code>。</li><li>调用方解析和验证输出后，提交 accepted 或 rejected。</li><li>验收失败需重试时，复用同一任务 ID 发起新请求。任务 ID 仅用于关联，不是幂等键，不自动重试或跳过先前模型，每次生成都可能计费。</li><li>使用原 Key 查询任务，或在请求日志详情点击“查看任务耗时与费用”。</li></ol>
 <pre>${esc(example)}</pre>
 <p>拒绝时必须指定 reason：parse_error（解析失败）、schema_error（结构校验失败）、business_error（业务验收失败）或 other。仅正常完成的请求可反馈；相同结果重复提交幂等，不同结果返回 409。接口不收提示词、回复正文和错误堆栈。反馈不消耗模型调用额度，也不改变服务商健康度。</p>
 <p>任务按租户和 API Key 隔离；同名 ID 不跨 Key 合并，账户会话使用独立范围。ID 为 1–128 位字母、数字、点、冒号、下划线或短横线，不应包含个人信息；未提供时默认以请求 ID 关联。支持四种普通对话 HTTP/SSE 入口；媒体生成、专用视觉理解和 WebSocket 的自定义任务关联暂不支持。</p>
 <p>最新发起请求决定任务结果；仍有请求运行时显示 running，未反馈验收显示 unverified。任务跨度包含重试间隔与验收等待；累计上游耗时可能因并发重叠而大于跨度。所有尝试的已知用量和费用均计入，按币种分别累计；未知项单独计数，不当作零。每任务最多 1000 次请求，超出返回 409。日志保留 90 天；清除日志同时清除任务关联和反馈，旧记录不推断补齐。</p>`;
}
