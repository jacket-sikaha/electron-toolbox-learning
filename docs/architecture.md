# Architecture

> 架构决策与演进记录。每个阶段完成或重大架构调整时更新。

---

## ADR-001:阶段 1 最小实现架构

**日期**:2026-10-07

### 决策

采用 Main + Preload + Renderer 三文件结构:

```
electron/main.ts      ← Main 进程入口
electron/preload.ts   ← Preload 桥(阶段 1 空实现)
src/                  ← Renderer(React SPA)
```

### 关键设计

| 设计 | 决策 | 理由 |
|------|------|------|
| nodeIntegration | false | Renderer 不直接拥有 Node,防止 XSS 升级为系统级入侵 |
| contextIsolation | true | 隔离 Preload 与 Renderer 上下文 |
| preload | 阶段 1 空文件但配置必填 | 为阶段 2 扩展留架构位,防止后续图省事开 nodeIntegration |
| dev/prod 判断 | `!app.isPackaged` | Electron 原生 API,不依赖构建工具 |
| dev 加载 | `loadURL('http://localhost:5173')` | Vite HMR |
| prod 加载 | `loadFile(join(app.getAppPath(), 'dist', 'index.html'))` | 无 dev server 时读本地文件 |
| 外链处理 | `setWindowOpenHandler` + `shell.openExternal` | 防止在 Electron 内被钓鱼 |
| 窗口创建时机 | `app.whenReady().then(createWindow)` | 过早会抛 'Cannot create BrowserWindow before app is ready' |
| 窗口关闭 | `window-all-closed` + `platform !== 'darwin'` 判断 | macOS 关窗口≠退出应用 |

### 为什么这样设计

1. **最小权限原则**:JSON Formatter 不需要 Node API,逻辑放 Renderer;Renderer 默认碰不到 Node。
2. **安全姿势锁死**:从一开始就用 `nodeIntegration:false + contextIsolation:true + preload`,避免后续安全退化。
3. **架构稳定性**:Preload 文件即使阶段 1 是空的也建立并配置,阶段 2 加文件 IO 时只改 Preload 内部,不动 Main 的窗口创建逻辑。

### 替代方案

- `nodeIntegration:true`(早期 Electron 默认):Renderer 直接拥有 Node —— ❌ 任意 XSS → 系统级入侵
- 不建 Preload 文件:阶段 1 能跑,但阶段 2 加 IPC 时要重写 BrowserWindow 配置,架构不稳定
- 用 `process.env.NODE_ENV` 判断 dev/prod:依赖构建工具和外部环境变量,易出错

### 规模扩大 10 倍

- 工具从 1 个增到 10+ 个:需要插件化架构(阶段 5),当前 App.tsx 的 if/else 渲染不可持续
- Main 入口会膨胀:需要拆分窗口管理、IPC handler 注册、生命周期管理为独立模块
- Preload 会膨胀:需要按工具拆分暴露的 API,引入分层 Preload 或动态加载

---

## 复盘:阶段 1

### 本次核心机制

- Electron 三进程模型:Main(主线程、Node 能力、窗口管理)/ Renderer(React 页面、默认无 Node)/ Preload(受控桥)
- app.whenReady() 生命周期:创建窗口的唯一正确时机
- dev/prod 加载方式差异本质:dev 走 http、prod 走 file://,因为 prod 没有 dev server
- 安全配置三件套:nodeIntegration:false + contextIsolation:true + preload

### 为什么这样设计

- Renderer 不需要 Node 就不给 —— 最小权限
- 安全姿势从一开始锁死 —— 防止后续安全退化
- Preload 文件即使空也建立 —— 架构稳定,扩展时不改 Main

### 哪些代码可以交给 AI

- JsonFormatter.tsx(纯 UI + 逻辑)
- styles.css
- vite.config.ts / tsconfig
- index.html / src/main.tsx

### 哪些知识必须自己掌握

- electron/main.ts 里的 7 个关键设计(进程模型 / 安全配置 / dev/prod / 生命周期 / 外链 / 平台差异)
- nodeIntegration / contextIsolation / preload 三个配置项的安全含义
- app.isPackaged vs process.env.NODE_ENV 的工程取舍

### 最容易出现的 3 个 Bug

1. **窗口不出现**:app.whenReady() 未调用,或 createWindow 在 ready 前执行
2. **prod 模式白屏**:loadFile 路径错误(__dirname 在打包后指向 asar 内,需要 app.getAppPath() 或 process.resourcesPath)
3. **窗口内外链跳转异常**:未配置 setWindowOpenHandler,导致外链在 Electron 窗口内打开

### 一个性能风险

- 阶段 1 还没有真正的性能瓶颈,但要注意:每个 BrowserWindow 都是独立 Chromium 实例,多窗口时内存成本高(阶段 5 深挖)

### 一个安全风险

- 阶段 1 暴露的 `version: "0.0.0-placeholder"` 是无意义字符串,但**原则**:Preload 暴露的任何东西都要审视是否必要。阶段 2 引入文件 IO 时,API 暴露面会扩大,必须配合输入校验。

### 一个面试问题

> Q:Electron 为什么不让 Renderer 直接拥有 Node 能力?如果不允许,那 Renderer 怎么调系统 API?
>
> A:Renderer 必须渲染不可信数据(用户输入、第三方 API 返回),如果它直接拥有 Node 能力,任意 XSS 漏洞都会升级为系统级入侵。Preload 是受控桥:通过 contextBridge 暴露白名单 API + 输入校验,即使 Renderer 被攻破,攻击者也只够不到系统。

### 如果规模扩大 10 倍

- 工具数 10+:当前 App.tsx 的 if/else 渲染不可持续 → 阶段 5 插件化架构
- IPC handler 50+:集中注册不可持续 → 分模块注册 + 类型安全 IPC(阶段 2 引入)
- Preload 100+ API:单文件不可持续 → 分工具拆分暴露面(阶段 5)
- 多窗口:每窗口独立 Chromium 内存成本 → 共享渲染进程或隐藏工具进程(阶段 5)

---

## 架构演进路线

| 版本 | 架构 | 触发条件 |
|------|------|---------|
| V0(当前) | 单窗口 + 单工具 if/else 渲染 | 阶段 1 最小实现 |
| V1 | 工具注册表 + 路由切换 | 工具数 ≥ 3 |
| V2 | 分层 Preload + 类型安全 IPC | IPC handler ≥ 5 |
| V3 | 插件化(动态加载工具) | 工具数 ≥ 10 或第三方扩展 |
| V4 | 跨模块通信 + 事件总线 | 工具间需协作 |
| V5 | 共享渲染进程 / 工具进程 | 内存压力大或后台任务多 |
