# Electron Toolbox · 决策链复习图(阶段 1 → 6)

> 组织方式:**主干不是一个一个知识点,而是你做过的 17 个关键取舍**。每个取舍四格固定:
> `选了` / `否决了` / `因为` / `何时翻案`。
> 复习一遍 = 面试模拟一遍。事实性知识统一收在最后的「事实卡」里。

**图例**:✅ 已巩固(能解释 + 能应用 + 能排错) · 🟡 待检验(还没用自己的话复述过) · 🔴 未接触
**状态汇总**:17 个决策中 ✅ 16 个、⚠️ 1 个(理由未复述);事实卡 ✅ 13 条、🟡 4 条;待检验雷达 13 条

**用法**:
- VS Code 装 `Markmap` 插件直接预览;或打开 <https://markmap.js.org/repl> 粘贴本文件
- 只看 `选了` / `因为` 两格 = 快速过一遍;**只跳跃 `何时翻案`** = 练判断力
- 每格后面 `→ Bug-xxx` = 回查 `docs/bug-lab.md` 的真实事故

---

## ① 信任边界:谁能碰系统

### D1 安全三件套从头锁死 ✅
- **选了**:`nodeIntegration:false` + `contextIsolation:true` + preload 必填(阶段 1 就算空文件也建);dev/prod 用 `!app.isPackaged` 判断,dev `loadURL('http://localhost:5173')`,prod `loadFile(join(app.getAppPath(),'dist','index.html'))`
- **否决了**:`nodeIntegration:true`(早期 Electron 默认)/ 阶段 1 图省事不建 preload / 用 `process.env.NODE_ENV` 判断环境
- **因为**:最小权限(Renderer 必须渲染不可信数据)+ 安全姿势从一开始锁死防退化 + 架构稳定(阶段 2 加 IPC 只改 preload 内部,不动窗口创建)
- **何时翻案**:不翻。放宽的收益是「省一次 IPC」,代价是「任意 XSS → 系统级入侵」,**收益与代价不可逆性差三个数量级**
- **配套认知**:`contextIsolation` 的价值不是「隔离进程」,而是「Preload 与 Renderer 是两个独立 window 对象,`exposeInMainWorld` 是复印一份,页面改不动原件」→ 防 Monkey Patching

### D2 IPC 零入参(方案 2) ✅
- **选了**:`selectAndReadFile()` 不收 path,Main 内部 `dialog` 选完直接读;选文件 + 读文件合并为一个原子操作
- **否决了**:传 path + 白名单校验(方案 1)/ 暴露 `readFile(path)` 让 Renderer 自己拼路径
- **因为**:零入参 = 零攻击面。方案 1 的攻击面是「校验逻辑写得对不对」,方案 2 的攻击面是**空集**;API 合并让 path 根本没机会成为攻击向量
- **何时翻案**:当出现「最近打开的文件列表」「从剪贴板读路径」这类**必须传路径**的需求时 —— 那时才引入 `path.resolve` 归一化 + 白名单目录比对 + 逐级校验,**绝不能把用户给的 path 直接交给 `fs.readFile`**
- **保留的纵深防御**:即使零入参天然安全,Main 仍守文件大小边界(阶段 2 是 10MB,防 OOM)
- **关联**:→ Bug-002 时代遗留问题不在本决策,在 D5

### D3 权限身份不来自入参 ✅
- **选了**:三层校验 ①**通道存在性**(没声明 `fs:read` 的工具,`ipcMain.handle("tool:{id}:fs:read")` 根本不注册)②**来源校验**(`event.sender`,Electron 运行时注入)③**入参校验**(纵深防御);通道三段命名 `tool:{toolId}:{permission}`
- **否决了**:用入参 `args.toolId` 做权限判断(调用方自己填,填 `system-info` 就冒充成功,等于没校验)
- **因为**:**任何由被校验方提供的身份信息都不可信**。而且「没建这条路」比「拦住了」更强 —— 前者是物理上不存在,后者依赖代码写得对
- **何时翻案**:不翻。切到 B 方案(运行时加载)后通道仍按声明注册;将来加「权限弹窗授权」,身份判断要**叠加**用户授权记录,而不是替换掉 `event.sender`
- **易错点** 🟡:`{permission}` 段是**权限标识(能力类别)**,不是 API 名。写成 `tool:base64:readFile` 就把「能力声明」降级成「方法名」,审计函数再也查不出影响面

