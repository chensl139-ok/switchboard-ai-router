---
name: plugin-guide
description: 本地开发场景下的 AI 插件集成规范。使用 lark-cli 命令管理插件包和实例，通过 capabilityClient/CapabilityService 生成调用代码。触发词：插件, plugin, AI生文, AI生图, 图片理解, 文档解析, 语音转文字, 结构化提取, capabilityClient, CapabilityService, pluginInstance, lark-cli plugin
compatibility: "requires: lark-cli with plugin commands (apps +plugin-install, +plugin-uninstall, +plugin-list). If not met, tell user: lark-cli 当前版本不支持插件能力，请升级到最新版本"
when_to_use: "lark-cli apps +plugin-* commands are available. If not, tell user: lark-cli 当前版本不支持插件能力，请升级到最新版本"
steering: true
steering-topic: plugin_guide
match-template-name: nestjs-react-fullstack
---

{% raw %}

# Plugin 集成指南（本地开发）

AI 插件集成规范，使用 lark-cli 命令管理插件包与实例，通过 capabilityClient / CapabilityService 生成调用代码。

## ⚠️ 前置门禁

本 skill 依赖 lark-cli 的插件管理能力。开始前先确认当前环境是否可用：

```bash
lark-cli apps --help 2>&1 | grep -q '+plugin-install' && echo "READY" || echo "MISSING"
```

- **READY** → 继续
- **MISSING** → 当前 lark-cli 版本不支持插件命令，请更新到最新版后重试：

## Quick Reference

| 操作 | 方式 |
|------|------|
| 插件包管理（安装/卸载/查看） | 由 lark-apps skill 引导，参考其 plugin reference 文档 |
| 创建实例 | 设计 paramsSchema/formValue → 自查规则 → 写入配置文件（见 Create 链路） |
| 获取插件调用代码编写依据 | 按「插件调用代码编写依据」章流程获取 |
| Client 侧非流式调用 | `capabilityClient.load(id).call(actionKey, input)` |
| Client 侧流式调用 | `capabilityClient.load(id).callStream(actionKey, input)` |
| Server 侧调用（仅兜底） | `capabilityService.load(id).call(actionKey, input)` |
| 长耗时 AI 结果 | 大体量/多字段/多份/多语言/文件或多模态串联等结构信号命中时，优先前端 `callStream` 渐进展示；需保存则流式结束后复用 CRUD 落库；仅在 Client 侧无法满足时使用后端任务记录 + 状态查询 + 结果读取；禁止单个 HTTP 请求等待完整结果后才返回 |
| capabilityClient 导入 | `import { capabilityClient } from '@lark-apaas/client-toolkit'` |
| CapabilityService 导入 | `import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';` |
| CapabilityService 注入 | `@Inject(CapabilityService) private readonly capabilityService: CapabilityService`（**禁止空参 `@Inject()`**，会导致启动崩溃 502；业务 Module 无需 imports） |
| 插件实例配置位置 | `server/capabilities/<instance_id>.json`（默认全栈应用）。见「配置目录」段 |

> **capabilityClient 导入警告**：`capabilityClient` 是从 `@lark-apaas/client-toolkit` 直接导入的独立对象，**不是**从 `getDataloom()` 上获取的。正确且唯一的方式：`import { capabilityClient } from '@lark-apaas/client-toolkit'`。

## Plugin 代码编写指南

以下场景**必须**先读取 `references/plugin-coding-guide.md` 再编写代码：

- 编写 `capabilityClient` 或 `CapabilityService` 调用代码时
- 需要判断 Client 侧还是 Server 侧调用时
- 处理流式输出（`outputMode = stream`）
- 在 Server 侧进行 NestJS 注入或编排多个插件调用时

## 核心概念

