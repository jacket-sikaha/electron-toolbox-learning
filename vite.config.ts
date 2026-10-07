import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

// Vite 配置 —— 同时打包 Renderer(React SPA)和 Electron(Main + Preload)
// vite-plugin-electron 会把 electron/main.ts 和 electron/preload.ts
// 单独编译成 CommonJS,输出到 dist-electron/,与 package.json 的 main 字段对齐。
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
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
        onstart({ reload }) {
          // preload 改动只刷新 Renderer,不重启 Main
          reload();
        },
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
