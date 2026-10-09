# Architecture Decision Records (ADR)

> 架构决策日志。每个重要技术选型/架构调整记录一条 ADR。
> 格式:背景 → 决策 → 理由 → 后果 → 状态。

---

## ADR-001: 三进程模型与安全配置(阶段 1)

**状态**:✅ Accepted
**日期**:2026-10-07

### 背景

Electron 应用默认配置下 Renderer 拥有 Node 能力(nodeIntegration:true),会导致任意 XSS 升级为系统级入侵。需要从一开始选择正确的安全姿势。

### 决策

采用 Electron 官方推荐的安全配置:

- `nodeIntegration: false`
- `contextIsolation: true`
- `preload` 必填(即使阶段 1 空实现)
- Main 用 `app.isPackaged` 判断 dev/prod

### 理由

1. Renderer 必须渲染不可信数据,直接拥有 Node = 灾难
2. Preload 是受控桥,即使 Renderer 被攻破,攻击者也只能调白名单 API
3. `app.isPackaged` 不依赖构建工具,dev/prod 语义明确

### 后果

- 阶段 1 任何需要 Node 的功能都必须走 Preload + IPC(阶段 2 引入)
- 工程复杂度略增,但安全姿态从一开始就锁死
- 架构稳定:阶段 2 加文件 IO 时只改 Preload,不动 Main

---

## ADR-002: 项目文档结构(学习沉淀)

**状态**:✅ Accepted
**日期**:2026-10-07

### 背景

长期学习需要沉淀知识,防止上下文失控(Skill 第 17 条)。需要明确文档结构。

### 决策

建立 `docs/` 目录,包含:

- `learning-protocol.md` —— 学习方法论
- `knowledge-map.md` —— 知识点 checklist + 状态
- `architecture.md` —— 架构决策与演进
- `bug-lab.md` —— Bug 实验室
- `performance.md` —— 性能实验室
- `decisions.md`(本文件)—— ADR 日志

### 理由

- 文档分离:不同类型知识归档到不同文件,避免单文件膨胀
- checklist 可视化:Knowledge Map 进度一目了然
- ADR 风格:每个决策有背景/理由/后果,便于复盘

### 后果

- 每阶段结束需要更新多个文件(成本可控)
- 新增工具/阶段时,文档结构已就位,无需重构

---

## ADR-003:阶段 2 IPC 架构与安全设计

**状态**:✅ Accepted
**日期**:2026-10-08

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

## ADR-004:阶段 3 托盘常驻的生命周期模型

**状态**:✅ Accepted
**日期**:2026-10-08

### 背景

工具从「用完就关」的窗口应用升级为「常驻后台」的桌面应用。需要引入托盘,并重新设计退出语义:用户点窗口的 × 到底意味着什么?

### 决策

1. **窗口 close 拦截**:`win.on('close')` 里 `event.preventDefault()` + `hide()`,不销毁窗口
2. **意图标记**:模块级 `let isQuitting = false`,区分「隐藏」与「真退出」
3. **before-quit 兜底**:`app.on('before-quit')` 里设 `isQuitting = true` + 销毁托盘
4. **window-all-closed 空实现**:托盘应用在窗口全关时什么都不做(保留为策略声明位置)
5. **托盘引用模块级持有**:`let tray: Tray | null = null`,防止 GC 回收
6. **退出入口留在 Main**:托盘菜单回调直接在 Main 内处理,Renderer 只能 `hide` 不能 `quit`

### 理由

1. **托盘应用语义是「常驻」**:关窗口 ≠ 退出应用,必须拦 close(而非 window-all-closed —— 那时窗口已销毁,拦不住)
2. **拦截需要一个开关**:否则「点 × 」和「点退出」都会走同一段拦截逻辑,永远退不掉
3. **退出路径不止一条**(托盘菜单、系统关机、Cmd+Q),单点设置标记不可靠 → before-quit 兜底
4. **GC 会回收无人引用的 Tray**:局部变量在函数执行完后失去引用,图标莫名消失(不是崩溃,极易误判)
5. **最小权限**:退出是破坏性操作,暴露给 Renderer 等于给 XSS 一个拒绝服务的入口

### 后果

- 隐藏的窗口渲染进程常驻内存(约 50-100MB),是「秒开」的代价
- 退出逻辑变复杂,顺序敏感(Bug-002:`app.quit()` 与 `isQuitting = true` 顺序反了会导致僵尸状态)
- 为阶段 5 多窗口场景埋下「窗口策略需要统一管理」的伏笔

---

## ADR-005:阶段 4 大文件处理架构(Stream + Worker)

**状态**:✅ Accepted
**日期**:2026-10-08

### 背景

阶段 2 的 Base64 工具用 `fs.readFile` 一次性读入内存并限制 10MB。要处理大文件,暴露出两个独立瓶颈:**内存**(一次性读入会 OOM)和 **CPU**(编码阻塞主线程导致整个应用冻结)。

### 决策

1. **Stream 分块读**:`createReadStream` + `highWaterMark = 3MB` + `for await` 背压
2. **块大小必须是 3 的倍数**:3145728(Base64 的 3 字节分组语义,见 Bug-003)
3. **Worker 线程编码**:`base64-worker.ts` 作为独立构建 entry,主线程只做调度
4. **Worker 开在 Main**:数据流最短,文件数据不出 Main 进程
5. **进度用单向推送**:`webContents.send` + `ipcRenderer.on`,并做 100ms 节流
6. **订阅契约**:Preload 的 `onXxx` 返回 unsubscribe 函数,组件在 `useEffect` 清理中调用
7. **资源确定性释放**:`finally { await worker.terminate() }`
8. **正确性护栏**:主线程 + Worker 两层 3 倍数断言

### 理由

1. **两个瓶颈需要两个武器**:Stream 解决内存(占用从 O(文件大小) 降到 O(块大小)),Worker 解决 CPU(编码离开主线程)
2. **异步 ≠ 不卡**:异步解决的是「等待」(磁盘 I/O),不解决「计算」。编码是纯 CPU,`await` 它照样占主线程
3. **Main 卡死比 Renderer 卡死严重**:Main 是所有窗口的公共线程,冻结后菜单/托盘/IPC 全部无响应
4. **Worker 开在 Main 是数据流最短的选择**:开在 Renderer 需要跨 IPC 搬运 100MB 两次
5. **invoke 语义承载不了进度**:invoke 是「一次调用一个返回值」,进度是「一次调用多次更新」
6. **Worker 是独立运行单元**:vite-plugin-electron 只构建 entry 列表里明确列出的文件
7. **断言优于注释**:注释会被忽略,断言会在第一次运行时拦住错误(把 Bug-003 变成代码护栏)

### 后果

- 可处理任意大小文件,内存与文件大小解耦;界面全程流畅;进度可视
- 代价:structured clone 的 chunk 拷贝开销;代码复杂度显著上升(Worker 通信、请求-响应配对、进度节流、订阅清理、构建登记)
- 遗留:最终结果仍是完整 Base64 字符串,GB 级文件会在「拼接」这一步重新撑爆内存 → 终极方案是边编码边落盘
- 建立了可复用的「后台任务」模式,阶段 5 的插件化工具可直接套用

---

(后续 ADR 持续追加)
