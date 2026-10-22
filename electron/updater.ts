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
//
// ════════════════════════════════════════════════════════════════════════════
// 状态机（阶段 6-4 第二阶段新增）
// ════════════════════════════════════════════════════════════════════════════
//
//   idle ──检查──→ checking ──有新版──→ available ──用户点下载──→ downloading
//                    │                                              │
//                    └──没新版──→ idle                              ├─成功→ ready ──用户点安装──→ 退出重启
//                                                                   └─失败→ error
//   任意环节出错 → error（带原因，不是静默）
//
// 状态存在的意义：菜单项能不能点、显示什么文字，全部由状态**推导**出来。
// 「不可用的时候给一个灰掉的项」比「点了没反应」清楚得多。
//
// Q4 的结论落在这里：autoDownload = false（下载必须用户发起）、
// autoInstallOnAppQuit = true（用户不点就下次退出时装）—— 正在用工具的人不会被强行重启。
// ════════════════════════════════════════════════════════════════════════════

import { app, Notification } from "electron";
// ⚠ 注意这个 import 的写法:必须是 `electron-log/main`,不能是 `electron-log`。
// 原因见 electron-log@5.4.4 的 package.json exports:
//   ".": { "browser": "./src/renderer/index.js", "default": "./src/index.js" }
// 而 Vite 默认的 resolve.conditions 里带着 "browser" ——
// 于是 Main 进程的 bundle 会被解析成【渲染进程那份】,那里 log.transports 是 undefined,
// 运行时就炸在 `log.transports.file.level = "info"` 上。
// 这个坑现在由 Bug-009 记录。
import log from "electron-log/main";

import { join } from "node:path";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

export type UpdateState =
  | "idle" // 空闲 / 已是最新
  | "checking" // 正在检查
  | "available" // 有新版本,等用户决定
  | "downloading" // 正在下载
  | "ready" // 已下载完成,等用户重启
  | "error";

interface UpdateSnapshot {
  state: UpdateState;
  /** 给用户看的文字(托盘里直接显示) */
  message: string;
  /** 可用的新版本号,没有就是空串 */
  version: string;
}

let state: UpdateState = "idle";
let message = "尚未检查更新";
let availableVersion = "";
let initialized = false;
/** 上次因为下载进度而重建菜单的百分比(避免每秒建几十次菜单) */
let lastProgressPercent = -1;

const listeners = new Set<() => void>();

const STATE_LABEL: Record<UpdateState, string> = {
  idle: "空闲",
  checking: "检查中",
  available: "有新版本",
  downloading: "下载中",
  ready: "待安装",
  error: "出错",
};

export function getUpdateState(): UpdateSnapshot {
  return { state, message, version: availableVersion };
}

/**
 * 订阅状态变化(托盘菜单靠它重建)。
 * 返回取消订阅函数 —— 和 Preload 的 onXxx 保持同一个约定。
 */
export function onUpdateStateChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 只通知订阅者重建 UI,不发系统通知 */
function notifyListeners(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch (e) {
      log.error("[updater] 状态订阅者抛错:", e);
    }
  }
}

/**
 * 发一条系统通知(非模态)。
 *
 * 为什么用通知而不是 dialog?
 *   托盘应用常驻后台,用户可能正在用别的软件处理文件。
 *   模态框会抢焦点、打断输入 —— 那是**侵入**。
 *   系统通知是「我告诉你了,你什么时候处理随你」。
 *
 * ⚠ Windows 上 Notification 依赖 AppUserModelID,见 main.ts 的
 *   app.setAppUserModelId(...),值必须与 package.json 的 build.appId 一致。
 */
