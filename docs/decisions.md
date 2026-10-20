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

## ADR-007: 工具契约与权限模型(阶段 5)

**状态**:✅ Accepted
**日期**:2026-10-08

### 背景

阶段 4 结束时,4 个工具全部硬编码在 [src/App.tsx](../src/App.tsx)(侧边栏按钮 + 渲染分支各一处),Main 端也逐个手写 handler;而 [electron/preload.ts](../electron/preload.ts) 把**全部能力**一次性 `exposeInMainWorld`,导致 JSON Formatter(纯前端字符串处理)也能调到 `bigBase64()` —— 最小权限原则被违反。

需要一套「工具可插拔 + 权限可声明」的架构,为未来开放第三方插件打地基。

### 决策

1. **编译时注册,不做运行时加载(方案 A)** —— 工具是源码模块,通过 import 数组注册
2. **单一数据源 + 声明与实现分离**:
   - `shared/tool-manifest.ts` 只放**纯数据**(`meta` + `permissions`),Main 与 Renderer 各自 import
   - `src/tools/index.ts` 放 `id → React 组件` 映射,**只在 Renderer**
3. **`ctx` 能力注入**:工具只接收 `ctx`,永不直接接触 `ipcRenderer`
4. **`ctx` 在 Renderer 按 `permissions` 裁剪组装**,Main 不组装(技术上也不可能 —— 函数不可跨 IPC 序列化)
5. **Main 三层权限校验**:①通道存在性(没声明 → 通道不注册)②来源校验(`event.sender`)③入参校验
6. **身份标识不来自入参**:禁止用 `args.toolId` 做校验

### 理由

1. **单一数据源避免两端不同步**:各存一份会出现「UI 显示有权限、Main 校验说没权限」这类极难排查的 Bug;共享纯数据文件让 TypeScript 在**编译期**保证一致
2. **声明与实现分离是分期演进的接口位**:共享的只有元数据,组件映射留在 Renderer。阶段 7 做懒加载时这里是插入 `React.lazy()` 的位置;迁移到 B 方案时这里是「加载器」要替换的位置 —— **契约不变,只是数据来源变**
3. **ctx 必须在 Renderer 组装是技术约束而非选择**:IPC 只能传数据(结构化克隆),函数不可序列化
4. **ctx 的真正价值是「裁剪」不是「封装」**:`electronAPI` 按功能命名且一次性全暴露;`ctx` 按能力命名且按工具裁剪 —— 无权限的工具拿到的 `ctx` 是 `{}`
5. **身份必须来自框架或物理不存在**:入参里的 `toolId` 由调用方填写可任意伪造;`event.sender` 由运行时注入不可篡改;未注册的通道则根本调不通
6. **A 到 B 是连续迁移不是重写**:两者架构契约完全相同,B 只多一个加载器(≈100 行)。**没有权限模型的运行时加载 = 纯粹的安全漏洞**,所以应先理解权限模型再做 B

### 后果

- 加一个工具只需改 2 个文件(manifest 一条 + 组件映射一行),侧边栏自动出现
- 权限从「隐式散落在实现里」变成「集中显式声明」,可 `filter()` 查询影响面、可自动生成文档、满足商店上架的能力清单要求
- **A 阶段 `permissions` 只是声明不是强制** —— 编译时注册下所有代码可信,工具可直接 `import("node:fs")` 绕过;真正的强制要等 B 阶段
- 遗留:`ctx` 的裁剪在 Renderer 执行,**理论上可被 Renderer 内部代码绕过** —— 真正的边界仍在 Main 的 handler 注册与 `event.sender` 校验
- 遗留:每加工具仍需改 2 个文件,这是 A 方案的固有成本

---

## ADR-008: 通道命名规则与权限裁剪实验(阶段 5)

**状态**:✅ Accepted
**日期**:2026-10-12

### 背景

阶段 5 实现 ctx 能力注入时,需要把旧的扁平通道名(`tool:select-and-read-file`、`tool:big-base64`、`tool:get-system-info`、`window:hide`)改为按 `tool:{toolId}:{permission}` 三段命名,使通道本身就能表达「哪个工具申请了什么权限」。同时通过 Bug-004 注入实验验证了权限裁剪失效的实际影响。

### 决策

1. **通道命名采用三段式 `tool:{toolId}:{permission}`**:
   - `tool` = 前缀分组(所有工具相关通道统一前缀)
   - `{toolId}` = 调用方工具 id(如 `base64`、`system-info`)
   - `{permission}` = 权限标识(如 `fs:read`、`sys:info`、`window:hide`)

