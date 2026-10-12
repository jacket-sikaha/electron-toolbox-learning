# Bug Lab

> Bug 实验室。每个 Bug 记录:现象 → 复现 → 定位 → 原因 → 修复 → 教训。
> 主动制造的 Bug 也要记录,这是阶段复盘的核心素材。

---

## Bug 实验类型清单(随阶段推进触发)

### 生命周期
- [ ] 重复创建窗口
- [ ] 窗口销毁不彻底
- [ ] 事件未解绑
- [ ] 定时器未清理

### 异步
- [ ] race condition(IPC 响应乱序)
- [ ] stale state(渲染进程重载后旧回调)
- [ ] 重复请求
- [ ] 请求取消
- [ ] 超时 / 重试
- [x] **分块边界对齐(Bug-003:Base64 块大小非 3 倍数 → 静默数据损坏)**

### 并发
- [ ] 并发过高
- [ ] 队列堆积
- [ ] 限流错误
- [ ] 资源竞争

### 内存
- [ ] 对象持续增长
- [ ] Listener 泄漏
- [ ] Cache 无上限
- [ ] 大对象长期持有
- [ ] Worker 线程泄漏(已防护:finally 里 terminate)

### 安全
- [ ] 权限过大
- [ ] 输入未校验
- [ ] 不可信数据
- [ ] API 暴露过多
- [ ] 环境变量泄漏

### 生产环境
- [ ] 路径错误(__dirname / resourcesPath)
- [ ] 环境变量错误
- [ ] 构建后资源不存在
- [ ] 打包后行为不同
- [ ] 更新失败

---

## Bug 记录

(每个 Bug 完成下面的模板)

### Bug-001: [标题]

**日期**:
**类型**: 生命周期 / 异步 / 并发 / 内存 / 安全 / 生产环境

**现象**:
> 用户看到什么

**复现步骤**:
1. ...
2. ...
3. ...

**定位过程**:
- 第一步查了什么
- 关键线索是什么

**根本原因**:
> 为什么发生(不只是"哪里错了")

**修复方案**:
> 怎么改的,为什么这样改有效

**为什么这个修复有效**:
> 原理层面

**如何避免再次出现**:
> 防御措施 / Code Review 检查项

---

### Bug-001: Electron 二进制安装失败(postinstall 网络超时)

**日期**:2026-10-07
**类型**:生产环境 / 安装问题(pnpm + Electron 二进制下载)

**现象**:
> `pnpm dev` 启动时,Vite 构建成功(`dist-electron/main.js` 和 `preload.js` 都生成),
> 但 Electron 启动时报错:
> ```
> Error: Electron failed to install correctly,
> please delete node_modules/electron and try installing again
> ```
> 报错位置:`node_modules/.pnpm/electron@31.7.7.../electron/index.js:17`

**复现步骤**:
1. `pnpm install`(默认源)
2. postinstall 触发 `node install.js` 下载 Electron 二进制
3. 21.4s 后 `RequestError: read ECONNRESET` 报错
4. `pnpm dev` 时 `require('electron')` 调 `getElectronPath` 找不到二进制,抛错

**定位过程**:
- **第一步**:读报错栈,关键函数名 `getElectronPath` —— 直接告诉你「二进制路径解析失败」
- **第二步**:观察到 Vite 构建已成功(`dist-electron/main.js` 1.06kB)→ 不是代码问题,是 Electron 二进制没下来
- **第三步**:看到 `postinstall failed in 21.4s` + `ECONNRESET` → 网络问题,默认源是 github.com,国内访问必失败
- **第四步**:确认 `allowBuilds.electron: true` 已允许 postinstall 执行 → 配置正确,问题在「下载源」不在「允不允许执行」
- **第五步**:设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重试成功

**根本原因**:
> Electron 不是普通 npm 包,它的安装过程会通过 postinstall 脚本(`node install.js`)
> 从 GitHub releases 下载 ~80MB 的 Electron 二进制(Chromium + Node)到本地。
> 国内访问 github.com 不稳定,ECONNRESET 导致二进制没下来。
> 但 electron 的 JS 包源码已经装上了,所以 `require('electron')` 能加载 JS 模块,
> 调 `getElectronPath` 找二进制时找不到,抛错。

**修复方案**:
1. 在项目根目录建 `.npmrc`,写入:
   ```
   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
   ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
   ```
2. 清缓存 + 重装:
   ```bash
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-cache" -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron" -ErrorAction SilentlyContinue
   pnpm rebuild electron
   ```
