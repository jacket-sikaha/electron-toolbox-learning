// shared/tool-manifest.ts —— 工具的「声明层」
//
// ════════════════════════════════════════════════════════════════════════
// 阶段 5 核心文件 1/4:单一数据源(Single Source of Truth)
// ════════════════════════════════════════════════════════════════════════
//
// 这个文件被「两个进程」同时 import:
//   - Main  侧:electron/main.ts    → 决定注册哪些 IPC handler(权限的物理基础)
//   - Renderer 侧:src/App.tsx      → 决定侧边栏显示哪些按钮
//
// 为什么必须共享同一份,而不是两边各写一份?
//   各写一份 → 迟早不同步。典型场景:你在 Renderer 给某工具加了 "fs:read",
//   但忘了改 Main 那份 → UI 显示「这个工具有文件权限」,而 Main 的权限校验
//   说「没有」→ 用户看到的行为与实际生效的规则不一致,这类 Bug 极难排查。
//
// 共享一份之后,TypeScript 会在【编译期】保证两端读到的是同一份数据 ——
// 字段缺了、类型错了,编译就报错,不用等运行时 IPC 才发现。
// 这就是「共享纯数据文件」真正的威力:让类型系统帮你验证两端一致。
//
// ════════════════════════════════════════════════════════════════════════
// ⚠️ 这个文件里【绝对不能】出现 React 组件
// ════════════════════════════════════════════════════════════════════════
//
// 如果这里写 `import { JsonFormatter } from "../src/tools/JsonFormatter"`,
// Main 进程 import 这个文件时,就会被逼着把 4 个 React 组件(连同样式、
// 浏览器 API、DOM 依赖)全拉进 Node 环境的构建产物里 ——
// 不仅体积浪费,还会直接构建报错(Node 里没有 document / window)。
//
// 所以:「元数据(meta)」留在这里共享,「组件映射(component)」留在
//      Renderer 的 src/tools/index.ts —— 这叫【声明与实现分离】。
//      额外收益:阶段 7 做懒加载时,组件映射表正好是插入 React.lazy() 的位置。

/** 一个工具可以向框架声明需要的能力 */
export type Permission =
  | "fs:read" // 读取本地文件(必须经由 Main 的系统 dialog 选择,零入参)
  | "sys:info" // 读取系统信息(平台 / CPU / 内存 / 版本号)
  | "window:hide" // 控制窗口显隐(最小化到托盘)
  | "clipboard" // 剪贴板读写(阶段 5 尚未实现,预留)
  | "net"; // 网络请求(阶段 5 尚未实现,预留)

/**
 * 工具元信息 —— 侧边栏 / 路由 / 权限注册的消费者
 *
 * 注意它和「工具组件」是两种东西:
 *   - meta:全量列出(要渲染整个侧边栏)
 *   - component:按需加载(同一时刻只渲染一个)
 */
export interface ToolMeta {
  /** 唯一标识:路由匹配、IPC 通道命名、权限校验的 key */
  id: string;
  /** 侧边栏显示名 */
  name: string;
  /** 侧边栏图标(阶段 5 用 emoji,阶段 6 可换 SVG) */
  icon: string;
  /** 侧边栏排序(升序) */
  order: number;
}

/** 一个工具的完整声明 = 元信息 + 权限清单 */
export interface ToolManifestEntry {
  meta: ToolMeta;
  /** 声明这个工具需要的能力 —— 直接决定它拿到的 ctx 里有什么 */
  permissions: readonly Permission[];
}

/**
 * 工具清单 —— 加一个新工具,改这里一处。
 *
 * 这份数组的两端消费方式:
 *   Main:     for (const t of TOOL_MANIFEST) if (t.permissions.includes("fs:read")) 注册 handler
 *   Renderer: TOOL_MANIFEST.map(...) 渲染侧边栏按钮
 */
export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [
  {
    meta: { id: "json-formatter", name: "JSON Formatter", icon: "{}", order: 1 },
    // 纯前端工具:JSON.parse 是浏览器原生 API,不需要任何 Node 能力。
    // 所以它的 ctx 会是空对象 {} —— 这不是遗漏,这是最小权限原则的体现。
    permissions: [],
  },
  {
    meta: { id: "base64", name: "Base64 工具", icon: "🔢", order: 2 },
    permissions: ["fs:read"],
  },
  {
    meta: { id: "big-base64", name: "大文件 Base64", icon: "📦", order: 3 },
    permissions: ["fs:read"],
  },
  {
    meta: { id: "system-info", name: "系统信息", icon: "🖥️", order: 4 },
    permissions: ["sys:info", "window:hide"],
  },
];

/** 按 id 查工具声明(路由用) */
export function getToolEntry(id: string): ToolManifestEntry | undefined {
  return TOOL_MANIFEST.find((t) => t.meta.id === id);
}

/**
 * 查询「哪些工具用到了某个能力」—— 一行拿到影响面
 *
 * 典型用途:要给所有文件读取加 10 秒超时,先看看会影响谁:
 *   getToolsUsingPermission("fs:read")  → [base64, big-base64]
 *
 * 不用翻源码考古。这是 permissions 在「编译时注册」阶段最实在的价值:
 * 把权限从「实现细节」变成「可被程序查询的元数据」。
 */
export function getToolsUsingPermission(p: Permission): string[] {
  return TOOL_MANIFEST.filter((t) => t.permissions.includes(p)).map((t) => t.meta.id);
}