function notify(title: string, body: string): void {
  if (!app.isReady()) return;
  if (!Notification.isSupported()) {
    log.warn("[updater] 当前系统不支持通知,只能写日志");
    return;
  }
  try {
    new Notification({ title, body }).show();
    // 成功也要留一行。否则「通知到底弹没弹」在日志里永远是空白,
    // 出问题时只能靠用户回忆「我好像没看见」—— 那不是证据。
    log.info(`[updater] 已发系统通知:${title} — ${body}`);
  } catch (e) {
    log.error("[updater] 系统通知发送失败:", e);
  }
}

function setState(
  next: UpdateState,
  msg: string,
  opts: { notify?: boolean } = {},
): void {
  state = next;
  message = msg;
  log.info(`[updater] 状态 ${STATE_LABEL[next]}:${msg}`);
  if (opts.notify) notify("Electron Toolbox", msg);
  notifyListeners();
}

// ════════════════════════════════════════════════════════════════════════════
// 「装完的痕迹」—— 让更新在事后可追溯
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么需要这个东西?
//
//   实测发现同一个「安装」动作,两条入口的 UX 完全不同:
//
//     点「重启并安装」→ autoUpdater.quitAndInstall(false, true)
//                       → 日志 Install: isSilent: false, isForceRunAfter: true
//                       → 用户看得见安装界面,装完新版本自动被拉起
//
//     退出应用时自动装 → electron-updater 内部 install(true, false)
//                       → 日志 Install: isSilent: true, isForceRunAfter: false
//                       → 用户什么都看不见,装完也不会自动打开
//
//   第二条正是 autoInstallOnAppQuit = true 的效果。它对「常驻托盘工具」是合理的
//   (不打断正在用的人),代价是:用户退出后完全不知道发生了什么。
//
//   electron-updater 官方给的线索是启动参数 `--updated` —— 但它只在
//   isForceRunAfter = true 时才会传给新进程。而我们的静默路径恰恰是 false,
//   所以 `--updated` 永远不会出现。**库的痕迹机制依赖了一个我们已经关掉的行为。**
//
//   于是自己补一条:进 ready(意味着「下次退出一定会装」)时落一个标记文件,
//   下次启动读它,并且用真实版本号核对「到底装上了没有」。
//   版本对上了 → 告知用户「已更新到 X」;对不上 → 记一条 warn,说明那次没成。
//
//   标记写在 userData 里而不是安装目录:安装器会替换应用目录,但 userData 活得比它久。
// ════════════════════════════════════════════════════════════════════════════

interface PendingInstallMarker {
  from: string;
  to: string;
  stagedAt: string;
}

function markerPath(): string {
  return join(app.getPath("userData"), "update-applied.json");
}

function markInstallPending(to: string): void {
  const file = markerPath();
  const body: PendingInstallMarker = {
    from: app.getVersion(),
    to,
    stagedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(file, JSON.stringify(body), "utf8");
    log.info(`[updater] 已落盘「退出时将安装 ${to}」的痕迹 → ${file}`);
  } catch (e) {
    // 写不进去不是致命错,但必须说出来 —— 否则下次启动就无法确认更新是否发生过
    log.error("[updater] 写「安装痕迹」失败,下次启动将无法确认: ", e);
  }
}

/**
 * 作废「已计划安装」的痕迹 —— 用户明确说了这次不装。
 *
 * 为什么要单独一个函数,而不是交给 consumeUpdateAppliedNotice() 自己判断:
 *   这两件事的语义相反 —— consume 是「核对计划有没有兑现」,cancel 是「计划被撤销了」。
 *   如果取消时不作废痕迹,下次启动就会把「用户主动放弃」误报成「装失败了」。
 *   Bug-008 的教训是「失败不能静默」,它的反面同样成立:
 *   **主动放弃也不该被误报成失败** —— 误报多了,真正的失败就被淹没了。
 */
export function cancelInstallPending(reason: string): void {
  try {
    rmSync(markerPath(), { force: true });
    log.info(`[updater] 作废「计划安装」的痕迹(${reason})`);
  } catch (e) {
    log.warn("[updater] 作废「安装痕迹」失败,下次启动可能误报: ", e);
  }
}

