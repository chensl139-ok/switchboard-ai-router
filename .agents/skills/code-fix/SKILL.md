---
name: code-fix
description: Use when encountering code errors such as import failures, TypeScript/Dto type mismatches, JSX syntax issues, API call exceptions, route 404 errors, PostgresError connection verification failed, or **lucide-react icon not found / duplicate identifier / barrel-export naming conflicts**. 触发词：导入错误, 模块解析失败, 类型错误, Dto不匹配, JSX语法, API异常, 路由404, code fix, debugging, lucide-react import error, icon not found, 图标不存在, Cannot find name, 标识符重复, no-redeclare, export 冲突, 桶导出冲突, dual export, "请修复错误" 通用排错, please re-obtain a valid database connection
---


# 代码问题诊断与修复指南

## 概述

本文档提供开发过程中常见问题的诊断与修复流程，涵盖导入错误、语法问题、API 调用异常、路由配置等。规范性内容请参考 `coding-guide`，React Hook 相关问题请参考 `react-hook-best-practices`。

## 导入和模块错误

### 缺少导入声明

**问题描述**：使用组件或图标时没有正确导入

**解决方案**：

- 使用前务必验证技术栈中组件的可用性
- 添加正确的导入语句
- 检查组件是否在当前技术栈中可用

**代码示例**：

```typescript
// 正确的导入方式
import { Button } from '@client/src/components/ui/button';
import { Input } from "@client/src/components/ui/input"
import { ListPlus, Cake, Home, Building, Twitter } from "lucide-react";
```

### 导入路径错误诊断

**问题描述**：错误的导入路径导致模块解析失败

**诊断步骤**：

1. 检查是否使用了项目别名（`@client/`、`@server/`、`@shared/`），而非相对路径 `../`
2. 确认别名对应的实际路径是否正确（如 `@client/` 对应 `client/`）
3. 验证目标文件是否存在于指定路径

> 路径别名的完整定义请参考 `coding-guide` 的"全局编码约定"部分。

### 组件可用性验证

**问题描述**：使用不存在的组件或错误的导入路径

**解决方案**：

- 严格遵循技术栈文档中的可用组件列表
- 验证组件是否存在于指定路径
- 检查组件参数是否匹配

**检查清单**：

- [ ] 导入路径是否正确
- [ ] 组件是否存在
- [ ] 组件参数是否匹配

### lucide-react 图标存在性核查

**问题描述**：从 `lucide-react` 导入的图标名拼错或臆造，渲染时得到 `undefined`，触发 React "type is invalid" 或 LSP "Cannot find name"。

**预防规则（写 import 时主动核查，而非事后救援）**：

1. **不确定就查**：图标名不在你已知列表里 → 先 `Read packages/client/lucide-react/iconMappings.json`（或 lucide-react 包的 d.ts 导出列表）确认存在，再写 import
2. **替换图标必须连同 import 列表一起检查**：把旧图标替换成新图标时，**必须先 grep 当前文件 import 列表**确认新名未已 import，避免触发 LSP "标识符重复" / `no-redeclare`
3. **LSP 警告是硬约束**：写代码后看到 LSP 任意 "Cannot find name" / "标识符重复" → **必须先修完警告才能 commit**，禁止带 LSP 错误提交

### 同名 export 重复（修复 SOP）

**症状**：LSP 报 "标识符 X 重复" / `no-redeclare`。

**修复步骤**：

1. 整个项目 `grep "export.*\bX\b"` 找所有同名 export 一并处理，**不能只改单点**——首次出 bug 时同类常已在多处复制粘贴
2. 预防规则（跨子组件常量前缀化、行内/桶导出二选一）见 `coding-guide` 的「TypeScript 规范 · 命名约定」与「文件命名约定 · 导入导出」

### 前端 Dto 类型使用错误

**问题描述**：代码中使用的 Dto 类型属性与实际定义不一致，导致 TypeScript 类型检查报错

**核心原则**：遇到类型错误，先查 `@client/src/api/gen/types.gen.ts` 确认定义，再修改代码

