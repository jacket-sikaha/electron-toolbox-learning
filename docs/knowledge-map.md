# Electron Knowledge Map

> 进度状态:✅ 已掌握(能解释+应用+排错) · 🟡 接触(能解释) · 🔴 未接触 · 🎯 当前阶段目标

## Architecture 架构设计

- [x] ✅ 进程模型 Main / Renderer / Preload 三者职责与边界
- [x] ✅ Preload 最小暴露原则
- [x] ✅ IPC 通信架构(ipcMain / ipcRenderer / contextBridge 数据流)—— 阶段 2 完成
- [ ] 🔴 多窗口架构(主窗口/子窗口/隐藏窗口/工具进程)—— 阶段 5
- [ ] 🔴 插件化扩展架构(无限扩展工具箱核心命题)—— 阶段 5
- [x] ✅ 进程隔离与信任边界 —— 阶段 2 巩固

## Core 重点基础

- [x] 🟡 BrowserWindow 创建与配置(webPreferences 安全配置)
- [x] 🟡 dev/prod 加载方式差异(loadURL vs loadFile 本质)
- [x] ✅ app.whenReady() 生命周期时机
- [x] ✅ ipcMain.handle 通信机制 —— 阶段 2 完成
- [x] ✅ ipcRenderer.invoke 通信机制 —— 阶段 2 完成
- [x] ✅ contextBridge.exposeInMainWorld —— 阶段 2 完成
- [ ] 🔴 完整 app 生命周期(ready/window-all-closed/before-quit/will-quit)—— 阶段 3
- [ ] 🔴 WebContents 状态与事件 —— 阶段 3
- [ ] 🔴 Dialog / Menu / Tray / Shell / SystemPreferences —— 阶段 3
- [ ] 🔴 globalShortcut / clipboard / powerMonitor —— 阶段 3
- [ ] 🔴 desktopCapturer —— 阶段 4(图片工具)

## Bug / Security 安全与边界

- [x] 🟡 nodeIntegration 配置错误导致 RCE(原理理解)
- [x] 🟡 contextIsolation 配置错误的危害
- [x] ✅ Preload 暴露 API 过大的风险 —— 阶段 2 实操
- [x] ✅ IPC 未校验输入 = 主进程注入 —— 阶段 2 理解(方案 2 规避)
- [x] ✅ 路径穿越攻击(渲染进程传相对/绝对路径)—— 阶段 2 理解(方案 2 规避)
- [ ] 🔴 ipcMain.on 监听泄漏 —— 阶段 3
- [ ] 🔴 Zombie 进程(窗口关闭但子进程未退)—— 阶段 3
- [ ] 🔴 stale state(渲染进程重载后旧回调仍触发)—— 阶段 3
- [ ] 🔴 __dirname / process.resourcesPath prod 路径问题 —— 阶段 6

## Performance 性能

- [ ] 🔴 启动时间(冷启动/preload 提前/按需加载)—— 阶段 7
- [ ] 🔴 大文件处理(Stream/Worker/分片)—— 阶段 4
- [ ] 🔴 IPC 频繁通信/大数据 IPC 开销与替代方案 —— 阶段 4
- [ ] 🔴 多窗口内存成本(每窗口独立 Chromium)—— 阶段 5
- [ ] 🔴 Renderer CPU 长任务阻塞 —— 阶段 4
- [ ] 🔴 打包体积与启动(asar/压缩/原生模块)—— 阶段 6
- [ ] 🔴 autoUpdater 性能与失败重试 —— 阶段 6

## Engineering 工程化

- [ ] 🔴 electron-builder 跨平台/签名/目标格式 —— 阶段 6
- [x] 🟡 Main/Renderer/Preload TypeScript 工程结构 —— 阶段 1 已建立
- [x] 🟡 开发热重载(dev vs prod 加载差异)—— 阶段 1 已实现
- [x] ✅ Electron 安装机制(postinstall + 二进制下载 + ELECTRON_MIRROR)—— Bug-001 实战
- [x] ✅ pnpm allowBuilds 白名单机制 —— Bug-001 实战
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
| 3 | 生命周期与系统工具(Tray/Menu) | ⏳ 待开始 | 0% |
| 4 | 大文件与异步(Worker Threads) | ⏳ 待开始 | 0% |
| 5 | 插件化扩展架构 | ⏳ 待开始 | 0% |
| 6 | 工程化与发布 | ⏳ 待开始 | 0% |
| 7 | 性能与架构演进 | ⏳ 待开始 | 0% |

## 薄弱点记录

(随学习推进更新,用于复习时定向巩固)

- postinstall 失败的「软失败」行为:pnpm 某些版本/配置下 install 整体退出码 0,但二进制没下来,要靠 `pnpm dev` 才暴露

## 已巩固(曾为薄弱点,已通过复述检查)

- ✅ handle/invoke 精确描述:注册/调用,不是订阅/发布(发布订阅是 on/send)。channel 名不一致 → Main 端无人 handle → Promise 永远 pending,不报错不超时
- ✅ XSS vs 路径穿越:两种完全不同的攻击类型。XSS 攻渲染进程,路径穿越攻文件系统。二层防御里 Preload 校验防的是路径穿越
- ✅ contextIsolation 核心价值:Preload 与 Renderer 是两个独立 window 对象,exposeInMainWorld 是「复印一份」,页面改不动原件,防 Monkey Patching
- ✅ Base64 膨胀率 ×1.37:3 字节 → 4 字符,5MB → 6.85MB 是正常设计,不是 Bug(阶段 4 大文件的关键约束)

## 已遇到的 Bug

- Bug-001:Electron 二进制安装失败(postinstall 网络超时)→ 见 `bug-lab.md`
