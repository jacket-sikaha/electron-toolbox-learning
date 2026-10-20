// electron/logger.ts —— 日志初始化模块
//
// 阶段 6-3:日志 + 崩溃报告
//
// 核心设计:
// 1. Main 进程的日志写到「一个确认可写的目录」下的 main.log
// 2. Renderer 进程的日志通过 IPC 转发到 Main,写进同一个文件(带 [renderer] 前缀)
//
//    ★ 为什么不是「让 Renderer 直接用 electron-log」?见 electron/preload.ts
//      头部的 Bug-006:sandboxed preload 的 require 白名单只有
//      electron/events/timers/url,而 electron-log 顶层就要 require("path")
//      → 整个 preload 加载失败,window.electronAPI 变成 undefined。
//      正确做法是 Preload 用 ipcRenderer.send("log:write") 把日志寄给 Main,
//      由 Main 落盘(handler 见 main.ts 的 ipcMain.on("log:write"))。
//
// 3. crashReporter 捕获 native crash,写到 app.getPath('crashDumps')
//
// ─────────────────────────────────────────────────────────────────────────
// 【Bug-008 的教训 —— 这个模块存在的真正理由】
// ─────────────────────────────────────────────────────────────────────────
// 最初的版本是这么写的:直接让 electron-log 用默认路径(userData/logs/main.log),
// 然后 log.info(`log file: ${getFile().path}`) 打出来给人看。
//
// 结果:文件从头到尾没有出现,而且 —— 关键在这里 —— **一句话都不报**。
// 排查结论(三轮探针 + ACL 取证):
//
//   1. 代码没问题:路径解析对、level 配置生效、消息确实走到了 file transport。
//   2. 失败发生在系统调用那一层:fs.writeFileSync 写 userData/logs/main.log
//      被拒绝,错误码 EPERM —— 因为运行环境对 %APPDATA% 只给读权限
//      (工作区可写、用户目录只读)。
//   3. electron-log 5.x 的 File.writeLine 在 catch 里只做一件事:
//          this.emit("error", new Error(`Couldn't write to ${this.path}. ...`))
//      这个 error 事件没有任何有效的消费者 → 没有文件、没有终端报错、不抛异常。
//      = 写日志失败,而日志系统本身不告诉你。
//
// 所以这个模块现在的设计原则只有一条:**允许写不进去,但不允许不吭声。**
//   ① 落盘前先做「可写性预检」(真的建目录、真的写一个探针文件、真的读回来、再删掉)
//   ② userData 不可写就沿回退链找一个能写的目录(temp → 工作区)
//   ③ 一旦发生回退或彻底写不进去,用 console.error 大声报告(不走 electron-log,避免自我循环)
//   ④ 第一行日志写完后,回过头检查文件是否真的存在 —— 不信任「应该写成功了」
//
// 通用教训(比 bug 本身值钱):
//   引入任何「日志 / 持久化 / 上传」类第三方库时,先问一句:
//   **它失败了,会不会告诉我?** 一个把失败咽下去的库,能把人的排查方向带偏几小时。
// ─────────────────────────────────────────────────────────────────────────

// ⚠ 必须写 `electron-log/main`,不能写 `electron-log`:见 Bug-009。
// electron-log@5.4.4 的 exports 里 "." 同时有 "browser" 和 "default" 两个条件,
// Vite 默认 resolve.conditions 含 "browser" → Main 的 bundle 拿到渲染进程那份,
// log.transports 为 undefined → initMainLogger 第一行就抛 TypeError。
import log from "electron-log/main";
import { crashReporter } from "electron";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

let initialized = false;
let fileErrorSinkInstalled = false;

/** 日志目录的来源,用于在回退时知道该报什么。 */
type LogDirSource = "userData" | "temp" | "workspace" | "none";

interface LogDirChoice {
  dir: string;
  source: LogDirSource;
}

/**
 * 初始化 Main 进程日志。
 * 必须在 app.whenReady() 之前调用,因为 crashReporter.start()
 * 要在 app ready 流程最早期注册才能捕获到早期 crash。
 */
