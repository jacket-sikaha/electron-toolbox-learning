// electron/main.ts —— Main Process 入口
//
// 这个文件是整个 Electron 应用的「主线程」。
// 它拥有完整 Node.js 能力,负责:创建窗口、管理生命周期、调度系统 API。
// 默认配置下,Renderer(React 页面)碰不到这里的任何东西,
// 必须通过 Preload 暴露的桥才能间接调用(阶段 2 才会用)。

import { app, BrowserWindow, shell, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// 关键设计 1:__dirname 在 CommonJS 环境下可直接用
// electron/main.ts 会被 tsc 编译成 CommonJS 输出到 dist-electron/,
// 所以 __dirname 指向 dist-electron/。
// 但要记住一个常见的 prod Bug:打包后 __dirname 可能指向 asar 内部,
// 需要配合 process.resourcesPath 处理资源路径。阶段 6 会专门讲。
const isDev = !app.isPackaged;

// 关键设计 2:dev/prod 判断用 app.isPackaged,不用 process.env.NODE_ENV
// - dev 模式:app.isPackaged === false → 加载 Vite dev server
// - prod 模式:app.isPackaged === true  → 加载本地打包产物
// 这是不依赖任何构建工具的 Electron 原生 API,语义明确。

function createWindow() {
  // 关键设计 3:窗口安全配置 —— 从第一天就锁死正确姿势
  // nodeIntegration:false      → Renderer 不直接拥有 Node API
  // contextIsolation:true      → Preload 与 Renderer JS 上下文隔离
  // preload:                    → 必填,即使阶段 1 暂时是空的也要引用,
  //                              为阶段 2 扩展文件 IO 留架构位,防止后续
  //                              为了图省事直接开 nodeIntegration
  // sandbox:                    → 阶段 1 先保持默认,阶段 5 性能优化时讲
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  // 关键设计 4:dev/prod 加载方式不同
  // - dev: loadURL,走 Vite HMR,改 React 代码即时刷新
  // - prod: loadFile,直接读磁盘上的 dist/index.html
  //
  // 为什么 prod 不能继续 loadURL?
  //   因为 prod 模式下没有 dev server,用户机器上没有 localhost:5173。
  //   必须加载本地打包产物(file:// 协议)。
  //
  // 注意:loadFile 的路径是相对 main.js 的运行目录,打包后路径会变,
  // 这里用 process.resourcesPath 处理,阶段 6 打包时会专门讲。
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    // dev 模式自动开 DevTools,方便调试
    mainWindow.webContents.openDevTools();
  } else {
    // prod 模式加载本地打包产物
    // 注意路径:dist/index.html 相对项目根目录,但 main.js 在 dist-electron/,
    // 所以用 process.cwd() 拼绝对路径,避免相对路径歧义。
    mainWindow.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }

  // 关键设计 5:外部链接用系统浏览器打开,而不是在 Electron 窗口内跳转
  // 这是个常被忽略的安全/UX 细节:如果用户点了 <a href="https://...">,
  // 默认会在 Electron 窗口里打开,导致:① 失去浏览器导航 ② 可能被钓鱼
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// 关键设计 6:IPC handler 注册 —— 阶段 2 核心
//
// ipcMain.handle(channel, handler):注册一个「可被 invoke 调用」的处理函数
// - channel:字符串通道名,必须与 ipcRenderer.invoke 的 channel 一致
// - handler:async (event, ...args) => result,返回值会通过 IPC 传回 Renderer
//
// 关键设计 6.1:为什么用 handle/invoke 而不是 on/send?
// - ipcMain.on + ipcRenderer.send:单向通信,无法返回值(老 API,不推荐)
// - ipcMain.handle + ipcRenderer.invoke:双向通信,返回 Promise,异步友好(推荐)
// 阶段 2 的需求是「读文件并返回内容」,必须用 invoke/handle。
//
// 关键设计 6.2:channel 名用 'tool:select-and-read-file' 这种命名
// - 用 'tool:' 前缀分组,避免后续工具增多后 channel 名冲突
// - 用 kebab-case,Electron 社区约定
//
// 关键设计 6.3:零入参 = 零攻击面(你选的方案 2)
// - handler 不读取 event 或 args,因为 Renderer 不传任何东西
// - path 由 Main 内部 dialog 拿到,Renderer 拿不到 path
// - 即使 Renderer 被攻破,攻击者也无法伪造 path
function registerIpcHandlers() {
  ipcMain.handle("tool:select-and-read-file", async () => {
    // 1. 弹系统文件选择框(只能在 Main 调,Renderer 碰不到 dialog)
    const result = await dialog.showOpenDialog({
      title: "选择要转 Base64 的文件",
      properties: ["openFile"],
      // 限制单文件,不允许多选(最小权限)
      filters: [
        // 不限后缀,允许任意文件(阶段 2 需求)
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    // 2. 用户取消选择(dialog 返回 canceled: true)
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];

    // 3. 关键设计 6.4:即使方案 2 天然安全,Main 仍要做边界防御
    // - 限制文件大小:避免用户选了一个 10GB 文件把 Main 进程 OOM
    // - 这是「纵深防御」的体现:方案 2 防住了路径穿越,
    //   但「文件大小」这个边界仍要在 Main 守
    // 阶段 2 先用简单 size 检查,阶段 4 大文件会改用 Stream
    const { stat } = await import("node:fs/promises");
    const stats = await stat(filePath);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(
        `文件过大(${(stats.size / 1024 / 1024).toFixed(2)}MB),当前阶段限制 10MB 以内。阶段 4 会用 Stream 支持大文件。`
      );
    }

    // 4. 读文件内容(Node fs API,Renderer 碰不到)
    const buffer = await readFile(filePath);
    const name = basename(filePath);

    // 5. 返回 { buffer, name } 给 Renderer
    // - Buffer 通过 IPC 传输时会被自动序列化为 Uint8Array
    // - Renderer 拿到后用 btoa 或 TextDecoder 转 Base64
    return { buffer, name };
  });
}

// 关键设计 7:app.whenReady() —— 创建窗口的唯一正确时机
// 在 app ready 之前调用 new BrowserWindow() 会抛错:
//   Error: Cannot create BrowserWindow before app is ready
app.whenReady().then(() => {
  // 关键设计 7.1:IPC handler 必须在 app ready 后注册
  // - 在 ready 之前调 ipcMain.handle 会抛错(虽然文档没明说,但行为不可预期)
  // - 而且 dialog 等 API 也必须 ready 后才能用
  registerIpcHandlers();

  createWindow();

  // macOS 特性:点击 dock 图标时,如果窗口都关了,重新创建一个
  // 这是 macOS 应用约定俗成的行为,Windows/Linux 不需要
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 关键设计 7:窗口关闭行为 —— 平台差异
// macOS: 关窗口 ≠ 退出应用(应用驻留菜单栏)
// Windows/Linux: 关窗口 = 退出应用
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
