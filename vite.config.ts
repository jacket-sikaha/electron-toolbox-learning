import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

// ============================================================================
// 关键设计 1:Electron 启动参数「只定义一次」
// ----------------------------------------------------------------------------
// --no-sandbox / --disable-gpu-sandbox 是 Windows 11 25H2 上 Chromium sandbox
// 初始化 Bug(electron#52098)的社区 workaround,任何一次启动都必须带上。
// 抽成常量,是为了让「某条分支漏参数」在结构上不可能发生。
// ============================================================================
const ELECTRON_ARGS = [".", "--no-sandbox", "--disable-gpu-sandbox"];

// 对应 vite-plugin-electron 里 ElectronOptions['onstart'] 的入参
type OnStartAPI = {
  startup: (argv?: string[]) => Promise<void>;
  reload: () => void;
};

// ============================================================================
// 关键设计 2:两个 entry 共用「一个」启动状态机
// ----------------------------------------------------------------------------
// 为什么不能给 main / preload 各写一个不同的 onstart?
//
// vite-plugin-electron 的实现是(见 dist/index.js 的 closeBundleCount 计数):
//   等「所有 entry 都构建完成」后,只调用「最后构建完的那个 entry」的 onstart。
// 两个 entry 的构建是并发的、完成顺序不确定,于是首次启动时存在一个竞态:
//   - 若 main 胜出 → 走 startup([...]),参数完整 ✅
//   - 若 preload 胜出 → 走 reload();而此时 Electron 还没起来,
//     插件内部的 reload() 会退化成 startup() 的「默认参数」[".", "--no-sandbox"],
//     把 --disable-gpu-sandbox 悄悄丢掉 ❌
// 表现出来就是「同一环境,有时能正常启动、有时一启动就崩」的偶发问题。
//
// 所以这里改成共享状态机:按 kind 区分行为,不依赖构建完成顺序。
// ============================================================================
let electronStarted = false;

function onElectronStart(kind: "main" | "preload", { startup, reload }: OnStartAPI) {
  // pnpm dev:vite —— 只跑渲染层,不拉起 Electron(用于隔离排查前端问题)
  if (process.env.ELECTRON_SKIP) return;

  // 首次构建完成:拉起 Electron。
  // 此处刻意不区分 kind,保证无论哪个 entry 最后构建完,拿到的都是完整启动参数。
  if (!electronStarted) {
    electronStarted = true;
    void startup(ELECTRON_ARGS);
    return;
  }

  // 之后的热更新:
  // - main 改动:主进程代码无法热替换,只能整进程重启。
  //   startup() 内部会先 treeKill 旧实例,所以重复调用天然幂等。
  // - preload 改动:它只是渲染层的桥,重启进程太重,刷新 Renderer 就够。
  if (kind === "main") {
    void startup(ELECTRON_ARGS);
  } else {
    reload();
  }
}

// ============================================================================
// 关键设计 3:Electron 的启动权只交给 vite-plugin-electron 一处
// ----------------------------------------------------------------------------
// 历史上 package.json 的 dev 脚本里还有一条
//   concurrently "vite" "wait-on http://localhost:5173 && electron ."
// 于是插件启动一个 Electron、脚本再启动一个 → 同时出现两个 Electron 窗口。
// 现在 npm 脚本只管起 Vite,Electron 生命周期全部由插件负责:
//   - 插件会等 dev server 的 listening 事件后再启动,不再需要 wait-on
//   - 改 main.ts 自动重启、改 preload.ts 自动刷新,也不再需要 concurrently
//
// vite-plugin-electron 会把 electron/main.ts 和 electron/preload.ts
// 单独编译成 CommonJS,输出到 dist-electron/,与 package.json 的 main 字段对齐。
// ============================================================================
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        onstart: (api) => onElectronStart("main", api),
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart: (api) => onElectronStart("preload", api),
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  // 防止 dev server 端口冲突
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
