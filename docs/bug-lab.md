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
- [x] **路径错误(Bug-007:崩溃目录手写拼接;Bug-008:假设 userData 一定可写)**
- [ ] 环境变量错误
- [ ] 构建后资源不存在
- [x] **打包后行为不同(Bug-005:dev 的启动参数在 prod 丢失;Bug-006:preload 依赖图进包)**
- [ ] 更新失败
- [x] **第三方库静默失败(Bug-008:electron-log 写盘 EPERM 被完全吞掉)**

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

---

### Bug-005: dev 的启动参数在打包后丢失导致 prod 直接崩溃

**日期**:2026-10-12
**类型**:生产环境 / 打包后行为不同(启动参数丢失)

**现象**:
> dev 模式(`pnpm dev`)一切正常。
> 打包后双击 `release/win-unpacked/ElectronToolbox.exe`:
> - 窗口完全不出现
> - 没有任何 JS 报错、没有弹窗、没有日志
> - 只有进程退出码 `1`
>
> 这是最难受的一类 Bug:**dev 好、prod 死,而且死得悄无声息**。

**复现步骤**:
1. `pnpm dev` → 应用正常启动 ✅
2. `pnpm build:win` 打包 → 双击产物 exe → 立即退出,exit code 1 ❌
3. 对照:`pnpm dev:electron`(脚本里手写了 `--no-sandbox --disable-gpu-sandbox`)→ 正常 ✅

**定位过程**:
- **第一步**:现象是「exit code 1,无任何输出」→ 先排除 JS 层异常(GlobalExceptionHandler 没触发)
- **第二步**:对照 dev 与 prod 的**启动路径**差异 ——
  dev 走 `vite-plugin-electron` 的 `startup(ELECTRON_ARGS)`,
  prod 走「用户双击 exe,由操作系统直接拉起,零命令行参数」
- **第三步(关键)**:回到 `vite.config.ts` 看到:
  ```ts
  const ELECTRON_ARGS = [".", "--no-sandbox", "--disable-gpu-sandbox"];
  ```
  → 这两个参数**只存在于 dev 的启动调用里**。它是「谁启动进程」决定的,
  而 prod 的启动者(Windows Shell)根本不知道有这个需求。

