// electron/preload.ts —— Preload 桥
//
// 阶段 1:空实现,只通过 contextBridge 暴露一个空的 API 占位。
// 阶段 2 才会真正暴露文件 IO 等受控 API。
//
// 为什么阶段 1 也要建这个文件并配置到 BrowserWindow?
//   不是「现在要用」,而是「将来要用 + 防止安全退化」。
//   如果现在不建,阶段 2 加文件 IO 时,容易为了图省事直接
//   开 nodeIntegration:true,让 Renderer 直连 Node —— 这是
//   Electron 安全模型最大的坑,一开始就锁死姿势能避免。

import { contextBridge } from "electron";

// contextBridge.exposeInMainWorld:在 Renderer 的 window 上挂一个白名单对象
// Renderer 只能调这里暴露的方法,碰不到 Node API。
// 阶段 1 暴露一个空对象,表示「目前没有任何需要走 Preload 的能力」。
contextBridge.exposeInMainWorld("electronAPI", {
  // 阶段 2 会在这里加:readFile / writeFile 等
  version: "0.0.0-placeholder",
});