/**
 * 启动时调用一次:如果上次退出前落过痕迹、且当前版本确实变了,返回更新信息。
 * 无论成功与否都会把痕迹文件删掉 —— 它是一次性的,留着只会让下次误判。
 */
export function consumeUpdateAppliedNotice(): {
  from: string;
  to: string;
} | null {
  const file = markerPath();
  if (!existsSync(file)) return null;

  // ── 读痕迹(Bug-014:带 BOM 就解析不了)─────────────────────────────────
  //
  // 我们自己是 writeFileSync(utf8) 写的,不带 BOM。但这个文件躺在用户目录里,
  // 它会被很多东西碰过:编辑器保存(很多 Windows 编辑器默认加 BOM)、
  // 安全软件的扫描临时文件、非原子写入留下的半截内容……
  // 而 JSON.parse 遇到开头的 U+FEFF 会直接抛 SyntaxError —— 实测踩过一次:
  // 痕迹被当成「读不懂」丢弃,用户本该收到的「已更新到 X」就静默消失了。
  // 所以:先剥 BOM,再解析;解析失败也不直接删,而是改名留证。
  let marker: PendingInstallMarker | null = null;
  let parsed = false;
  try {
    let raw = readFileSync(file, "utf8").trim();
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1).trim();
    marker = JSON.parse(raw) as PendingInstallMarker;
    parsed = true;
  } catch (e) {
    log.error("[updater] 「安装痕迹」读不出来: ", e);
  }

  try {
    if (parsed) {
      rmSync(file, { force: true });
    } else {
      // 读不懂 ≠ 没发生。留一份坏文件,事后才有得查;
      // 直接删掉等于把唯一的现场也一起丢了。
      const bad = `${file}.bad-${Date.now()}`;
      renameSync(file, bad);
      log.warn(`[updater] 痕迹文件内容无法解析,已改名保留以便排查 → ${bad}`);
    }
  } catch (e) {
    log.warn("[updater] 清理「安装痕迹」失败: ", e);
  }

  if (!marker?.to || !marker.from) return null;

  const current = app.getVersion();
  if (current !== marker.to) {
    // 走到这里只剩一种可能:安装真的没生效。
    // 「用户主动选择这次不装」不会到这里 —— 那条路径会先把痕迹作废(见 cancelInstallPending)。
    log.warn(
      `[updater] 上次退出前计划安装 ${marker.from} → ${marker.to},` +
        `但这次启动的仍是 ${current} —— 那次安装没生效` +
        `(安装器报错、被杀、或用户在安装器界面里点了取消)`,
    );
    return null;
  }

  log.info(`[updater] 确认更新已生效:${marker.from} → ${marker.to}`);
  return { from: marker.from, to: marker.to };
}

/**
 * Q4 的 C 项:更新装完之后、下次启动的那一刻,主动告诉用户「你现在是新版了」。
 *
 * 这是四个告知点里最便宜的一个,也是最不该省的一个:
 * 用户可能根本没走「退出前先问」那条路(关机、任务管理器结束进程、蓝屏重启),
 * 安装照样会在退出时发生。少了这一步,他只能靠自己记住版本号才发现变了。
 */
export function notifyUpdateAppliedIfAny(): void {
  const applied = consumeUpdateAppliedNotice();
  if (!applied) return;
  notify(
    "Electron Toolbox",
    `已更新到 ${applied.to}(原 ${applied.from});托盘菜单可查看当前版本`,
  );
}