### D4 编译时注册 A,不做运行时加载 B ⚠️
- **选了**:工具是源码里的模块,通过 `import` 数组注册(`shared/tool-manifest.ts` 纯数据 + `src/tools/index.ts` 组件映射)
- **否决了**:B 方案(运行时 `readdir` + 动态 `import()` 扫描目录)—— 契约完全相同,只多约 100 行加载器;但**没有权限模型的运行时加载 = 纯粹的安全漏洞**
- **因为**:A → B 是**连续迁移不是重写**(契约不变,只是数据来源变);先在 A 阶段把权限模型理解透,再上 B
- **何时翻案**:工具 ≥ 10 或**要开放第三方插件**时必须切 B;切之前必须已有「运行时强制」,否则 B 就是给自己开 RCE 后门
- ⚠️ **状态缺口**:你当时只答了「A 吧」,**理由没给出**。这是全图唯一「已实现但未巩固」的决策 —— 用自己的话补一句「我做 A,因为 ______」,它才够格升 ✅
- **关联**:→ 待检验雷达第 13 条

---

## ② 进程与生命周期

### D5 托盘常驻:拦 `close`,不拦 `window-all-closed` ✅
- **选了**:`win.on('close')` 里 `event.preventDefault()` + `hide()`;模块级 `let isQuitting = false` 做意图标记;`app.on('before-quit')` 兜底设标记 + 销毁托盘;退出入口只留在 Main(托盘菜单回调),Renderer 只能 `hide` 不能 `quit`
- **否决了**:在 `window-all-closed` 里拦(那时窗口已销毁,**拦不住**)/ 只在托盘菜单这一处设 `isQuitting`(退出路径不止一条)
- **因为**:托盘应用的语义是「关窗口 ≠ 退出应用」;拦截需要一个开关来区分「点 × 想隐藏」和「点退出想真走」;退出路径有托盘菜单 / 系统关机 / Cmd+Q 三条,单点设置不可靠
- **何时翻案**:非托盘应用(关窗即退出)就不需要 `isQuitting`,直接 `window-all-closed` → `app.quit()`。**别把托盘逻辑套到普通工具窗口上**
- **顺序硬约束**:`isQuitting = true` 必须在 `app.quit()` **之前**,否则 `quit` 同步触发的 `close` 里 `preventDefault()` 会中止退出,而 `before-quit` 已经把托盘销毁了 → 用户失去再次退出的入口 → **僵尸状态** → Bug-002
- **代价已量化**:`hide()` 保留渲染进程,常驻 **50-100MB/窗口**,这是「秒开」的价格

### D6 引用必须模块级持有 ✅
- **选了**:`let tray: Tray | null = null` 放在模块作用域
- **否决了**:`const tray = new Tray()` 写在 `createTray()` 函数内
- **因为**:函数执行完局部变量失去引用 → GC 回收 → **图标莫名消失**。它不崩溃、不报错,极易误判成「打包后图标丢了」
- **何时翻案**:改用 `WindowManager` 类持有实例时,**类实例本身仍必须被模块级变量引用** —— 本质不变,只是从「一个变量」变成「一个容器的变量」

---

## ③ 并发与资源

