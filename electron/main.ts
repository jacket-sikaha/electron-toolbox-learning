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
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Worker } from "node:worker_threads";
import os from "node:os";

// 阶段 5:Main 侧 import TOOL_MANIFEST —— 权限声明从「实现细节」变成「可被程序查询的元数据」
import { TOOL_MANIFEST, getToolsUsingPermission } from "../shared/tool-manifest";

// 阶段 6-3:日志 + 崩溃报告
// initMainLogger 内部会调用 crashReporter.start(),必须在 app.whenReady() 之前调用,
// 因为 crashReporter 需要在 Chromium 初始化最早期注册才能捕获 crash。
import { initMainLogger } from "./logger";
// ⚠ 必须写 `electron-log/main`,不能写 `electron-log`:见 Bug-009。
// Vite 默认 resolve.conditions 含 "browser",会把 electron-log 的
// browser 条件(渲染进程那份)解析进 Main 进程的 bundle。
import log from "electron-log/main";

// 阶段 6-4:自动更新
import { checkForUpdatesNow, initAutoUpdater } from "./updater";

// 初始化日志 —— 必须在 app ready 之前(crashReporter.start 早期注册)
initMainLogger();

// 关键设计 1:__dirname 在 CommonJS 环境下可直接用
// electron/main.ts 会被 tsc 编译成 CommonJS 输出到 dist-electron/,
// 所以 __dirname 指向 dist-electron/。
// 但要记住一个常见的 prod Bug:打包后 __dirname 可能指向 asar 内部,
// 需要配合 process.resourcesPath 处理资源路径。阶段 6 会专门讲。

// ============================================================================
// 阶段 6 Bug:dev 模式的 --no-sandbox 在 prod 模式丢失
// ----------------------------------------------------------------------------
// dev 模式下,vite-plugin-electron 通过 ELECTRON_ARGS 把 --no-sandbox
// --disable-gpu-sandbox 作为命令行参数传给 electron.exe。
// 但 prod 模式下用户直接双击 exe,没有 vite-plugin-electron,
// 这两个参数丢失 → Windows 11 25H2 Chromium sandbox 初始化 Bug(electron#52098)
// 触发 → 进程直接崩溃,无 JS 错误输出,只有 exit code 1。
//
// 修复:在 app ready 之前用 commandLine.appendSwitch 注入参数。
// appendSwitch 必须在 app.whenReady() 之前调用,因为 sandbox 初始化
// 发生在 app ready 流程的最早期,晚了就来不及。
// ============================================================================
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");

const isDev = !app.isPackaged;

