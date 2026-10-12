# Electron Knowledge Map

> 进度状态:✅ 已掌握(能解释+应用+排错) · 🟡 接触(能解释) · 🔴 未接触 · 🎯 当前阶段目标

## Architecture 架构设计

- [x] ✅ 进程模型 Main / Renderer / Preload 三者职责与边界
- [x] ✅ Preload 最小暴露原则
- [x] ✅ IPC 通信架构(ipcMain / ipcRenderer / contextBridge 数据流)—— 阶段 2 完成
- [ ] 🎯 多窗口架构(主窗口/子窗口/隐藏窗口/工具进程)—— 阶段 5
- [x] ✅ 插件化扩展架构(无限扩展工具箱核心命题)—— 阶段 5 完成(契约层 + 注册表 + ctx 注入 + 权限裁剪)
- [x] ✅ 进程隔离与信任边界 —— 阶段 2 巩固

## Core 重点基础

- [x] 🟡 BrowserWindow 创建与配置(webPreferences 安全配置)
- [x] 🟡 dev/prod 加载方式差异(loadURL vs loadFile 本质)
- [x] ✅ app.whenReady() 生命周期时机
- [x] ✅ ipcMain.handle 通信机制 —— 阶段 2 完成
- [x] ✅ ipcRenderer.invoke 通信机制 —— 阶段 2 完成
- [x] ✅ contextBridge.exposeInMainWorld —— 阶段 2 完成
- [x] ✅ 完整 app 生命周期(ready / window-all-closed / close 拦截 / quit-exit-destroy 区别)—— 阶段 3 完成
- [ ] 🔴 WebContents 状态与事件 —— 阶段 5
- [x] ✅ Dialog / Menu / Tray / Shell —— 阶段 3 完成(Shell 用于外链打开)
- [ ] 🔴 globalShortcut / clipboard / powerMonitor —— 阶段 3 余项
- [ ] 🔴 desktopCapturer —— 阶段 5(图片工具)
- [x] ✅ 模块级引用持有(防 Tray/Window 被 GC)—— 阶段 3 完成
- [x] ✅ Worker Threads 通信模型(postMessage / 请求-响应配对 / terminate)—— 阶段 4 完成
- [x] ✅ Node Stream 分块读 + 背压(createReadStream + for await)—— 阶段 4 完成
- [x] ✅ IPC 双向模式:invoke/handle(一问一答)vs send/on(单向推送)—— 阶段 4 完成
- [x] ✅ 订阅生命周期管理(Preload 返回 unsubscribe + useEffect 清理)—— 阶段 4 完成

## Bug / Security 安全与边界

- [x] 🟡 nodeIntegration 配置错误导致 RCE(原理理解)
- [x] 🟡 contextIsolation 配置错误的危害
- [x] ✅ Preload 暴露 API 过大的风险 —— 阶段 2 实操
- [x] ✅ IPC 未校验输入 = 主进程注入 —— 阶段 2 理解(方案 2 规避)
- [x] ✅ 路径穿越攻击(渲染进程传相对/绝对路径)—— 阶段 2 理解(方案 2 规避)
- [x] ✅ ipcMain.on 监听泄漏 —— 阶段 4 完成(Preload 返回 unsubscribe + useEffect 清理)
- [ ] 🔴 Zombie 进程(窗口关闭但子进程未退)—— 阶段 3 部分(Bug-002 见 bug-lab)
- [ ] 🔴 stale state(渲染进程重载后旧回调仍触发)—— 阶段 5
- [x] ✅ Worker 线程泄漏(finally 里 terminate)—— 阶段 4 完成
- [x] ✅ 分块编码边界对齐(Base64 3 字节分组,块大小必须 3 的倍数)—— Bug-003 实战
- [ ] 🔴 __dirname / process.resourcesPath prod 路径问题 —— 阶段 6

## Performance 性能