export function initMainLogger(): void {
  if (initialized) return;
  initialized = true;

  // ---- 第 1 步:先决定「写到哪里」,而不是假设 userData 一定可写 ----
  const choice = pickLogDir();

  // ---- 第 2 步:配置 transports ----
  log.transports.file.level = "info"; // 写到文件的最低级别
  log.transports.console.level = isDevSafe() ? "debug" : "info"; // dev 多看 debug
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB 轮转
  // 格式: [2026-01-15 10:30:00.000] [info] [main] > 消息
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

  // ★ 显式指定路径。
  //   不要依赖 electron-log 的隐式解析链(它内部会调 app.getPath('logs') /
  //   getPath('userData') 并各自 try/catch 兜底,失败时降级成一条静默路径)。
  //   路径这种事,自己算清楚、自己验证过,才算数。
  let logFilePath = "";
  if (choice.source === "none") {
    // 一条路都走不通:关掉文件传输,只留控制台 —— 但必须吼出来
    log.transports.file.level = false;
    shout(
      "没有任何可写的日志目录,文件日志已关闭(仅控制台输出)。",
      "尝试过的目录见上方 warn 输出;这通常意味着运行环境对用户目录和工作区都限制写入。",
    );
  } else {
    logFilePath = join(choice.dir, "main.log");
    log.transports.file.resolvePathFn = () => logFilePath;
  }

  // ---- 第 3 步:崩溃报告 ----
  // crashReporter 使用 Chromium 的 Crashpad,捕获 native crash(C++ 层段错误等)
  // try/catch 抓不到这些,因为进程已经死了。
  // start() 必须在 app ready 之前调用。
  //
  // ★ Bug-007 的根治:「日志说得出崩溃目录」和「崩溃真写进那个目录」是两件事。
  //   日志目录回退了,崩溃目录必须跟着回退 —— 否则又变回「路径是真的,文件永远不在」。
  //   注意顺序:setPath('crashDumps') 必须在 crashReporter.start() 之前,
  //   一旦 start() 完成,Crashpad 就已经把落盘路径固定了。
  if (choice.source !== "none" && choice.source !== "userData") {
    repointCrashDumps(join(choice.dir, "crashes"));
  }

  crashReporter.start({
    uploadToServer: false, // 学习阶段不上传,只存本地
    compress: true,
  });

  // ---- 第 4 步:自报家门 ----
  // ⚠ 这里有个反直觉的点:log.info() 返回不代表写成功。
  //   所以下面打完日志之后,还要回头验证文件是否真的存在。
  if (choice.source !== "none") {
    if (choice.source !== "userData") {
      // 走回退链不是错误,但必须让人知道 —— 否则「日志去哪了」又会变成一次考古
      shout(
        `userData 日志目录不可写,已自动回退到 ${choice.source}: ${choice.dir}`,
      );
    }
    log.info("[main] logger initialized");
    log.info(`[main] log file: ${logFilePath}`);
    log.info(`[main] log dir source: ${choice.source}`);
  } else {
    log.info("[main] logger initialized (仅控制台,文件日志已关闭)");
  }
  // ★ 崩溃目录用 Electron 的真实 API,不再手写拼接。
  //   Bug-007:旧代码写的是 join(userData, "crashes") —— 一个从来不会有人往里写文件的假路径。
  //
  // ⚠ 但「API 返回的目录」和「人该去哪个目录找文件」不是同一个目录:
  //   app.getPath('crashDumps') 给的是 Crashpad 那个独立进程的 **数据库根**
  //   (它需要 database + attachments/ + reports/ + settings.dat 一整套工作区),
  //   而 minidump 本体按 Crashpad 自己的约定落在 <数据库根>\reports\ 下。
  //   这是实测出来的:process.crash() 后约 2 秒,reports\ 里出现 32.88 MB 的 .dmp,
  //   写它的是独立的 crashpad-handler 进程(主进程那时早就死了)。
  //
  //   所以两行都打、各自带标签:
  //     - 数据库根  = 事实来源(直接来自 Electron API)
  //     - reports\ = 人真正要去的目录(一步到位,不必懂 Crashpad 的内部约定)
  //   判据:这一行日志的唯一用途,是让人出事后【一步找到 .dmp 文件】。
  //   代价是多一行日志;换来的是「不需要任何背景知识就能找到文件」。
  const crashDbDir = crashDumpsPath();
  log.info(`[main] crash dir (Crashpad 数据库根): ${crashDbDir}`);
  log.info(`[main] crash dumps (minidump 实际落盘处): ${crashDumpsReportDir()}`);

  // ---- 第 5 步:给文件传输装一个「错误出口」 ----
  // 默认情况下 electron-log 写盘失败是静默的(见文件头 Bug-008),
  // 这个 listener 就是那个缺失的消费者。
  installFileErrorSink();

  // ---- 第 6 步:不相信「应该写成功了」,回头验证 ----
  if (logFilePath && !existsSync(logFilePath)) {
    shout(
      `文件日志声称写到 ${logFilePath},但该文件不存在。`,
      "写盘失败且错误被吞掉了 —— 说明回退链选中的目录在真正写入时仍然失败。",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 可写性预检 + 回退链
// ─────────────────────────────────────────────────────────────────────────

/**
 * 按优先级挑一个「确认可写」的日志目录。
 * 顺序:userData/logs → temp/logs → (dev) 工作区/logs
 *
 * 注意这里的「确认」不是 existsSync 那种「目录存在就算数」,
 * 而是真的建目录、真的写一个探针文件、真的读回来比对、再删掉。
 * 为什么必须写+读+删这一整套?
 *   - 只判断目录是否存在 → 无法发现 ACL 只读
 *   - 只写不读回 → 某些虚拟文件系统/重定向层会「写成功」但内容不在那里
 *   - 写完不删 → 每次启动都留垃圾
 */
function pickLogDir(): LogDirChoice {
  const candidates: LogDirChoice[] = [];

  const userData = appPathSafe("userData");
  if (userData) candidates.push({ dir: join(userData, "logs"), source: "userData" });

  const temp = appPathSafe("temp");
  if (temp) candidates.push({ dir: join(temp, "electron-toolbox", "logs"), source: "temp" });

  // 工作区兜底只在 dev 下有意义:prod 的 cwd 是安装目录(只读),
  // 而且用户也不会去那里找日志。
  if (isDevSafe()) {
    candidates.push({ dir: join(process.cwd(), "logs"), source: "workspace" });
  }

  for (const candidate of candidates) {
    if (isDirWritable(candidate.dir)) return candidate;
    console.warn(`[logger] 日志目录不可写,跳过: ${candidate.dir} (${candidate.source})`);
  }

  return { dir: "", source: "none" };
}

/** 真的建目录 → 真的写 → 真的读回来 → 再删掉。全过才叫可写。 */
function isDirWritable(dir: string): boolean {
  const probeFile = join(dir, `.write-probe-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probeFile, "electron-toolbox write probe", "utf8");
    const readBack = readFileSync(probeFile, "utf8");
    unlinkSync(probeFile);
    return readBack === "electron-toolbox write probe";
  } catch {
    // 收尾失败不要掩盖真正的结论
    try {
      if (existsSync(probeFile)) unlinkSync(probeFile);
    } catch {
      /* ignore */
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 失败必须可见
// ─────────────────────────────────────────────────────────────────────────

/**
 * 给 electron-log 的文件传输装上错误消费者。
 * 不加这个,写盘失败就是一个 emit("error") 之后无人理会的黑洞。
 */
function installFileErrorSink(): void {
  if (fileErrorSinkInstalled) return;
  fileErrorSinkInstalled = true;

  try {
    const file = log.transports.file.getFile() as unknown as {
      on?: (event: string, listener: (err: unknown) => void) => unknown;
    };
    file.on?.("error", (err) => {
      // 用 console 而不是 log —— 日志系统自己出问题时,不能再让它自己报
      console.error("[logger] 文件日志写入失败(electron-log 默认会静默吞掉):", err);
    });
  } catch (e) {
    console.error("[logger] 无法挂载文件传输的错误监听器:", e);
  }

  // electron-log 还有一条内部错误出口(electron-log.transports.file: <message>)。
  // 基类的实现是空函数,这里明确接管,避免它再次把错误吃掉。
  try {
    (log as unknown as { processInternalErrorFn?: (e: unknown) => void }).processInternalErrorFn =
      (e) => {
        console.error("[logger] electron-log 内部错误:", e);
      };
  } catch {
    /* 不同版本接口可能不同,不致命 */
  }
}

/**
 * 大声报告。刻意不走 electron-log —— 因为「日志系统自己坏了」这件事,
 * 恰恰不能被这个坏掉的日志系统承载,否则又是一次静默。
 */
function shout(reason: string, detail?: string): void {
  console.error(`\n[logger] ⚠ ${reason}`);
  if (detail) console.error(`[logger] ⚠ ${detail}`);
  console.error("");
}

// ---- 安全获取 app 路径(避免在 app ready 前调用报错)----

function appPathSafe(name: string): string | undefined {
  try {
    const { app } = require("electron");
    return app.getPath(name) as string;
  } catch {
    return undefined;
  }
}

function isDevSafe(): boolean {
  try {
    // 动态引入 app,避免在 Preload 环境(没有 app)中报错
    const { app } = require("electron");
    return !app.isPackaged;
  } catch {
    return false;
  }
}

/**
 * Crashpad 的**数据库根目录**。
 *
 * Bug-007 修复:旧代码手写 join(userData, "crashes") 是**假路径**,
 * 真实来源是 app.getPath('crashDumps')。
 *
 * ⚠ 注意别再犯第二次「写一条没验证过的关于系统行为的事实」:
 *   这个返回值**不是** minidump 所在目录(我一开始就是这样误以为的),
 *   而是 Crashpad 那个独立进程的工作目录。dump 在它的 reports/ 子目录里。
 *   实测:Electron 31 / Windows 上它返回 <userData>\Crashpad,
 *   并在其中建出 attachments/ 与 reports/,minidump 落在 reports/。
 */
function crashDumpsPath(): string {
  return appPathSafe("crashDumps") ?? "unknown(crashDumps 不可用)";
}

/**
 * minidump 实际落盘处 = <crashDumps>\reports\。
 *
 * 为什么要单独提供这一个路径?
 *   因为「API 给的路径」和「人该去哪个目录找文件」是两件事。
 *   日志的用途是让人出事后一步找到文件,而不是逼他去懂 Crashpad 的目录约定。
 */
function crashDumpsReportDir(): string {
  const db = appPathSafe("crashDumps");
  return db ? join(db, "reports") : "unknown(crashDumps 不可用)";
}

/**
 * 把崩溃转储目录重定向到一个确认可写的路径。
 * 必须在 crashReporter.start() 之前调用 —— start() 之后 Crashpad 已经固定了路径。
 */
function repointCrashDumps(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    const { app } = require("electron");
    app.setPath("crashDumps", dir);
  } catch (e) {
    shout(`无法把崩溃目录改到 ${dir}:`, (e as Error)?.message);
  }
}
