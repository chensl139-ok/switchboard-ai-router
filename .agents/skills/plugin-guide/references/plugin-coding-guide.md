## PluginInstance 代码编写指南

### 核心原则：根据场景选择调用侧

**默认优先在 Client 侧调用 capabilityClient；流式或高耗时 AI 生成优先 `callStream` 渐进展示。结果需要持久化时，优先在流式结束后通过已有后端接口保存；只有 Client 侧无法满足时才切到 Server 侧。**

**高耗时 AI capability 先判调用形态**：只要输出规模大、输出字段多、需要多份结果、多语言/长文本、文件或多模态输入后继续生成、多个 capability 串联、或结果需后续查看/落库，就不得把完整 AI 结果塞进一个同步 HTTP 请求等待。能由前端承接时，优先用前端 `callStream` 渐进展示，并在流式结束后按需复用已有 CRUD 接口保存结果；只有 Client 侧无法满足（触发器/敏感凭证/强事务/必须由后端保证落库一致性等）时，才采用后端任务记录 + 状态/结果查询，避免把后台任务作为默认方案。

**严禁** import ｛ capabilityClient ｝ from '@lark-apaas/client-capability'。
**唯一指定**的导入方式是 import { capabilityClient } from '@lark-apaas/client-toolkit';

| 优先级 | 场景 | 调用方式 |
|-------|------|---------|
| **首选** | 绝大多数即时展示场景 | `capabilityClient.load(id).call()` |
| **首选** | 流式输出，或高耗时但可由前端承接的 AI 生成 | `capabilityClient.load(id).callStream()`（流式结束后按需持久化） |
| **必要时** | 高耗时且 Client 侧无法满足：触发器、敏感凭证、强事务、必须由后端保证落库一致性 | 后端任务记录 + 后台调用 `CapabilityService.load(id).call()` + 前端短轮询状态/结果 |
| **兜底** | Client 侧无法满足且单次调用可在交互边界内完成 | `CapabilityService.load(id).call()` |

#### 什么情况下应使用 Server 侧？

以下场景适合在 Server 侧调用：

1. **涉及敏感凭证**：调用需要服务端私密 token/secret，不适合暴露给前端
2. **必须后端编排**：多个插件调用之间有强事务依赖，需要后端统一编排
3. **触发器/定时任务场景**：没有前端上下文，只能由后端发起
4. **插件结果需要持久化**：调用结果需要保存到数据库；能由前端承接时，优先前端 `callStream` 渐进展示并在结束后复用已有 CRUD 接口保存；只有 Client 侧无法满足或必须由后端保证落库一致性时，才在 Server 侧调用并落库。若此时输出规模大、字段多、结果多份或需多步能力串联，必须改为任务记录 + 后台执行 + 状态/结果查询，避免一个 HTTP 请求等待完整生成

> **提示**：如果插件结果不需要存储、仅用于即时展示（如流式生成文本、发送消息），优先在前端调用。但当结果需要保存到数据库时，不要回避使用 Server 侧。

---

### 插件结果持久化决策

当插件返回的结果需要保存到数据库时（如 AI 分类/摘要结果、文档解析的结构化数据、图片识别结果、语音转文字内容等），按以下决策选择方案：

```
插件结果是否需要持久化到数据库？
├── 否
│   ├── `outputMode=stream` 或内容生成较慢 → Client 侧 `callStream()` 渐进展示
│   └── 单次短输出 → Client 侧 `call()`（默认）
└── 是
    ├── `outputMode=stream` 且前端可承接 → 推荐方案 A：Client 侧 `callStream()` 渐进展示，成功后通过已有 CRUD 接口保存结果
    ├── 输出较小且可在交互边界内完成、且必须由后端保证一致性 → Server 侧调用并在同一方法中落库
    └── Client 侧无法满足且输出规模大/多字段/多份/多语言/多步骤 → 方案 B：Server 侧创建任务记录，快速返回任务状态；后台调用插件并落库；前端短轮询状态/结果
```

| 应避免的做法 | 推荐做法 |
|------------|---------|
| 前端调用插件后不保存结果，导致数据丢失 | 插件调用成功后及时持久化 |
| 为保存插件结果单独新建 API（如 `PATCH /api/xxx/ai-analysis`） | 优先复用已有的 create/update 接口，扩展字段即可 |
| 仅在前端 state 中暂存插件结果，不写入数据库 | 通过后端接口保存到数据库 |

