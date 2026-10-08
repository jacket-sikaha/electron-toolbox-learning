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
// 这个组件本身是 UI + 逻辑,boilerplate 你看一眼即可。
// 重点理解:它调 window.electronAPI.selectAndReadFile() 这个动作背后发生了什么。

import { useState } from "react";

// 全局类型声明:让 TS 知道 window.electronAPI 的类型
// 这个声明应该放在单独的 types.d.ts,这里先简化放在组件里
declare global {
  interface Window {
    electronAPI: {
      selectAndReadFile: () => Promise<{
        buffer: Uint8Array;
        name: string;
      } | null>;
    };
  }
}

export function Base64Tool() {
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
      // 这里就是 IPC 调用的入口
      // 背后链路:window.electronAPI.selectAndReadFile()
      //   → Preload 的 ipcRenderer.invoke('tool:select-and-read-file')
      //   → IPC 管道跨进程传输
      //   → Main 的 ipcMain.handle 收到,弹 dialog + 读文件
      //   → 返回 { buffer, name }
      const result = await window.electronAPI.selectAndReadFile();

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
      const blob = new Blob([result.buffer]);
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
        setError("文件读取失败(FileReader 错误)");
        setLoading(false);
      };

      reader.readAsDataURL(blob);
    } catch (e) {
      // Main 抛出的错误会通过 IPC 传回这里
      // 比如「文件过大」错误就是 Main 抛的
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
    </div>
  );
}
