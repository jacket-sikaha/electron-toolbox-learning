// src/tools/renderer-log.ts —— 渲染进程日志统一入口(阶段 6-3)
//
// ────────────────────────────────────────────────────────────────────────
// 完整链路(阶段 6-3,Bug-006 修复后的最终形态):
//   rendererLog.error("...")
//     → window.electronAPI.log.error(...)        ← preload 暴露
//     → ipcRenderer.send("log:write", {...})     ← preload 转发
//     → ipcMain.on("log:write")                  ← main 接收 + 校验
//     → electron-log 写 userData/logs/main.log   ← main 落盘(带 [renderer] 前缀)
//
//   注意:electron-log 本身【不参与】这条链路的前半段。
//   Bug-006 之后,electron-log 的 import 只允许出现在 Main 侧 ——
//   因为 sandboxed preload 的 require 白名单里没有 path / fs。
//
// 为什么单独建一个文件,而不是每个组件各写各的?
//   在组件里直接写 `(window as ...).electronAPI?.log?.error(...)`
//   每次都要一个难看的长类型断言,而且容易打错。
//   这里收口成一个三行调用:rendererLog.error("...")。
//
// 更重要的一点:日志【不是能力】。
//   阶段 5 的 ctx 只裁剪「permissions 声明的能力」—— fs / system / window。
//   日志是任何工具在任何时刻都需要的「基础设施」,
//   不该为了记一条日志就去 tool-manifest 里加一个 "log" 权限。
//   所以它不进 ctx,而是像 console 一样全局可用(preload 也确实是这么暴露的)。
// ────────────────────────────────────────────────────────────────────────

interface ElectronLog {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * 取 electron-log 句柄;preload 未暴露时降级到 console,
 * 保证在纯浏览器环境(如 vitest / 组件单测)里也不会崩。
 */
function getLog(): ElectronLog {
  const api = (window as unknown as { electronAPI?: { log?: ElectronLog } }).electronAPI;
  return api?.log ?? console;
}

/** 渲染进程日志对象 —— 统一从这里打日志,别直接用 console.xxx */
export const rendererLog: ElectronLog = {
  info: (...args) => getLog().info(...args),
  warn: (...args) => getLog().warn(...args),
  error: (...args) => getLog().error(...args),
  debug: (...args) => getLog().debug(...args),
};