### D7 大文件用双武器,不是一把更快的刀 ✅
- **选了**:`createReadStream(path,{highWaterMark: 3*1024*1024})` + `for await` 背压 + Worker 线程编码 + `finally { await worker.terminate() }` + 主/Worker 两层断言
- **否决了**:`fs.readFile` 一次性读入(100MB → OOM)/ 在 Main 主线程编码(界面全程冻结,**菜单、托盘、IPC 全部无响应**)/ 用 `btoa`(只接受字符串,非 Latin-1 抛 `InvalidCharacterError`)/ 在 Renderer 用 Web Stream(读不了本地文件,还要跨 IPC 搬两次 100MB)
- **因为**:**两个独立瓶颈,两个独立武器,只解决一个都失败**
  - 内存 → Stream:占用从 `O(文件大小)` 降到 `O(块大小)`,与文件大小**解耦**
  - CPU → Worker:异步解决「等待」(磁盘 I/O),**不解决「计算」**;Base64 编码是纯 CPU,`await` 它照样占主线程
  - Main 卡死比 Renderer 卡死严重:Main 是所有窗口的公共线程
- **何时翻案**:
  - GB 级文件 → **边编码边落盘**(结果不经过内存)。当前**遗留技术债**:返回值仍是完整 Base64 字符串,分块省下的内存会在「拼接」那一步还回去
  - 频繁小任务 → **Worker 线程池**(一任务一线程的创建成本是每线程约几十 MB 栈空间)
  - 大 chunk 拷贝开销 → 可考虑 `Transferable` / `SharedArrayBuffer`
- **配套**:Worker 是**独立运行单元**,`vite-plugin-electron` 只构建 entry 列表里明确列出的文件 —— 忘登记就 `new Worker()` 时 `Cannot find module`
- **关联**:→ Perf-001(实测膨胀率 1.333,与 4/3 理论一致;界面全程无卡顿)

### D8 块大小必须是 3 的倍数(3145728) ✅ 硬约束
- **选了**:中间块 3MB;断言写在主线程和 Worker 两处
- **否决了**:随便取 1MB(1048576,不是 3 的倍数)/ 用注释提醒「注意对齐」
- **因为**:Base64 是 **3 字节 → 4 字符**的分组语义。中间块末尾带 padding 会让解码器**提前终止** → **静默数据损坏**(3.5MB 解码后只剩 1MB,丢 71%),而**进度正常、膨胀率正常、输出长度正常** —— 指标全健康,数据全废
- **何时翻案**:不翻。切到边编码边落盘后,边界约束**依然存在**,只是从「块」挪到「输出流」
- **原则**:**断言优于注释** —— 注释会被忽略,断言在第一次运行时就会拦住 → Bug-003
- **另一条边界**:最后一块**可以是任意长度**(它的 padding 是合法的结尾),不需要补齐

---

## ④ 通信语义

### D9 `invoke` 管一问一答,推送管持续状态 ✅
- **选了**:`ipcMain.handle` / `ipcRenderer.invoke` 做请求-响应(返回 Promise);进度用 `webContents.send` + `ipcRenderer.on` 单向推送,**最短 100ms 节流**;Preload 的 `onXxx` **必须返回 unsubscribe**,组件在 `useEffect` 清理里调用
- **否决了**:用 `invoke` 反复轮询推进度(语境错误 + IPC 风暴)/ 用 `on/send` 做需要返回值的调用 / 100ms 不节流(小分块会推上千次,把通道打满)
- **因为**:`invoke` 的语义是「**一次调用 → 一个返回值**」,承载不了「一次调用 → 多次更新」。两者方向也不同:**`send`+`on` 是 Main→Renderer 推送,`invoke`+`handle` 是 Renderer→Main 一问一答,不能混用**
- **何时翻案**:当消息是「**过期后可以自我纠正**」的瞬时状态(如鼠标位置、当前激活工具)→ 改成「**通知 + 拉取**」:Main 只 send「有变化」,Renderer 收到后 invoke 拉当前值。**乱序问题在架构层直接消失**,比带 `seq` 序号更彻底
- **判据**:是否需要判断「这条消息过期后能否自我纠正」—— 不是「有没有实时性要求」
- **两个沉默失败**:
  - channel 名拼不一致 → Main 端无人 handle → **Promise 永远 pending**,不报错、不超时
  - 订阅不清理 → 监听器累积 → 一次推送触发 N 次回调,组件卸载后仍持有旧 state(stale state)
