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

---

## ADR-003:阶段 4 大文件处理架构(Stream + Worker Threads)

**日期**:2026-10-08

### 决策

大文件 Base64 工具采用「Stream 分块读 + Worker 线程编码 + 进度单向推送」的三段式架构:

```
Renderer ──invoke──▶ Main 主线程 ──dialog 选文件──▶ createReadStream 分块
                          │                              │
                          │                              ▼ postMessage
                          │◀── 结果回传 ──── Worker 线程(Base64 编码)
                          │
                          ├──event.sender.send("base64:progress")──▶ Renderer(进度)
                          └──invoke 返回值(最终结果)──────────────▶ Renderer
```

### 关键设计

| 设计 | 决策 | 理由 |
|------|------|------|
| 分块读取 | `createReadStream(path, { highWaterMark: BLOCK_SIZE })` | 内存占用从 O(文件大小) 降到 O(块大小) |
| 块大小 | `3 * 1024 * 1024`(3145728) | **必须是 3 的倍数**(Base64 分组语义,见 Bug-003) |
| 编码位置 | Worker 线程(`base64-worker.ts`) | CPU 密集计算必须搬离主线程,否则整个应用卡死 |
| Worker 位置 | 开在 Main 而非 Renderer | Main 已持有文件数据;开在 Renderer 要跨 IPC 搬两次 100MB |
| 背压控制 | `for await (const chunk of stream)` | 读一块 → 等编码完 → 再读下一块,内存恒定 |
| Worker 生命周期 | `finally { await worker.terminate() }` | 防线程泄漏(点 10 次泄漏 10 个线程) |
| 进度通信 | `webContents.send` + `ipcRenderer.on` | invoke 是「一次调用一个返回值」,进度需要「一次调用多次更新」 |
| 进度节流 | 最短 100ms 一次 | 否则小分块会推上千次,把 IPC 通道打满 |
| 订阅清理 | Preload 返回 unsubscribe 函数,组件 `useEffect` 返回它 | 防监听器累积,否则一次推送触发 N 次回调 |
| 构建登记 | Worker 也是 vite-plugin-electron 的独立 entry | 忘了登记 → `new Worker()` 抛 Cannot find module |
| 正确性护栏 | 主线程 + Worker 两层 3 倍数断言 | 把 Bug-003 的教训变成代码,防止复发 |

### 为什么这样设计

1. **两个瓶颈需要两个武器**:内存爆 → Stream 分块;界面卡 → Worker 线程。只解决一个不够。
2. **「异步」不等于「不卡」**:异步解决的是「等待」(读磁盘),不解决「计算」(Base64 编码)。计算要离开主线程只能靠 Worker/child_process/utilityProcess。
3. **Main 卡死比 Renderer 卡死严重**:Renderer 卡只有那个窗口无响应;Main 卡则所有窗口、菜单、托盘、IPC 全部冻结,用户会以为程序死了去强杀。
4. **数据流最短原则**:文件数据从磁盘进 Main,就地在 Main 交给 Worker,结果不出 Main 进程 —— 避免跨 IPC 搬运大块数据。
5. **进度必须用推送模式**:invoke/handle 的语义是「一问一答」,无法承载「持续更新」。

### 替代方案

- **fs.readFile 一次性读入**:100MB 文件 → 主进程 OOM + 界面卡死 ❌
- **在 Renderer 用 Web Stream + Worker**:Renderer 读不了本地文件;且要实现得先向 Main 要 100MB(IPC 传输一大坨 Uint8Array),编码完再传回 ❌
- **在主线程编码(不用 Worker)**:进度条能走,但界面全程冻结,Main 的菜单/托盘 IPC 全部无响应 ❌
- **用 btoa 代替 Buffer.toString('base64')**:btoa 只接受字符串,且对非 Latin-1 字符抛 InvalidCharacterError ❌
- **进度用 invoke 反复调用**:语境错误,且会造成 IPC 风暴 ❌

### 后果

- **正面**:可处理任意大小文件,内存占用与文件大小解耦;界面全程流畅;进度可视。
- **代价**:structured clone 复制 chunk 有拷贝开销(Worker 的固有成本);代码复杂度上升(Worker 通信、请求-响应配对、进度节流、订阅清理)。
- **遗留**:结果仍是「一次性返回完整 Base64 字符串」—— 若文件达到 GB 级,返回的字符串本身会撑爆内存。真正的终极方案是「边编码边写文件」,留待后续阶段。

---

## 复盘:阶段 3

### 本次核心机制

- **窗口 close 事件拦截**:托盘应用不退出,而是在窗口 close 时 `event.preventDefault()` + `hide()`
- **isQuitting 意图标记**:区分「点 × 想隐藏」与「点退出想真走」两种意图
- **quit / exit / destroy 三者语义**:quit 发起优雅退出流程(可拦)、exit 强制退出(不可拦)、destroy 直接销毁(不触发 close)
- **before-quit 兜底**:覆盖系统关机、Cmd+Q 等所有退出路径
- **hide vs destroy**:hide 保留渲染进程(内存常驻、重开瞬间);destroy 释放内存(重开慢)
- **托盘引用必须模块级持有**:局部变量会被 GC 回收,图标莫名消失