- [ ] 🔴 启动时间(冷启动/preload 提前/按需加载)—— 阶段 7
- [x] ✅ 大文件处理(Stream 分块 + Worker 线程 + 背压)—— 阶段 4 完成
- [x] ✅ IPC 频繁通信/进度推送节流 —— 阶段 4 完成
- [ ] 🔴 IPC 大数据传输开销(结构化克隆成本)—— 阶段 5
- [ ] 🔴 多窗口内存成本(每窗口独立 Chromium)—— 阶段 5
- [x] ✅ Main 进程长任务阻塞(CPU 密集搬离主线程)—— 阶段 4 完成
- [ ] 🔴 打包体积与启动(asar/压缩/原生模块)—— 阶段 6
- [ ] 🔴 autoUpdater 性能与失败重试 —— 阶段 6

## Engineering 工程化

- [ ] 🔴 electron-builder 跨平台/签名/目标格式 —— 阶段 6
- [x] 🟡 Main/Renderer/Preload TypeScript 工程结构 —— 阶段 1 已建立
- [x] 🟡 开发热重载(dev vs prod 加载差异)—— 阶段 1 已实现
- [x] ✅ Electron 安装机制(postinstall + 二进制下载 + ELECTRON_MIRROR)—— Bug-001 实战
- [x] ✅ pnpm allowBuilds 白名单机制 —— Bug-001 实战
- [x] ✅ 多入口构建登记(每个「运行单元」都要同步登记 entry)—— 阶段 4 完成
- [ ] 🔴 测试(Playwright Electron)—— 阶段 6
- [ ] 🔴 日志(electron-log)—— 阶段 6
- [ ] 🔴 崩溃报告(crashReporter)—— 阶段 6
- [ ] 🔴 ASAR 打包机制 —— 阶段 6
- [ ] 🔴 自动更新(electron-updater / 签名 / Notarization)—— 阶段 6

---

## 阶段进度

| 阶段 | 主题 | 状态 | 完成度 |
|------|------|------|--------|
| 1 | 地基:进程模型 + 最小实现 | ✅ 完成 | 100% |
| 2 | IPC 与安全边界(Base64/URL) | ✅ 完成 | 100% |
| 3 | 生命周期与系统工具(Tray/Menu) | ✅ 完成 | 95%(globalShortcut / 应用菜单待补) |
| 4 | 大文件与异步(Worker Threads) | ✅ 完成 | 100%(含 Bug-003 实验) |
| 5 | 插件化扩展架构 | ✅ 完成 | 100%(契约层 + 注册表 + ctx 注入 + 权限裁剪 + Bug-004 实验) |
| 6 | 工程化与发布 | ⏳ 待开始 | 0% |
| 7 | 性能与架构演进 | ⏳ 待开始 | 0% |

## 薄弱点记录

(随学习推进更新,用于复习时定向巩固)