- **关联**:→ Bug-006(Rollup 把 CJS require 提升到 bundle 顶部,顺序调整治不了)

---

## ⑤ 扩展架构

### D10 契约是双向合同 + 单一数据源 ✅
- **选了**:`ToolManifestEntry{meta, permissions}`(声明工具**需要什么**)+ `ToolContext`(声明框架**提供什么**);`shared/tool-manifest.ts` 只放**纯数据**,Main 与 Renderer 各自 import;`meta` 与 `component` **分开声明**
- **否决了**:只声明权限的单向契约(工具会绕过框架直接 `import("node:fs")`,权限系统成废纸)/ Main 存清单让 Renderer 拉(首屏多一个 IPC 往返 + 空白态 + 丢编译期校验)/ Renderer 存清单让 Main 来要(**循环依赖**:窗口是 Main 建的)/ 两边各存一份完整清单(不同步:改一边忘另一边,字段内容漂移)/ 继续用扁平 `window.electronAPI`(违反最小权限)/ 共享文件里放 React 组件(Main 打包会拉进 React + 浏览器 API,Node 直接崩)
- **因为**:
  - **单一数据源**让 TypeScript 在**编译期**保证两端一致,不靠运行时同步
  - **声明与实现分离是分期演进的接口位**:阶段 7 做懒加载时,正好在 `TOOL_COMPONENTS` 映射处插 `React.lazy()`;迁移到 B 方案时,正好替换成「加载器」。**契约不变,只是数据来源变**
  - **meta 与 component 的消费者不同**:meta 要**全量**(侧边栏得列出所有工具),component 应**按需懒加载**。混在一起 = 启动时加载全部插件代码
- **何时翻案**:工具 ≥ 10 → manifest 拆多文件按类目组织 + 组件懒加载 + 侧边栏分组搜索;开放第三方 → 必须迁 B
- **固有成本(接受它)**:加一个工具仍要改 **2 个文件**(manifest 一条 + 组件映射一行),这是 A 方案的代价
- **关联**:→ Bug-004(把 `buildContext` 的裁剪条件注释掉,界面不崩不报错,悄悄给了所有工具全部能力 —— **最危险的 Bug 是「静默成功」的 Bug**)

### D11 `ctx` 在 Renderer 组装 ✅
- **选了**:`buildContext(permissions)` 在 Renderer 按权限裁剪 —— `permissions: []` → `ctx = {}`,`["fs:read"]` → `ctx = { fs: {...} }`;Main 只负责「实现能力 + 校验」
- **否决了**:Main 组装好 `ctx` 再传给 Renderer
- **因为**:**这是技术约束,不是选择**。IPC 只传数据(结构化克隆),**函数不可序列化**。`ctx.fs.selectAndReadFile` 这个对象必须存在于**使用它的那块内存**里,Main 就算组装好也传不过去
- **何时翻案**:只有一种情况 —— 改成「Main 下发可序列化的**能力清单**」,但**函数最终仍要在本地组装**。所以严格说:这条不翻
- **必须区分的两个问句**:**谁拥有能力**(Main 实现 `dialog`/`fs`)**≠ 谁持有对象**(ctx 必须在 Renderer 内存里)。你曾在这里踩过两次
- **诚实的边界**:ctx 裁剪在 Renderer 执行,**理论上可被 Renderer 内部代码绕过**(contextIsolation 只挡住了 `ipcRenderer`,Preload 暴露的 `electronAPI` 仍是全量的)→ 阶段 5 的 ctx 是**工程纪律**,阶段 7 第三方面前才是**安全防线**

### D12 `permissions` 现在就写(哪怕拦不住) ✅
- **选了**:A 阶段就把 `permissions: ["fs:read"]` 写进 manifest
- **否决了**:等有强制力(B 阶段)再写
- **因为**:
  - **隐式事实 → 显式声明**:不读源码就知道能力使用面,上架要求填能力清单
  - **可查询 = 可自动化**:改通用机制时 `TOOL_MANIFEST.filter(t => t.permissions.includes("fs:read"))` 一行拿到受影响工具清单 —— **影响面从「考古」变「查询」,这才是声明式优于命令式的根本原因**
  - **成本差判据**:写入成本随工具数增长,读取价值立刻兑现。现在写 = 设计时顺便声明;以后补 = 考古
