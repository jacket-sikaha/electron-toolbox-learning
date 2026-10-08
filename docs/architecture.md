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

## ADR-002:阶段 2 IPC 架构与安全设计

**日期**:2026-10-08
**状态**:✅ Accepted

### 背景

Base64 工具需要读本地文件,Renderer 在安全配置下没有 `fs` / `dialog` 等 Node API,必须通过 IPC 让 Main 干活。需要设计 Preload API 签名和防御策略。

### 决策

1. **方案 2:零入参 API** —— `selectAndReadFile()` 不接收 path,Main 内部 `dialog` 选完直接读
2. **API 合并**:选文件 + 读文件合并为一个原子操作,不暴露 `readFile(path)`
3. **channel 命名**:`tool:select-and-read-file`,`tool:` 前缀分组
4. **handle/invoke 而非 on/send**:双向通信 + Promise,异步友好
5. **纵深防御**:Main 侧加 10MB 文件大小限制(阶段 4 改 Stream)

### 理由

1. **零入参 = 零攻击面**:Renderer 不传 path,无法伪造路径,天然防路径穿越
2. **API 合并减少暴露面**:暴露 `readFile(path)` 会让 path 成为攻击向量
3. **handle/invoke 是 Electron 推荐姿势**:返回 Promise,比 on/send 的回调风格更安全
4. **纵深防御**:即使方案 2 天然安全,Main 仍守文件大小边界,防 OOM

### 后果

- Renderer 拿不到 path,无法自行选择读哪个文件(安全特性,非缺陷)
- 文件大小限制 10MB,大文件需等阶段 4 Stream 改造
- 后续工具增多后,channel 命名的 `tool:` 前缀分组会发挥作用

---

## 复盘:阶段 2

### 本次核心机制

- **IPC 数据流三层**:IPC 管道(ipcMain/ipcRenderer)+ Preload 桥(contextBridge)+ Main handler(ipcMain.handle)
- **handle/invoke 配对**:channel 名一致,返回 Promise,双向通信
- **零入参架构**:方案 2 把选文件 + 读文件合并,Renderer 不传 path,零攻击面
- **Buffer 跨 IPC**:Main 的 Buffer 自动序列化为 Uint8Array,Renderer 用 FileReader 转 Base64
- **纵深防御**:方案 2 防路径穿越 + Main 守文件大小边界

### 为什么这样设计

- Renderer 必须渲染不可信数据,不能直接拥有 Node → 必须 IPC
- 方案 2 零入参 > 方案 1 传 path + 校验 → 攻击面从「校验 path」降到「零」
- Preload 只做转发不做业务 → 职责单一,易审计
- channel 用 `tool:` 前缀 → 后续工具增多不会冲突

### 哪些代码可以交给 AI

- Base64Tool.tsx 的 UI + FileReader 逻辑
- preload.ts 的类型定义和 exposeInMainWorld 调用
- App.tsx 的侧边栏扩展

### 哪些知识必须自己掌握

- ipcMain.handle / ipcRenderer.invoke / contextBridge 三者职责与配对关系
- 方案 1 vs 方案 2 的安全性差别(零入参 = 零攻击面)
- 纵深防御:Preload + Main 两层校验的职责分工
- channel 命名规范(`tool:` 前缀分组)
- handle/invoke vs on/send 的选择

### 最容易出现的 3 个 Bug

1. **channel 名不一致**:ipcMain.handle 的 channel 与 ipcRenderer.invoke 的 channel 拼写不一致 → 调用永远 pending,不报错
2. **Buffer 跨 IPC 变 Uint8Array**:Main 返回 Buffer,Renderer 拿到的是 Uint8Array,直接 btoa 会失败(btoa 只接受 string)
3. **dialog 在 app ready 前调用**:dialog.showOpenDialog 必须在 app ready 后,否则行为不可预期

### 一个性能风险

- 10MB 文件全量读入内存 + Base64 转换,内存占用约文件大小 × 1.37(Base64 膨胀率)。100MB 文件会占 ~137MB 内存。阶段 4 用 Stream 改造

### 一个安全风险

- 当前方案 2 天然安全(零入参),但如果后续加「输入 path 读文件」的需求(比如最近打开的文件列表),必须加 path 白名单校验 + resolve 后比对,不能直接 fs.readFile(用户传的 path)

### 一个面试问题

> Q:Electron 的 IPC 有哪几种?handle/invoke 和 on/send 有什么区别?什么时候用哪个?
>
> A:主要两种:① handle/invoke 双向通信,返回 Promise,适合「请 Main 干活并拿结果」② on/send 单向通信,不返回值,适合「通知」。需要返回值的场景用 handle/invoke,纯通知用 on/send。现代 Electron 推荐尽量用 handle/invoke,因为 Promise 风格更安全(不依赖回调顺序)

### 如果规模扩大 10 倍

- IPC handler 从 1 个到 50+:集中注册不可持续 → 分模块注册(每个工具一个 ipc 模块)
- channel 命名冲突概率增大 → `tool:base64:read` 这种二级前缀
- Preload 暴露 50+ API → 单文件不可持续 → 按工具拆分暴露面
- 类型安全:手写 channel 名容易拼错 → 引入类型安全 IPC(阶段 2 进阶)

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