- **插件包（Plugin Package）**：npm 格式的功能包，安装到 `node_modules/`，含 `manifest.json` 描述 actions 和 form.schema。
- **插件实例（Plugin Instance / Capability）**：基于插件包创建的业务配置，存储在 `server/capabilities/{id}.json`（默认全栈应用，路径规则见「配置目录」），定义 `paramsSchema`（业务入参）和 `formValue`（表单映射，通过 `{{input.xxx}}` 引用 paramsSchema 参数）。
- **变量映射**：`调用方传值 → paramsSchema 定义变量 → formValue 消费变量 {{input.xxx}} → Plugin form.schema 接收`。

### 插件包 ≠ npm 包（必读）

| | 插件包 | npm 依赖 |
|------|------|------|
| 写入字段 | `package.json` → **`actionPlugins`** | `package.json` → `dependencies` / `devDependencies` |
| 用途 | 妙搭平台 AI 能力 | 项目依赖库 |
| **禁止** | ❌ 不能用 `npm install` 装插件包 | ❌ 不能用 `npm install` 管理插件包 |

两套机制完全独立。混淆会导致运行时找不到插件。

### 插件实例配置目录

插件实例配置文件（`<instance_id>.json`）存放在 capabilities 目录下。按以下优先级确定路径：

1. 环境变量 `MIAODA_CAPABILITIES_DIR` → 直接使用
2. 环境变量 `MIAODA_APP_TYPE` 或 `.env.local` 中的 `MIAODA_APP_TYPE`：
   - `6` → `shared/capabilities/`（纯前端应用）
   - 其他 → `server/capabilities/`（全栈应用）
3. 以上都未设置 → 默认 `server/capabilities/`

目录不存在时 `mkdir -p` 创建。

---

## AI 插件目录（17 个）

### 文本类

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-text-generate` | 文本生成 | stream | 流式文本 `content` | 文案、报告、对话、问答 |
| `ai-text-summary` | 文本摘要 | stream | 流式文本 `summary` | 长文本摘要、要点提取 |
| `ai-translate` | 多语言翻译 | stream | 流式文本 `translation` | 中英日韩等多语言互译 |
| `ai-categorization` | 文本分类 | unary | `{categories: string[]}` | 打标签、情感分析、内容分类 |
| `ai-text-to-json` | 文本→结构化 JSON | unary | `{字段名: 值}` | 信息提取、表单自动填充（最多 20 字段） |
| `ai-search-summary` | 搜索摘要 | stream | 流式文本 `content` | 联网搜索 + 摘要生成 |

### 图片类

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-text-to-image` | 文生图 | unary | `{images: string[]}` | 根据文本描述生成图片 |
| `ai-image-to-image` | 图生图 | unary | `{images: string[]}` | 图片编辑、风格转换 |
| `ai-image-understanding` | 图片理解 | stream | 流式文本 `content` | 图片描述、问答、OCR |
| `ai-image-to-json` | 图片→结构化 JSON | unary | `{字段名: 值}` | 图片信息提取（单步直达） |
| `ai-image-compare` | 图片对比 | stream | 流式文本 `content` | 两张图片差异分析 |
| `ai-image-matting` | 抠图 | unary | `{images: string[]}` | 去背景、主体提取 |
| `ai-background-replace` | 换背景 | unary | `{images: string[]}` | 替换图片背景 |

