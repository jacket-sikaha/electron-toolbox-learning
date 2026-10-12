// src/tools/types.ts —— 工具与框架之间的「能力契约」
//
// ════════════════════════════════════════════════════════════════════════
// 阶段 5 核心文件 2/4:ToolContext(框架向工具提供什么)
// ════════════════════════════════════════════════════════════════════════
//
// 阶段 4 结束时的做法:preload.ts 把所有能力一次性 exposeInMainWorld,
// 变成 window 上一个巨大的 electronAPI 对象。问题:
//   ① 按「功能」命名(selectAndReadFile / bigBase64 / getSystemInfo)
//   ② 启动时一次性全暴露,任何工具都能调到任何能力
//   → JSON Formatter 明明只做字符串处理,却能调 window.electronAPI.bigBase64()
//   → 最小权限原则被彻底违反
//
// 阶段 5 的做法:框架按工具的 permissions【裁剪】出一份 ctx 给它。
//   JSON Formatter   permissions=[]                    → ctx = {}
//   Base64 工具      permissions=["fs:read"]           → ctx = { fs: {...} }
//   系统信息         permissions=["sys:info","window:hide"] → ctx = { system:{...}, window:{...} }
//
// ★ 记住:ctx 不是「electronAPI 的封装」,而是「按权限裁剪后的能力视图」。
//   核心动作是【裁剪】——没有权限的能力,在 ctx 上根本不存在这个属性。
//
// ════════════════════════════════════════════════════════════════════════
// 为什么 ctx 必须在 Renderer 组装,而不是 Main 组装好传过来?
// ════════════════════════════════════════════════════════════════════════
//
// 因为 IPC 走的是【结构化克隆(structured clone)】——只能传数据,
// 不能传函数。ctx 里全是方法,Main 就算组装好了也传不过去。
//
// 更根本的原因:ctx 上的方法要被工具代码调用(ctx.fs.xxx()),
// 对象必须【就在使用者所在的那块内存里】。工具代码跑在 Renderer,
// 所以 ctx 对象必须由 Renderer 创建。
//
// Main 的职责是另外两件事:
//   ① 实现能力(ipcMain.handle 里真正调 dialog + fs)
//   ② 决定权限(没声明 fs:read 的工具,对应通道根本不注册 —— 权限的物理基础)

import type { Permission } from "../../shared/tool-manifest";

// ── 各能力的返回值类型 ────────────────────────────────────────────────────

/** 跨 IPC 传输后 Buffer 会变成 Uint8Array */
export interface FileContent {
  buffer: Uint8Array;
  name: string;
}

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

export interface BigBase64Result {
  base64: string;
  name: string;
  originalSize: number;
  base64Size: number;
}

export interface Base64Progress {
  processed: number;
  total: number;
}

// ── 能力契约 ──────────────────────────────────────────────────────────────

/**
 * 框架能提供的全部能力。
 *
 * 注意命名方式:按【能力】分组(fs / system / window),
 * 而不是按【功能】(selectAndReadFile 平铺在顶层)。
 * 这样「权限声明 fs:read」和「ctx 上的 fs 命名空间」是一一对应的。
 */
export interface ToolContext {
  fs: {
    /** 选文件并读取(小文件,10MB 以内)。零入参 → Renderer 拿不到 path */
    selectAndReadFile(): Promise<FileContent | null>;
    /** 选大文件并用 Stream + Worker 转 Base64。绑定进度回调 */
    bigBase64(onProgress: (p: Base64Progress) => void): Promise<BigBase64Result | null>;
  };
  system: {
    getInfo(): Promise<SystemInfo>;
  };
  window: {
    /** 隐藏当前窗口到托盘 */
    hide(): Promise<void>;
  };
}

/** 工具组件收到的 props */
export interface ToolProps {
  /**
   * 已按该工具的 permissions 裁剪过的能力视图。
   *
   * Partial 的含义:不是「可能缺失」,而是「按权限决定有没有」。
   * 声明了 fs:read → ctx.fs 一定存在;
   * 没声明 → ctx.fs 在类型上不存在,运行时也真的不存在(双保险)。
   */
  ctx: Partial<ToolContext>;
}

/** ctx 上每个命名空间对应的权限(权限 → 能力的映射表) */
export const CONTEXT_PERMISSION_MAP: Record<keyof ToolContext, Permission> = {
  fs: "fs:read",
  system: "sys:info",
  window: "window:hide",
};