- postinstall 失败的「软失败」行为:pnpm 某些版本/配置下 install 整体退出码 0,但二进制没下来,要靠 `pnpm dev` 才暴露
- ~~Electron 事件名易混:close / closed / before-quit~~ → 阶段 3 已巩固
- ~~Tray/Window 引用必须模块级持有~~ → 阶段 3 已巩固
- **「异步 ≠ 不卡」的区分**:用户曾答「界面卡死需要异步读取」。异步解决的是「等待」(磁盘 I/O),不解决「计算」(Base64 编码占 CPU)。计算要离开主线程必须用 Worker —— 阶段 4 教学纠正
- **Worker 该开在 Main 还是 Renderer 的理由不完整**:答对了位置(开在 Main),但理由是「数据流最短」(避免 100MB 跨 IPC 搬两次),而非「Main 有 Node 能力」—— 阶段 4 教学补强
- **主线程阻塞的准确表述** ~~(阶段 4 知识检查 Q1)~~ → **已巩固**(第二轮复述:答出「await 让出事件循环 / 轮到执行时仍占据 CPU 时间片 / 阻塞在本进程内,只影响自己应用」)。保留要点:await 让出的是「等待」的时间片,让不出「计算」的时间片;计算一旦开始就是该线程的独占期;JS 引擎**没有抢占式调度**,同步代码的危害完全由写代码的人负责
- **「数据流最短」的准确表述** ~~(阶段 4 知识检查 Q2)~~ → **已巩固**(第二轮复述:答出「IPC 做的是复制操作,5MB 变 2 份,峰值 ≥10MB」)。保留要点:①是「两个**进程**」不是「两个线程」—— 进程内存独立,必须序列化/反序列化,跨线程理论上可共享(SharedArrayBuffer)②序列化在**发送方 Main 的主线程**上跑,所以方案 B 先付出的是「主线程 CPU 代价」,不只是内存
- **通用机制 vs 过度设计的判断标准** ~~(阶段 4 知识检查 Q3)~~ → **已巩固**(判断练习:正确判定「现在就该加 permissions 字段」)。两个问句:**① 这个约束会不会变?**(不需要预测未来,只问变化的可能性)**② 不防的后果 vs 防的成本,比例是多少?**(当下就能算)。配套原则:**成本极低、不可逆性极高的事(如预留字段)要早做;成本高、可后补的事要晚做**。⚠️ 用户易犯「理由错位」—— 曾用「工具变多难以维护」(扩展性问题)去论证「权限系统」(安全性问题)的必要性
- **IPC 消息语义层** ~~(阶段 4 知识检查 Q4)~~ → **已巩固**(第二轮复述:B 完美答出「瞬时快照」及理由,C 答出序号方案)。保留要点:判据是「**这条消息过期后能否自我纠正**」,不是「有没有实时要求」;防护三手段:①序号(带 seq,收到旧包丢弃)②**通知 + 拉取(首选:Main 只 send「有变化」,Renderer 收到后 invoke 拉当前值,乱序在架构层消失)** ③时间戳。⚠️ 易混:`send`+`on` = Main→Renderer 单向推送;`invoke`+`handle` = Renderer→Main 一问一答,两者方向不同**不能混用**;Main 内部轮询(如 clipboard)不涉及 IPC
- **插件契约是「双向合同」不是「单向声明」**(阶段 5 首轮):只答出「插件声明自己需要什么」(名字/权限/UI),漏了「框架向插件注入什么」。**能力注入**(注入 ctx 而非让插件直接用 ipcRenderer)是 permissions 声明能被真正执行的前提
- **`meta` 与 `component` 必须分开声明**(阶段 5 首轮):用户把「菜单元信息」和「页面组件」混在一条。二者消费者与加载时机不同 —— meta 需全量渲染(侧边栏要列出所有工具),component 应按需懒加载。混在一起会导致启动时加载全部插件代码
- **混淆「谁拥有数据」与「谁持有对象」**(阶段 5 三问,踩了两次):
  - ①清单存放:从「两边都需要」直接跳到「那就存两份」,漏了「需不需要两份完整数据」。两份会不同步(改一边忘另一边,或字段内容不一致)→ 应为**单一数据源**(共享纯数据文件,两端各自 import)
  - ②`ctx` 谁组装:答「Main 组装后交给 Renderer」。**错**:IPC 只能传数据不能传方法(函数不可序列化),`ctx` 必须在**使用它的内存里**创建 → Renderer 组装。Main 的职责是「实现能力 + 权限校验」,不是「造对象给人用」
- **权限标识的来源不可含在入参里**(阶段 5 修正题 2):答「校验权限,用权限声明时的标识判断」方向对,但「标识从哪来」未精确化。正确做法:身份来自**通道本身**(未声明权限的工具,对应通道根本不注册)+ **`event.sender`**(Electron 运行时注入,调用方改不了)。⚠️ 必记原则:**任何由被校验方提供的身份信息都不可信**(如入参里的 `toolId` 可任意伪造)
- **【待阶段 5 结束后自行回答】** 为什么选 A(编译时注册)而不是 B(运行时加载目录)?—— 教练要求用户用自己的话填「我做 A,因为 ______」,用户答「A吧」未给理由。阶段 5 完成后回头补
- **通道命名三段含义中 `fs:read` 是权限标识不是 API 名**(阶段 5 知识检查 Q1):用户答「调用方 / 功能名 / 申请使用的 api」,第三段说成「api」。精确:`tool` = 前缀分组 / `{toolId}` = 工具 id(调用方)/ `{permission}` = **权限标识**(能力类别声明,不是某个具体方法名)。配套:**Main 侧 handler 不注册是安全设计的物理基础** —— 未声明 fs:read 的工具,`ipcMain.handle("tool:{id}:fs:read")` 根本不存在,调用直接 reject;「没建这条路」比「拦住了」更强
- **permissions 为什么要写:缺「影响面查询」和「成本差判据」**(阶段 5 知识检查 Q3):用户只答「统一管理」。完整三理由:① 隐式事实 → 显式声明(不读源码就知道能力使用面,上架要求填)② 改通用机制时 `TOOL_MANIFEST.filter(t => t.permissions.includes("fs:read"))` 一行拿受影响工具清单(改动影响面从「考古」变「查询」= 声明式优于命令式的根本原因)③ 写入成本随工具数增长、读取价值立刻兑现,现在写 = 设计时顺便声明,以后补 = 考古(成本差判据)

