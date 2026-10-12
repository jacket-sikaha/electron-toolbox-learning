# 工具契约(Tool Contract)

> 阶段 5 插件化架构的核心设计文档。
> 定义「工具」与「框架」之间的双向合同 —— 工具声明自己是谁、要什么;框架告诉工具能怎么用自己。
>
> 相关:[architecture.md](architecture.md) 的 ADR-006 · [knowledge-map.md](knowledge-map.md)

---

## 一、这份文档解决什么问题

### 阶段 4 结束时的现状

```tsx
// src/App.tsx —— 每加一个工具,改两处
<button onClick={() => setActiveTool("json")}>JSON 格式化</button>   // ① 侧边栏
<button onClick={() => setActiveTool("base64")}>Base64</button>
...
{activeTool === "json" && <JsonFormatter />}                        // ② 渲染分支
{activeTool === "base64" && <Base64Tool />}
```

```ts
// electron/preload.ts —— 所有能力一次性全暴露
contextBridge.exposeInMainWorld("electronAPI", {
  selectAndReadFile, getSystemInfo, hideWindow, bigBase64, onBase64Progress,
});
```

**两个问题:**

1. **不可扩展** —— 加工具要改 N 处,`App.tsx` 会无限膨胀
2. **违反最小权限** —— JSON Formatter 完全不需要 Node 能力,却能调到 `bigBase64()`

### 本文档定义的答案

| 问题 | 答案 |
|---|---|
| 工具怎么被框架发现? | `TOOL_MANIFEST`(共享纯数据) |
| 工具怎么被渲染? | `TOOL_COMPONENTS`(Renderer 独占映射) |
| 工具怎么拿到 Node 能力? | `ctx` 能力注入(按 `permissions` 裁剪) |
| 怎么保证工具不越权? | Main 三层校验(通道存在性 / 来源 / 入参) |

---

## 二、ToolModule 契约:工具向框架声明什么

```ts
// shared/tool-manifest.ts —— 纯数据,Main 与 Renderer 都能安全 import

/** 工具元信息:侧边栏消费者 */
export interface ToolMeta {
  id: string;        // 唯一标识:路由匹配、IPC 通道命名、权限校验的 key
  name: string;      // 侧边栏显示名
  icon: string;      // 侧边栏图标(emoji 或字符,阶段 7 可换 SVG)
  order: number;     // 排序位置(侧边栏按此升序)
}

/** 一个工具的完整声明 */
export interface ToolManifestEntry {
  meta: ToolMeta;
  permissions: Permission[];   // 声明需要的能力 —— 决定 ctx 注入什么、Main 注册哪些通道
}
```

**注意:共享文件里没有 `component`。** 组件映射在 Renderer:

```ts
// src/tools/index.ts —— 只在 Renderer
export const TOOL_COMPONENTS: Record<string, React.ComponentType<ToolProps>> = {
  "json-formatter": JsonFormatter,
  "base64": Base64Tool,
  "big-base64": BigFileBase64Tool,
  "system-info": SystemInfoTool,
};
```

### 为什么 `meta` 和 `component` 必须分开

| | `meta`(共享) | `component`(Renderer 独占) |
|---|---|---|
| **消费者** | 侧边栏 / 路由 / Main 权限注册 | 页面渲染器 |
| **加载时机** | 全量(要列出所有工具) | 按需(同一时刻只渲染一个) |
| **能在 Main 加载吗** | ✅ 纯数据 | 🔴 React 组件,Main 没有 DOM |

**混在一起的后果:** Main `import` 共享文件时,被迫把 4 个 React 组件(含样式、浏览器 API)拉进自己的 bundle —— 不仅浪费,还会直接报错。**所以共享文件必须只放纯数据。**

**额外收益:** `TOOL_COMPONENTS` 这个映射表,正是阶段 7 插入 `React.lazy()` 的位置。

---

## 三、ToolContext 契约:框架向工具提供什么

### 工具**不能**这样做

```ts
// 🔴 工具内部直接调 ipcRenderer
import { ipcRenderer } from "electron";
const file = await ipcRenderer.invoke("tool:select-and-read-file");
```

**三个问题:**

1. **工具知道了通道名** —— 那是框架的实现细节
2. **工具能调任意通道** —— 包括它没声明权限的,`permissions` 形同虚设
3. **通道改名 → 所有工具全崩** —— 框架与工具被硬编码绑死

### 工具**应该**这样做

```ts
// ✅ 工具只用 ctx,永远不碰 ipcRenderer
function Base64Tool({ ctx }: ToolProps) {
  const handleSelect = async () => {
    const file = await ctx.fs.selectAndReadFile();
  };
}
```

