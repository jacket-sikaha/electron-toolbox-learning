// electron/preload.ts — Preload 桥
//
// 阶段 2:暴露 selectAndReadFile API(文件读取)
// 阶段 3:暴露 getSystemInfo / hideWindow API(系统信息 + 托盘集成)
// 阶段 4:暴露 bigBase64 / onBase64Progress API(大文件 + 进度推送)
// 阶段 6-3:暴露 log API(转发给 Main 落盘)+ debug 通道
//
// 关键设计 1:contextBridge.exposeInMainWorld 是「唯一正确」的暴露方式
// - 它把对象复制到 Renderer 的 window 上,Renderer 只能调这些方法
// - Renderer 拿不到 ipcRenderer 对象本身,碰不到其他 channel
// - 如果不通过 contextBridge,直接 window.myAPI = ipcRenderer,
//   contextIsolation: true 下会失败(隔离了 window)
//
// 关键设计 2:零入参 = 零攻击面(方案 2)
// - selectAndReadFile() 不接收任何参数
// - path 由 Main 内部 dialog 决定,Renderer 无法传 path
// - 即使 Renderer 被 XSS 攻破,攻击者也只能「再选一次文件」
//
// 关键设计 3:Preload 里只做「转发」,不做业务逻辑
// - 校验、文件读取都在 Main 做
// - Preload 只是「白名单 + 转发」,职责单一
// - 这样 Preload 文件即使膨胀,也容易审计

import { contextBridge, ipcRenderer } from "electron";

// 暴露的 API 类型定义(给 Renderer 用,IDE 智能提示)
export interface FileContent {
  buffer: Uint8Array; // Buffer 跨 IPC 后变成 Uint8Array
  name: string;
}

// 阶段 3:系统信息返回结构
export interface SystemInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMem: number;
  freeMem: number;
  hostname: string;
  osVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  appVersion: string;
  uptime: number;
}

// 阶段 4:大文件处理结果
export interface BigBase64Result {
  base64: string;
  name: string;
  originalSize: number;
  base64Size: number;
}

// 阶段 4:进度事件负载
export interface Base64Progress {
  processed: number;
  total: number;
}

// ── 阶段 6-3:日志转发(替代在 preload 里直接 import electron-log)──────────
//
// 为什么绕这一圈?见文件头 Bug-006:sandboxed preload 不能引入 electron-log
// (它要 require path/fs/child_process,白名单里没有)。
// 所以 Renderer 侧只能把日志「寄」给 Main,由 Main 写文件。
//
// 为什么用 send 而不是 invoke?
//   日志是「发出去就不用管」的单向通知,不需要返回值。
//   send/on 语义更贴切,也不会在 Main 卡顿时让 Renderer 攒一堆待决 Promise。

type LogLevel = "info" | "warn" | "error" | "debug";

function formatLogArg(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ""}`;
  try {
    // JSON.stringify(undefined) 返回 undefined(不是字符串),要兜底
    return JSON.stringify(v) ?? String(v);
  } catch {
    // 循环引用等无法序列化的情况
    return String(v);
  }
}

function forwardLog(level: LogLevel, args: unknown[]): void {
  // IPC 参数必须可结构化克隆,所以先拍平成字符串
  ipcRenderer.send("log:write", {
    level,
    message: args.map(formatLogArg).join(" "),
  });
}

contextBridge.exposeInMainWorld("electronAPI", {
  // 阶段 6-3:debug 通道(临时,阶段 6 结束后删除)
  debugCrash: (): Promise<void> => ipcRenderer.invoke("debug:crash"),
  debugUncaught: (): Promise<void> => ipcRenderer.invoke("debug:uncaught"),

  // 阶段 6-3:日志 API —— 转发给 Main 写文件(见文件头 Bug-006)
  log: {
    info: (...args: unknown[]) => forwardLog("info", args),
    warn: (...args: unknown[]) => forwardLog("warn", args),
    error: (...args: unknown[]) => forwardLog("error", args),
    debug: (...args: unknown[]) => forwardLog("debug", args),
  },

  // 阶段 5:通道名改为 tool:{toolId}:{permission} 格式
  // 「标识来自通道本身」—— 没声明权限的工具,连对应的通道都不存在。
  // Base64Tool 声明了 fs:read → 通道 tool:base64:fs:read 存在
  // JsonFormatter 没声明 fs:read → 通道 tool:json-formatter:fs:read 根本不注册
  selectAndReadFile: (): Promise<FileContent | null> =>
    ipcRenderer.invoke("tool:base64:fs:read"),

  getSystemInfo: (): Promise<SystemInfo> =>
    ipcRenderer.invoke("tool:system-info:sys:info"),

  hideWindow: (): Promise<void> =>
    ipcRenderer.invoke("tool:system-info:window:hide"),

  bigBase64: (): Promise<BigBase64Result | null> =>
    ipcRenderer.invoke("tool:big-base64:fs:read"),

  // 阶段 4:订阅进度推送 —— IPC 的第二种模式(单向推送)
  //
  // 关键设计:必须返回「取消订阅」函数,否则监听器会累积泄漏。
  //
  // 为什么这是必须的?
  //   React 组件每次挂载都会调 onBase64Progress 注册一个监听器。
  //   如果组件卸载时不移除,下次再挂载又注册一个 —— 同一时刻可能有 N 个监听器。
  //   结果是:一次进度推送会触发 N 次回调,进度条乱跳,甚至状态错乱。
  //   这就是知识地图里的「ipcMain.on 监听泄漏」。
  //
  // 用法(Renderer 侧):
  //   const unsubscribe = window.electronAPI.onBase64Progress(cb);
  //   组件卸载时:unsubscribe();
  onBase64Progress: (
    callback: (data: Base64Progress) => void,
  ): (() => void) => {
    // 注意:必须包一层 wrapper,不能直接把 callback 交给 ipcRenderer.on。
    // 因为 ipcRenderer 的监听器签名是 (event, ...args),直接传 callback 会
    // 把 IpcRendererEvent 对象当成第一个参数,污染业务回调的参数。
    const listener = (_event: unknown, data: Base64Progress) => callback(data);
    ipcRenderer.on("base64:progress", listener);
    // 返回取消订阅函数
    return () => {
      ipcRenderer.removeListener("base64:progress", listener);
    };
  },
});