export function initAutoUpdater(): void {
  if (initialized) return;
  initialized = true;

  autoUpdater.logger = log;

  // ★ Q4 的结论,三个开关一句话:
  //   autoDownload = false          → 下不下载由用户决定(几十 MB 不是小数目)
  //   autoInstallOnAppQuit = true   → 用户不点「立即重启」,就在下次退出时静默装上
  //   allowDowngrade = false        → 不允许「降级」,防止更新源被指向旧版本
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  // 我们用的是 NSIS 安装器,不是 web installer(网页版安装器,先在浏览器里下再启动)。
  // 不显式关掉它,electron-updater 每次下载都会警告一句:
  //   NsisUpdater.js:45  this._logger.warn("disableWebInstaller is set to false, you should set it to true ...")
  // 而 AppUpdater.js:147 里它的默认值就是 false,官方也说明了「将来的版本会改成 true」。
  // 既然我们确定不用,就现在关掉 —— 免得将来默认值一变,行为在我们没动代码的情况下改变。
  autoUpdater.disableWebInstaller = true;

  // dev 环境没有 app-update.yml(那是打包产物),必须自己指定更新源
  if (!app.isPackaged) {
    // ⚠ 这两行缺一不可,而且缺了都【不会抛错】:
    //
    //   setFeedURL()          —— 告诉它「去哪儿问版本」
    //   forceDevUpdateConfig  —— 允许它在「未打包」状态下**真的去问**
    //
    // 第二行是关键。electron-updater 内部有一道闸门 isUpdaterActive():
    //
    //   if (!this.app.isPackaged && !this.forceDevUpdateConfig) {
    //     log.info("Skip checkForUpdates because application is not packed
    //               and dev update config is not forced");
    //     return false;      // → checkForUpdates() 直接 resolve(null)
    //   }
    //
    // 也就是说:**库决定「我不干活」时,既不抛错、也不返回错误,
    // 只往日志写一行**。界面上看到的就是「点了没反应」——
    // 这和 Bug-008(electron-log 写盘失败被静默吞掉)是同一个形状。
    //
    // 所以除了把开关打开,checkForUpdatesNow() 里还把「返回 null」
    // 当成一次需要上报的失败,让这种静默拒绝不可能再悄悄发生。
    const feedUrl = "http://127.0.0.1:8080/updates/";
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    autoUpdater.forceDevUpdateConfig = true;
    log.info(`[updater] dev 模式:更新源 ${feedUrl},forceDevUpdateConfig=true`);
  }

  // ── 事件 → 状态机 ──────────────────────────────────────────────────
  autoUpdater.on("checking-for-update", () => {
    setState("checking", "正在检查更新…");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    availableVersion = info.version;
    setState(
      "available",
      `发现新版本 ${info.version}(当前 ${app.getVersion()}),可在托盘菜单下载`,
      { notify: true },
    );
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    availableVersion = "";
    setState("idle", `已是最新版本 ${info?.version ?? app.getVersion()}`);
  });

  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    // 进度事件一秒可能来几十次:只更新文字,每 10% 一个台阶才重建菜单
    message = `下载中 ${Math.floor(p.percent)}%(${(
      p.transferred /
      1048576
    ).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB)`;
    log.info(`[updater] ${message}`);

    const percent = Math.floor(p.percent);
    if (percent >= lastProgressPercent + 10) {
      lastProgressPercent = percent;
      notifyListeners();
    }
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    // 落「我要装了」的痕迹:此刻起,无论用户点「重启并安装」还是直接退出,
    // 安装都会发生 —— 所以从现在开始就要为「下次启动能说清发生了什么」留下证据。
    markInstallPending(info.version);
    setState(
      "ready",
      `${info.version} 已下载完成:点「重启并安装」立即生效,或退出本应用时自动安装`,
      { notify: true },
    );
  });

  autoUpdater.on("error", (err: Error) => {
    setState("error", `更新失败:${err?.message ?? String(err)}`, {
      notify: true,
    });
  });

  setState("idle", `就绪(当前 ${app.getVersion()})`);

  log.info(
    `[updater] 初始化完成 currentVersion=${app.getVersion()} ` +
      `autoDownload=${autoUpdater.autoDownload} ` +
      `autoInstallOnAppQuit=${autoUpdater.autoInstallOnAppQuit} ` +
      `allowDowngrade=${autoUpdater.allowDowngrade} ` +
      `isPackaged=${app.isPackaged}`,
  );
}

