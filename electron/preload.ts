// electron/preload.ts —— Preload 桥
//
// 阶段 2:暴露 selectAndReadFile API(文件读取)
// 阶段 3:暴露 getSystemInfo / hideWindow API(系统信息 + 托盘集成)
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

contextBridge.exposeInMainWorld("electronAPI", {
  // 阶段 2:Base64 工具用的 API
  // 调用 ipcRenderer.invoke,channel 名必须与 main.ts 里 ipcMain.handle 一致
  selectAndReadFile: (): Promise<FileContent | null> =>
    ipcRenderer.invoke("tool:select-and-read-file"),

  // 阶段 3:系统信息 —— 只读、零入参、零风险
  getSystemInfo: (): Promise<SystemInfo> =>
    ipcRenderer.invoke("tool:get-system-info"),

  // 阶段 3:隐藏当前窗口(托盘应用:最小化到托盘)
  // 零入参 —— Renderer 只能说「隐藏我这个窗口」,不能指定隐藏别的窗口
  hideWindow: (): Promise<void> => ipcRenderer.invoke("window:hide"),
});
