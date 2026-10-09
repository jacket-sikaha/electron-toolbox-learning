// BigFileBase64Tool.tsx —— 阶段 4:大文件 Base64(Stream + Worker)
//
// 这个组件和 Base64Tool 的区别:
//   - 支持 100MB+ 文件(Stream 分块,内存不爆)
//   - 处理过程中界面不卡(Worker 线程编码,主线程不阻塞)
//   - 有实时进度条(IPC 单向推送)
//
// 组件本身的 UI 是 boilerplate,你要重点看的是:
//   ① 进度订阅的 useEffect 清理函数(防监听泄漏)
//   ② 进度百分比的计算

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    electronAPI: {
      selectAndReadFile: () => Promise<{
        buffer: Uint8Array;
        name: string;
      } | null>;
      getSystemInfo: () => Promise<unknown>;
      hideWindow: () => Promise<void>;
      bigBase64: () => Promise<{
        base64: string;
        name: string;
        originalSize: number;
        base64Size: number;
      } | null>;
      onBase64Progress: (
        callback: (data: { processed: number; total: number }) => void
      ) => () => void;
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function BigFileBase64Tool() {
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    base64: string;
    name: string;
    originalSize: number;
    base64Size: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // ==========================================================================
  // 关键设计 1:进度订阅 + 清理(防监听泄漏)
  // --------------------------------------------------------------------------
  // 这段 useEffect 是阶段 4 最值得看的地方。
  //
  // 依赖数组为空 [] → 只在挂载时订阅一次。
  // 返回的函数是「清理函数」→ 组件卸载时自动执行 unsubscribe()。
  //
  // 如果忘了写 return unsubscribe():
  //   ① 组件挂载 → 注册监听器 A
  //   ② 用户切到别的工具 → 组件卸载,但监听器 A 还在
  //   ③ 用户切回来 → 又注册监听器 B
  //   ④ 现在有两个监听器,一次进度推送触发两次 setProgress
  //   ⑤ 切换 N 次后,一次推送触发 N 次 —— 性能灾难 + 状态错乱
  //
  // 这就是知识地图里的「ipcMain.on 监听泄漏」,阶段 4 的必踩坑。
  // ==========================================================================
  useEffect(() => {
    const unsubscribe = window.electronAPI.onBase64Progress((data) => {
      setProgress(data);
    });
    // ★ 清理函数 —— 这一行是防泄漏的关键
    return () => unsubscribe();
  }, []);

  // 计时器:处理大文件时显示已耗时,让用户知道还在跑
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(timer);
  }, [loading]);

  // 记录上次处理结果,供"进度订阅是否泄漏"的演示用
  const renderCount = useRef(0);
  renderCount.current += 1;

  async function handleProcess() {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      // 关键点:这里是一次 invoke 调用,但进度会通过另一个通道推送过来。
      // 两者是并行的:invoke 等待最终结果,onBase64Progress 持续接收进度。
      const res = await window.electronAPI.bigBase64();
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, (progress.processed / progress.total) * 100)
      : 0;

  const expansionRatio =
    result && result.originalSize > 0
      ? (result.base64Size / result.originalSize).toFixed(3)
      : null;

  return (
    <div className="tool">
      <header className="tool-header">
        <h2>大文件 Base64(Stream + Worker)</h2>
        <button onClick={handleProcess} disabled={loading}>
          {loading ? `处理中... ${(elapsed / 1000).toFixed(1)}s` : "选择大文件"}
        </button>
      </header>

      {error && (
        <div className="error" style={{ padding: "8px 16px", borderBottom: "1px solid #3c3c3c" }}>
          ⚠ {error}
        </div>
      )}

      {/* 进度条 */}
      {loading && (
        <div style={{ padding: "16px", borderBottom: "1px solid #3c3c3c" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              marginBottom: "6px",
            }}
          >
            <span>处理进度</span>
            <span>
              {progress
                ? `${formatBytes(progress.processed)} / ${formatBytes(progress.total)}`
                : "初始化中..."}
            </span>
          </div>
          <div
            style={{
              height: "8px",
              background: "#3c3c3c",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${percent}%`,
                background: "#4ec9b0",
                transition: "width 0.15s linear",
              }}
            />
          </div>
          <div style={{ fontSize: "11px", color: "#858585", marginTop: "6px" }}>
            {percent.toFixed(1)}% · Worker 线程编码中,界面保持可操作(试试拖动窗口)
          </div>
        </div>
      )}

      {/* 结果统计 */}
      {result && (
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #3c3c3c",
            fontSize: "12px",
            display: "flex",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <span>📄 {result.name}</span>
          <span>原始:{formatBytes(result.originalSize)}</span>
          <span>Base64:{formatBytes(result.base64Size)}</span>
          <span style={{ color: "#dcdcaa" }}>
            膨胀率:×{expansionRatio}（理论值 1.333）
          </span>
          <span style={{ color: "#858585" }}>耗时:{(elapsed / 1000).toFixed(2)}s</span>
        </div>
      )}

      <div className="tool-body">
        <pre className="output-area" style={{ flex: 1, wordBreak: "break-all" }}>
          {result?.base64
            ? result.base64.slice(0, 5000) +
              (result.base64.length > 5000
                ? `\n\n...（仅显示前 5000 字符,总长 ${result.base64.length}）`
                : "")
            : loading
              ? "处理中,请稍候..."
              : "点击「选择大文件」开始(可试 100MB+ 的文件)"}
        </pre>
      </div>

      {/* 教学提示 */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid #3c3c3c",
          fontSize: "11px",
          color: "#858585",
          lineHeight: "1.7",
        }}
      >
        <strong style={{ color: "#4ec9b0" }}>这个工具用到的机制:</strong> Stream 分块读(内存
        O(1) 不爆)+ Worker Threads(CPU 编码不占主线程)+
        webContents.send(进度单向推送)。处理中试着拖动窗口、切换工具 ——
        界面不卡就说明 Worker 生效了。
      </div>
    </div>
  );
}