### 文档/语音/其他

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-doc-parser` | 文档解析 | unary | **纯文本 string** | PDF/Word/Excel 文本提取 |
| `ai-speech-to-text` | 语音识别 | unary | **纯文本 string** | 音频转文字 |
| `ai-speech-synthesis` | 语音合成 | unary | 音频 URL string | 文字转语音 |
| `web-crawler` | 网页抓取 | unary | 网页内容 string | 抓取指定 URL 的页面内容 |

> 所有插件 key 使用时需加 `@official-plugins/` 前缀，如 `@official-plugins/ai-text-generate`。

### 用户意图 → 插件选择

| 用户表述 | 对应插件 | 类型 |
|---------|---------|------|
| "AI 写文案 / 生成文本 / 帮我写" | `ai-text-generate` | 流式生成 |
| "总结 / 摘要 / 提取要点" | `ai-text-summary` | 流式生成 |
| "翻译成XX / 多语言" | `ai-translate` | 流式生成 |
| "分类 / 打标签 / 情感分析" | `ai-categorization` | 结构化 |
| "从文本提取字段 / 文本转结构化" | `ai-text-to-json` | 结构化 |
| "搜索并总结 / 联网查询" | `ai-search-summary` | 流式生成 |
| "AI 生图 / 文生图 / 生成图片" | `ai-text-to-image` | 图片 |
| "图片编辑 / 风格转换 / 图生图" | `ai-image-to-image` | 图片 |
| "识别图片 / 图片问答 / 看图说话" | `ai-image-understanding` | 流式生成 |
| "从图片提取信息 / 图片转结构化" | `ai-image-to-json` | 结构化 |
| "对比两张图 / 图片差异" | `ai-image-compare` | 流式生成 |
| "抠图 / 去背景" | `ai-image-matting` | 图片 |
| "换背景 / 替换背景" | `ai-background-replace` | 图片 |
| "解析文档 / 读 PDF / 读 Word" | `ai-doc-parser` | 文本提取 |
| "语音合成 / 文字转语音 / 朗读" | `ai-speech-synthesis` | 音频 |
| "语音识别 / 音频转文字" | `ai-speech-to-text` | 文本提取 |
| "抓取网页 / 爬取页面" | `web-crawler` | 文本提取 |

---

## 设计原则

### 原子化

**一个插件实例只做一件事**。不同输出类型、不同业务语义必须创建独立的插件实例。

```
✅ 正确：需要生成标题 + 生成正文
   → 创建两个 ai-text-generate 实例：title-generator、content-generator

❌ 错误：把标题和正文塞进同一个实例的 prompt
   → 输出混在一起，无法分别渲染
```

### 链式调用

部分插件输出是纯文本，不能直接产出结构化数据。需要链式组合时：

```
文档 → 结构化：ai-doc-parser → ai-text-to-json（两步）
图片 → 结构化：ai-image-to-json（单步直达，优先用这个）
语音 → 结构化：ai-speech-to-text → ai-text-to-json（两步）
```

### 流式标注

使用 stream 输出模式的插件，功能设计中需注明涉及流式渲染，代码中使用 `callStream` + `normalizeStream`。

---

## Plugin 链式调用（Plugin Chain）

**禁止用正则/字符串解析替代 AI 插件做结构化输出处理**。

### 决策树：选择单步还是链式

```
输入是什么？
├── 文档文件 → 必须先用 ai-doc-parser 提取文本：
│   ├── 需要结构化数据 → ai-doc-parser → ai-text-to-json（2步链）
│   ├── 需要摘要 → ai-doc-parser → ai-text-summary
│   ├── 需要翻译 → ai-doc-parser → ai-translate
│   └── 仅需原文 → ai-doc-parser（单步）
├── 图片 →
│   ├── 提取结构化数据 → ai-image-to-json（⭐ 单步直达！）
│   ├── 理解后提取结构化 → ai-image-understanding → ai-text-to-json（2步链）
│   └── 抠图后换背景 → ai-image-matting → ai-background-replace（2步链）
├── 音频 →
│   ├── 需要结构化数据 → ai-speech-to-text → ai-text-to-json（2步链）
│   └── 仅需文字 → ai-speech-to-text（单步）
└── 纯文本 →
    ├── 需要结构化数据 → ai-text-to-json（⭐ 单步直达！）
    └── 摘要/翻译/分类/生成 → 对应单插件