// ============================================================================
// 阶段 6-3:全局未捕获异常兜底
// ----------------------------------------------------------------------------
// 这是最后一道防线。如果 ipcMain.handle 里没有 try/catch,
// 或者某个异步操作 reject 了但没有 .catch() —— 异常会冒泡到这里。
//
// 为什么不用 process.exit(1)?
//   发生异常时应该记录日志 + 让应用尽量继续运行(或优雅退出)。
//   直接 exit(1) 会让用户毫无感知,也来不及写日志。
//
// crashReporter 和这里的区别:
//   这里捕获的是 JS 异常(有调用栈、有上下文)
//   crashReporter 捕获的是 native crash(C++ 层段错误,JS 层根本看不到)
// ============================================================================
process.on("uncaughtException", (error) => {
  log.error("[main] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  log.error("[main] unhandledRejection:", reason);
});

log.info(`[main] app starting (isDev=${isDev}, v${app.getVersion()})`);

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
// 关键设计 6.2:阶段 5 通道命名改为 tool:{toolId}:{permission}
// - 通道名本身编码了「哪个工具的哪个权限」
// - 没声明权限的工具,对应通道根本不注册 → 攻击者就算知道命名规则也调不到
// - 这就是「标识来自通道本身」:不问「你是谁」(会说谎),看「通道存不存在」(框架说了算)
//
// 关键设计 6.3:零入参 = 零攻击面(你选的方案 2)
// - handler 不读取 event 或 args,因为 Renderer 不传任何东西
// - path 由 Main 内部 dialog 拿到,Renderer 拿不到 path
// - 即使 Renderer 被攻破,攻击者也无法伪造 path

// ── 阶段 5:权限声明审计 ──────────────────────────────────────────────────
//
// auditPermissions() 把 TOOL_MANIFEST 从「静态数据」变成「运行时可见的事实」。
// 它在启动时打印一份「每个工具声明了什么权限」的清单 ——
// 现在 4 个工具都自己写的,permissions 拦不住任何东西(方案 A 的局限);
// 但它让你一眼看到「这个应用到底碰了哪些系统能力」,不用翻 preload.ts 考古。
//
// 阶段 6-7 做真实拦截时,这个函数会变成「校验 + 拒绝」,而不仅是「打印」。
// 现在它存在的价值:把隐式事实变成显式声明 → 声明可被查询 → 可查询 = 可自动化。
function auditPermissions() {
  console.log("[permissions] 工具权限声明审计:");
  for (const entry of TOOL_MANIFEST) {
    const perms = entry.permissions.length > 0
      ? entry.permissions.join(", ")
      : "(无 — 纯前端工具)";
    console.log(`  ${entry.meta.id.padEnd(16)} → ${perms}`);
  }

  // 按权限反查:哪些工具用了某个能力
  console.log("[permissions] 能力 → 工具映射:");
  const allPerms = ["fs:read", "sys:info", "window:hide", "clipboard", "net"] as const;
  for (const p of allPerms) {
    const tools = getToolsUsingPermission(p);
    if (tools.length > 0) {
      console.log(`  ${p.padEnd(14)} → ${tools.join(", ")}`);
    }
  }
}

function registerIpcHandlers() {
  ipcMain.handle("tool:base64:fs:read", async () => {
    log.info("[main] tool:base64:fs:read invoked");
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
      log.info("[main] user canceled file selection");
      return null;
    }

    const filePath = result.filePaths[0];
    log.info(`[main] file selected: ${filePath}`);

    // 3. 关键设计 6.4:即使方案 2 天然安全,Main 仍要做边界防御
    // - 限制文件大小:避免用户选了一个 10GB 文件把 Main 进程 OOM
    // - 这是「纵深防御」的体现:方案 2 防住了路径穿越,
    //   但「文件大小」这个边界仍要在 Main 守
    // 阶段 4 起,小文件走这个 handler(有 10MB 限制),
    // 大文件走下面的 tool:big-base64(Stream + Worker,无大小限制)
    const stats = await stat(filePath);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (stats.size > MAX_FILE_SIZE) {
      log.warn(`[main] file too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      throw new Error(
        `文件过大(${(stats.size / 1024 / 1024).toFixed(2)}MB),这个工具限制 10MB 以内。请改用「大文件 Base64」(Stream + Worker)。`
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

  // ==========================================================================
  // 阶段 4:大文件 Base64 —— Stream + Worker 组合拳
  // ==========================================================================
  //
  // 关键设计 6.7:这个 handler 和上面的 select-and-read-file 有什么本质区别?
  //
  //   阶段 2 的版本(小文件):
  //     fs.readFile 一次性读入内存 → 返回整个 Buffer
  //     内存占用 = O(文件大小),且 Base64 编码在 Renderer 做
  //
  //   阶段 4 的版本(大文件):
  //     Stream 分块读 → 每块丢给 Worker 编码 → 分块累积结果
  //     内存占用 = O(块大小),编码在 Worker 线程做(不占主线程)
  //
  // 关键设计 6.8:进度推送为什么不能用 invoke 的返回值?
  //   invoke 是「一次调用 → 一个返回值」。进度是「一次调用 → 多次更新」。
  //   所以进度必须走 webContents.send(单向推送),返回值只用来给最终结果。
  //   这是 IPC 的第二种模式(阶段 4 新知识)。
  ipcMain.handle("tool:big-base64:fs:read", async (event) => {
    const result = await dialog.showOpenDialog({
      title: "选择大文件(Stream + Worker 处理)",
      properties: ["openFile"],
      filters: [{ name: "所有文件", extensions: ["*"] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const stats = await stat(filePath);
    const name = basename(filePath);
    const totalBytes = stats.size;

    // 关键设计 6.9:块大小必须是 3 的倍数 —— 阶段 4 最硬的技术约束
    //
    // 为什么?Base64 是「3 字节 → 4 字符」。
    //   如果块大小是 3 的倍数,每块单独编码后长度都是 4 的倍数,不含 padding,
    //   直接拼接就是正确结果。
    //   如果块大小不是 3 的倍数,每块末尾会补 padding(=),
    //   拼接后中间的 padding 会把整体结构破坏掉,解码直接失败。
    //
    // 3 * 1024 * 1024 = 3145728 字节,是 3 的倍数(同时也是 1MB 的整数倍)。
    const BLOCK_SIZE = 3 * 1024 * 1024;

    // 关键设计 6.9.1:防御性断言 —— 把 Bug-A 的教训变成代码护栏
    //
    // 这条断言是 Bug-A 注入实验的直接产物(docs/bug-lab.md)。
    // 实验证明:曾有人把 BLOCK_SIZE 随手改成 1MB(1048576,%3=1),
    // 结果每个中间块编码后都带 padding,拼接后 ~29% 处的 '=' 让解码器提前终止,
    // 3.5MB 的文件解码出来只剩 1MB —— 全程不报错,进度条正常,膨胀率正常。
    //
    // 为什么用「运行时断言」而不是「靠注释提醒」?
    //   注释会被忽略,断言不会。任何未来修改 BLOCK_SIZE 的人(包括未来的你,
    //   或者某个 AI 助手)都会在第一次运行时立刻撞上这条断言,而不是
    //   在生产环境收到「用户说文件坏了」的工单。
    //
    // 这就是「把 Bug 转化成护栏」:每修一个隐蔽 Bug,就加一条能防止它复发的断言。
    if (BLOCK_SIZE % 3 !== 0) {
      throw new Error(
        `[致命错误] BLOCK_SIZE 必须是 3 的倍数(当前 ${BLOCK_SIZE},余 ${BLOCK_SIZE % 3})。` +
          `Base64 按 3 字节分组编码,非 3 倍数会导致中间块带 padding,拼接结果静默损坏。` +
          `参考 docs/bug-lab.md 的 Bug-A。`
      );
    }

    // 关键设计 6.10:创建 Worker —— 把 CPU 密集的编码搬离主线程
    //
    // Worker 的文件路径:base64-worker.js 会被编译到 dist-electron/,
    // 而 main.js 也在 dist-electron/,所以用 __dirname 直接拼。
    const workerPath = join(__dirname, "base64-worker.js");
    const worker = new Worker(workerPath);

    // 关键设计 6.11:Worker 通信的「请求-响应配对」机制
    //
    // Worker 的消息是异步返回的,而且顺序不保证。
    // 我们用递增的 taskId 标记每个任务,用 Map 记录「哪些任务还没完成」。
    // 只有收到结果时才知道哪个任务完成了 —— 这是 Worker 编程的标配模式。
    const pending = new Map<
      number,
      (base64: string) => void // resolve 函数
    >();
    let taskId = 0;

    worker.on("message", (msg: { id: number; base64: string }) => {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id); // 收到结果就移除,避免 Map 无限增长
        resolve(msg.base64);
      }
    });

    worker.on("error", (err) => {
      console.error("[main] worker error:", err);
    });

    // 把一块数据交给 Worker 编码,返回 Promise<string>
    //
    // mustAlign:告诉 Worker「这一块是不是中间块」。中间块的长度必须是 3 的倍数,
    // 末块允许任意长度 —— 由主线程判断后传给 Worker,让 Worker 能独立做断言。
    function encodeChunk(chunk: Buffer, mustAlign: boolean): Promise<string> {
      const id = taskId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        // 注意:chunk 通过 structured clone 复制传给 Worker(有拷贝开销)
        worker.postMessage({ id, chunk, mustAlign });
      });
    }

    // 关键设计 6.12:进度推送 —— 节流
    //
    // 为什么要节流?如果每读一块就 send 一次,100MB / 3MB ≈ 34 次,还好。
    // 但如果块更小(比如 64KB),就是 1600 次 IPC —— 会把 IPC 通道打满。
    // 这里用「时间节流」:最多每 100ms 推一次进度。
    let lastProgressAt = 0;
    function sendProgress(processed: number) {
      const now = Date.now();
      if (now - lastProgressAt < 100 && processed < totalBytes) return;
      lastProgressAt = now;
      event.sender.send("base64:progress", {
        processed,
        total: totalBytes,
      });
    }

    // 关键设计 6.13:主流程 —— Stream 分块读 + 逐块交给 Worker
    //
    // 这里用 for await...of 遍历 Stream,每次拿到一个 chunk(大小最多 BLOCK_SIZE)。
    // 因为是 for await,循环会自动「背压(backpressure)」——
    //   读一块 → 等它编码完 → 再读下一块
    // 这样内存里始终只有一块数据 + 它的编码结果,不会堆积。
    const stream = createReadStream(filePath, { highWaterMark: BLOCK_SIZE });
    const parts: string[] = [];
    let processed = 0;

    try {
      for await (const chunk of stream) {
        // chunk 是 Buffer;createReadStream 的 highWaterMark 保证它最多 BLOCK_SIZE,
        // 但不保证「最后一块」也是 3 的倍数 —— 这是正常的,最后一块本来就短。
        // 由于前面的块都是 3 的倍数,「最后一块」单独编码后带 padding 也是正确的
        // (它本来就是整段数据的结尾)。
        //
        // mustAlign:processed + 本块长度 < totalBytes 说明后面还有数据 → 这是中间块,
        // 长度必须是 3 的倍数(由上面的 BLOCK_SIZE 断言保证)。
        const buf = chunk as Buffer;
        const mustAlign = processed + buf.length < totalBytes;
        const base64 = await encodeChunk(buf, mustAlign);
        parts.push(base64);

        processed += buf.length;
        sendProgress(processed);
      }
    } finally {
      // 关键设计 6.14:Worker 必须显式终止,否则它会一直活着
      //
      // 这是阶段 3「资源释放」知识的延续:
      //   Worker 是一个真实的 OS 线程,不 terminate 它就不会退出。
      //   如果每次调用都 new Worker 却从不 terminate,
      //   用户点 10 次工具就泄漏 10 个线程 —— 内存和 CPU 双双上涨。
      //   所以放在 finally 里,保证「无论成功还是抛错」都能清理。
      await worker.terminate();
    }

    // 关键设计 6.15:所有块拼接
    // 因为每块的 base64 都是 4 的倍数长度(3 的倍数输入 → 4 字符/3字节),
    // 直接 join 就是完整正确的 Base64。
    const base64 = parts.join("");

    // 关键设计 6.16:返回结果时带上「统计信息」
    // 让 Renderer 能验证:输出长度是否符合 ×1.37 膨胀率(阶段 2 学过的常识)
    return {
      base64,
      name,
      originalSize: totalBytes,
      base64Size: base64.length,
    };
  });

  // 关键设计 6.5:阶段 3 系统信息工具 —— 零入参、零风险
  //
  // 为什么系统信息必须走 IPC,不能在 Renderer 直接拿?
  //   - os.cpus() / os.totalmem() / process.versions 都是 Node API,Renderer 没有
  //   - 但这些都是「只读、无参数、无副作用」的调用,是 IPC 里最安全的一类:
  //     没有入参 → 没有攻击面(和阶段 2 的方案 2 同一个思路)
  ipcMain.handle("tool:system-info:sys:info", () => {
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
  ipcMain.handle("tool:system-info:window:hide", () => {
    mainWindow?.hide();
  });

  // ==========================================================================
  // 阶段 6-3:crashReporter 实验通道(临时,阶段 6 结束后删除)
  // --------------------------------------------------------------------------
  // process.crash() 故意触发 native crash(C++ 层段错误)。
  // try/catch 抓不到这个,因为进程在 C++ 层就死了。
  // crashReporter 会在进程死亡前写 minidump 到 crashes/ 目录。
  // ==========================================================================
  ipcMain.handle("debug:crash", () => {
    log.info("[main] debug:crash invoked — about to trigger native crash");
    process.crash();
  });

  // ⚠ 这个 handler 有个反直觉之处,是整个日志实验里最值钱的一课:
  //
  //   ipcMain.handle 内部【必然】有一层 try/catch —— 它要把 handler 抛出的错误
  //   接住、再主动 reject 回 Renderer。否则调用方的 Promise 会永远 pending。
  //
  //   所以在 handler 里直接 throw,【不会】产生 uncaughtException:
  //     handler 里 throw  → 被 handle 的 try/catch 接住 → 前端看到 rejected Promise
  //                       → process.on("uncaughtException") 不触发 → 写不进 main.log
  //
  //   要让 throw 变成「真正没人接的异常」,必须让它【晚一点】抛出 ——
  //   晚到 handler 已经返回、handle 的那层 try/catch 已经结束之后。
  //   setImmediate 就是干这个的:把回调排到当前调用栈清空之后再执行。
  //   那时抛出的异常才直达 process 的 uncaughtException。
  //
  //   对照记忆:
  //     handler 里 throw   = 异常发生在「调用栈还没退出」时 → 有人接
  //     setImmediate 里 throw = 异常发生在「调用栈已清空」之后 → 没人接 → uncaughtException
  ipcMain.handle("debug:uncaught", () => {
    log.info(
      "[main] debug:uncaught invoked — throw 将在 setImmediate 里抛出(跳出 handle 的 try/catch)",
    );
    setImmediate(() => {
      throw new Error("故意抛出的未捕获异常(debug:uncaught)");
    });
    return "已排入 setImmediate,请查看 main.log 里的 uncaughtException 那一行";
  });

  // ==========================================================================
  // 阶段 6-3:接收 Renderer 转发来的日志(Bug-006 修复后新增)
  // --------------------------------------------------------------------------
  // Preload 不能 import electron-log —— 见 electron/preload.ts 文件头 Bug-006:
  // sandboxed preload 的 require 白名单只有 electron/events/timers/url,
  // 而 electron-log 顶层会 require("path") → 整个 preload 加载失败。
  //
  // 所以 Renderer 侧日志走 ipcRenderer.send("log:write", {...}) 送到这里,
  // 由 Main 统一用 electron-log 写进日志文件。
  //
  // 为什么用 on 而不是 handle?
  //   这是单向通知,发送方不需要回执。用 handle 会让 Renderer 侧返回一个
  //   永远不 resolve 也没人 await 的 Promise,徒增噪音。
  //
  // ⚠ 纪律:Renderer 是【不可信边界】,入参必须校验
  //   level 若不在白名单里,直接 log[level] 会得到 undefined 进而 TypeError。
  //   校验后一律归一到 info,既安全又不会丢日志。
  // ==========================================================================
  ipcMain.on("log:write", (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { message?: unknown }).message !== "string"
    ) {
      // 非法载荷:丢弃,但留一条痕迹(便于排错「日志怎么少了」)
      log.warn("[main] log:write received malformed payload, dropped");
      return;
    }

    const { level, message } = payload as { level?: unknown; message: string };
    const safeLevel: "info" | "warn" | "error" | "debug" =
      level === "warn" || level === "error" || level === "debug"
        ? level
        : "info";

    log[safeLevel](`[renderer] ${message}`);
  });

  // 阶段 5:启动时审计权限声明 —— 把隐式事实变成显式输出
  auditPermissions();
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
    {
      // 阶段 6-4:自动更新的手动入口
      //
      // 为什么放托盘菜单,而不是主窗口里加个按钮?
      //   更新是「应用级」行为,不属于任何工具。阶段 5 的权限模型是围绕工具设计的,
      //   而更新不属于任何工具 —— 它属于应用本身,所以入口在应用层(Main 的托盘)。
      //   附带好处:整条更新逻辑不需要新增 IPC 通道,也就没有新的攻击面。
      label: "检查更新",
      click: async () => {
        const msg = await checkForUpdatesNow();
        // 非模态反馈:托盘应用不该弹模态框抢焦点(用户可能正在用别的软件)。
        // 这里先用 tooltip 让结果可感知;真实产品会同时发系统通知。
        log.info(`[main] 检查更新结果:${msg}`);
        tray?.setToolTip(`Electron Toolbox — ${msg}`);
      },
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

  // 阶段 6-4:自动更新必须在 app ready 之后初始化
  // 它要读 app.getVersion()、app.isPackaged 等,ready 之前不保证可用。
  initAutoUpdater();

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