3. 验证:`node -e "console.log(require('electron'))"` 应输出 `electron.exe` 路径

**为什么这个修复有效**:
> `ELECTRON_MIRROR` 环境变量被 electron 的 `install.js` 脚本读取,
> 把下载 URL 从 `https://github.com/electron/electron/releases/...`
> 替换为 `https://npmmirror.com/mirrors/electron/...`。
> npmmirror 是国内 CDN,稳定且快。`.npmrc` 持久化配置,任何人 clone 后 `pnpm install`
> 都自动走镜像,不再需要手动 set 环境变量。

**如何避免再次出现**:
1. **所有 Electron 项目根目录都建 `.npmrc` 写 `ELECTRON_MIRROR`** —— 这是国内 Electron 开发第一道工程配置
2. **理解 pnpm 的 `allowBuilds` 白名单** —— pnpm v9+ 默认禁止所有 postinstall,必须显式 `allowBuilds.electron: true` 才会执行
3. **理解 postinstall 失败 ≠ install 失败** —— pnpm 在某些版本/配置下会对 lifecycle 脚本失败「软失败」,install 整体退出码 0,但二进制实际没下来。`pnpm dev` 时才暴露
4. **读报错栈的函数名** —— `getElectronPath` 直接告诉你「二进制路径解析失败」,不需要猜

**学习价值**:
- Electron 不是普通 npm 包,它有 postinstall 二进制下载机制
- pnpm `allowBuilds` 白名单是供应链安全特性(postinstall 可执行任意代码,曾有恶意包事件)
- `ELECTRON_MIRROR` 镜像源配置是国内 Electron 开发第一道坎
- `require('electron')` 在 Main 启动前就会触发二进制解析(getElectronPath)
- 报错栈阅读:函数名往往直接告诉你失败在哪一层

---

### Bug-002: 托盘应用退出顺序错误导致「僵尸状态」

**日期**:2026-10-08
**类型**:生命周期 / 托盘应用退出逻辑

**现象**:
> 用户点托盘菜单「退出」:
> - 窗口消失了(被 hide)
> - 托盘图标也消失了(被 destroy)
> - 但任务管理器里 Electron 进程还在跑(5 个进程)
> - 用户无法再次尝试退出(托盘没了,没有入口)
> - 应用变成「退不掉的僵尸」,只能强制结束进程

**复现步骤**:
1. 托盘菜单「退出」的 click handler 里,顺序写成:
   ```js
   app.quit();        // 先发起退出
   isQuitting = true; // 再设标记(来晚了)
   ```
2. before-quit 里注释掉 `isQuitting = true`(对照实验)
3. 点托盘「退出」

**定位过程**:
- **第一步**:观察现象 —— 窗口没了、托盘没了、进程还在
- **第二步**:对照实验 —— 注释掉 before-quit 里的 isQuitting = true,现象复现
- **第三步**:推理 —— app.quit() 同步发起退出流程,close 事件立刻触发,此时 isQuitting 还是 false,被 preventDefault 拦截
- **第四步**:发现连锁反应 —— before-quit 里的 tray.destroy() 执行了,托盘没了,用户失去再次退出的入口

**根本原因**:
> `app.quit()` 是「同步发起退出流程」,它会立刻触发窗口的 close 事件。
> 如果此时 isQuitting 还是 false,close 里的 `event.preventDefault()` 会把退出拦下来。
> 但 before-quit 里的 `tray.destroy()` 已经执行了,托盘被销毁。
> 结果:退出被中止,但托盘没了,用户无法再次尝试,应用变成僵尸状态。

**修复方案**:
1. 托盘菜单「退出」里,顺序必须是:
   ```js
   isQuitting = true;  // 先设标记
   app.quit();         // 再发起退出
   ```
2. before-quit 里保留 `isQuitting = true` 作为兜底(防其他退出路径)

**为什么这个修复有效**:
> `isQuitting = true` 必须在 `app.quit()` 之前设置,因为 quit() 是同步的,
> close 事件会立刻触发。如果标记还没设上,close 里的拦截逻辑就会生效。
> before-quit 的兜底确保任何退出路径(系统关机、Cmd+Q 等)都不会被拦截。

**如何避免再次出现**:
1. **理解 app.quit() 的同步性** —— 它不是「异步发起」,而是「立刻触发 close」
2. **状态必须先设后调** —— 任何「先设标记再调 API」的场景,顺序不能反
3. **before-quit 里做清理要谨慎** —— 如果退出被中止,清理已经做了,状态不一致
4. **托盘应用的退出逻辑要测试「点一次就退出」** —— 不能靠「点两次」的巧合