- **何时翻案**:不翻。这是「**成本极低 + 不可逆性极高 → 要早做**」的典型
- **配套判据(两次问句)**:① 这个约束**会不会变**?(只问变化的可能性,不预测未来)② **不防的后果 vs 防的成本**比例是多少?(当下就能算)
- ⚠️ **你的易错点**:曾用「工具变多难以维护」(扩展性问题)去论证「权限系统」(安全问题)的必要性 —— **理由错位**

---

## ⑥ 生产环境的真实世界

### D13 日志:预检 + 回退链 + 响亮失败 ✅
- **选了**:落盘前**四步真预检**(真建目录 → 真写 → 真读回比对 → 真删);**回退链** `userData → temp → workspace`;显式 `resolvePathFn`;**补上 error 出口**(不让库自己吞)
- **否决了**:只用 `existsSync` 判断可写(发现不了只读 ACL)/ 假设「用户目录一定可写」/ 把写失败交给库自己处理
- **因为**:`electron-log@5.x` 的 `File.writeLine()` 写盘失败时只做 `this.emit("error", ...)`,而 File 实例上**没有任何监听器** → 事件被 `processMessage()` 的 try/catch 接住 → 交给基类里**空实现**的 `processInternalErrorFn() {}`。结果:**不建文件、不打日志、不抛异常**
- **何时翻案**:不翻。原则是「**允许配置错,但不允许配置错了不吭声**」
- **方法论**:探针要**绕开所有可疑环节**(不经过该库、也不经过终端)写到确定可写的地方,让程序自己报告真相
- **关联**:→ Bug-008;同一条原则在 `scripts/dev-update-server.mjs` 复现(启动第一秒自检 `latest.yml` 是否存在)→ E-002

### D14 依赖一律显式子路径导入 ✅
- **选了**:`import log from "electron-log/main"`
- **否决了**:让打包器按 `exports` 条件自己选(`import log from "electron-log"`)
- **因为**:`electron-log@5.4.4` 的 `exports` 里 `"."` **同时**挂 `browser` 和 `default`;Vite 默认 `resolve.conditions` **含 `browser`** → 给 Main 打包时命中 `browser` → 把 `src/renderer/index.js` 装进 Main。运行时 `log.transports` 是 `undefined` → `TypeError: Cannot set properties of undefined`
- **何时翻案**:依赖的 `exports` **没有多条件分发**时可省;但判断顺序永远是「**先读那个依赖的 `exports` 字段,再决定用什么子路径导入**」
- **必记**:**类型正确 ≠ 运行时正确**。`exports` 里 `types` 和 `browser`/`default` 是**分开选的**,所以 `tsc` 全绿只说明类型对上了,这类错**一定在运行到第一次真正使用才炸**
- **关联**:→ Bug-009

### D15 启动前生效的开关,参数路径和代码路径各写一份 ✅
- **选了**:`app.commandLine.appendSwitch("no-sandbox")` 写进代码
- **否决了**:只在 `vite.config.ts` 的 `ELECTRON_ARGS` 里传
- **因为**:dev 的参数由 `vite-plugin-electron` 传进去;**打包后的快捷方式不会带 `--no-sandbox`** → prod 直接崩
- **何时翻案**:不翻。**凡是「必须在启动前生效」的开关,都要假设环境不一致**(dev ≠ prod ≠ CI)
- **关联**:→ Bug-005

