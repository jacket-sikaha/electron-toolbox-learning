// BigFileBase64Tool.tsx —— 阶段 4:大文件 Base64(Stream + Worker)
//
// 这个组件和 Base64Tool 的区别:
//   - 支持 100MB+ 文件(Stream 分块,内存不爆)
//   - 处理过程中界面不卡(Worker 线程编码,主线程不阻塞)
//   - 有实时进度条(IPC 单向推送)
//
// ────────────────────────────────────────────────────────────────────────
// 阶段 5 变化(对比重点):
//
// 阶段 4 的写法 —— 订阅管理散落在组件里,靠自己记得清理:
//   useEffect(() => {
//     const unsubscribe = window.electronAPI.onBase64Progress(setProgress);
//     return () => unsubscribe();        // ← 忘了这行就泄漏
//   }, []);
//   const res = await window.electronAPI.bigBase64();
//
// 阶段 5 的写法 —— 订阅生命周期被 ctx 实现收口了:
//   const res = await ctx.fs!.bigBase64(setProgress);
//
// context-factory.ts 里的实现是:
//   bigBase64: (onProgress) => {
//     const unsubscribe = api.onBase64Progress(onProgress);
//     return api.bigBase64().finally(() => unsubscribe());
//   }
//
// 「订阅 → 退订」配对被挪进框架实现,catch/finally 保证无论成功失败都会退订。
// 组件里只剩业务意图:我要进度,我要结果。
//
// ⚠️ 但要看清代价:ctx 收口解决的是「同一组件内订阅-退订配对」,
//    【不能】解决「组件卸载但请求还在飞」的场景 —— 那种情况需要在 ctx 里
//    返回 cancel 句柄,或把一次处理做成一等公民的「任务对象」。
//    这是阶段 7 的题目(长任务模型)。
// ────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { Base64Progress, BigBase64Result, ToolProps } from "./types";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function BigFileBase64Tool({ ctx }: ToolProps) {
  const [progress, setProgress] = useState<Base64Progress | null>(null);
  const [result, setResult] = useState<BigBase64Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

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

  async function handleProcess() {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      // 关键点:这里是一次调用,但进度会通过回调持续送进来。
      // 订阅的创建与销毁都在 ctx.fs.bigBase64 内部完成 —— 见文件头注释。
      const res = await ctx.fs!.bigBase64((p) => setProgress(p));
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
        ctx 收口的进度订阅(阶段 5:不再由组件自己管订阅/退订)。
        处理中试着拖动窗口、切换工具 —— 界面不卡就说明 Worker 生效了。
      </div>
    </div>
  );
}