**学习价值**:
- app.quit() 会触发窗口 close 事件(它是「发起流程」不是「强制退出」)
- quit / exit / destroy 的区别:quit 可被拦截,exit 强制,destroy 不触发 close
- isQuitting 开关的作用:区分「隐藏」与「退出」
- 顺序的重要性:状态必须先设后调
- 对照实验的价值:通过控制变量,把「猜测」变成「证据」
- 防御性代码的意义:before-quit 兜底能掩盖局部错误,但也可能掩盖 Bug

---

### Bug-003: Base64 分块边界错位导致数据静默损坏

**日期**:2026-10-08
**类型**:异步 / 数据完整性(分块编码边界对齐)

**现象**:
> 用「大文件 Base64」工具处理 3.5MB 文件(`D:\test-3.5mb.txt`,内容为 `AAAABBBBCCCCDDDD` 重复):
> - 进度条正常走完 0→100%
> - 无任何报错、无异常抛出
> - 膨胀率正常显示 1.333
> - 输出的 Base64 长度 **4893364**,甚至比正确值(4893356)**还多 8 个字符**
> - 但把输出解码后,只得到 **1048576 字节**(原文件 3670016 字节),内容 `一致: false`
> - **文件静默丢失 71.4% 的数据,全程没有任何提示**

**复现步骤**:
1. 把 `electron/main.ts` 里的块大小改成非 3 的倍数:
   ```js
   const BLOCK_SIZE = 1024 * 1024; // 1048576,1048576 % 3 = 1
   ```
2. 跑 `pnpm dev`,用「大文件 Base64」处理 3.5MB 文件
3. 观察:一切正常,没有报错
4. 把输出的 Base64 解码,对比原文件 → **数据损坏**

**定位过程**:
- **第一步**:注入 Bug 后先预测现象 —— 预测「正常跑完但结果是错的」(而不是崩溃),这决定了排查方向是「正确性」而不是「稳定性」
- **第二步**:加临时诊断日志,在 Worker 里打印每块的「输入长度 / %3 / 输出长度 / 末尾 4 字符」:
  ```
  [DEBUG][worker] id=0 输入=1048576字节 (❌非3倍数) 输出=1398104字符 末尾4字符="RA==" ⚠️含padding
  [DEBUG][worker] id=1 输入=1048576字节 (❌非3倍数) 输出=1398104字符 末尾4字符="RA==" ⚠️含padding
  [DEBUG][worker] id=2 输入=1048576字节 (❌非3倍数) 输出=1398104字符 末尾4字符="RA==" ⚠️含padding
  [DEBUG][worker] id=3 输入=524288字节  (❌非3倍数) 输出=699052字符  末尾4字符="REQ=" ⚠️含padding
  ```
  → 关键线索:**中间块末尾出现 `RA==`,而中间块本不该有 padding**
- **第三步**:在主线程汇总,计算拼接后「首个 `=` 的位置」:
  ```
  [DEBUG][main] 总块数=4 块大小=1048576(%3=1) 拼接后总长=4893364 首个'='位置=1398102 ❌ 中间出现 padding
  ```
  → `1398102 / 4893364 ≈ 28.6%` —— **`=` 出现在 28.6% 的位置,而不是末尾**
- **第四步(对照实验)**:把块大小改回 3 的倍数(3MB = 3145728),其余代码一行不动,重跑:
  ```
  [DEBUG][worker] id=0 输入=3145728字节 (✅3的倍数) 输出=4194304字符 末尾4字符="RERE"        ← 无 padding
  [DEBUG][worker] id=1 输入=524288字节  (❌非3倍数) 输出=699052字符  末尾4字符="REQ=" ⚠️含padding ← 最后一块,合法
  [DEBUG][main] 总块数=2 块大小=3145728(%3=0) 拼接后总长=4893356 首个'='位置=4893355 ✅ 正常
  ```
  → `4893355` 是**倒数第 1 个字符**,padding 落在最后 4 字符内 = 合法