### D16 可复现性 vs「改版本能生效」 🟡
- **选了**:放弃 lockfile,**关键工具链版本写死**(`electron@31.7.7` / `vite@5.4.21` / `typescript@5.9.3`)
- **否决了**:完整锁文件(代价是「改个小版本必须全量重装才生效」)
- **因为**:Bug-010 里整条工具链漂移(electron 装成空壳 → vite/electron 降级 → TS 5.3 不认 `Uint8Array<ArrayBuffer>` → `Base64Tool.tsx(85,47) TS2315`),漂移的根源是「没有任何东西钉住版本」
- **何时翻案**:**出现第二台机器 / CI / 多人协作时立刻翻案,必须开 lockfile**。单人单机可以忍,一旦要复现就忍不了
- **必须掌握的判断法**:**Electron 的 npm 包只是下载器**,真二进制在 `postinstall` 里下。判断「装好了」= `dist\electron.exe` + `dist\version` + `path.txt` **三样**,**不看目录在不在**;`require("electron")` 报错先分「路径没拿到」还是「二进制不存在」
- **关联**:→ Bug-010(注意:报错位置 ≠ 错误来源,`spawn` 报的 `ERR_INVALID_ARG_TYPE` 其实来自空壳 electron)

---

## ⑦ 更新通道

### D17 三层信任边界,谁也不替谁 ✅
- **选了**:三层划分职责 —— **HTTPS 管传输** / **`app-update.yml` 管去哪儿**(构建时写死,运行时不可改)/ **代码签名 + `publisherName` 管执行**;策略三件套 `autoDownload=false` + `autoInstallOnAppQuit=true` + `allowDowngrade=false`;`generic` provider 生成 `app-update.yml`;dev 用 `dev-app-update.yml` + `forceDevUpdateConfig`
- **否决了**:
  - 把 `latest.yml` 的 **sha512 完整性当安全性** —— 它只防「传坏」,**不防「换包」**;哈希与它校验的目标**来自同一个来源**,自洽不构成信任
  - 把「签名是保险」当模糊说法 —— 签名保护的区间是「**下载完成 → 执行之前**」,**不**保护版本号欺骗,也**不**保护可用性(拒绝服务)
  - 「恶意用户改本地 `app-update.yml`」当威胁 —— 能写安装目录 = 能改 `app.asar` = 已经能执行任意代码,**前提比结果强,不是真实攻击路径**
- **因为**:纵深防御的真实含义就是**没有哪一层管全部**;真正要防的是**控制更新源**的攻击(服务器被入侵 / CDN 配错 / DNS 劫持 + http / 域名过期)
- **何时翻案**:**上线前必须补齐** `publisherName` + 真实代码签名 + HTTPS 域名,否则更新通道**等于不设防**。当前状态是「执行层不设防,且已文档化」——这是**有意识接受的风险,不是遗漏**
- **源码坑** ⚠️:打开 `allowPrerelease` 会**自动把 `allowDowngrade` 改成 `true`**(`AppUpdater.js:31-44`),要关必须在它**之后**再设一次
- **已知且接受**:签名挡不住「一直提示更新、装又装不上」的**告警疲劳**攻击 → 需要提示节流 + 服务端监控
- **关联**:→ Bug-005(dev/prod 等价性)、E-001(generic provider 却提示你查 token)

---

## 事实卡(不构成决策,但必须记)

