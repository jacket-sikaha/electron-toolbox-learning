// src/tools/context-factory.ts —— 「全员 API」→ 「按权限裁剪的 ctx」
//
// ════════════════════════════════════════════════════════════════════════
// 阶段 5 核心文件 3/4:裁剪发生的地方
// ════════════════════════════════════════════════════════════════════════
//
// 数据流位置:
//
//   preload.ts 暴露的 window.electronAPI(按功能平铺、全部可见)
//                    │
//                    │  ← 阶段 5 在这里插入一层「裁剪」
//                    ▼
//   buildContext(permissions) → 只带该工具声明过的能力
//                    │
//                    ▼
//   工具组件:只看得见 ctx,看不见 electronAPI
//
// 为什么裁剪必须发生在 Renderer?
//   ctx 里全是方法(函数不可序列化,过不了 IPC),对象必须在使用者所在的内存里。
//   Main 能做到的是「决定哪些通道被注册」—— 那是权限的【物理基础】,
//   而这里是权限的【视图裁剪】。两层配合,缺一不可。

import type { Permission } from "../../shared/tool-manifest";
import type { ToolContext } from "./types";

/** preload 暴露的全量 API(阶段 4 的形态,这里作为 ctx 的「底层数据源」) */
interface RawElectronAPI {
  selectAndReadFile(): Promise<{ buffer: Uint8Array; name: string } | null>;
  getSystemInfo(): Promise<ToolContext["system"] extends { getInfo(): Promise<infer R> } ? R : never>;
  hideWindow(): Promise<void>;
  bigBase64(): Promise<
    { base64: string; name: string; originalSize: number; base64Size: number } | null
  >;
  onBase64Progress(
    callback: (data: { processed: number; total: number }) => void
  ): () => void;

  // 阶段 6-3:日志 API(electron-log 通过 IPC 转发到 Main 统一写文件)
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };

  // 阶段 6-3:crashReporter 调试通道(临时,阶段 6 结束后删除)
  debugCrash: () => Promise<void>;
  debugUncaught: () => Promise<void>;
}

function rawApi(): RawElectronAPI {
  return (window as unknown as { electronAPI: RawElectronAPI }).electronAPI;
}

// ── 各能力的实现(每个方法内部仍然是 ipcRenderer.invoke,只是包了一层能力命名) ─

function makeFsApi(): ToolContext["fs"] {
  const api = rawApi();
  return {
    selectAndReadFile: () => api.selectAndReadFile(),
    bigBase64: (onProgress) => {
      // ★ 订阅的清理责任在这里被「收口」:调用方传回调,内部负责订阅 + 退订,
      //   不再让每个工具组件各自记得写 useEffect 清理函数(那正是泄漏的来源)。
      const unsubscribe = api.onBase64Progress(onProgress);
      return api.bigBase64().finally(() => unsubscribe());
    },
  };
}

function makeSystemApi(): ToolContext["system"] {
  const api = rawApi();
  return {
    getInfo: () => api.getSystemInfo(),
  };
}

function makeWindowApi(): ToolContext["window"] {
  const api = rawApi();
  return {
    hide: () => api.hideWindow(),
  };
}

/**
 * 按工具的 permissions 组装 ctx —— 这一步就是「裁剪」。
 *
 * 关键:没有声明权限的能力,不会出现在返回对象上。
 * 所以 JSON Formatter 拿到的 ctx 是 {} —— 它连 ctx.fs 这个属性都访问不到,
 * 不是「访问了被拒绝」,而是「根本不存在」。
 *
 * ⚠️ 坦诚说明局限:这段代码跑在 Renderer 里,理论上 Renderer 自己的代码
 *    可以绕过它直接调 window.electronAPI。所以【真正的边界不在这里】,
 *    而在 Main 侧:① 没声明权限的工具,对应通道根本没注册
 *              ② event.sender 来源校验
 *    这里做的是「能力视图裁剪」,让正常写代码的人不会误用不该用的能力。
 *    这是纵深防御的其中一层,不是唯一一层。
 */
export function buildContext(permissions: readonly Permission[]): Partial<ToolContext> {
  const ctx: Partial<ToolContext> = {};

  // 阶段 5 核心裁剪逻辑:按 permissions 声明决定注入哪些能力
  // permissions=[] → ctx={} (什么都没有,如 JsonFormatter)
  // permissions=["fs:read"] → ctx.fs 可用,ctx.system/ctx.window 不存在
  // permissions=["sys:info","window:hide"] → ctx.system + ctx.window 可用
  //
  // ⚠️ Bug 实验教训:曾把条件判断注释掉改为无条件注入,导致所有工具拿到全部能力。
  // 该 Bug 在阶段 5(方案 A)无安全危害(代码可信,可绕过 ctx 直调 ipcRenderer),
  // 但在阶段 7(第三方插件)是致命漏洞 —— 插件唯一能力来源就是 ctx,裁剪失效=权限系统失效。
  // 权限裁剪的真正价值取决于「被裁剪方能不能绕过裁剪」。
  if (permissions.includes("fs:read")) {
    ctx.fs = makeFsApi();
  }
  if (permissions.includes("sys:info")) {
    ctx.system = makeSystemApi();
  }
  if (permissions.includes("window:hide")) {
    ctx.window = makeWindowApi();
  }

  return ctx;
}