**根本原因**:
> 项目为了绕开 Windows 11 25H2 上 Chromium sandbox 初始化 Bug(electron#52098),
> 需要在启动时带 `--no-sandbox` / `--disable-gpu-sandbox`。
> dev 模式下这两个参数由 `vite-plugin-electron` 作为**命令行参数**传入 —— 能生效。
>
> 但打包后,exe 由用户双击启动,**没有任何人负责传这两个参数**。
> 缺失参数 → Chromium sandbox 初始化失败 → 进程在 C++ 层直接死掉 →
> JS 还没开始跑,所以**没有任何 JS 层面的错误输出**。
>
> 一句话:**把「必须在启动前生效的配置」寄托在「启动者会传参」上,是脆弱的。**

**修复方案**:
把 workaround 从「启动参数」搬进「代码」—— 在 `app.whenReady()` **之前**注入:
```ts
// electron/main.ts 顶部
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
```
两处并存:dev 的 `ELECTRON_ARGS` 保留(不动既有链路),代码里再加一份兜底。

**为什么这个修复有效**:
> `app.commandLine.appendSwitch()` 会向 Chromium 的命令行**追加**开关,
> 效果与命令行传参等价 —— 但它写在了**应用代码里**,
> 所以无论谁启动这个进程(dev 的插件、还是用户双击 exe),
> 参数都必然存在。
>
> 时序上必须在 `app.whenReady()` 之前调用:因为 sandbox 初始化发生在
> app ready 流程的最早期,**晚了就来不及了**(这是 appendSwitch 的硬约束)。

**如何避免再次出现**:
1. **凡是「必须在进程启动前生效」的配置,参数路径和代码路径各写一份** ——
   不要假设「启动环境一致」。dev 和 prod 的启动者是两个不同的东西
2. **打包后第一件事就是跑一遍「用户视角」的启动** —— 双击 exe,而不是
   `pnpm start`。两者不等价
3. **`exit code 1` + 零输出 → 优先怀疑「JS 之前就死了」** ——
   去查命令行参数、环境变量、DLL/资源路径,而不是去查业务代码
4. **在 dev 里主动验证「去掉参数会怎样」** —— 用 `dev:electron` 不带 workaround 跑一次,
   能提前暴露对参数的隐式依赖

**学习价值**:
- **dev 与 prod 的差异不只在 `NODE_ENV`** —— 启动者、工作目录、命令行参数、
  资源路径、代码签名,全都可能不同
- **`app.commandLine.appendSwitch` 的时序约束**:必须早于 `app.whenReady()`,
  因为很多 Chromium 初始化在 ready 之前完成
- **「静默崩溃」的排查优先级**:无 JS 错误 → 先看进程层(参数/环境/原生依赖),
  再看 JS 层
- **workaround 的存放位置也是一种架构决策** —— 放在构建配置里,
  它的生效范围就只覆盖构建工具启动的那条路径;放进应用代码,才覆盖所有启动路径

---

### Bug-006: Preload 引入 Node 依赖库导致整个桥静默失效

**日期**:2026-10-14
**类型**:生产环境 / 安全边界(sandboxed preload 模块解析)

**现象**:
> 阶段 6-3 加完日志功能后,应用界面能正常渲染,但**所有工具全部失效** ——
> 选文件、系统信息、大文件 Base64 全都不工作。
> 排查入口只有一句:`window.electronAPI` 是 `undefined`。
> Renderer 侧没有任何报错、没有异常、DevTools Network/Console 一片安静。
>
> 真正的报错藏在 **DevTools Console 最上面两行**(容易被后来的业务日志淹没):
> ```
> Unable to load preload script: D:\study\electron-toolbox-learning\dist-electron\preload.js
>
> Error: module not found: path
>     at preloadRequire (VM4 sandbox_bundle:2:151213)
>     at <anonymous>:7:20
>     at runPreloadScript (VM4 sandbox_bundle:2:151877)
> ```

**复现步骤**:
1. 在 `electron/preload.ts` 里加一行 `import log from "electron-log";`,并在 `exposeInMainWorld` 前后调用 `log.info(...)`
2. `pnpm dev`
3. 应用窗口正常出现,UI 正常渲染
4. 点任意工具 → 全部无反应;Console 里查 `window.electronAPI` → `undefined`

**定位过程**:
- **第一步(错误方向,值得记录)**:先猜是「`log.info()` 写在 `exposeInMainWorld` 之前,
  IPC 通道还没就绪,把桥初始化打断了」→ 把 `log.info()` 挪到文件**最末尾** → **Bug 依然存在**。
  这一步的价值是**排除法**:证明失败点不在我们自己的业务代码顺序上。
- **第二步(关键转折)**:让用户**完整截图 DevTools Console 的最顶部**,
  而不是只看我们自己打的业务日志。第一行 `Unable to load preload script` 直接给出答案。
  → 教训:**preload 的失败点在「我们的代码」之外,必须去 Console 最顶部找**。
- **第三步**:读 `dist-electron/preload.js` 的**前 14 行**,发现 bundle 顶部有 **9 行 hoisted require**:
  ```
  L5  const require$$0$5 = require("electron");          ← 白名单内,合法
  L6  const require$$2   = require("path");              ← 从这一行开始炸
  L7  const require$$0$1 = require("child_process");
  L8  const require$$1   = require("os");
  L9  const require$$0   = require("fs");
  L10 const require$$0$2 = require("util");
  L11 const require$$0$3 = require("events");
  L12 const require$$0$4 = require("http");
  L13 const require$$1$1 = require("https");
  ```
  验证命令:
  ```powershell
  Select-String -Path "dist-electron\preload.js" -Pattern '^const require\$\$'
  ```
- **第四步**:把 9 行 require 与 **sandboxed preload 的 require 白名单**
  (`electron` / `events` / `timers` / `url`)逐行对照 ——
  `path` 不在白名单里,所以 **L6 是第一个失败的语句**,与 Console 报错完全对应。
- **第五步(验证修复)**:改造后重新 `pnpm build`:
  ```
  dist-electron/preload.js  0.98 kB   ← 从 80898 字节降到 981 字节
  ```
  bundle 全文只剩 **1 个** `require("electron")`,9 行 hoisted require 全部消失。

**根本原因**:
> 完整因果链(五步,缺一不可):
>
> ```
> ① preload.ts 里 import electron-log
>    → Vite/Rollup 把它【打包进】preload.js
>    (vite.config.ts 的 rollupOptions.external 只排除了 "electron",没有排除它)
>
> ② electron-log 的入口是【运行时分支】:
>      const isRenderer = typeof process === "undefined" || process.type === "renderer";
>      if (isRenderer) { ... } else if (isMain) { ... } else { ... }
>    运行时分支 = 打包器无法 tree-shaking
>    → main 和 node 两个变体【也进了包】,即使我们只要 renderer 那一份
>
> ③ 那两个变体要 require("path") / require("fs") / ...
>    而 Rollup 的 CJS 互操作会把这些 require【提升到 bundle 最顶部】,
>    编译成「模块加载时立刻执行」的语句,而不是「用到时才执行」
>
> ④ preload 运行在 sandbox 模式(Electron 20+ 默认 sandbox: true),
>    可用 require 白名单只有一个很小的集合:electron / events / timers / url
>    → require("path") 当场抛 `module not found: path`
>
> ⑤ preload 脚本在【我们自己写的任何一行代码执行之前】就死了
>    → contextBridge.exposeInMainWorld 从未执行
>    → Renderer 里 window.electronAPI 就是 undefined
> ```
>
> **一句话总结**:sandboxed preload 不是 Node 环境,而 `import` 一个第三方库
> 会把它的整棵依赖树(含 Node 内置模块)带进 bundle 的**加载期**。

**修复方案**:
1. **`electron/preload.ts` 只保留 `import { contextBridge, ipcRenderer } from "electron"`** ——
   删掉 `electron-log`,Preload 退回纯粹的「白名单 + 转发」。
   Renderer 侧日志改为**转发给 Main**:
   ```ts
   // preload.ts
   function forwardLog(level: LogLevel, args: unknown[]): void {
     // IPC 参数必须可结构化克隆,所以先拍平成字符串
     ipcRenderer.send("log:write", {
       level,
       message: args.map(formatLogArg).join(" "),
     });
   }
   contextBridge.exposeInMainWorld("electronAPI", {
     log: {
       info:  (...a) => forwardLog("info", a),
       warn:  (...a) => forwardLog("warn", a),
       error: (...a) => forwardLog("error", a),
       debug: (...a) => forwardLog("debug", a),
     },
     // ...
   });
   ```
2. **`electron/main.ts` 新增接收端**(Renderer 不可信,入参必须校验):
   ```ts
   ipcMain.on("log:write", (_event, payload: unknown) => {
     if (typeof payload !== "object" || payload === null ||
         typeof (payload as { message?: unknown }).message !== "string") {
       log.warn("[main] log:write received malformed payload, dropped");
       return;
     }
     const { level, message } = payload as { level?: unknown; message: string };
     const safeLevel: "info" | "warn" | "error" | "debug" =
       level === "warn" || level === "error" || level === "debug" ? level : "info";
     log[safeLevel](`[renderer] ${message}`);
   });
   ```
3. **`electron/logger.ts` 删除 `initRendererLogger()`** —— 它建立在
   「preload 可以自由 import npm 库」这个已被证伪的前提下,原地留注释说明为什么不复活它。
4. **`src/tools/renderer-log.ts` 保持 API 不变**(`rendererLog.info/warn/error/debug`),
   只更新头注释记录真实链路 —— 上层组件一行都不用改。

**为什么这个修复有效**:
> 修复的本质不是「换个写法」,而是**把 electron-log 移出 preload 的依赖图**。
> preload 的 require 图里只剩 `electron`(白名单内),bundle 顶部不再有
> 任何 Node 内置模块的 require,于是模块加载期不可能失败。
> 日志能力没有丢:它改走 **IPC 单向通道**(`send` / `on`)由 Main 落盘 ——
> 而 Main 本来就是完整的 Node 环境,`electron-log` 在那里毫无限制。
>
> **用 `send`/`on` 而不是 `invoke`/`handle` 的理由**:日志是单向通知,
> 发送方不需要回执。用 `handle` 会给 Renderer 侧留下一个永远不 `resolve`
> 也没人 `await` 的 Promise,纯属噪音。

**如何避免再次出现**:
1. **把「sandboxed preload 的 require 白名单」当成硬约束记在心里**:
   `electron` / `events` / `timers` / `url` —— 就这四个。
   Preload 里出现任何其他 `import`,先问一句:**这个库的依赖树里有 Node 内置模块吗?**
2. **给 preload 加构建期护栏**:preload 的 Vite 配置里显式声明
   `external: ["electron"]` 之外,可加一条产物检查 ——
   bundle 里出现 `require("path"|"fs"|"child_process"|...)` 直接让构建失败。
3. **看到 `window.electronAPI === undefined`,第一步永远是看 Console 最顶部** ——
   搜 `Unable to load preload script`。它比任何业务日志都早、都准。
4. **不要在 preload 里「顺手」用日志/工具库** —— Preload 的定位是
   「最小受控桥」,它每多一个依赖,攻击面和失败面就同时变大。
5. **日志属于「基础设施」不属于「能力」**:它不进阶段 5 的 `ctx` 裁剪,
   而是像 `console` 一样全局可用 —— 但实现上必须遵守上面的分层。

**学习价值**:
- **sandboxed preload 不是 Node 环境** —— 只有 `ipcRenderer` / `contextBridge`
  等极少数能力,不能 `require` fs / path / child_process
- **「没被用到的 import」不等于「不会执行」** —— 顶层 side effect 会被保留,
  并被 CJS 互操作**提升到 bundle 顶部**,变成模块加载期的同步执行语句
- **运行时分支是 tree-shaking 的杀手** —— 库入口里一个
  `if (isRenderer) ... else if (isMain) ...`,就能让打包器把**所有**分支
  的依赖都拖进来。这是选型时要看的隐藏成本
- **preload 加载失败是【静默】的** —— Renderer 只看到 `undefined`,
  不抛错、不阻断渲染。**必须**去 DevTools Console 顶部找
  `Unable to load preload script`
- **失败点在「你的代码之外」时的排查顺序**:先看 Console 真实报错 →
  再看构建产物(bundle 顶部)→ 再对照运行环境的受限清单(白名单)
- **诊断方向错了也要记录** —— 第一版「`log.info()` 顺序问题」的猜测虽然是错的,
  但它做了一次干净的排除实验;**把「猜错」写进文档,比只写正确答案更有价值**
- **「契约不变、实现替换」的改造方式**:`rendererLog` 的对外 API 一行没动,
  换掉的是底层链路 —— 这正是好抽象的回报

---

### Bug-007: 崩溃目录是手写拼接的假路径(日志指向一个永远不会有文件的目录)

**日期**:2026-10-15
**类型**:可观测性 / 「代码里写着一条从未被验证过的关于系统行为的事实」

**现象**:
> 阶段 6-3 测 `debug:crash`。调用 `window.electronAPI.debugCrash()` 之后进程确实退出了,
> 但按日志里打印的「crash dir」去找 dump 文件 —— **那个目录根本不存在**。
> userData 下只有一个 `Crashpad\` 目录,而且 `Crashpad\reports` 是**空的**;
> 全盘搜 `.dmp` 一个都没有。

**定位过程**:
1. 回读 `electron/logger.ts` 里的那一行:
   ```ts
   log.info(`[main] crash dir: ${join(appUserDataSafe(), "crashes")}`);
   ```
   目录名是**手写拼出来的**,不是问系统要的。
2. 对照 Electron API:压根没有 `getPath("crashes")` 这个名字。
   Chromium Crashpad 的真实落盘位置是 **`app.getPath("crashDumps")`**
   (Windows 上 = `<userData>\Crashpad\reports`)。
3. 于是「日志说的路径」和「Crashpad 真正写的路径」是两个地方 ——
   差得不算远,但足够让人在那里白找半天。

**根本原因**:
> 手写拼接 ≠ 查询系统。`join(userData, "crashes")` 只是「猜一个看起来合理的名字」,
> 它既没问过 Electron,也没被任何一次成功写入验证过。
> 危险不在「猜错了」,而在于**它以确定的语气输出** ——
> 排查者会直接相信它,然后在错误的目录里反复找文件。

**修复方案**:
1. `crashDumpsPath()` 改为 `app.getPath("crashDumps")`;取不到时明确输出
   `unknown(crashDumps 不可用)`,**而不是编一个路径出来**。
2. **根治要等 Bug-008 的结论** —— 光「路径是真话」还不够,还得**真的写进去**:
   ```ts
   if (choice.source !== "none" && choice.source !== "userData") {
     repointCrashDumps(join(choice.dir, "crashes")); // mkdir + app.setPath("crashDumps", dir)
   }
   crashReporter.start({ uploadToServer: false, compress: true });
   ```
   顺序是硬约束:`app.setPath("crashDumps", ...)` 必须在 `crashReporter.start()` **之前**,
   一旦 `start()` 完成,Crashpad 就把路径固定了。

**待查(诚实记录)**:
> `Crashpad\reports` 为空的最可能解释,是 Bug-008 的同一个环境约束:
> 崩溃转储写 `%APPDATA%` 同样被拒 → Crashpad 拿不到可写目录 → 不产生 `.dmp`。
> 这解释了「路径对、权限不对」也会表现成「什么都没有」。
> 本机尚未拿到一份 `.dmp` 做完整确认,列为待验证项。

**如何避免再次出现**:
1. **凡是「关于系统行为的事实」,要么问系统要,要么写清这是推测。**
   路径、版本、默认值、平台差异 —— 全属于这一类。
2. **日志里的路径必须是程序验证过的路径**,不能是程序猜的路径。
   判别法:这个值,我有没有一步操作能证明它真的成立?
3. **Crashpad 目录的坑**:`crashDumps` 是唯一正确入口;
   `setPath` 必须早于 `crashReporter.start`。

**学习价值**:
- 与 Bug-004 / Bug-006 / Bug-008 同族:**代码里写着一条从未被验证过的断言**。
  未经验证的不变量,比没有不变量更危险
- **可观测性设施本身也要被观测** —— 日志说错话比不打日志更贵
- 这个 Bug 的完整修复依赖下一个 Bug 的结论:**修 Bug 常常要回头改上一个 Bug 的修法**

---

### Bug-008: electron-log 写日志彻底静默 —— 文件不存在、终端不报错、不抛异常

**日期**:2026-10-15
**类型**:生产环境 / 第三方库静默吞错 + 运行环境权限

**现象**:
> 阶段 6-3 引入 electron-log 之后,`%APPDATA%\electron-toolbox-learning\logs\` 下
> **从来没有出现过 main.log**。更怪的是:
> - 终端里看不到 `[main] logger initialized` 那几行自报家门的日志
> - 没有异常、没有报错,应用功能一切正常(只是没有日志)
> - 手动清空日志目录后重启,目录**依旧是空的**
>
> 而 10/13 第一次加日志时**是写成功的**(main.log 里有 4 行),之后就不写了 —— 代码没改过。

**排查过程(三轮探针,每一步都必须可被证伪)**:
1. **先证伪「构建没生效」**:比对 `electron/preload.ts` 与 `dist-electron/preload.js`
   的 mtime 与字节数 → 产物比源码新,假设被推翻。
2. **旁路探针**:在 `electron/main.ts` 里加临时探针(用完即删),绕开 electron-log、
   也绕开终端,直接 `appendFileSync` 写工作区里的 `logger-probe.txt`。结论:
   - main.js 已加载;`initMainLogger()` 正常返回没抛错;
   - `log.transports.file.getFile().path` = `<userData>\logs\main.log`(路径正确);
   - `console.level` / `file.level` 配置都生效;
   - `log.info()` 返回且没抛错。
   - **⇒ 路径解析、配置、初始化全部正确,问题不在我们这层。**
3. **挂钩子看消息走到哪**:给三个 transport 的 `writeFn` 打钩子 ——
   **HOOK 命中 3 次**(console / file / ipc 都收到了同一条消息,level 也都通过)。
   **⇒ 消息确实到达了 file transport,不是「没走到」。**
4. **直接调底层**:`fs.writeFileSync("...\\logs\\main.log", "x")` ——
   **抛错 `EPERM: operation not permitted, open '...\logs\main.log'`**。
5. **排除 ACL**:`icacls` 显示该目录上 `Administrator` 是 Full Control;
   用 PowerShell 往同一路径写文件**成功**;而 Electron 进程的 GetOwner 也是 Administrator。
   ⇒ 差别不在 ACL,而在**进程令牌** —— 应用进程带着受限的沙箱身份,
   写入范围被限制在工作区内。
6. **独立 Electron 进程复核**:单独跑一个 electron 脚本,对
   `userData` / `temp` / `appData` / `sessionData` 跑同一套写测试 ——
   **全部 EPERM**,而工作区内可写。⇒ 确认是「写入范围」的问题,不是某个目录坏了。

**根本原因(两层,缺一不可)**:
> **第一层(触发器)**:`fs.writeFileSync(<userData>\logs\main.log)` 被系统拒绝(EPERM)。
> 运行环境对用户目录只给读权限,只有工作区可写。
>
> **第二层(放大器,最贵的一层)**:electron-log 5.x 的 `File.writeLine()` 把写盘
> 包在 try/catch 里,catch 中只做一件事:
> ```js
> this.emit("error", new Error(`Couldn't write to ${this.path}. ${e.message}`), this);
> ```
> 而 **File 实例上没有任何 error 监听器**;这个事件最终被 `processMessage()` 的
> try/catch 接住,交给 `processInternalErrorFn()` —— 基类里那个函数是**空实现 `{}`**。
>
> ⇒ 结果:**没有文件、终端没有任何报错、不抛异常**。
> 「写日志失败」这件事,被日志库自己咽了下去。

**为什么 10/13 能写、之后不能**:
> 同一份代码,**运行环境变了** —— 进程从「可写用户目录」变成「只能写工作区」。
> 「昨天还好好的」这类线索必须当成一等证据:它几乎总在说
> **变的是环境,不是代码**。

**修复方案(重写 `electron/logger.ts`,原则:允许写不进去,但不允许不吭声)**:
1. **可写性预检** `isDirWritable()`:真的 `mkdirSync` → 真的 `writeFileSync` 探针文件
   → 真的 `readFileSync` 读回来比对 → 再 `unlinkSync` 删掉。
   (只判断 `existsSync` 发现不了只读 ACL;只写不读回发现不了重定向层。)
2. **回退链**:`userData/logs` → `temp/electron-toolbox/logs` →(仅 dev)`工作区/logs`,
   第一个通过预检的胜出,结果记为 `userData | temp | workspace | none`。
3. **显式指定路径**:`log.transports.file.resolvePathFn = () => logFilePath`,
   不再依赖 electron-log 那套「自己推导、错了也不说」的隐式链。
4. **失败必须可见**:
   - 走回退链时用 `console.error` 大声报告 —— **刻意不走 electron-log**,
     因为「日志系统自己坏了」这件事不能被这个坏掉的系统承载;
   - `installFileErrorSink()`:给 File 实例挂 `on("error", ...)`,并接管
     `processInternalErrorFn`,把那个无人理会的黑洞补上消费者;
   - 一条路都走不通 → 关掉文件传输 + 明确说明原因。
5. **不信任「应该写成功了」**:打完第一行日志后 `existsSync(logFilePath)` 回头验证,
   不存在就再报一次。
6. **崩溃目录跟着一起回退**(见 Bug-007)。

**验证**:
- `tsc -p tsconfig.node.json` 与 `tsc -p tsconfig.json` → 均 exit 0
- 真实 `pnpm dev` + 指定 `--user-data-dir` 四轮:
  可写 userData → 选中 userData 且 `main.log` 真的出现;
  不可写 userData → 自动回退 workspace 且 `logs\main.log` 真的出现;
  全部不可写 → 文件日志关闭并明确报错;
  `debugUncaught` 经 IPC 转发 → Renderer 侧日志也进了 main.log
- 产物核查:`dist-electron/main.js` 里新 logger 的四段文案各命中 1 次

**如何避免再次出现**:
1. **引入任何「日志 / 持久化 / 上传」类第三方库时,先问一句:
   它失败了,会不会告诉我?** 一个把失败咽下去的库,能把排查方向带偏几小时。
2. **不要用「库能跑」代替「库在工作」** —— 要让程序自己报告真相。
   探针必须**绕开所有可疑环节**(不经过 electron-log、也不经过终端),
   写到确定可写的地方。
3. **探针必须跑在与被测程序相同的权限/环境下** —— 用沙箱身份跑的探针
   只能得到 EPERM,那测的是沙箱,不是应用。
4. **「文件不存在」永远只有三种可能**:没写 / 写到别处 / 写了又被删。
   逐条设计成可证伪的观察,不要停在猜测。
5. **日志目录不能假设**:userData 可能只读、安装目录只读、`%APPDATA%` 可能被策略限制。
   任何要落盘的东西,都需要「预检 + 回退 + 响亮失败」三件套。

**学习价值**:
- **静默失败是最贵的一类 Bug** —— 没有报错的地方,才是排查的盲区
- **第三方库的失败传播链必须自己查过**:谁能接住、转成什么、交给谁
- **「同样代码昨天能用」= 环境变量**(权限、工作目录、启动者、系统策略)
- **可观测性设施本身要容错**:日志可以丢,但不能撒谎
- **修 Bug 要修完整**:改了日志目录,崩溃目录必须跟着走(Bug-007)

---

### 阶段 6-3 验收记录(2026-10-16)

**验收项(4/4 通过)**:

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 冷启动:可写性预检 → 回退 → 落盘 | ✅ 终端报的路径与 `logs\main.log` 实际内容一致(旧代码里这两件事可以脱钩) |
| 2 | Renderer 日志经 IPC 转发落盘 | ✅ `[renderer] ...` 出现在 main.log(Bug-006 回归通过) |
| 3 | `debug:uncaught` 触发真正的 uncaughtException | ✅ 栈顶 `Immediate.<anonymous>` + `process.processImmediate` |
| 4 | `debug:crash` 产出 minidump | ✅ `logs\crashes\reports\*.dmp`(实测 32.88 MB) |

**本次纠正的一处「未验证的事实」(第四条同族错误)**:
> `crashDumpsPath()` 的注释里我曾写下「Windows 上是 `<userData>\Crashpad\reports`」——
> 这是**没验证就写下的关于系统行为的事实**。探针实测推翻:`app.getPath('crashDumps')`
> 返回的是 Crashpad 的**数据库根**(`<userData>\Crashpad`)。
> minidump 按 Crashpad 自己的约定落在 `<数据库根>\reports\` 下。
> 同族: Bug-004(声明与实现不一致)/ Bug-006(注释承诺的护栏不存在)/ Bug-007(手写假崩溃路径)/ 本条。
> 日志现在两行都打、各带标签:`crash dir (Crashpad 数据库根)` 与 `crash dumps (minidump 实际落盘处)`。

**写进复盘的代价(必须记住)**:
> 测试 3 之后应用「活着」,是因为我们的 `uncaughtException` handler **只记日志、不退出**。
> **这不是生产策略**:未知异常之后进程状态可能已损坏(内存、句柄、半途的 IPC),
> 继续运行可能静默产出错误结果。生产实践是「记日志 → 有序退出 → 重启」。
> 这里故意不退出,只是为了让人能看见日志。

**日志目录回退链的实测结论**:本机环境下 `userData` 与 `temp` 两个候选均 EPERM
(进程写入范围被限制在工作区),最终落到 `workspace`:`D:\study\electron-toolbox-learning\logs\`。

---

### Bug-009: electron-log 在 Main 进程里被装进了「渲染进程那份实现」

**日期**:2026-10-19
**类型**:打包与模块解析 / 条件导出(exports conditions)/ 第三方库双实现

**现象**:
> 阶段 6-4 加上 `autoUpdater.logger = log` 之后,应用启动即失败,弹出
> `A JavaScript error occurred in the main process`。终端里的两条线索:
> ```
> electron-log/renderer is loaded in the main process.
> If you want to use electron-log in the main process, import from "electron-log/main".
> ```
> ```
> TypeError: Cannot set properties of undefined (setting 'level')
>     at initMainLogger (dist-electron/main.js:614:31)
> ```
> 而**同一份 `logger.ts` 在阶段 6-3 是跑通了四轮验证的**,一行都没改过。

**复现步骤**:
1. `electron/main.ts`、`electron/logger.ts` 里都是 `import log from "electron-log"`
2. 打包 Main(`vite-plugin-electron` 的 build 阶段)
3. 启动 → `log.transports` 为 `undefined` → `log.transports.file.level = "info"` 抛错

**定位过程**:
1. **先看栈顶**:错在 `initMainLogger` 的**第一行业务语句**,而 `log` 本身不为空
   ⇒ 不是"没导入",是"导进来的东西不对"。
2. **抓免费线索**:electron-log 自己打了
   `electron-log/renderer is loaded in the main process`。
   一个库能说出这句话,说明它**知道自己的哪份实现被装进来了** —— 那就顺着这条走。
3. **查依赖自己怎么声明**:`electron-log@5.4.4/package.json` 的 `exports`:
   ```json
   ".": {
     "types":   "./src/index.d.ts",
     "browser": "./src/renderer/index.js",
     "default": "./src/index.js"
   }
   ```
4. **查打包器怎么选条件**:Vite/Rollup 默认的 `resolve.conditions` 里**带有 `browser`**。
   于是为 Main 进程打包时,`.` 这个入口优先命中了 `browser` 条件 ⇒ 打进的是
   `src/renderer/index.js`。那份实现里 `transports` 本来就只在浏览器侧赋值。

**根本原因**:
> **条件导出是一套「按消费者环境做分发」的机制,而 Vite 的默认条件集合是按"给浏览器打包"配的。**
> Renderer 用它是对的;Main / Preload 不是浏览器,用同一套条件就会**静默装错实现**。
> 更麻烦的地方在于:这种错**不会在编译期报** —— 类型来自 `types` 字段(两份共用),
> 所以 `tsc` 全绿,直到运行到第一次真正使用才炸。

**修复方案**:
> 三处导入改成显式子路径(各带一句注释指向本条):
> ```ts
> import log from "electron-log/main"   // 不用 "electron-log":见 Bug-009
> ```
> 涉及 `electron/main.ts`、`electron/logger.ts`、`electron/updater.ts`。

**为什么这个修复有效**:
> 显式子路径直接命中 `exports` 里的 `"./main"` 键,**跳过了 `"."` 的条件选择**。
> 也就是说:不再让打包器替我们回答"这个包该给我哪一份",而是我们自己说清楚。
> 顺带把库内部那条「猜我在哪个进程」的分支也绕开了。

**如何避免再次出现**:
1. **同一包对 main / renderer 有两份实现时,一律用显式子路径**(`pkg/main`、`pkg/renderer`),
   不要依赖打包器的默认条件。
2. **引入第三方库前先读它的 `exports` 字段** —— 那里写着它对"环境"的全部假设。
3. 打包非浏览器目标时,主动核对 `resolve.conditions`;
   更彻底的做法是给 main / preload 单独配置 `resolve.conditions: []`(只留 `node`)。
4. **"这段代码以前验证过"不是它不会坏的理由** —— 依赖或被依赖方的元数据变了,它就会坏。

**学习价值**:
- **条件导出是双向的坑**:它既能帮你在对的环节选对实现,也能在对的环节选错实现
- **库的启动警告是免费线索**:它自报家门的那句话,往往就是根因的方向
- **类型正确 ≠ 运行时正确**:`types` 字段选对了,不代表 `default/browser` 也选对了
- 报错在 `logger.ts`,根因在 `package.json` 的 `exports` —— **错误的位置不等于错误的来源**

---

### Bug-010: Electron 装成「空壳」+ 无锁文件导致整条工具链漂移

**日期**:2026-10-19
**类型**:环境 / 依赖管理 / 二进制资产 / 可复现性

**现象**:
> `pnpm dev` 起不来,报两层完全不同的错:
> ```
> Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
> ```
> ```
> TypeError [ERR_INVALID_ARG_TYPE]: The "file" argument must be of type string.
>     Received an instance of Object
>     at normalizeSpawnArguments (node:child_process:568:3)
>     at startup (...\vite-plugin-electron\dist\index.js:206:25)
> ```
> 同时**之前能编过的代码编不过了**:
> `src/tools/Base64Tool.tsx(85,47): error TS2315: Type 'Uint8Array' is not generic`

**定位过程(这题的难点是三个问题挤在一个症状里)**:
1. **先分清"报错说的是谁"**:`require("electron")` 报的是**装没装好**;
   `vite-plugin-electron` 的 `spawn` 报的是**拿到的东西不是路径**。
   两者是同一个原因的上下游,不是两个 Bug。
2. **查二进制而不是查目录**:`node_modules\electron\` 目录在,但
   - `path.txt` **不存在**
   - `dist\` 里只有 **16 个文件**(完整是 **73 个**),**连 `electron.exe` 都没有**
   ⇒ "看起来装了,其实是空壳"。
3. **对照同 store 里的其它副本**:`electron@31.0.0` 有 41 个文件(完整)、
   `electron@31.7.7_supports-color@7.2.0` 有 73 个(完整)
   ⇒ 只是**我们这一份的解压中断了**,不是网络或镜像整体坏了。
4. **查为什么会装到别的版本**:`pnpm-workspace.yaml` 里 `lockfile: false`
   ⇒ 没有 `pnpm-lock.yaml` ⇒ 每次 install 重新解析。
   这次装进去的是 `vite 5.0.0 / electron 31.0.0 / typescript 5.3.3`
   (上一轮是 `5.4.21 / 31.7.7 / 5.9.x`)。
5. **TS 2315 就是漂移的连带后果**:`Uint8Array<ArrayBuffer>` 这个泛型是 TS 5.7 才有的,
   6-3 修 `Base64Tool` 时用的正是它;降级到 5.3.3 之后它变成了语法错误。

**根本原因(三层)**:
> **第一层**:Electron 的 npm 包**只是一个下载器**。真正的二进制
> (`electron.exe` / `*.dll` / `*.pak` / `icudtl.dat`)是在 `postinstall` 里下载并解压的,
> **这个动作不是原子的** —— 中断、权限、镜像抖动,任何一处出问题,
> 就留下一个"目录存在、内容残缺"的 `node_modules/electron`。
>
> **第二层**:`require("electron")` 的返回值**只有两种**:dist 路径字符串,或者抛错。
> 一旦二进制不全,它抛的错会被上一层(插件)当成"参数类型不对"继续往外抛,
> **报出来的错和真因完全无关**。
>
> **第三层(放大器)**:`lockfile: false` 让每次 install 都可能换一套版本组合。
> 换版本 → 触发重新解压 → 撞上中断 → 空壳。
> 于是"版本漂移"和"二进制残缺"这两件事**互相喂养**。

**修复方案**:
1. 删掉残缺的 `node_modules\electron\dist` 与 `path.txt`
2. 用镜像重跑下载器,让二进制重新完整落盘:
   ```powershell
   $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
   node node_modules\electron\install.js
   ```
3. 把工具链显式装回验证过的组合(精确版本,不带 `^`):
   ```powershell
   pnpm add -D electron@31.7.7 vite@5.4.21 typescript@5.9.3
   ```
4. 复查:`dist\` 73 个文件、`electron.exe` 在、`path.txt` 在、
   `tsc -p tsconfig.node.json --noEmit` 与 `tsc -p tsconfig.json --noEmit` 均 exit 0

**为什么这个修复有效**:
> `install.js` 会先读 `dist/version` 判断"装没装好";dist 残缺时它读不到,于是报
> "failed to install correctly" 而**不会重下** —— 所以这个错必须靠**手动清掉残缺 + 重跑下载器**才能解开,
> 单纯再 `pnpm install` 一次会命中同一条短路。

**一处推断被自己的实验推翻(记下来)**:
> 我最初的解释是"pnpm 无锁文件时会解析到范围下限"。**这是错的。**
> 在干净目录里做对照实验(`lockfile: false` + `"vite": "^5.0.0"` + `"electron": "^31.0.0"`):
> 解析结果是 **`vite 5.4.21` / `electron 31.7.7`**,即 **pnpm 默认选范围内最高版本**。
> ⇒ 版本落到下限,原因是**当时 `node_modules` 处于残缺/半装状态下的 reconcile**,
> 不是 resolution-mode。**"我观察到它降级了"和"我知道它为什么降级"是两件事。**

**如何避免再次出现**:
1. **`lockfile: false` 是主动选择(为了改小版本后重装能生效),但必须配「关键工具链版本写死」**:
   `vite` / `electron` / `typescript` 用精确版本;其它依赖可以用 `^`。
   这样既保留"重装拿新版本"的便利,又不会让编译器自己换掉。
2. **判断 Electron 装没装好,别看目录,看三样东西**:
   `dist\electron.exe`、`dist\version`、`path.txt`。
3. 遇到 `require("electron")` 的错,先问一句:**是"路径没拿到"还是"二进制不存在"**。
4. 依赖变动之后,**第一件事是重跑两个 tsconfig 的全量检查**,而不是继续改业务代码。

**学习价值**:
- **前端包是"代码",Electron 包是"代码 + 几十 MB 二进制"**,两者的失败形态完全不同
- **报错的位置不是错误的来源**:真因在安装,报错在插件的 `spawn`
- **"无锁文件"换来的方便,代价是可复现性** —— 这个取舍要显式做、写进 decisions,而不是默认
- **一次依赖漂移能同时打断编译和运行** —— 影响面比想象的大
- **"观察到" ≠ "解释了"**:机制没验证过就写进结论,迟早会被自己的实验打脸

---

### 阶段 6-4 验证记录(2026-10-19)

**自动更新的初始化:实测通过**(`logs/main.log` 真实内容):

```
[2026-10-19 11:58:07.294] [info]  [main] app starting (isDev=true, v0.1.0)
[2026-10-19 11:58:07.720] [warn]  [updater] 未打包运行：已设 forceDevUpdateConfig = true，将读取 dev-app-update.yml 而不是 resources/app-update.yml
[2026-10-19 11:58:07.723] [info]  [updater] 初始化完成 currentVersion=0.1.0 autoDownload=false autoInstallOnAppQuit=true allowDowngrade=false
```

三个策略值全部按设计生效:
- `autoDownload=false` —— 不自动下载(常驻工具不能偷占带宽)
- `autoInstallOnAppQuit=true` —— 退出时安装(不打断正在使用的人)
- `allowDowngrade=false` —— 拒绝降级(防"用旧版本回退绕过新版本修复")

**尚未完成**:真实的「发现新版本 → 下载 → 退出时安装」链路,需要一个本地更新源
(`http://127.0.0.1:8080/updates` )配合两个版本号,见阶段 6-4 的实测步骤。

---

## 易错点(不是 Bug,但会浪费你半天)

### E-001: 第三方库的错误提示会把你带偏

**场景**:本地更新源目录配错了,客户端拿到 404。electron-updater 报:

```
Cannot find channel "latest.yml" update info
Please double check that your authentication token is correct.
Due to security reasons, actual status maybe not reported, but 404.
```

**为什么这句是误导**:我们用 `generic` provider,**根本没有 authentication token**。那句提示是 electron-updater 从 GitHub provider 继承下来的**通用文案**。照着它去查 token,方向从一开始就是错的。

**正确做法**:
1. **先看状态码和完整 URL**。日志里 `http://127.0.0.1:8080/updates/latest.yml?noCache=...` → 404,已经说明一切
2. 再确认**服务端根目录**到底指向哪 —— 本例的真实原因是:启动服务时忘了传目录,`process.argv[2] ?? "release"` 回退成了「当前工作目录/release」,一个恰好存在、但里面没有 `latest.yml` 的旧构建目录
3. 最后才去怀疑库的行为

**通用规律**:第三方库的错误文案常常是**跨场景复用的**,它描述的是「最常见的那种失败」,不一定是你遇到的那种。**信状态码,不信措辞。**

### E-002: 服务"看起来正常"是最难查的状态

同一个问题的教训:**允许配置错,但不允许配置错了不吭声。**

一个静态文件服务,在没有 `latest.yml` 的目录上跑起来,表现是:端口在听、HTTP 200/404 有响应、进程不报错 —— 一切"正常",但客户端稳定失败。

修法是把检查前移到**启动的第一秒**:项目里的 `scripts/dev-update-server.mjs` 现在会在启动时自检 `latest.yml` 是否存在、`latest.yml` 里提到的文件名是否真的在目录里,不满足就立刻打印 ⚠ 并说明当前根目录。这与 Bug-008 是同一条原则。
