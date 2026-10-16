// Base64Tool.tsx —— 阶段 2 第一个需要 IPC 的工具
//
// 设计判断:
//   - 选文件 + 读文件:必须走 Main(需要 dialog + fs,Renderer 没有)
//   - Base64 转换:Renderer 自己做(btoa / FileReader 都行)
//   - UI 渲染:Renderer
//
// 关键点:Renderer 拿到的是 Uint8Array(Main 的 Buffer 跨 IPC 后变 Uint8Array),
// 不能直接 btoa(btoa 只接受 string)。需要先把 Uint8Array 转 string,
// 再 btoa。或者用 FileReader.readAsDataURL。
//
// ────────────────────────────────────────────────────────────────────────
// 阶段 5 变化(这个文件是理解契约的最佳样本,请对比看):
//
//   阶段 4:  const result = await window.electronAPI.selectAndReadFile();
//   阶段 5:  const result = await ctx.fs!.selectAndReadFile();
//
//   两种写法的差别不在「少打几个字」,而在:
//     ① 工具不再知道「通道名 / 是 invoke 还是 send」这些框架实现细节
//     ② 工具只能用它声明过的能力 —— 这里 ctx.fs 存在,是因为
//        shared/tool-manifest.ts 里 base64 声明了 permissions: ["fs:read"]
//     ③ 框架换实现(改成 REST、改成 WebSocket)工具一行都不用改
//     ④ 测试时可以传一个假 ctx 进去,不用启动整个 Electron
//
//   注:ctx.fs! 里的感叹号 —— ctx 是 Partial<ToolContext>,
//   类型上 fs 可能不存在。这个工具声明了 fs:read,所以运行时一定存在。
// ────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import type { ToolProps } from "./types";
import { rendererLog } from "./renderer-log";

export function Base64Tool({ ctx }: ToolProps) {
  const [base64, setBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectFile() {
    setLoading(true);
    setError(null);
    setBase64("");
    setFileName("");

    try {
      // 这里就是 IPC 调用的入口(但工具自己不知道这一点)
      // 背后链路:ctx.fs.selectAndReadFile()
      //   → context-factory.ts 的 makeFsApi() 包了一层
      //   → preload 的 ipcRenderer.invoke('tool:select-and-read-file')
      //   → IPC 管道跨进程传输
      //   → Main 的 ipcMain.handle 收到,弹 dialog + 读文件
      //   → 返回 { buffer, name }
      //
      // ★ 如果这个工具没声明 fs:read,上面这句连类型都过不了、
      //   运行时 ctx.fs 也是 undefined —— 失败点从「运行时静默」前移到「写代码时」。
      const result = await ctx.fs!.selectAndReadFile();

      if (!result) {
        // 用户取消选择
        setLoading(false);
        return;
      }

      setFileName(result.name);

      // Uint8Array → Base64
      // 方案 1:用 FileReader(浏览器原生,推荐用于大文件)
      // 方案 2:用 btoa + String.fromCharCode(小文件可用,大文件会栈溢出)
      // 这里用方案 1,因为阶段 4 会扩展到更大文件
      //
      // ▼ 关于这里的类型收窄,值得停一下看清楚(TS 5.7 的破坏性变更)
      //
      //   TS 5.7 起 Uint8Array 变成了泛型:Uint8Array<TArrayBuffer extends ArrayBufferLike>。
      //   裸写 Uint8Array 就等于 Uint8Array<ArrayBufferLike> —— 包含 SharedArrayBuffer
      //   支撑的视图。而 lib.dom 里 BlobPart 只收 ArrayBufferView<ArrayBuffer>(不收 shared)。
      //   于是「IPC 回来的 Uint8Array」在类型上过不了 new Blob([...]) —— 报 TS2322。
      //
      //   ★ 收窄的依据不是「我觉得没事」,而是【IPC 的传输保证】:
      //     跨进程走结构化克隆,它一定复制出一份挂在普通 ArrayBuffer 上的新视图,
      //     永远不可能是 SharedArrayBuffer。所以这里收窄是【陈述事实】,不是妥协。
      //
      //   为什么不用 new Blob([new Uint8Array(result.buffer)]) 绕开它?
      //     那会白白多复制一整份文件(Blob 构造本身已经复制一次)。
      //     文件上限以后还会涨,「为了类型好看多一次 O(n) 复制」正是我们一直在避免的东西。
      const blob = new Blob([result.buffer as Uint8Array<ArrayBuffer>]);
      const reader = new FileReader();

      reader.onload = () => {
        // reader.result 格式:data:application/octet-stream;base64,XXXX
        // 我们只要逗号后面的 Base64 部分
        const dataUrl = reader.result as string;
        const base64Content = dataUrl.split(",")[1] || "";
        setBase64(base64Content);
        setLoading(false);
      };

      reader.onerror = () => {
        rendererLog.error("Base64Tool: FileReader 读取失败");
        setError("文件读取失败(FileReader 错误)");
        setLoading(false);
      };

      reader.readAsDataURL(blob);
    } catch (e) {
      // Main 抛出的错误会通过 IPC 传回这里
      // 比如「文件过大」错误就是 Main 抛的
      rendererLog.error("Base64Tool: 选文件失败", e);
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="tool">
      <header className="tool-header">
        <h2>Base64 工具</h2>
        <button onClick={handleSelectFile} disabled={loading}>
          {loading ? "读取中..." : "选择文件"}
        </button>
      </header>

      {error && (
        <div
          className="error"
          style={{ padding: "8px 16px", borderBottom: "1px solid #3c3c3c" }}
        >
          ⚠ {error}
        </div>
      )}

      {fileName && (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid #3c3c3c",
            fontSize: "12px",
          }}
        >
          📄 {fileName} ({(base64.length / 1024).toFixed(1)}KB Base64)
        </div>
      )}

      <div className="tool-body">
        <pre
          className="output-area"
          style={{ flex: 1, wordBreak: "break-all" }}
        >
          {base64 || (loading ? "等待选择文件..." : "点击「选择文件」开始")}
        </pre>
      </div>

      {/* 教学提示:把「声明 → 能力」这条链显式画出来 */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid #3c3c3c",
          fontSize: "11px",
          color: "#858585",
          lineHeight: "1.7",
        }}
      >
        <strong style={{ color: "#4ec9b0" }}>权限链:</strong> manifest 里声明{" "}
        <code>permissions: ["fs:read"]</code> → 框架调用 buildContext 组装出{" "}
        <code>ctx.fs</code> → 本组件调 <code>ctx.fs.selectAndReadFile()</code>。
        全程没有出现过 ipcRenderer。
      </div>
    </div>
  );
}