- ✅ **事件时机**:`close` 可拦截 → `closed` 已销毁不可拦 → `before-quit` 只能清理
- ✅ **退出三兄弟**:`app.quit()` **发起**优雅退出流程(可拦,会触发 `close`)/ `app.exit()` **强制**退出(不可拦)/ `win.destroy()` **直接销毁**(不触发 `close`)
- ✅ **`hide` vs `destroy`**:hide 保留渲染进程(内存常驻 50-100MB,重开瞬间)/ destroy 释放内存(重开慢)
- ✅ **跨进程 = 结构化克隆 = 完整内存复制**:是「两个**进程**」(内存独立,必须序列化/反序列化),**不是两个线程**;跨线程理论上可共享(`SharedArrayBuffer`)。**序列化跑在发送方主线程上**,所以先付出的是**主线程 CPU 代价**,不只是内存
- ✅ **Base64 膨胀率 4/3 ≈ 1.333**(5MB → 6.85MB 是**正常设计不是 Bug**);实测与理论一致
- ✅ **主线程阻塞的准确表述**:`await` 让出的是「等待」的时间片,**让不出「计算」的时间片**;计算一旦开始就是该线程的独占期;**JS 引擎没有抢占式调度**,同步代码的危害完全由写代码的人负责
- ✅ **断言优于注释**(把 Bug-003 变成代码护栏)
- ✅ **Worker 是独立构建 entry**(忘登记 → `Cannot find module`)
- ✅ **`app.getPath('crashDumps')`** 才是崩溃目录;手写 `join(userData,"crashes")` 会把人指向一个永远不会有文件的目录 → Bug-007
- 🟡 **sandboxed preload 的 `require` 白名单只有 4 个**:`electron` / `events` / `timers` / `url`。Preload 里出现任何其他 `import`,先问「这个库的依赖树里有 Node 内置模块吗?」
- 🟡 **「没被用到的 import」≠「不会执行」**:Rollup 的 CJS 互操作会把 CJS 依赖的 `require` **提升到 bundle 顶部**(`const require$$x = require("...")`),变成**模块加载期**的同步执行语句。所以「把 `log.info()` 挪到后面」这种改业务代码顺序的做法**治不了**
- 🟡 **preload 加载失败是静默的**:Renderer 只看到 `window.electronAPI === undefined`,不抛错、不阻断渲染。诊断入口**永远**是 DevTools Console **最顶部**的 `Unable to load preload script` —— 它比任何业务日志都早、都准
- 🟡 **运行时分支是 tree-shaking 的杀手**:`if (isRenderer) ... else if (isMain) ...` 让打包器无法静态判定 → **所有**分支的依赖都被拖进包(哪怕你只要一份)。这是选型时要看的**隐藏成本**

---

## 待检验雷达(13 条还没用自己的话复述过)

> 这 13 条的共同点:**都已经写进代码了,但还只是"读过"。**「读过」和「会用」之间隔一次复述。
> 复述方法:合上文档,用 3 句话说清「现象 → 机制 → 所以我现在怎么写」。

**A. Bug-006 系列(4 条)**
1. sandboxed preload 的 `require` 白名单只有 4 个
2. 「没被用到的 import」不等于「不会执行」(Rollup 提升 require 到 bundle 顶部)
3. preload 加载失败是静默的(诊断入口 = Console 最顶部)
4. 运行时分支是 tree-shaking 杀手

**B. Bug-008 / 环境(3 条)**

5. 「库能跑」不等于「库在工作」—— 入门槛问题:**它失败了,会不会告诉我?**
6. 落盘位置不能假设(预检 + 回退链 + 响亮失败三件套)
7. **环境也是变量**:同一份代码 10/13 能写、10/15 不能 —— 因为进程**令牌**变了。所以「昨天还好好的」必须当成**一等证据**:它几乎总在说「变的是环境,不是代码」

**C. Bug-009 / 打包(2 条)**

8. 条件导出是**双向**的坑:能帮你在对的环节选对,也能在对的环节选错
9. 类型正确 ≠ 运行时正确(`types` 与 `browser`/`default` 分开选)

**D. Bug-010 / 依赖(2 条)**

10. 「装好了」要靠三样东西证明(`electron.exe` + `version` + `path.txt`)
11. **观察 ≠ 解释**:你曾把「版本降到范围下限」解释成「pnpm 无锁文件时解析最低版本」,**对照实验直接推翻**(干净目录下 `^5.0.0` 解析出 5.4.21)。真因是残缺 `node_modules` 的 reconcile。**机制没验证过就不能写进结论**

**E. 阶段 6-2(1 条)**

12. dev 与 prod 的启动参数不等价(→ 已升格为决策 D15,但仍待复述)

**F. 阶段 5 遗留(1 条)**

13. **为什么选 A(编译时注册)而不是 B(运行时加载)?** —— 你当时只答「A 吧」。这条堵在 D4 上,是整个知识地图里**唯一的"已实现但未巩固"**

---

## 翻案触发器(什么时候该回头改设计)

> 这一栏是整张图最高价值的部分:**判断力 = 知道什么时候原来的结论会过期**。