- **第五步(端到端验证)**:用 Node 直接做往返测试,不依赖界面:
  ```powershell
  node -e "const fs=require('fs');const buf=fs.readFileSync('D:/test-3.5mb.txt');const BLOCK=1048576;let p=[];for(let i=0;i<buf.length;i+=BLOCK){p.push(buf.subarray(i,i+BLOCK).toString('base64'));}const bug=p.join('');const d=Buffer.from(bug,'base64');console.log('Bug版解码后字节:',d.length);console.log('原文件字节:',buf.length);console.log('内容一致:',d.equals(buf));"
  ```
  输出:
  ```
  Bug版长度: 4893364     首个=位置: 1398102
  Bug版解码后字节: 1048576
  原文件字节: 3670016
  内容一致: false
  ```

**根本原因**:
> Base64 编码以 **3 字节为一组**(24 bit → 4 个 ASCII 字符)。当输入长度不是 3 的倍数时,
> 最后一组不足 3 字节,编码器补 `=`(padding)把它凑成 4 字符的完整组。
>
> 分块编码时,如果块大小不是 3 的倍数,那么**每一个中间块**编码后末尾都会带 padding。
> 这些 padding 拼接到整体字符串中间时,Base64 解码器读到第一个 `=` 就**判定输入流结束**,
> 后面的全部内容被忽略。
>
> 本例中:块大小 1048576,`1048576 % 3 = 1`,于是每块末尾补 `==` 凑齐。
> 第一块的 `RA==` 出现在第 1398102 个字符处,解码器在此截断,
> 只解出 1048576 字节(正好是第一块的原始字节数),丢失了后续 2621440 字节。
>
> **最后一块是唯一例外**:它的 padding 恰好是整个数据流的合法结尾,所以不受影响。

**修复方案**:
1. 块大小改为 3 的倍数:
   ```js
   const BLOCK_SIZE = 3 * 1024 * 1024; // 3145728,%3 === 0
   ```
2. 加固(把教训变成代码护栏,两层纵深防御):
   ```js
   // 第一层:主线程,在定义块大小后立刻断言
   if (BLOCK_SIZE % 3 !== 0) {
     throw new Error(`[致命错误] BLOCK_SIZE 必须是 3 的倍数(Bug-003)...`);
   }
   ```
   ```ts
   // 第二层:Worker,收到任务后校验(通过 mustAlign 区分中间块/末块)
   if (task.mustAlign && chunk.length % 3 !== 0) {
     throw new Error(`[致命错误] 中间块长度必须是 3 的倍数(Bug-003)...`);
   }
   ```
   `mustAlign` 由主线程计算:`processed + buf.length < totalBytes`(后面还有数据 = 中间块)。

**为什么这个修复有效**:
> 块大小取 3 的倍数后,每个中间块的输入长度都能被 3 整除,
> 编码结果不含 padding,是完整 Base64 的合法「切片」,直接拼接即正确。
> 只有最后一块可能带 padding,而它的 padding 就是整个数据流的合法结尾。
>
> 即:**中间块必须 3 的倍数;最后一块可以是任意长度。** 这是分块 Base64 的完整规则。

**如何避免再次出现**:
1. **分块处理编码类数据前,先查清「输入输出比例」** —— Base64 是 3→4,所以块大小必须是 3 的倍数;UTF-8 按字节切会截断多字节字符;压缩/加密流则完全不能随机切分
2. **「块大小」是正确性参数,不是性能参数** —— 取 3MB 的理由表面是「1MB 整数倍、够大」,真正关键是「3 的倍数」。随手改成 4MB(4194304 % 3 = 1)立刻复现此 Bug
3. **把教训写成运行时断言,而不是注释** —— 注释会被忽略,断言不会。错误消息里要写清「为什么」并指向本文档
4. **任何编码/序列化功能都必须有「往返测试」** —— 编码→解码→对比原文。只看长度、只看膨胀率、只看「没报错」全都无法发现这类 Bug
5. **UI 只显示片段时必须加日志** —— 界面只显示前 5000 字符,而 padding 在第 1398102 位,光看界面永远发现不了

**学习价值**:
- Base64 的 3 字节分组语义:不是「3 的倍数」这个数字本身,而是「padding 只能出现在流的末尾」
- **静默数据损坏(Silent Data Corruption)是最昂贵的一类 Bug** —— 不崩溃、不报错、所有指标健康,只有数据是错的。用户不会来报「程序崩了」,用户只是某天发现「文件打不开」
- 正确性不能用「指标健康」证明,只有端到端往返验证是真理
- 「块大小」这种看似随意的性能参数,背后可能藏着正确性约束 —— 这是分块流式处理的第一个坑
- 对照实验方法论:同一份输入、只改一个变量(块大小),让因果链闭合,把「猜测」变成「证据」
- 防御性断言的价值:每修一个隐蔽 Bug,就加一条能防止它复发的护栏(两层:主线程 + Worker)
- Worker 的分工:Worker 自己不知道「这是不是最后一块」,必须由主线程通过参数告知 —— 职责清晰(主线程调度、Worker 校验+编码)