**错误示例**：

- 示例1： 赋值时缺失必需属性

```
Property 'dueDate' is missing in type {...} but required in type 'CreateBorrowRecordDto'
```

- 示例2：访问不存在的属性

```
Property 'avatar' does not exist on type 'LotteryParticipantResponseDto'
```

- 示例3：导入不存在的类型

```
Module '"@client/src/api/gen"' has no exported member named 'DiscrepancyResponseDto'
```

**解决步骤**：

1. 在 `@client/src/api/gen/types.gen.ts` 中搜索目标Dto实际定义
2. 确认类型名称是否正确，明确完整定义

**检查清单**：

- [ ] 已查看 `@client/src/api/gen/types.gen.ts` 中的类型定义
- [ ] 已对比代码使用与实际定义的差异
- [ ] 已根据实际定义修正代码
- [ ] 已验证修改后类型使用正确

## 业务日期错位

**问题描述**：本地凌晨、周一或月初附近，日期落到前一天、上周或上月。

**解决步骤**：按 `coding-guide` 的「业务日期」一节改——自然日统一走业务时区 helper；精确时刻不动。

## JSX 和语法错误

### 特殊字符转义处理

**问题描述**：JSX 中未转义的特殊字符导致渲染错误

**常见字符**：`<`, `>`, `{`, `}`, `&`, `"`, `` ` ``

**解决方案**：

| 字符 | HTML 实体 | 使用场景 |
|------|-----------|----------|
| `<` | `<` | 显示小于号 |
| `>` | `>` | 显示大于号 |
| `&` | `&` | 显示与符号 |
| `"` | `"` | 显示双引号 |
| `'` | `'` | 显示单引号 |

**代码示例**：

```jsx
// ✅ 正确的特殊字符处理
<div>
  <p>价格: &lt; 100元</p>
  <p>公司: A &amp; B 科技</p>
  <p>标题: &quot;Hello World&quot;</p>
</div>

// ❌ 错误的写法
<div>
  <p>价格: < 100元</p>  {/* 会被解析为标签 */}
  <p>公司: A & B 科技</p>  {/* 可能导致解析错误 */}