- **工具数 ≥ 10** → B 方案势能积累到位:manifest 拆多文件 + `React.lazy()` 懒加载 + 侧边栏分组搜索(D4 / D10)
- **要开放第三方插件** → **必须**先有运行时强制,再切 B;否则等于开 RCE 后门(D4)
- **出现「必须传路径」的需求**(最近文件 / 剪贴板路径)→ 零入参失效,启用 path 白名单 + resolve 归一化(D2)
- **出现 GB 级文件** → 边编码边落盘,否则拼接那一步重新撑爆内存(D7)
- **高频工具调用** → Worker 池替代一任务一线程(D7)
- **瞬时状态类消息**(鼠标位置 / 当前工具)→ 换「通知 + 拉取」,别用序号补丁(D9)
- **多窗口 / 内存压力** → hide 的 50-100MB 成本不可接受,要统一窗口策略(WindowManager)+ 考虑共享渲染进程(D5 / D6)
- **出现第二台机器 / CI** → 立刻开 lockfile,可复现性优先于「改版本能生效」(D16)
- **正式上线** → `publisherName` + 代码签名 + HTTPS 三样缺一不可(D17)
- **告警疲劳成为问题** → 更新提示节流 + 服务端监控(D17)

---

## 面试四问(每个阶段留一道,复习时直接口述)

1. **阶段 1**:Electron 为什么不让 Renderer 直接拥有 Node?不允许的话 Renderer 怎么调系统 API?
   → 因为 Renderer 必须渲染不可信数据,给了 Node 就是「任意 XSS → 系统级入侵」。Preload 是受控桥:`contextBridge` 暴露白名单 API + 输入校验,即使被攻破也够不到系统。
2. **阶段 3**:托盘应用,用户点退出退不掉(或窗口和托盘都没了但进程还在),为什么?
   → 退出意图标记与 `app.quit()` 的顺序问题。`app.quit()` 同步发起退出并触发 `close`,此时 `isQuitting` 仍为 false → `preventDefault()` 中止退出;而 `before-quit` 里已 `tray.destroy()` → 失去再次退出入口 → 僵尸状态。
3. **阶段 4**:Electron 里把 1GB 文件转 Base64,怎么做?
   → 两个瓶颈两个武器:①内存用 `createReadStream` + `highWaterMark` + `for await` 背压(占用恒定)②CPU 搬 Worker(主线程冻结比渲染阻塞严重得多)③进度用 `send`+`on` 推送并节流 ④块大小必须 3 的倍数,否则静默损坏。
4. **阶段 5**:如何让第三方插件只能调用它声明过的系统能力?
   → ①双向契约 ②ctx 按 permissions 裁剪 ③Main 三层校验(通道不注册 + `event.sender` + 入参纵深)④身份来自框架不来自入参 ⑤`contextIsolation` 阻止插件拿到 `ipcRenderer`,ctx 是唯一能力来源 ⑥A 阶段只是声明,B 阶段才真正强制。

---

## 一句话总览

> 阶段 1-5 你在建**结构**(进程边界 / 通信语义 / 扩展契约),
> 阶段 6 你在撞**真实世界**(路径可写性、打包条件、安装完整性、更新信任边界)。
> 结构问题靠设计判断解决,真实世界问题**只能靠"主动怀疑 + 让程序自己报告"**解决 ——
> 而阶段 7 要解决的第三类问题是**代价**:启动时间、内存、传输开销,那一类**必须有基线数字**,不能靠感觉。

---

**生成依据**:`docs/knowledge-map.md`(156 行 · 全量状态)、`docs/architecture.md`(ADR-001/002/003/006 + 阶段复盘)、`docs/decisions.md`(ADR-001~009)、`docs/bug-lab.md`(Bug-001~010 + E-001/002)、`docs/performance.md`(Perf-001 + 风险清单)
**覆盖说明**:仅覆盖阶段 1-6(阶段 6 未完:自动更新下载+安装端到端、Playwright 测试);阶段 7 未开始,只以「翻案触发器」形式预留接口。
