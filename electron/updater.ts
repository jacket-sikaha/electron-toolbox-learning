// electron/updater.ts —— 阶段 6-4:自动更新
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ 这个文件真正在写的不是「怎么检查更新」（那是 electron-updater 的事），        │
// │ 而是「怎么保证更新的每一步都可见、每一次失败都能被追上」。                    │
// │ 这是 Bug-008（日志静默失败）留给我们的账：                                   │
// │ 一个默默失败的后台功能，比一个明确报错的功能危险得多。                        │
// └──────────────────────────────────────────────────────────────────────────┘
//
// 更新链路（一张图记住它）：
//
//   autoUpdater.checkForUpdates()
//        │  ① 读配置：打包后是 resources/app-update.yml，dev 是 dev-app-update.yml
//        │     —— 那里写着「去哪儿问版本」
//        ▼
//   GET <url>/latest.yml            ← 这一步被 HTTPS 保护（传输完整性）
//        │  ② 比对 version：比当前高才继续（除非 allowDowngrade）
//        ▼
//   下载 <url>/<安装包>             ← 边下边算 sha512
//        │  ③ 下完比对 latest.yml 里记的 sha512
//        ▼
//   update-downloaded               ← 此刻包已落盘、已校验
//        │  ④ 安装：Windows 是「运行一个安装器」，macOS 是「系统替换 .app」（要求签名）
//        ▼
//   新版本生效
//
// 注意 ③ 和 ④ 防的不是同一件事：
//   ③ sha512 防「文件在传输/存储中被改坏」
//   ④ 代码签名防「这个包根本不是我发的」
// 只做 ③ 不够 —— 能改 latest.yml 的人，也能顺手改掉里面那个 sha512。

import { app } from "electron";
// ⚠ 注意这个 import 的写法:必须是 `electron-log/main`,不能是 `electron-log`。
// 原因见 electron-log@5.4.4 的 package.json exports:
//   ".": { "browser": "./src/renderer/index.js", "default": "./src/index.js" }
// 而 Vite 默认的 resolve.conditions 里带着 "browser" ——
// 于是 Main 进程的 bundle 会被解析成【渲染进程那份】,那里 log.transports 是 undefined,
// 运行时就炸在 `log.transports.file.level = "info"` 上。
// 这个坑现在由 Bug-009 记录。
import log from "electron-log/main";
import { autoUpdater } from "electron-updater";

let initialized = false;

/**
 * 初始化自动更新。**必须在 app.whenReady() 之后调用。**
 */
export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  // ── 0. 把 electron-updater 自己的日志，接进我们的 logger ──────────────────
  // 不做这一步，它内部发生的一切只会落在它自己的 console 里，
  // 而 Bug-008 的教训是：**没有入口的失败 = 没发生过**。
  autoUpdater.logger = log;

  // ── 1. 显式声明策略，不依赖默认值 ────────────────────────────────────────
  // 下面三个默认值，是去 node_modules/electron-updater/out/AppUpdater.js
  // 里读出来的（不是凭印象）：
  //   :138  this.allowDowngrade        = false
  //   :109  this.autoDownload          = true
  //   :114  this.autoInstallOnAppQuit  = true
  //
  // ⚠ 一个真实存在的坑（同文件 :31-44）：
  //   一旦你把 allowPrerelease 打开，allowDowngrade 会被【自动改成 true】。
  //   想关回去，必须在设置 allowPrerelease【之后】再设一次 allowDowngrade。
  //   —— 这是「默认值会被别的开关悄悄改掉」的典型案例。
  autoUpdater.allowDowngrade = false;

  // 阶段 6-4 的架构决定（来自 Q4）：
  //   工具是常驻托盘的，用户可能正在用它处理文件 → 绝不静默重启。
  //   所以「自动下载」关掉，交给用户点；但「退出时安装」保留（默认行为）——
  //   用户不点也无所谓，下次正常退出就装上了。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── 2. 事件全绑：每个状态都要有日志 ──────────────────────────────────────
  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] checking-for-update —— 开始向更新源要版本清单");
  });
  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] update-available —— 发现新版本 ${info.version}`);
  });
  autoUpdater.on("update-not-available", (info) => {
    log.info(`[updater] update-not-available —— 已是最新（源上版本 ${info.version}）`);
  });
  autoUpdater.on("download-progress", (p) => {
    log.info(
      `[updater] download-progress —— ${p.percent.toFixed(1)}%  ` +
        `${p.transferred}/${p.total} 字节  ${Math.round(p.bytesPerSecond / 1024)} KB/s`,
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info(`[updater] update-downloaded —— ${info.version} 已下载并校验通过，将在退出时安装`);
  });
  // error 事件必须绑：不绑的话它就是一个「没人听的哨声」
  autoUpdater.on("error", (err) => {
    log.error("[updater] error ——", err);
  });

  // ── 3. dev 模式守卫 ──────────────────────────────────────────────────────
  // node_modules/electron-updater/out/AppUpdater.js:278
  //   const isEnabled = this.app.isPackaged || this.forceDevUpdateConfig;
  //
  // 也就是说：**dev 模式下整个更新器默认是关着的**，而且它不会大声告诉你，
  // 只会安静地什么都不做 —— 又是一个「静默失败」现场。
  // 解法：forceDevUpdateConfig = true，让它改读项目根目录的 dev-app-update.yml。
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    log.warn(
      "[updater] 未打包运行：已设 forceDevUpdateConfig = true，" +
        "将读取 dev-app-update.yml 而不是 resources/app-update.yml",
    );
  }

  log.info(
    `[updater] 初始化完成 currentVersion=${autoUpdater.currentVersion?.version ?? "?"} ` +
      `autoDownload=${autoUpdater.autoDownload} ` +
      `autoInstallOnAppQuit=${autoUpdater.autoInstallOnAppQuit} ` +
      `allowDowngrade=${autoUpdater.allowDowngrade}`,
  );
}

/**
 * 「检查更新」的入口：把结论同时送进日志和返回值。
 * 返回一句**给人看**的话，调用方（托盘菜单）负责把它显示出来。
 */
export async function checkForUpdatesNow(): Promise<string> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      // 这条路径在 dev 模式缺配置时会出现 —— 必须说清楚，不能返回 undefined 了事
      return "检查更新没有返回结果（通常是 dev 模式缺少 dev-app-update.yml 或更新源不可达）";
    }
    return `检查完成：更新源上的版本是 ${result.updateInfo.version}（当前 ${app.getVersion()}）`;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    log.error("[updater] 检查更新失败：", e);
    return `检查更新失败：${msg}`;
  }
}