</div>
```

## API 生成错误

### 调用 API 客户端时参数与预期不符

**问题描述**：调用 API 客户端时发现传参与后端定义不相同

**解决方案**：检查后端 Swagger 注解中是否对 DTO 对象正确做了注解

## 调用生成的 API 异常

### 查看本地运行日志

**适用场景**：本地开发期 API 调用异常、控制台报错、后端进程行为异常。

**处理要求**：本地日志由 `scripts/dev.js` 落到 `logs/` 目录(`dev.log`、`server.log` 及对应的 `.std.log`),直接 `cat` / `tail -F` 查看;浏览器侧错误看 DevTools Console。本地版**不接管线上日志/traceid 排查链路**(那条路径由发布平台和 oncall 工具承接)。

### 调用 API 客户端时后端返回异常

**解决方案**：检查并修复后端的实现，请勿修改 API 客户端相关代码

**排查示例**：

异常报错如下

```json
[ERROR]{"type":"HTTP Response","url":"/spark/p/app_4hnezxn4uy49c/api/hello/config","method":"GET","status":500,"statusText":"Internal Server Error","message":"Request failed with status code 500","responseData":{"code":"INTERNAL_ERROR","message":"服务器内部错误","success":false,"data":null,"timestamp":1761048452289,"httpStatus":500,"error":{"code":"INTERNAL_ERROR","message":"服务器内部错误","stack":"Error: 这是测试异常：HelloController.getConfig方法故意抛出的错误\n    at HelloController.getConfig (/home/gem/workspace/dist/server/modules/hello/hello.controller.js:17:15)\n    at /home/gem/workspace/node_modules/@nestjs/core/router/router-execution-context.js:38:29\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)"}},"responseTime":283}
```

排查步骤：

1. 分析错误信息

根据 ERROR 可以得知如下关键信息：
请求的 URL：/spark/p/app_4hnezxn4uy49c/api/hello/config
请求 METHOD：GET
错误信息：服务内部错误
错误堆栈（可选）：Error: 这是测试异常：HelloController.getConfig方法故意抛出的错误\n    at HelloController.getConfig (/home/gem/workspace/dist/server/modules/hello/hello.controller.js:17:15)\n    at /home/gem/workspace/node_modules/@nestjs/core/router/router-execution-context.js:38:29\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)

1. 如果错误堆栈存在，优先按照错误堆栈中的相关文件与行列号找到对应文件，读取内容并启发式分析
2. 如果错误堆栈不存在，按照请求的 URL 找到对应的 controller，检查其中的逻辑，启发式的分析依赖。如发现问题可以直接处理。若仍未发现问题，可以在 controller 抛出的错误对象上增加 `message` 属性，改变 message 内容方便 debug。你可以在增加完之后让用户重新请求触发问题。

```typescript
try {
 // some logic
} catch (err) {
        // 后端异常必须在后端打印日志
 this.logger.error('...')
    // 后端异常同时需要抛出到前端，方便修复
 // 构造为 http-errors compatible 的对象
    err.statusCode = 500;
    err.message = err.stack; // 抛出 stack 信息，保障有足够的错误内容透出
    throw err;
}
```

注意：优先让错误信息中包含堆栈信息，以更精确的定位错误发生位置。

## 数据库连接问题

### PG 连接串过期 / 失效

**问题描述**：`npm run dev` 启动后，后端访问数据库时报类似如下错误（关键特征是 `connection verification failed` + `expired or invalid connection link`，endpoint 域名以实际为准）：

```
PostgresError: connection verification failed for endpoint "<pg-endpoint>": expired or invalid connection link, please re-obtain a valid database connection
```

**根因**：PG connection string 注入在 `.env.local` 中，由于安全策略，连接串 **5 天过期**。`npm run dev` 启动时只会读取一次 `.env.local`，过期后旧连接串就会触发上述报错。

**修复方案**：**重新运行 `npm run dev`** 即可。启动脚本会重新拉取并注入最新的 PG connection string 到 `.env.local`，新进程读取到的就是有效连接串。不要去改后端代码或 ORM 配置。

**注意**：

- 不要尝试手工编辑 `.env.local` 里的 PG connection string，连接串由启动流程统一管理
- 不要把这个错误当成业务代码 bug 去排查 controller / service / 数据库 schema
- 重启 `npm run dev` 后若仍报同样错误，再按其它通用排查路径处理

## 路由和导航问题

### 路由 404 错误诊断

**问题描述**：新页面无法访问或出现 404 错误

**诊断步骤**：

1. 确认页面组件已在 `client/src/app.tsx` 中注册路由
2. 验证路由路径拼写正确（注意大小写敏感）
3. 检查导航链接路径与路由定义是否完全匹配
4. 确认动态路由参数正确传递

> 路由配置规范和导航开发详见 `coding-guide` 的"页面与路由开发规范"部分。

## 性能优化

### React Hook 相关问题

useEffect 无限循环、依赖数组管理、useMemo/useCallback 记忆化等问题，请参考 `react-hook-best-practices` 技能，该技能涵盖 React 19 新特性、派生状态、事件 vs Effect 等完整内容。

## 错误处理快速参考

| 场景 | 做法 | 注意事项 |
|------|------|----------|
| 用户反馈 | 使用 `toast` (sonner) 显示友好消息 | 消息简洁、可操作，避免暴露技术细节 |
| 前端日志 | 使用 `logger` (`@lark-apaas/client-toolkit/logger`) | 禁止 console；参数为 string，对象需 `JSON.stringify` |
| 后端日志 | 使用 `@nestjs/common` 的 Logger | 禁止 console；参数为 string，对象需 `JSON.stringify` |
| 业务错误 | 区分预期错误与意外错误 | 预期错误用 `logger.warn`，意外错误用 `logger.error` |
| 异常处理 | 禁止静默处理异常 | 必须显示明确的错误信息，参考 `coding-guide` 相关规范 |