### 为什么这样设计

- 托盘应用的语义是「常驻后台」,关窗口 ≠ 退出应用 → 必须拦截 close
- 拦截 close 需要一个「是否真的要退出」的开关,否则无法区分意图 → isQuitting
- 退出路径不止一条(托盘菜单、系统关机、快捷键),单一位置设置标记不可靠 → before-quit 兜底

### 哪些代码可以交给 AI

- SystemInfoTool.tsx 的展示布局、进度条、格式化函数
- preload.ts 的类型定义和 API 暴露
- 托盘图标的内联 base64 占位图

### 哪些知识必须自己掌握

- close / closed / before-quit 三个事件的时机与能力差异
- app.quit() 是「发起退出流程」而非「强制退出」——它会触发 close
- isQuitting 开关的必要性与「先设标记再调 API」的顺序要求
- hide() 与 destroy() 的资源语义差异
- Tray / BrowserWindow 引用必须模块级持有(防 GC)

### 最容易出现的 3 个 Bug

1. **退出顺序反了**(Bug-002):`app.quit()` 写在 `isQuitting = true` 之前 → 窗口被 hide、托盘被 destroy、进程还在,应用变成退不掉的僵尸
2. **托盘局部变量被 GC**:`const tray = new Tray()` 写在函数内 → 函数执行完图标消失
3. **before-quit 里清理后退出被中止**:清理动作已执行但进程没退,状态不一致

### 一个性能风险

- `hide()` 的窗口渲染进程仍然存活,常驻内存约 50-100MB。托盘应用「秒开」的代价是内存。多窗口场景下这是主要内存成本(阶段 5 展开)

### 一个安全风险

- 托盘菜单里的「退出」如果暴露给 Renderer(比如加一个 `window:quit` IPC),那么 Renderer 一旦被 XSS 攻破,攻击者就能强制关闭应用 → 拒绝服务。当前实现把退出留在 Main 内部(托盘菜单回调),Renderer 只能 `hide`,是正确的最小权限设计

### 一个面试问题

> Q:Electron 托盘应用,用户点退出退不掉(或者点一次窗口和托盘都消失了但进程还在),为什么?
>
> A:典型的是 close 拦截与退出意图标记的顺序问题。`app.quit()` 是同步发起退出流程,会立刻触发窗口 close 事件;如果此时 `isQuitting` 仍为 false,close 里的 `preventDefault()` 会中止退出。若 `before-quit` 里已经执行了 `tray.destroy()`,用户就失去了再次退出的入口,应用变成僵尸状态。正确做法是「先设 isQuitting = true,再调 app.quit()」,并在 before-quit 中兜底设置标记。

### 如果规模扩大 10 倍

- 托盘菜单项从 2 个到 20+(切换工具、全局快捷键配置、开机自启)→ 需要动态构建菜单 + 菜单模板模块化
- 多窗口场景:每加一个窗口就多一份「关闭是隐藏还是销毁」的策略决策 → 需要统一的窗口管理模块(WindowManager),把 close 拦截策略配置化
- 全局快捷键增多 → 冲突检测与用户可配置化

---

## 复盘:阶段 4

### 本次核心机制

- **Stream 分块读取**:`createReadStream` + `highWaterMark`,内存占用从 O(文件大小) 降到 O(块大小)
- **for await 自动背压**:读一块 → 等处理完 → 再读下一块,内存恒定不堆积
- **Worker Threads 卸载 CPU**:Base64 编码搬到独立线程,主线程只做调度
- **Worker 请求-响应配对**:递增 taskId + `Map<id, resolve>`,应对异步乱序返回
- **IPC 两种模式**:invoke/handle(一问一答)vs webContents.send / ipcRenderer.on(单向推送)
- **进度节流**:最短 100ms 一次,防止 IPC 风暴
- **订阅清理契约**:Preload 的 `onXxx` 必须返回 unsubscribe 函数,组件在 `useEffect` 清理里调用
- **分块边界对齐**:Base64 的 3 字节分组语义,块大小必须是 3 的倍数(Bug-003)
- **资源确定性释放**:`finally { await worker.terminate() }`

### 为什么这样设计

- 大文件有**两个**独立瓶颈:内存(读进来撑爆)和 CPU(编码卡界面)。只解决一个都会失败 → 组合拳
- 异步 I/O 解决「等待」不解决「计算」。编码是纯 CPU 计算,`await` 它一样占用主线程 → 必须 Worker
- Main 主线程是所有窗口的公共资源,一旦被阻塞,整个应用(菜单、托盘、IPC)全部无响应,比 Renderer 卡死严重得多 → 计算必须离开 Main
- 进度是「持续状态」而非「单次结果」,invoke 的语义承载不了 → 用推送模式

### 哪些代码可以交给 AI