### 契约定义

```ts
// src/tools/types.ts —— Renderer 使用的能力契约

/** 框架能提供的全部能力 */
export interface ToolContext {
  fs: {
    selectAndReadFile(): Promise<FileContent | null>;
    bigBase64(onProgress: (p: Base64Progress) => void): Promise<BigBase64Result | null>;
  };
  system: {
    getInfo(): Promise<SystemInfo>;
  };
  window: {
    hide(): Promise<void>;
  };
}

/** 工具组件收到的 props */
export interface ToolProps {
  ctx: Partial<ToolContext>;   // ← 已按该工具的 permissions 裁剪
}
```

### 裁剪:ctx 是「按权限裁剪的视图」,不是 electronAPI 的封装

```ts
// 框架组装 ctx 的逻辑(Renderer 侧)
function buildContext(permissions: readonly Permission[]): Partial<ToolContext> {
  const ctx: Partial<ToolContext> = {};
  if (permissions.includes("fs:read"))     ctx.fs = makeFsApi();
  if (permissions.includes("sys:info"))    ctx.system = makeSystemApi();
  if (permissions.includes("window:hide")) ctx.window = makeWindowApi();
  return ctx;
}
```

| 工具 | `permissions` | 拿到的 `ctx` |
|---|---|---|
| JSON Formatter | `[]` | `{}` ← **什么都没有** |
| Base64 工具 | `["fs:read"]` | `{ fs: {...} }` |
| 大文件 Base64 | `["fs:read"]` | `{ fs: {...} }` |
| 系统信息 | `["sys:info", "window:hide"]` | `{ system: {...}, window: {...} }` |

**这就是 ctx 存在的全部理由:不是「方便用」,而是「按工具裁剪」。**

### 与 `window.electronAPI` 的对比

| | `window.electronAPI` | `ctx` |
|---|---|---|
| 暴露时机 | 应用启动时一次性全暴露 | 工具激活时按权限组装 |
| 暴露范围 | 全部能力 | 只暴露声明过的 |
| 命名方式 | 按**功能**(`selectAndReadFile`) | 按**能力**(`fs`) |
| 粒度 | 一个全局巨型对象 | 每个工具一份,互不可见 |

---

## 四、Main 侧:权限校验的三层模型

### 核心原则

> **任何由被校验方提供的身份信息都不可信。**
> 身份必须来自「框架注入的上下文」,或者「物理上不存在」。

### 第一层:通道存在性(注册期)

**没声明权限的工具,对应的 IPC 通道根本不注册。**

```ts
// electron/main.ts —— 启动时,根据 TOOL_MANIFEST 决定注册哪些 handler

for (const tool of TOOL_MANIFEST) {
  if (tool.permissions.includes("fs:read")) {
    registerFsHandlers(tool.meta.id);   // → ipcMain.handle(`tool:${tool.meta.id}:fs:read`, ...)
  }
  if (tool.permissions.includes("sys:info")) {
    registerSystemHandlers(tool.meta.id);
  }
}
```

**效果:**

| 通道名 | 是否注册 | 原因 |
|---|---|---|
| `tool:base64:fs:read` | ✅ 存在 | base64 声明了 `fs:read` |
| `tool:json-formatter:fs:read` | 🔴 **不存在** | json-formatter 没声明 —— 调用直接 reject |

**「没声明权限」在物理上等于「这个通道不存在」—— 不是「调用了再拒绝」,而是「根本不存在」。**

### 第二层:来源校验(运行期)

```ts
ipcMain.handle("tool:base64:fs:read", (event) => {
  // event.sender 由 Electron 运行时注入,调用方改不了
  if (event.sender !== mainWindow?.webContents) {
    throw new Error("非法来源");
  }
  ...
});
```

| 信息来源 | 可信度 |
|---|---|
| 入参 `{ toolId: "base64" }` | 🔴 调用方自己填的,可任意伪造 |
| `event.sender` | ✅ 运行时注入,调用方无法篡改 |

**这就是阶段 2「零入参 = 零攻击面」原理的另一面:不要问「你是谁」(会撒谎),要看「你从哪来」(框架告知)。**

### 第三层:入参校验(纵深防御)

**即使来源合法,也要校验入参本身** —— 合法工具也可能传错/传恶意数据。

```ts
// 已有的例子:阶段 2 的 10MB 限制
if (fileSize > MAX_FILE_SIZE) throw new Error("文件过大");
```

---

## 五、权限清单(Permission)