---

### Client 侧调用方式（默认首选）

#### 1. 调用前获取权威依据

在为某个插件实例生成调用代码前，必须先通过 `get_plugin_ai_json` 工具获取该插件实例的运行时投影（plugin_Instance.ai.json），并以其中信息为准：

- `actions[].key`：调用时要传的 `actionKey`
- `actions[].inputSchema / outputSchema`：入参/出参结构
- `actions[].outputMode`：`unary | stream`（决定调用与结果处理方式）

**编码前闸门（必须）**：先产出 Schema 摘录卡，再开始代码编辑。

```markdown
[Schema 摘录卡]
- pluginInstanceId / actionKey / outputMode
- input.required / output.fields / readme.constraints
- 调用侧决策: Client | Server
```

若摘录卡字段缺失，不得进入实现阶段。

#### call / callStream 函数签名

```typescript
// 前端 capabilityClient（@lark-apaas/client-toolkit，实际类型来自 @lark-apaas/client-capability）
.call<T = unknown>(actionKey: string, params?: Record<string, unknown>): Promise<T>              // 非流式
.callStream<T = unknown>(actionKey: string, params?: Record<string, unknown>): AsyncIterable<T>  // 流式
```

- **第一个参数 `actionKey`**：必须是字符串，值来自 `get_plugin_ai_json` 返回的 `actions[].key`（如 `'sendFeishuMessage'`、`'textGenerate'`）
- **第二个参数 `params`**：类型是 `Record<string, unknown>`，结构符合 `actions[].inputSchema`
- 上面是**前端**签名，带泛型。**服务端 `CapabilityService` 的 `call` / `callStream` / `callStreamWithEvents` 都没有泛型**，两者不通用，详见「Server 侧调用方式」

> **`Record<string, unknown>` 不接 `interface` 声明的对象**（interface 没有隐式索引签名），直接传会撞
> `Argument of type 'XxxInput' is not assignable to parameter of type 'Record<string, unknown>'. Index signature for type 'string' is missing in type 'XxxInput'.`
> 三种正确写法：① 直接传内联对象字面量；② 入参类型用 `type XxxInput = { ... }` 而非 `interface`（type 别名有隐式索引签名）；③ 已有 interface 时在调用点显式 `input as unknown as Record<string, unknown>`。**不要为此改用 `as any`。**

```typescript
// ❌ 错误：把参数 JSON.stringify 后当作 actionKey
plugin.call(JSON.stringify({ meeting_title: '...' }));
// ❌ 错误：漏掉 actionKey，直接传参数对象
plugin.call({ meeting_title: '...' });

// ✅ 正确：第一个参数是 actionKey 字符串，第二个参数是 input 对象
plugin.call('send_feishu_message', { meeting_title: '...' });
```

#### 2. 非流式调用（outputMode = "unary"）

```typescript
import { capabilityClient } from '@lark-apaas/client-toolkit';
import { logger } from "@lark-apaas/client-toolkit/logger";

const result = await capabilityClient
  .load('create_feishu_group')
  .call('createGroup', {
    group_name: '项目讨论群',
    members: ['user_001', 'user_002'],
  });

logger.info(result);
```

#### 3. 流式调用（outputMode = "stream"）

##### 必须处理返回形态差异（重点）

`callStream()` 可能返回 `AsyncIterable<chunk>` 或 `{ output: AsyncIterable<chunk> }`，必须先归一化。

```typescript
type AnyRecord = Record<string, unknown>;

function isAsyncIterable(value: unknown): value is AsyncIterable<AnyRecord> {
  return !!value && typeof (value as AnyRecord)[Symbol.asyncIterator] === 'function';
}

function normalizeStream(resultOrStream: unknown): AsyncIterable<AnyRecord> {
  if (isAsyncIterable(resultOrStream)) {
    return resultOrStream;
  }
  if (
    resultOrStream &&
    typeof resultOrStream === 'object' &&
    'output' in (resultOrStream as AnyRecord) &&
    isAsyncIterable((resultOrStream as AnyRecord).output)
  ) {
    return (resultOrStream as AnyRecord).output as AsyncIterable<AnyRecord>;
  }
  throw new Error('Invalid callStream result: cannot find AsyncIterable stream');
}

function readFirstStringField(
  chunk: AnyRecord,
  keys: string[],
): string {
  for (const key of keys) {
    const value = chunk[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}
```

##### 场景判断与推荐方案