```

### 常见 Plugin Chain 组合

| 链路 | 插件组合 | 场景举例 |
|------|---------|---------|
| 文档→结构化数据 | `ai-doc-parser` → `ai-text-to-json` | 简历PDF→员工档案 |
| 文档→摘要 | `ai-doc-parser` → `ai-text-summary` | 研报PDF→摘要 |
| 图片→结构化数据 | `ai-image-to-json`（**单步**） | 发票→金额/日期 |
| 音频→结构化数据 | `ai-speech-to-text` → `ai-text-to-json` | 会议录音→待办 |
| 抠图→换背景 | `ai-image-matting` → `ai-background-replace` | 商品图→电商主图 |

### Plugin Chain 调用模式

```typescript
// 文档 → 结构化数据（2步链）
const rawResult = await capabilityClient
  .load('doc_parser_instance')
  .call('parseDocToMarkdown', { fileUrl: [docUrl] });

const structured = await capabilityClient
  .load('text_to_json_instance')
  .call('textToJson', { text: rawResult.content });
```

> **Client 侧提示**：`capabilityClient` 支持直接传 File/Blob 对象作为文件参数，无需先上传获取 URL。Server 侧 `CapabilityService` 仅支持 URL 字符串。

---

## Schema 规则

生成 paramsSchema 和 formValue 前必读本章节。

### 变量三层映射

```
调用方传值              paramsSchema 定义变量       formValue 消费变量                         Plugin form.schema 接收
(resume_text="...")  →  (定义: resume_text)     →  ("prompt": "...{{input.resume_text}}...")  →  (prompt 字段)
(article="...")      →  (定义: article)         →  ("content": "{{input.article}}")           →  (content 字段)
```

**关键区分**：

- formValue 的 **key** = Plugin form.schema 的字段名（如 `prompt`、`content`、`fileUrl`）
- formValue 的 **value** 中通过 `{{input.xxx}}` 引用 paramsSchema 定义的变量
- 变量名（paramsSchema）与 form 字段名（form.schema）分属不同层，通常名称不同

### paramsSchema 生成规则

#### 支持的参数类型（仅 4 种）

**文本**：

```json
{ "type": "string", "description": "文本参数描述" }
```

**数组**：

```json
{ "type": "array", "description": "描述", "items": { "type": "string", "description": "元素描述" } }
```

**图片**：

```json
{ "type": "array", "format": "plugin-image-url", "description": "描述", "items": { "type": "string" } }
```

**文件**：

```json
{ "type": "array", "format": "plugin-file-url", "description": "描述", "items": { "type": "string" } }
```

#### 约束

- 只允许 string 和 array 两种 type
- 每个参数**必须**有 type 和 description
- array 类型**必须**有 items 字段
- format 只允许 `plugin-image-url` 或 `plugin-file-url`
- 若 form.schema 字段描述写"不允许使用参数"，则不生成对应 paramsSchema

### formValue 生成规则

- **key 必须**对应 form.schema 中定义的字段
- **value** 可以是常量，或 `{{input.xxx}}` 引用 paramsSchema 参数
- **类型一致性**：
  - form.schema type=string → `"字段名": "{{input.param}}"` 或常量字符串
  - form.schema type=array + paramsSchema type=array → **透传**：`"字段名": "{{input.param}}"`（禁止再包数组）
  - form.schema type=array + paramsSchema type=string → **包装**：`"字段名": ["{{input.param}}"]`
- **禁止双层包装**：paramsSchema 已经是 array 时，`["{{input.param}}"]` 会导致 `[url]` → `[[url]]`
- 无法明确赋值的字段留空字符串 `""`
- **业务枚举参数**：用户指定单一固定值 → 常量；用户列举多个值 → 生成 paramsSchema 参数
- 若 form.schema 字段描述写"固定填默认值 xxx" → 直接填固定值

### 插件字段映射表

#### 文本类

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-text-generate | `prompt` | 用户输入嵌入 prompt 字符串 | `modelID`、`modelParams`（固定值） |
| ai-text-summary | `content` | 直接赋值 | `requirement`（摘要要求） |
| ai-translate | `content` | 直接赋值 | `targetLanguage`（单一语言写常量，多语言生成参数） |
| ai-categorization | `textToBeCategorized` | 直接赋值 | `categories`（分类列表，array 类型） |
| ai-text-to-json | `prompt` | 文本嵌入 prompt | `jsonStructure`（固定结构定义）、`modelID`、`modelParams` |
| ai-search-summary | `prompt` | 用户查询嵌入 prompt | `modelID`、`modelParams`（固定值） |

#### 图片类

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-text-to-image | `prompt` | 图片描述嵌入 prompt | `ratio`（宽高比）、`style`（风格） |
| ai-image-to-image | `prompt` + `images` | 指令嵌入 prompt，图片传 images（透传） | `strength`（编辑强度） |
| ai-image-understanding | `prompt` + `images` | 指令嵌入 prompt，图片传 images（透传） | `modelID`、`modelParams` |
| ai-image-to-json | `prompt` + `images` | 文本嵌入 prompt，图片传 images | `jsonStructure`、`modelID`、`modelParams` |
| ai-image-compare | `prompt` + `images` | 对比指令嵌入 prompt，两张图片传 images | — |
| ai-image-matting | `images` | 图片直接传入（透传） | — |
| ai-background-replace | `images` + `prompt` | 原图传 images，新背景描述嵌入 prompt | — |

#### 文档/语音/其他

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-doc-parser | `fileUrl` | file 类型：array → 透传，string → 包装 `["{{input.xxx}}"]` | — |
| ai-speech-to-text | `fileUrl` | 同 ai-doc-parser | — |
| ai-speech-synthesis | `text` | 直接赋值 | `voice`（语音角色，通常常量） |
| web-crawler | `url` | 直接赋值 | — |

### AI Prompt 编写规则

当插件涉及 AI 能力时，formValue 的 prompt 字段**应包含完整的高质量提示词**，而非简单透传。

#### 禁止的做法

```json
// ❌ 直接透传
"prompt": "{{input.prompt}}"
// ❌ 过于简单
"prompt": "根据关键词生成文案：{{input.keywords}}"
```

#### Prompt 编写要素

1. **角色设定**：明确 AI 扮演的角色
2. **任务描述**：清晰说明要完成的具体任务
3. **输入说明**：标明用户输入将被插入的位置
4. **输出要求**：明确格式、结构、长度等
5. **风格约束**：指定语气、风格、受众

#### 各场景 Prompt 模板

**文本生成类**：

```json
"prompt": "你是一位资深的[平台名]内容创作专家。\n\n请根据以下关键词生成一篇文案：\n关键词：{{input.keywords}}\n\n内容要求：\n1. 标题（15-25字）\n2. 正文（300-500字）\n3. 结尾设置互动问题"
```

**图片理解类**：

```json
"prompt": "你是一位专业的图像分析专家。\n\n请对提供的图片进行深度分析：\n1. 基础信息：图片类型、主体内容\n2. 细节描述：颜色、构图、关键元素\n3. 语义理解：含义、情感、用途\n\n{{input.additional_requirements}}"
```

**文生图类**：

```json
"prompt": "请生成一张高质量图片：\n\n主题内容：{{input.subject}}\n\n画面要求：风格、构图、光线、色调\n质量要求：画面清晰、主体突出"
```

### 模板语法限制

- **仅允许** `{{input.参数名}}` 一种语法
- **严禁** `{{#if}}`、`{{#each}}`、`{{#unless}}`、`{{/if}}`、`{{/each}}`、`{{else}}`

### 一致性铁律

1. **定义的变量必须被引用** — paramsSchema 中定义了 `xxx`，formValue 中至少有一处 `{{input.xxx}}`
2. **引用的变量必须被定义** — formValue 中出现 `{{input.xxx}}`，paramsSchema.properties 中必须有 `xxx`
3. **paramsSchema 允许为空** — 当 formValue 所有字段都是常量时可以是 `{}`
4. **不一致 → 后端 actions 为空 → 插件无法调用** — 常见致命错误

### ID 生成规则

1. 基于插件实例的名称和描述，设计有业务语义的 ID
2. 格式：小写字母 + 数字 + 短横线（如 `task-text-summary`）
3. 长度不超过 128 字符
4. 必须在当前项目内唯一

---

## CRUD 链路

### Create 链路

创建一个**插件实例**（Plugin Instance），即能力目录下的 `<id>.json` 配置文件。

1. **安装插件包** — 由 lark-apps skill 引导完成
2. **读 manifest** — `cat node_modules/<pluginKey>/manifest.json`，理解插件的 actions 和 form.schema
3. **确定配置目录** — 按上方「插件实例配置目录」规则确定目录，不存在则 `mkdir -p` 创建
4. **设计实例配置** — 规则见 §Schema 规则，确定：
   - `id`：语义化 ID（小写+短横线，如 `task-text-summary`）
   - `name` / `description`：实例的显示名称和描述
   - `paramsSchema`：对外暴露的业务入参
   - `formValue`：将业务入参映射到插件的 form.schema 字段
5. **自查规则** — 写入前逐条对照 §一致性铁律 检查：变量引用是否对称、类型是否允许、是否使用了禁止的模板语法、数组是否有 items。发现违规立即修正，超过 3 次仍未通过则上报用户
6. **写入实例配置** — 将以下结构写入 `server/capabilities/<id>.json`（或步骤 3 确定的路径）：

   ```json
   {
     "id": "<id>",
     "pluginKey": "<pluginKey>",
     "pluginVersion": "<version>",
     "name": "<实例名称>",
     "description": "<实例描述>",
     "paramsSchema": { ... },
     "formValue": { ... },
     "createdAt": <unix毫秒>,
     "updatedAt": <unix毫秒>
   }
   ```

7. **获取插件调用代码编写依据** — 必须按「插件调用代码编写依据」章的获取流程执行（含多级 Fallback）。未成功获取 → 禁止进入步骤 8
8. **编写调用代码** — 基于步骤 7 的结果，**禁止凭记忆猜测**

大 JSON 场景先写临时文件再读取，避免命令行转义问题。

### Update 链路

修改已有**插件实例**的配置。不可变字段（id / pluginKey / pluginVersion / createdAt）不要修改。

1. `cat server/capabilities/<id>.json` → 查看当前实例配置
2. 读 manifest + 设计修改方案（改 name / formValue / paramsSchema）
3. 改后逐条对照 §一致性铁律 自查，修正后写回配置文件，更新 `updatedAt`
4. **获取插件调用代码编写依据** — 按「插件调用代码编写依据」章的获取流程执行
5. paramsSchema 变化 → 基于步骤 4 的结果扫描代码引用并更新

### Delete 链路

1. `cat server/capabilities/<id>.json` → 确认实例存在
2. `grep -rn "load('${id}')" <project-path>/` → 扫描代码引用，有则先清理
3. `rm server/capabilities/<id>.json`
4. 确认清理完成

### Get 链路

| 查什么 | 操作 |
|--------|------|
| 已声明的插件包及安装状态 | 由 lark-apps skill 引导 |
| 所有实例概览 | `ls server/capabilities/` |
| 单个实例完整配置 | `cat server/capabilities/<id>.json` |
| 插件的 actions/schema | `cat node_modules/<pluginKey>/manifest.json` |
| 获取插件调用代码编写依据 | 按「插件调用代码编写依据」章流程获取 |

### 常见违规及修正

| 违规信息 | 原因 | 修正 |
|---------|------|------|
| `forbidden Handlebars syntax at formValue.xxx` | 使用了控制语法 | 改为纯 `{{input.xxx}}` |
| `paramsSchema property "x" type "number" is invalid` | 类型不在 string/array 范围 | 改为 `"type": "string"` 或 `"type": "array"` |
| `paramsSchema property "x" is array but missing items` | 缺少 items | 补上 `"items": {"type": "string"}` |
| `{{input.xxx}} at formValue.yyy is not defined` | 引用了未定义的变量 | 在 paramsSchema 中补充定义 |
| `paramsSchema property "x" is never referenced` | 定义了但未引用 | 在 formValue 中补充引用或从 paramsSchema 移除 |

---

## 插件调用代码编写依据

### 获取调用依据（每次编写/修改调用代码前必须执行）

**首次尝试**：

```bash
npx @lark-apaas/miaoda-cli plugin list --id <instance_id>
```

命令不可用时，依次尝试 fallback。如果所有工具都不可用且插件有 `{dynamic: true}`，按「无 Node.js 环境」兜底处理。

输出包含 `actions[].key`、`inputSchema`、`outputSchema`、`outputMode`，是编写调用代码的唯一依据。

### 充血 Fallback 链

`npx @lark-apaas/miaoda-cli plugin list --id <id>` → 失败则 `npx fullstack-cli capability list --id <id>` → 失败则 `node .agents/skills/plugin-guide/scripts/plugin-hydrate.js <pluginKey> <instanceId>` → 失败则手动合并 manifest + capability JSON。

### 无 Node.js 环境

1. 告知用户当前环境未安装 Node.js
2. 手动逐条校验 formValue + paramsSchema（对照 §Schema 规则）
3. 手动合并 manifest + capability JSON
4. 如果插件有 `{dynamic: true}`：
   a. 阅读插件源码（`node_modules/<pluginKey>/` 中动态 schema 函数）
   b. 结合 formValue 推导动态参数的实际结构
   c. 输出推导结论
   d. 基于推导结果编写调用代码
   e. 运行时若报错 → 上报用户（附带推导过程 + 实际报错）
   f. 运行正确 → 推导成立，代码注释说明推导来源

### Client vs Server 决策

| 应用类型 | 可选调用侧 |
|---------|-----------|
| 纯前端应用 | 只有 Client 侧 |
| 全栈应用（NestJS + React） | Client 侧（首选）或 Server 侧 |

**Server 侧仅在以下场景使用**：

1. 涉及敏感凭证（token/secret 不能暴露给前端）
2. 多步骤强事务编排
3. 触发器/定时任务（无前端上下文）
4. 插件结果需持久化到数据库

> 不涉及上述场景 → Client 侧。

### 持久化决策

以下任一条件成立时，插件结果**必须**保存到数据库：

1. 结果会在其他页面展示
2. 结果供后续功能消费
3. 用户再次访问时需要看到结果

**推荐**：能由前端承接时，Client 侧 `callStream` 渐进展示，流式结束后调已有 CRUD 接口保存。**必要时**：敏感凭证、触发器、强事务或必须由后端保证落库一致性时，Server 侧 Service 调用插件并落库。

**高耗时 AI capability 闸门**：若插件输出定义或功能设计显示输出规模大、输出字段多、需要多份结果、多语言/长文本、文件或多模态输入后继续生成、多个 capability 串联、或结果需后续查看/落库，禁止把完整生成放进一个同步 HTTP 请求等待；能由前端承接时优先 `callStream` 渐进展示，需保存则流式结束后复用 CRUD 落库；仅在 Client 侧无法满足时后端创建任务记录后快速返回、由前端短轮询状态/结果，或拆成多个独立小调用。

### 生成代码

完成上述决策后，**必须读取** `references/plugin-coding-guide.md` 获取具体代码模式。禁止凭记忆写调用代码。

---

| 错误类型 | 含义 | 应对策略 |
|----------|------|---------|
| `InputValidationError` | 入参不符合 schema | 修复参数后重试 |
| `RateLimitError` | 触发限流 | 指数退避重试（1s/2s/4s），最多 3 次 |
| `ExecutionError` | 插件执行失败 | 记录日志 + 降级方案 + 通知用户 |
| `OutputValidationError` | 返回值不符合 schema | 记录异常返回 + 使用默认值 |

**规则**：

1. **禁止静默吞异常**：每个 `catch` 块必须向用户展示错误或触发补偿
2. **异步操作必须有终态**：DB 中维护状态（pending → success / failed）
3. **长耗时 AI 生成不得同步等完**：大体量、多字段、多份、多语言、文件/多模态串联或需要持久化的 AI capability 调用，触发接口必须快速返回任务状态或采用前端流式展示；若接口请求、浏览器操作或页面请求出现超时/连接断开，不能只凭服务端最终日志或数据库最终写入宣告成功，必须证明用户侧存在可读取的终态结果
4. **插件失败必须有补偿**：至少记录到待处理列表或提示用户重试

## 缓存与幂等性

- AI 类插件**没有请求级缓存**。同样输入返回相似结果是 LLM 正常行为。
- **禁止**通过修改业务参数注入 UUID 来"绕缓存"，这会污染 AI 输入。

## 参数来源规范

| 类型 | 来源 | 示例 |
|------|------|------|
| 业务数据 | 从 DB 查询或前端传入 | 候选人姓名、简历内容 |
| 运行时配置 | 从配置/环境变量/平台 API 获取 | 接收人 user_id、模板 |

**禁止**在业务代码中硬编码运行时配置值。固定值 → 在 formValue 中直接配置；动态值 → 从配置/API/DB 获取。

---

## 常见错误（必须避免）

| 错误做法 | 正确做法 |
|---------|---------|
| 用 `npm install` 安装插件包 | 插件包通过 lark-apps skill 引导安装 |
| 实例配置文件写入不正确的位置 | 按「插件实例配置目录」规则确定路径 |
| 未读 manifest 就写调用代码 | 先 `cat manifest.json`，确认 actionKey/schema |
| Mock `capabilityClient` 返回值 | 必须真实调用 |
| 通过 `getDataloom().capability` 调用插件 | `capabilityClient` 是独立导入 |
| Client 侧先通过 dataloom 上传文件再传给插件 | 直接传 File/Blob 对象 |
| 用正则/字符串解析处理 AI 输出 | 用 `ai-text-to-json` / `ai-image-to-json` |
| 认为 `ai-doc-parser` 能直接输出结构化 JSON | 只输出纯文本，需链式调用 `ai-text-to-json` |
| 图片提取结构化用两步链 | 优先 `ai-image-to-json` 单步直达 |
| 流式 chunk 当字符串拼接 | chunk 是对象，按 outputSchema 解构：`chunk.content` |
| formValue 中 `["{{input.xxx}}"]` 包装已是 array 的参数 | array 类型透传 `"{{input.xxx}}"`，不再包数组 |
| 创建了实例但未生成调用代码 | CREATE 后必须接着生成调用代码集成到业务 |
| 为保存插件结果单独新建 API 端点 | 复用已有 CRUD 接口 |

## 铁律

1. **写入实例配置前必须自查** — 逐条对照 §一致性铁律 检查参数定义与引用的对称性、类型合法性、模板语法限制。自查通过后再写入配置文件。
2. **先装包再建实例** — 创建插件实例前必须确保插件包已安装。
3. **校验失败走重试** — max 3 次，3 次仍失败上报用户。
4. **写代码前获取插件调用代码编写依据** — 必须按「插件调用代码编写依据」章流程获取。禁止凭记忆猜测 actionKey / inputSchema / outputMode。
5. **禁止用 `npm install` 安装插件包** — 插件包和 npm 包是两套独立机制。
6. **禁止 Mock** — 必须走真实插件实例调用链路。
7. **formValue 禁止 Handlebars 控制语法** — 仅允许 `{{input.xxx}}`。

{% endraw %}