---

### Bug-004: 权限裁剪失效导致所有工具获得全部能力

**现象**: 把 `context-factory.ts` 的 `buildContext` 权限裁剪逻辑注释掉,改为无条件注入 `ctx.fs` / `ctx.system` / `ctx.window`,所有工具(包括 permissions 为 `[]` 的 JSON Formatter)都拿到全部能力。但**应用界面完全正常,无任何报错**。

**复现步骤**:
1. 将 `buildContext` 的三个 `if (permissions.includes(...))` 条件判断注释掉
2. 改为无条件赋值:`ctx.fs = makeFsApi(); ctx.system = makeSystemApi(); ctx.window = makeWindowApi();`
3. 运行 `pnpm dev`,切到 JSON Formatter(permissions: `[]`)
4. 界面正常显示,控制台无报错
5. 若在 JsonFormatter 代码里写 `await ctx.fs!.selectAndReadFile()` —— 正常代码会 `TypeError: Cannot read properties of undefined`(ctx.fs 不存在),Bug 代码则调用成功

**定位过程**:
1. 用户切到 JSON Formatter,界面看起来完全正常 → 第一层观察:Bug 不以崩溃形式出现
2. 用户在 Console 查 `window.electronAPI` → 暴露了 5 个方法(但这是 Preload 的底层 API,不是 ctx)
3. 教练指出 `window.electronAPI` ≠ `ctx`,重新要求观察 ctx
4. 用户正确回答:正常 ctx={},Bug 的 ctx={fs,system,window}

**根本原因**: `buildContext` 的裁剪逻辑被绕过,permissions 声明不再决定 ctx 内容。权限模型在 Renderer 侧的「裁剪」这一环节失效。

**修复方案**: 恢复 `buildContext` 的三个条件判断,每个能力只在对应用户声明的 permissions 存在时才注入。

**为什么修复有效**: 裁剪逻辑恢复后,permissions=[] 的工具 ctx={},ctx.fs 是 undefined,即使组件代码误调也会 TypeError 而非静默成功。

**如何避免**:
1. **权限裁剪逻辑应有单元测试** —— 至少 3 个用例:permissions=[] → ctx={};permissions=["fs:read"] → 只有 ctx.fs;permissions=["sys:info","window:hide"] → 有 ctx.system + ctx.window 但无 ctx.fs
2. **审计日志可以校验裁剪结果** —— buildContext 返回后可加 dev-only 断言:检查 ctx 的 keys 是否与 permissions 声明一致
3. **不要把裁剪逻辑写成「能跑就行」** —— 这个 Bug 的危险在于它完全不报错,只在「有人误用不该有的能力」时才暴露

**学习价值**:
1. **权限裁剪的真正价值取决于「被裁剪方能不能绕过裁剪」** —— 阶段 5(方案 A,代码可信):Renderer 可直接 `import { ipcRenderer }` 绕过 ctx,所以裁剪是「工程纪律」不是「安全防线」;阶段 7(第三方插件):插件拿不到 ipcRenderer,ctx 是唯一能力来源,裁剪失效 = 权限系统彻底失效。同一机制在不同威胁模型下,性质完全不同
2. **最危险的 Bug 是「静默成功」的 Bug** —— 不崩溃、不报错、界面正常,只是悄悄地给了工具不该有的能力
3. **window.electronAPI ≠ ctx** —— Preload 暴露的 electronAPI 是底层全量 API(供 ctx 工厂调用),ctx 是 buildContext 按 permissions 裁剪后的能力视图(供工具组件使用)
4. **「声明与实现一致」是权限系统可信的前提** —— permissions 声明 `[]` 但 ctx 实际有 fs,声明就变成了误导性代码,比没有声明更危险
5. **Bug 注入实验的价值**:主动制造、主动观察、主动理解 —— 理解一个 Bug 的本质比修 10 个 Bug 更有价值
6. **对照思考**:正常代码下 `ctx.fs` 是 undefined → 误调 TypeError;Bug 代码下 `ctx.fs` 可用 → 误调成功。**「失败」反而是安全行为,「成功」反而是安全漏洞** —— 颠覆了「能跑就是对的」的直觉