## 已巩固(曾为薄弱点,已通过复述检查)

- ✅ handle/invoke 精确描述:注册/调用,不是订阅/发布(发布订阅是 on/send)。channel 名不一致 → Main 端无人 handle → Promise 永远 pending,不报错不超时
- ✅ XSS vs 路径穿越:两种完全不同的攻击类型。XSS 攻渲染进程,路径穿越攻文件系统。二层防御里 Preload 校验防的是路径穿越
- ✅ contextIsolation 核心价值:Preload 与 Renderer 是两个独立 window 对象,exposeInMainWorld 是「复印一份」,页面改不动原件,防 Monkey Patching
- ✅ Base64 膨胀率 ×1.37:3 字节 → 4 字符,5MB → 6.85MB 是正常设计,不是 Bug(阶段 4 大文件的关键约束)
- ✅ Electron 事件名 close / closed / before-quit:close 可拦截,closed 已销毁不可拦,before-quit 只能清理 —— 阶段 3 复述检查通过
- ✅ Tray / Window 引用必须模块级持有:局部变量离开作用域被 GC 回收,图标莫名消失(不是崩溃)—— 阶段 3 复述检查通过
- ✅ Base64 分块边界规则:中间块必须 3 的倍数;最后一块可以是任意长度(它的 padding 是合法结尾)—— 阶段 4 复述检查通过,用户独立推理正确
- ✅ 进度为什么不能用 invoke:invoke 是「一次调用 → 一个返回值」,进度是「一次调用 → 多次更新」,必须用单向推送 —— 阶段 4 理解
- ✅ 订阅必须清理:Preload 的 onXxx 返回 unsubscribe,组件 useEffect 清理里调用,否则监听器累积 —— 阶段 4 实现
- ✅ 主线程阻塞的准确表述:await 让出「等待」让不出「计算」;阻塞的是**本进程的事件循环**;JS 引擎无抢占式调度 —— 阶段 4 第二轮复述通过
- ✅ 跨进程 = 结构化克隆 = 完整内存复制:是「两个进程」(内存独立、必须序列化)不是「两个线程」;序列化在**发送方主线程**上跑 —— 阶段 4 第二轮复述通过(补术语精度)
- ✅ 防御 vs 过度设计的两个问句:①约束会不会变 ②后果 vs 成本比。配套:**成本极低且不可逆性高的事要早做**(预留 permissions 字段)—— 阶段 4 判断练习通过
- ✅ IPC 消息语义:判据是「过期后能否自我纠正」;防护首选「通知 + 拉取」;`send/on`(单向)与 `invoke/handle`(一问一答)方向不同不可混用 —— 阶段 4 第二轮复述通过
- ✅ IPC 模式选择判据:一次调用一次返回 → invoke/handle;一次订阅多次推送 → send/on;进程内部轮询不涉及 IPC —— 阶段 4 第二轮复述通过

## 已遇到的 Bug

- Bug-001:Electron 二进制安装失败(postinstall 网络超时)→ 见 `bug-lab.md`
- Bug-002:托盘应用退出顺序错误导致「僵尸状态」→ 见 `bug-lab.md`
- Bug-003:Base64 分块边界错位导致静默数据损坏(3.5MB 文件解码后只剩 1MB,丢失 71.4%)→ 见 `bug-lab.md`
- Bug-004:权限裁剪失效导致所有工具获得全部能力(静默成功型 Bug,界面不崩溃不报错)→ 见 `bug-lab.md`
