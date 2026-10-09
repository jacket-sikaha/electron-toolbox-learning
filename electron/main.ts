// electron/main.ts —— Main Process 入口
//
// 这个文件是整个 Electron 应用的「主线程」。
// 它拥有完整 Node.js 能力,负责:创建窗口、管理生命周期、调度系统 API。
// 默认配置下,Renderer(React 页面)碰不到这里的任何东西,
// 必须通过 Preload 暴露的桥才能间接调用(阶段 2 才会用)。

import {
  app,
  BrowserWindow,
  shell,
  dialog,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import os from "node:os";

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

// ============================================================================
// 阶段 3 新增:托盘应用的状态与生命周期
// ============================================================================

// 关键设计 2.1:isQuitting 开关 —— 区分「隐藏」与「真的退出」
//
// 为什么需要它?因为 app.quit() 会触发窗口的 close 事件:
//   点 × → close 触发 → isQuitting=false → preventDefault + hide(只隐藏)
//   点托盘退出 → 先设 isQuitting=true → app.quit() → close 触发 → 不拦(真退出)
// 顺序必须是「先设标记,再调 quit()」。反过来的话,quit() 同步发起退出流程、
// close 立刻触发,此时标记还是 false,退出会被拦掉 —— 表现为「点两次才退得掉」。
let isQuitting = false;

// 关键设计 2.2:窗口和托盘的引用必须持有,否则会被 GC 回收
// 这是 Electron 的经典坑:局部变量创建的 Tray/Window 一旦离开作用域,
// 可能被垃圾回收,表现为「托盘图标莫名其妙消失」。
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// 关键设计 2.3:showWindow —— 统一的「唤起窗口」入口
// 三个地方要用:托盘单击、托盘菜单「显示主窗口」、全局快捷键。
// 抽成一个函数,避免三处各写一遍 hide/show 逻辑(其中一处漏写就会出 Bug)。
function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  // 关键设计 3:窗口安全配置 —— 从第一天就锁死正确姿势
  // nodeIntegration:false      → Renderer 不直接拥有 Node API
  // contextIsolation:true      → Preload 与 Renderer JS 上下文隔离
  // preload:                    → 必填,即使阶段 1 暂时是空的也要引用,
  //                              为阶段 2 扩展文件 IO 留架构位,防止后续
  //                              为了图省事直接开 nodeIntegration
  // sandbox:                    → 阶段 1 先保持默认,阶段 5 性能优化时讲
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  // 阶段 3:把窗口引用存到模块级变量(见关键设计 2.2)
  mainWindow = win;

  // 关键设计 3.1:托盘应用的窗口关闭拦截 —— 阶段 3 核心
  //
  // 拦截点必须是「窗口自己的 close 事件」,不能是 window-all-closed。
  // 因为 window-all-closed 触发时窗口已经销毁了,那时再拦已经来不及。
  //
  // 事件顺序:用户点 × → 【close 事件(此刻还能拦)】→ 窗口销毁 → window-all-closed
  win.on("close", (event) => {
    if (!isQuitting) {
      // 用户只是点 ×,不是真的要退出 → 取消「销毁窗口」的默认行为,改成隐藏
      event.preventDefault();
      win.hide();
    }
    // isQuitting === true 时不拦,让窗口正常销毁,应用才能真正退出
  });

  // 关键设计 3.2:窗口真正销毁时清空引用
  // 防止 mainWindow 指向一个已销毁的窗口(访问它会抛 "Object has been destroyed")
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
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
    win.loadURL("http://localhost:5173");
    // dev 模式自动开 DevTools,方便调试
    win.webContents.openDevTools();
  } else {
    // prod 模式加载本地打包产物
    // 注意路径:dist/index.html 相对项目根目录,但 main.js 在 dist-electron/,
    // 所以用 process.cwd() 拼绝对路径,避免相对路径歧义。
    win.loadFile(join(app.getAppPath(), "dist", "index.html"));
  }

  // 关键设计 5:外部链接用系统浏览器打开,而不是在 Electron 窗口内跳转
  // 这是个常被忽略的安全/UX 细节:如果用户点了 <a href="https://...">,
  // 默认会在 Electron 窗口里打开,导致:① 失去浏览器导航 ② 可能被钓鱼
  win.webContents.setWindowOpenHandler(({ url }) => {
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

  // 关键设计 6.5:阶段 3 系统信息工具 —— 零入参、零风险
  //
  // 为什么系统信息必须走 IPC,不能在 Renderer 直接拿?
  //   - os.cpus() / os.totalmem() / process.versions 都是 Node API,Renderer 没有
  //   - 但这些都是「只读、无参数、无副作用」的调用,是 IPC 里最安全的一类:
  //     没有入参 → 没有攻击面(和阶段 2 的方案 2 同一个思路)
  ipcMain.handle("tool:get-system-info", () => {
    return {
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? "未知",
      cpuCount: os.cpus().length,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      hostname: os.hostname(),
      osVersion: os.release(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      appVersion: app.getVersion(),
      uptime: os.uptime(),
    };
  });

  // 关键设计 6.6:阶段 3 窗口控制 —— 供 Renderer 主动隐藏窗口
  //
  // 托盘应用里,「最小化到托盘」按钮需要让 Main 把窗口藏起来。
  // 注意这里同样零入参:Renderer 只能说「隐藏我自己的窗口」,
  // 不能指定「隐藏哪个窗口」—— 不开这个口子,就少一类攻击面。
  ipcMain.handle("window:hide", () => {
    mainWindow?.hide();
  });
}

// 关键设计 7:托盘(Tray)—— 阶段 3 核心,让应用「常驻」而不是「关了就死」
//
// 托盘是托盘应用的灵魂:窗口可以关掉,但图标一直在系统托盘区,
// 用户随时能点它把窗口唤回来。这意味着「关窗口」不再等于「退出应用」。
function createTray() {
  // 关键设计 7.1:托盘图标 —— 用 nativeImage 从 base64 造一个 1x1 的占位图标
  //
  // 为什么不用一个真实 .png 文件?
  //   - 阶段 3 的重点是生命周期机制,不是图标美术
  //   - 真实图标涉及「打包后资源路径」问题(阶段 6 会专门讲 app.getAppPath / process.resourcesPath)
  //   - 用 nativeImage 内存创建,可以完全绕开路径问题,聚焦生命周期
  //
  // ⚠️ 生产环境绝对要换成真实图标:Windows 任务栏/托盘对 1x1 空图标的渲染
  //    在某些系统上会显示为空白,用户会以为程序崩了。
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mNkYPhfz0AEYBxVSF+FjAxEGkK0QkYGIg0hWiEjA5GGEK2QkYFIQ4hWyMhApCFEK2RkAABBVwEBAQEAAP//AwD/JwEDAAAAAElFTkSuQmCC"
  );

  tray = new Tray(icon);

  // 关键设计 7.2:托盘提示文字(鼠标悬停时显示)
  tray.setToolTip("Electron Toolbox");

  // 关键设计 7.3:托盘菜单 —— 注意「退出」这一项的写法
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => showWindow(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        // ★ 关键:先设 isQuitting = true,再调 app.quit()
        //
        // 顺序不能反。app.quit() 是「同步发起退出流程」,它会立刻触发窗口的
        // close 事件;如果此时 isQuitting 还是 false,close 里的拦截逻辑会把
        // 退出拦下来 —— 表现为「点了退出没反应,再点一次才成功」。
        //
        // Bug-002 教训:顺序反了 + before-quit 里 tray.destroy() 会导致
        // 「窗口没了、托盘没了、进程还在」的僵尸状态。
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  // 关键设计 7.4:单击托盘图标恢复窗口
  //
  // ⚠️ 平台差异:这个事件在 macOS 上是失效的(或者行为不同)。
  //    macOS 的约定是:单击托盘图标弹出菜单,所以那里只能靠菜单项恢复窗口。
  //    这也是为什么上面的菜单里有「显示主窗口」—— 它是跨平台都能用的入口。
  tray.on("click", () => {
    showWindow();
  });
}

// 关键设计 8:app.whenReady() —— 创建窗口的唯一正确时机
// 在 app ready 之前调用 new BrowserWindow() 会抛错:
//   Error: Cannot create BrowserWindow before app is ready
app.whenReady().then(() => {
  // 关键设计 8.1:IPC handler 必须在 app ready 后注册
  // - 在 ready 之前调 ipcMain.handle 会抛错(虽然文档没明说,但行为不可预期)
  // - 而且 dialog 等 API 也必须 ready 后才能用
  registerIpcHandlers();

  createWindow();
  createTray();

  // macOS 特性:点击 dock 图标时,如果窗口都关了,重新创建一个
  // 这是 macOS 应用约定俗成的行为,Windows/Linux 不需要
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      // 阶段 3 补充:macOS 上窗口可能只是被隐藏了,这里要显式恢复
      showWindow();
    }
  });
});