| 场景 | 特征 | 推荐度 |
|-----|------|-------|
| **多插件并行流式** | 多个插件各返回单一输出，并行调用 |  **优先推荐** |
| **单插件 JSON 流式解析** | 单插件返回结构化 JSON，需边接收边解析 | ⚠️ 仅在必要时 |

**核心原则**：在插件设计阶段按「原子化拆解」拆分，避免单插件返回多字段 JSON。

##### 推荐：多插件并行流式

适用于需求涉及多种输出（标题、正文、图片等），各输出相对独立。

```tsx
import { logger } from "@lark-apaas/client-toolkit/logger";

function MultiPluginStreamExample() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverUrl, setCoverUrl] = useState('');

  const handleGenerate = async (keywords: string) => {
    // 1. 封面图（非流式，异步不阻塞）
    capabilityClient
      .load('cover_generator')
      .call<{ images: string[] }>('textToImage', { keywords })
      .then(res => res?.images?.[0] && setCoverUrl(res.images[0]))
      .catch(err => logger.warn('封面生成失败', err));

    // 2. 标题（非流式）
    capabilityClient
      .load('title_generator')
      .call<{ content: string }>('textGenerate', { keywords })
      .then(res => res?.content && setTitle(res.content));

    // 3. 正文（流式，边生成边展示）
    const streamResult = capabilityClient
      .load('content_generator')
      .callStream<{ content: string }>('textGenerate', { keywords });
    const contentStream = normalizeStream(streamResult);

    // 🎯 按 outputSchema 字段提取，禁止把 chunk 当字符串
    for await (const chunk of contentStream) {
      const delta = readFirstStringField(
        chunk as Record<string, unknown>,
        ['content'], // 必须来自 get_plugin_ai_json.actions[].outputSchema
      );
      if (delta) {
        setContent(prev => prev + delta);
      }
    }
  };

  return (/* 各字段独立渲染 */);
}
```

**优点**：代码简洁、各插件独立、某个失败不影响其他。

##### ⚠️ 兜底：单插件 JSON 流式解析

当无法拆分为多插件时，需处理不完整 JSON 的逐字符到达，需实现 `parseStreamingStringField` 和 `extractJsonObject` 工具函数。**强烈建议在插件设计阶段拆分为多插件并行流式调用，避免此场景。**

---

### 失败日志最小集（必须）

失败日志至少包含以下字段：

```typescript
{
  pluginInstanceId: string,
  actionKey: string,
  outputMode: 'unary' | 'stream',
  inputKeys: string[],
  resultType?: string,
  resultKeys?: string[],
  firstChunkKeys?: string[],
  error: string
}
```

### 改后冒烟验证清单（必须）

完成调用代码后，最少执行并记录：

1. 一个 `unary` action 的真实调用结果（字段按 `outputSchema` 读取）
2. 一个 `stream` action 的真实调用结果（chunk 按 `outputSchema` 字段读取）
3. 调用失败时的最小日志字段齐全
4. 若无法执行真实调用，必须明确写明阻塞原因，禁止直接标记"开发完成"
5. 若用户触发 AI 生成的请求超时、连接断开或工具返回超时，必须判定为验收失败；只有触发请求快速返回、随后能通过页面或接口读到明确完成或失败终态和结果，才允许标记通过

### Server 侧调用方式（仅兜底场景）

> 以下场景适合使用 Server 侧调用；若前端 `callStream` + 既有 CRUD 保存即可满足展示和持久化，不要优先引入后端后台任务。

#### 1. 何时适合用 Server 侧？

| 场景 | 原因 | 示例 |
|------|------|------|
| 触发器/Webhook | 无前端上下文 | 数据变更时自动发送通知 |
| 定时任务 | 无前端上下文 | 每日定时生成报告 |
| 敏感凭证调用 | 凭证不能暴露给前端 | 调用需要 admin token 的 API |
| 强事务编排 | 多步骤需要原子性 | 创建记录 → 发通知 → 更新状态必须全成功或全回滚 |
| 插件结果需持久化 | 调用结果需保存到数据库 | AI 分类/摘要结果需落库、文档解析的结构化数据需入库、图片识别结果需关联业务记录、语音转文字结果需存档等 |
| 高耗时 AI 生成需后续查看 | 请求不能长期占用用户交互链路 | 批量、多版本、多语言、长文本、多字段结构化生成，或文件/多模态分析后再生成内容 |