/**
 * 手动检查更新。
 * 返回一句人话,方便调用方直接显示(菜单 / 日志)。
 */
export async function checkForUpdatesNow(): Promise<string> {
  try {
    const result = await autoUpdater.checkForUpdates();

    // ★ 返回 null = 库自己决定「这次不检查」,而它【不会抛错】。
    //   触发条件(都只写进日志):
    //     - 未打包 且 没开 forceDevUpdateConfig
    //     - 已有一次检查正在进行中
    //   这就是「点了没反应」的来源:Promise 正常 resolve,状态机没被推动,
    //   界面上什么都不变。必须把它当失败上报 —— 不允许静默拒绝(Bug-008 同形)。
    if (result === null) {
      const reason = app.isPackaged
        ? "库拒绝执行(可能已有检查正在进行),详见日志"
        : "dev 下被跳过:未打包且未开 forceDevUpdateConfig(日志里是 Skip checkForUpdates …)";
      setState("error", `检查没有执行:${reason}`, { notify: true });
      return `检查没有执行:${reason}`;
    }

    // 结果由事件写入状态机,这里只负责把当前状态说成人话
    return state === "available"
      ? `发现新版本 ${availableVersion}(当前 ${app.getVersion()})`
      : message;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // checkForUpdates 抛错 与 error 事件 可能同时发生,
    // 这里兜一层保证「状态一定会被写上」—— 不允许静默失败(Bug-008 的教训)
    if (state !== "error") {
      setState("error", `检查失败:${msg}`, { notify: true });
    }
    return `检查失败:${msg}`;
  }
}

/**
 * 下载更新。只有 available 状态才允许 —— 这个判断是约束,不是装饰。
 */
export async function downloadUpdateNow(): Promise<string> {
  if (state !== "available") {
    log.warn(`[updater] 当前状态 ${state} 不允许下载`);
    return `当前状态(${STATE_LABEL[state]})不允许下载`;
  }

  lastProgressPercent = -1;
  setState("downloading", "开始下载更新…");

  try {
    await autoUpdater.downloadUpdate();
    return "下载完成";
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    setState("error", `下载失败:${msg}`, { notify: true });
    return `下载失败:${msg}`;
  }
}

/**
 * 临时关掉「退出时自动安装」(只影响这一次退出)。
 *
 * 用来支撑 Q4 的 B 项:用户在退出前被问「有更新,要不要装」,选了「仅退出,这次不装」。
 * 注意这只是本次进程内的开关 —— 下次启动 initAutoUpdater() 会重新置回 true,
 * 因为「默认在退出时安装」仍然是我们选择的默认策略。
 */
export function setAutoInstallOnQuit(enabled: boolean): void {
  autoUpdater.autoInstallOnAppQuit = enabled;
  log.info(`[updater] 本次退出时自动安装 = ${enabled}`);
}

/**
 * 退出并安装。
 *
 * ⚠ 调用方必须先把自己的 isQuitting 置为 true 再调这里。
 *   否则窗口 close 事件里的拦截逻辑会把这次退出拦下来 ——
 *   就是 Bug-002 那个「窗口没了、托盘没了、进程还在」的僵尸态。
 *   更新安装是最典型的「我主动要退出」场景,却又最容易被自己的拦截逻辑挡住。
 */
export function quitAndInstallNow(): void {
  if (state !== "ready") {
    log.warn(`[updater] 当前状态 ${state} 不能安装,忽略`);
    return;
  }

  log.info("[updater] quitAndInstall:即将退出并安装新版本");
  // 参数:isSilent=false 让用户看见安装过程;isForceRunAfter=true 装完自动拉起新版本
  autoUpdater.quitAndInstall(false, true);
}