// 关键设计 9:窗口关闭行为 —— 阶段 3 的关键改动
//
// 阶段 1 的写法(已废弃):
//   app.on("window-all-closed", () => {
//     if (process.platform !== "darwin") app.quit();
//   });
// 那是「普通窗口应用」的写法:关掉所有窗口 = 退出应用。
//
// 阶段 3 改成托盘应用后,这个逻辑必须删掉 —— 否则会出问题:
//   用户点 × → close 里 preventDefault + hide → 窗口没销毁 → window-all-closed 不触发
//   (看起来「恰好没事」,但这是脆弱的巧合)
//   真正危险的是:一旦某个窗口被真的销毁(比如 isQuitting 逻辑出错、或调了 destroy()),
//   window-all-closed 就会触发并 app.quit(),把常驻应用整个干掉。
//
// 托盘应用的正确做法:什么都不做,让应用继续活着。
// 用户想退出,统一走托盘菜单的「退出」(那条路径会设 isQuitting 再 quit)。
app.on("window-all-closed", () => {
  // 托盘应用:窗口全关了也【不退出】,应用常驻托盘,等用户从托盘唤回。
  // 只有 macOS 之外也不需要 quit —— 这正是托盘应用与普通窗口应用的分水岭。
  //
  // 保留这个监听器(而不是删掉)是为了留一个明确的「策略声明位置」:
  // 以后如果有人想改成「关窗口即退出」,改这里一处即可,不用到处找。
});

// 关键设计 10:退出前的清理钩子 —— 阶段 3 引入
//
// before-quit 在 app.quit() 发起后、窗口真正关闭前触发。
// 这里做两件事:
//   ① 把 isQuitting 置为 true —— 保证任何路径的退出都不会被 close 拦截
//      (比在托盘菜单里手动设更可靠,因为 quit 还可能来自系统关机、
//       任务管理器结束进程、macOS Cmd+Q 等我们控制不了的入口)
//   ② 释放托盘引用 —— 避免托盘图标在退出过程中残留
app.on("before-quit", () => {
  // 恢复:任何退出路径都设 isQuitting,防止 close 拦截
  isQuitting = true;
  tray?.destroy();
  tray = null;
});