- `base64-worker.ts` 的 Worker 骨架(message 监听 + postMessage)
- `BigFileBase64Tool.tsx` 的进度条 UI、计时器、统计展示
- Preload 的类型定义与 unsubscribe 包装写法
- vite.config.ts 里 Worker entry 的构建配置

### 哪些知识必须自己掌握

- Stream 分块为什么能解决内存问题(不是「快」,是「占用恒定」)
- 「异步 ≠ 不卡」:异步解决等待,计算必须离开主线程
- Worker 该开在 Main 还是 Renderer(数据流最短原则)
- 进度为什么不能用 invoke 返回
- 订阅必须清理,否则监听器累积
- **分块编码的边界对齐约束(块大小必须是 3 的倍数)** —— 阶段 4 最硬的技术约束
- Worker 是独立运行单元,必须同步登记到构建配置

### 最容易出现的 3 个 Bug

1. **块大小不是 3 的倍数**(Bug-003):中间块带 padding,拼接后解码器提前终止 → **静默数据损坏**,不报错、进度正常、膨胀率正常,数据丢失 71%
2. **Worker 未 terminate**:每次调用泄漏一个 OS 线程,内存与 CPU 双双上涨
3. **订阅未清理**:听众累积,一次进度推送触发 N 次回调;组件卸载后仍持有旧 state 引用(stale state)

**另有两个易错点(非 Bug 但强相关)**:
- **Worker 忘加构建 entry**:`dist-electron/base64-worker.js` 不生成,`new Worker()` 抛 Cannot find module
- **进度节流缺失**:小分块场景会推上千次 IPC,把通道打满

### 一个性能风险

- **返回值仍是完整 Base64 字符串**:GB 级文件时,字符串本身就撑爆内存 —— 分块读取省下的内存,在最终拼接那一步又还回去了。终极方案是「边编码边落盘」

### 一个安全风险

- **Worker 路径可控性**:`new Worker(join(__dirname, 'base64-worker.js'))` 在开发阶段路径固定是安全的;但如果未来支持「插件化 Worker」(从用户目录加载),路径就必须白名单校验,否则等于任意代码执行入口

### 一个面试问题

> Q:Electron 里处理一个 1GB 文件并转 Base64,你会怎么做?为什么?
>
> A:核心是两个瓶颈、两个武器。
> ① **内存**:不能用 `fs.readFile` 一次读入(1GB 进内存 + Base64 后 ~1.37GB,主进程直接 OOM)。用 `createReadStream` 配合固定大小的 `highWaterMark` 分块读,配合 `for await` 做背压,内存占用恒定为「一块大小 + 一块编码结果」。
> ② **CPU**:Base64 编码是纯计算,跑在主线程会让整个应用(所有窗口、菜单、托盘、IPC)全部冻结 —— 比渲染进程卡死严重得多。必须把编码搬到 Worker 线程,主线程只做「读一块 → postMessage → 收结果 → 推进度」的调度。
> ③ **进度**:进度是持续状态,invoke/handle 是一问一答,承载不了,必须用 `webContents.send` + `ipcRenderer.on` 单向推送,并且要节流。
> ④ **边界**:Base64 是 3 字节→4 字符,分块大小必须是 3 的倍数,否则每个中间块末尾的 padding 会让解码器提前终止 —— 这是静默数据损坏,不报错但数据全废。必须加断言。

### 如果规模扩大 10 倍

- **从「转 Base64」到「转 100 种格式」**:Worker 内的编码逻辑要抽象为「任务处理器」,一个 Worker 池按需分发不同类型的任务
- **Worker 从「一任务一线程」到「线程池」**:频繁创建销毁 Worker 有成本(每线程 ~几十 MB 栈空间),需要复用
- **从「一次一个文件」到「批处理」**:需要任务队列 + 并发上限 + 取消机制
- **从「返回字符串」到「流式落盘」**:GB 级文件必须边编码边写文件,不能把结果整体留在内存
- **进度节流参数需要自适应**:不同文件大小下固定 100ms 节流的效果差异很大

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
| V0 | 单窗口 + 单工具 if/else 渲染 | 阶段 1 最小实现 |
| V1(当前) | 工具注册表 + 路由切换 | 工具数 ≥ 3 |
| V2 | 分层 Preload + 类型安全 IPC | IPC handler ≥ 5 |
| V3 | 插件化(动态加载工具) | 工具数 ≥ 10 或第三方扩展 |
| V4 | 跨模块通信 + 事件总线 | 工具间需协作 |
| V5 | 共享渲染进程 / 工具进程 | 内存压力大或后台任务多 |

**对应实际进度**:
- V0:阶段 1(JSON Formatter 单工具)
- V1:阶段 2-4(工具增至 4 个:JSON / Base64 / 系统信息 / 大文件 Base64),但 App.tsx 仍是 if/else,「注册表」尚未实现 —— **工具数已达阶段 5 的触发线**
- 阶段 4 已提前引入「后台线程」概念(Worker),对应 V5 的一部分