2. **通道名改造映射**:
   | 旧 | 新 |
   |---|---|
   | `tool:select-and-read-file` | `tool:base64:fs:read` |
   | `tool:big-base64` | `tool:big-base64:fs:read` |
   | `tool:get-system-info` | `tool:system-info:sys:info` |
   | `window:hide` | `tool:system-info:window:hide` |

3. **Main 启动时运行 `auditPermissions()` 审计函数**:打印每个工具的权限声明 + 按权限反查工具列表,确认声明与注册一致

4. **Bug-004 实验教训写入 buildContext 注释**:权限裁剪逻辑被注释掉的 Bug 在阶段 5 无安全危害(代码可信可绕过 ctx),但在阶段 7 是致命漏洞

### 理由

1. **三段命名让通道名本身就是权限声明的一部分** —— 不需要查文档就知道 `tool:base64:fs:read` 是 Base64 工具申请的文件读取能力
2. **未声明权限的工具对应通道不注册** —— `json-formatter` 没声明 `fs:read`,所以 `ipcMain.handle("tool:json-formatter:fs:read")` 根本不存在,调用直接 reject。这是「没建这条路」比「拦住了」更强
3. **审计函数让权限声明可验证** —— 启动时打印权限映射,不正常一眼看出

### 后果

- 通道名从「功能描述」变成「权限声明的一部分」,可读性提高
- `auditPermissions()` 在每次启动时打印权限审计表,方便排查不一致
- Bug-004 的实验教训永久记录在 `context-factory.ts` 注释里,防止未来「简化」裁剪逻辑

---

## ADR-009: 自动更新的信任边界(阶段 6-4)

**状态**:✅ Accepted
**日期**:2026-10-20

### 背景

引入 electron-updater 时暴露了一个必须显式记录的问题:**「自动更新」本质是把远端代码送进用户机器并执行的合法通道**,它的信任边界到底在哪?

阶段 6-2 我们决定**跳过代码签名**。这条决策的真实代价必须被量化,否则它会退化成一句说不清的「少一道保险」。

### 决策

1. **更新链路按三层划分职责,任何一层都不能替代另一层**:

   | 层 | 管什么 | 靠什么 |
   |---|---|---|
   | HTTPS | **传输** | 服务端证书 |
   | `app-update.yml`(打包时生成) | **去哪儿** | 构建时写死,运行时不可改 |
   | 代码签名 + `publisherName` | **执行** | Authenticode 证书 |

2. **当前项目明确处于「执行层不设防」状态,并已文档化**:
   - `build.win` 未设 `publisherName` → `NsisUpdater.verifySignature()` 读不到就 `return null`,**整个验签被跳过**(`node_modules/electron-updater/out/NsisUpdater.js:84-99`)
   - 未做代码签名 → 即使设了 `publisherName`,也没有签名可比对
   - 于是 `latest.yml` 里的 sha512 成为唯一防线 —— 而它只防「传坏」,不防「换包」(哈希与它校验的目标来自同一个来源,自洽不构成信任)

3. **HTTPS 只用于生产**;本机 `http://127.0.0.1:8080` 是纯测试用途,已在 `dev-app-update.yml` 与 `build.publish` 中注明

4. **不接受「签名是保险」这种模糊说法**:签名保护的区间是「下载完成 → 执行之前」。它**不**保护版本号欺骗,也**不**保护可用性(拒绝服务)。

### 理由

1. 三层各管一段、互不替代 —— 这才是纵深防御的真实含义:没有哪一层管全部
2. `publisherName` 是唯一能把「这份文件是谁签的」交还给**机器判定**的机制,不依赖「我信得过的那个 URL」
3. 「恶意用户改本地 `app-update.yml`」这个场景**不构成真实威胁**:能写安装目录 = 能改 `app.asar` = 已经能执行任意代码。**前提比结果强**,这不是一条真实攻击路径
4. 真正需要防的是**控制更新源**的攻击(服务器被入侵 / CDN 配错 / DNS 劫持 + http / 域名过期)

### 后果

- 上线前必须补齐:`publisherName` + 真实代码签名 + HTTPS 域名。否则自动更新通道**等于不设防**
- 已知且接受的风险:签名挡不住「一直提示更新、装又装不上」这类**告警疲劳**攻击 → 需要提示节流 + 服务端监控(阶段 7+)
- ⚠ 记录一个源码层面的坑:打开 `allowPrerelease` 会**自动把 `allowDowngrade` 改成 `true`**(`AppUpdater.js:31-44`),要关回去必须在它之后对 `allowDowngrade` 再设一次

---
(后续 ADR 持续追加)