```ts
// shared/tool-manifest.ts
export type Permission =
  | "fs:read"       // 读取本地文件(通过 dialog 选择,零入参)
  | "sys:info"      // 读取系统信息(平台/CPU/内存/版本)
  | "window:hide"   // 隐藏/显示窗口
  | "clipboard"     // 剪贴板读写
  | "net";          // 网络请求
```

**命名约定:`能力域:操作`。** 能力域对应 `ctx` 上的命名空间(`fs:read` → `ctx.fs`),这样权限声明与 ctx 结构可以一一对应。

### `permissions` 在「编译时注册」阶段的价值

代码全部可信、拦不住人 —— **那为什么现在就写?**

**两条「今天就能兑现」的价值:**

1. **集中管理** —— 把「散落在实现里的隐式事实」变成「集中的显式声明」。现在想知道「这个应用碰了哪些系统能力」要通读 preload;有了它一眼看全(**商店上架都要求填这张表**)

2. **影响面可查询** —— 要改通用机制(如「所有文件读取加 10 秒超时」)时:
   ```ts
   TOOL_MANIFEST.filter(t => t.permissions.includes("fs:read"))
   // → 一行拿到受影响工具清单,不用翻源码考古
   ```

> **可查询 = 可自动化。**
> **这是「声明式」优于「命令式」的根本原因 —— 不是因为它优雅,是因为它能被程序处理。**

**更关键的是时机:** `permissions` 的**写入成本随工具数量增长**,而**读取价值立刻兑现**。现在写是「设计时顺便声明」;以后补是「考古」—— 要回忆一个三个月前写的工具用了什么能力。

---

## 六、数据流全景

```
┌─────────────────────────── Renderer ───────────────────────────┐
│                                                                 │
│  App.tsx                                                        │
│    import { TOOL_MANIFEST } from "../shared/tool-manifest"      │
│    import { TOOL_COMPONENTS } from "./tools"                    │
│                                                                 │
│    当前工具 = TOOL_MANIFEST.find(t => t.meta.id === activeId)   │
│    ctx      = buildContext(当前工具.permissions)   ← 裁剪!      │
│    组件     = TOOL_COMPONENTS[activeId]                         │
│                                                                 │
│    <组件 ctx={ctx} />   ← 没有权限的能力根本不在 ctx 上         │
│         │                                                       │
│         │ ctx.fs.selectAndReadFile()                            │
│         ▼                                                       │
│    ipcRenderer.invoke("tool:base64:fs:read")                    │
└─────────┬───────────────────────────────────────────────────────┘
          │  IPC(只能传数据,不能传函数)
┌─────────▼─────────────────────────── Main ──────────────────────┐
│                                                                 │
│  import { TOOL_MANIFEST } from "../shared/tool-manifest"        │
│                                                                 │
│  启动时:按 permissions 决定注册哪些 handler                     │
│    tool:base64:fs:read      ✅ (base64 声明过)                  │
│    tool:json-formatter:*    🔴 未注册(没声明)                   │
│                                                                 │
│  handler 内部:                                                  │
│    ① 校验 event.sender(来源)                                   │
│    ② 校验入参(大小/路径/格式)                                  │
│    ③ 执行真正的能力(dialog / fs / os)                          │
└─────────────────────────────────────────────────────────────────┘
```

**这张图里最重要的一点:**

> **`TOOL_MANIFEST` 是同一个数组,被两边各自 `import` —— 单一数据源。**
> **`ctx` 是 Renderer 本地组装的 —— 因为它含方法,方法过不了 IPC。**

---

## 七、自我检查

| 问题 | 答案 |
|---|---|
| 加一个新工具要改几个文件? | **2 个**:`shared/tool-manifest.ts`(加一条)+ `src/tools/index.ts`(加一行映射) |
| 怎么保证两端清单一致? | 同一份数据被两边 import,TypeScript 编译期校验 |
| 为什么 ctx 不能在 Main 组装? | IPC 只能传数据(结构化克隆),**函数不可序列化** |
| 为什么不用入参 `toolId` 做权限校验? | 调用方自己填的身份可任意伪造 → 等于没校验 |
| A 阶段 permissions 拦得住人吗? | **拦不住**(编译期注册,所有代码可信)。它是「可查询的元数据」,不是「强制边界」 |
| 什么时候 permissions 变成真正的强制? | 迁移到 B 方案(运行时加载)之后 |
| A 阶段为什么不直接做 B? | 两者**架构契约完全相同**,B 只多一个「加载器」(≈100 行)。**没有权限模型的运行时加载 = 纯粹的安全漏洞** —— 应先理解权限模型 |
