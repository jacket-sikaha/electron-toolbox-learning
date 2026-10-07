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