#### 2. NestJS 注入方式

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';

@Injectable()
export class XxxService {
  private readonly logger = new Logger(XxxService.name);

  // 注入 token 必须显式写成 @Inject(CapabilityService)
  constructor(
    @Inject(CapabilityService) private readonly capabilityService: CapabilityService,
  ) {}
}
```

**禁止空参 `@Inject()`**。本 stack 的 `nest-cli.json` 用 `builder: swc`，空参 `@Inject()` 会把注入 token 置为 undefined，Nest 回退读 `design:type` 拿到 `Function`，服务端启动即崩溃、所有 `/api` 请求返回 502：

```
UnknownDependenciesException: Nest can't resolve dependencies of the XxxService (?).
Please make sure that the argument Function at index [0] is available in the XxxModule context.
```

见到这段报错先查构造函数有没有空参 `@Inject()`，不要去改 Module 的 `imports` / `providers`。

**业务 Module 不需要注册 CapabilityModule**。`PlatformModule` 是 `@Global()` 且已把 `CapabilityModule` 放进 `exports`，`CapabilityService` 全局可注入。不要在业务 Module 里写 `imports: [CapabilityModule.forRoot(...)]` 或 `imports: [PlatformModule.forRoot()]`。

同一规则适用于从 `@lark-apaas/fullstack-nestjs-core` 注入的其他平台服务（`AuthNPaasService`、`FileService` 等）。

#### 3. 调用示例

服务端 `CapabilityExecutor` 的**三个方法全都没有泛型参数**（`@lark-apaas/nestjs-capability`）：

```typescript
call(actionName: string, input: unknown, context?: Partial<PluginActionContext>): Promise<unknown>;
callStream(actionName: string, input: unknown, context?): AsyncIterable<unknown>;
callStreamWithEvents(actionName: string, input: unknown, context?): AsyncIterable<StreamEvent<unknown>>;
```

写 `.call<T>(...)` / `.callStream<T>(...)` / `.callStreamWithEvents<T>(...)` 都会报「应有 0 个类型参数，但获得 1 个」。泛型只存在于前端 `capabilityClient`。注意服务端 `input` 是**必传**（没有 `?`），且类型是 `unknown` 而非前端的 `Record<string, unknown>`。服务端接 `unknown` 后在运行时收窄，禁止 `as any`：

```typescript
const inputParams = {
  // 严格按 get_plugin_ai_json.actions[].inputSchema 构造
};

try {
  const output: unknown = await this.capabilityService
    .load('')
    .call('', inputParams);
  // 运行时收窄后再取字段，例如：
  // if (typeof output === 'object' && output !== null && 'content' in output) { ... }
  return output;
} catch (error) {
  this.logger.error('pluginInstance call failed', {
    pluginInstanceId: '',
    actionKey: '',
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  throw error;
}
```

#### 4. Server 侧编排与容错原则

- PluginInstance 调用在 Server 侧通常属于 **外部依赖 / side-effect**
- 除非业务明确要求强一致性，**默认不应阻塞主业务流程**
- 已选择 Server 侧承接的高耗时 AI capability 必须有可观测状态：创建任务时记录处理进度、完成终态、失败终态、输入摘要、错误信息和结果引用；触发接口只返回任务标识与当前状态，前端通过短轮询读取进度和最终结果

推荐写法：异步触发 + catch 兜底：

```typescript
this.somePluginInstanceSideEffect(input).catch(error => {
  this.logger.warn('PluginInstance side-effect failed, ignored', {
    error: error instanceof Error ? error.message : 'Unknown error'
  });
});
```

---

### outputMode 与调用侧选择

先通过 `get_plugin_ai_json(pluginInstanceId)` 获取 `actions[].outputMode`：

| outputMode | 推荐调用侧 | 调用方式 |
|------------|-----------|---------|
| `unary` | **Client 侧优先** | `capabilityClient.load(id).call(actionKey, input)` |
| `stream` | **Client 侧优先** | `capabilityClient.load(id).callStream(actionKey, input)` |
| 任意（兜底场景） | Server 侧 | `capabilityService.load(id).call(actionKey, input)` |

**选择原则**：

- 不涉及持久化时，优先在 Client 侧直接调用
- `outputMode = stream` 时，Client 侧使用 `callStream` 做渐进式渲染
- 涉及持久化、触发器、敏感凭证、事务编排等场景时，使用 Server 侧

---
