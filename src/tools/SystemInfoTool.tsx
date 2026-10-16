// SystemInfoTool.tsx —— 阶段 3:系统信息工具
//
// ────────────────────────────────────────────────────────────────────────
// 阶段 5 变化:
//   阶段 4:  await window.electronAPI.getSystemInfo()
//   阶段 5:  await ctx.system!.getInfo()
//
//   同一个工具用了【两个】能力,所以 manifest 里声明了两条权限:
//     permissions: ["sys:info", "window:hide"]
//   而 ctx 恰好组出了两个命名空间:
//     { system: {...}, window: {...} }
//
//   ⚠️ 注意这里的对应关系是「一个能力 = 一个 ctx 命名空间」,
//      不是「一条权限 = 一个方法」。permissions 的粒度决定了裁剪粒度。
// ────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { SystemInfo, ToolProps } from "./types";
import { rendererLog } from "./renderer-log";

// 把字节数格式化成人类可读的 GB / MB
function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 把秒数格式化成「x 天 x 小时 x 分钟」
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function SystemInfoTool({ ctx }: ToolProps) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadInfo() {
    setLoading(true);
    setError(null);
    try {
      // 这里就是阶段 3 的 IPC 链路(阶段 5 起经由 ctx 能力视图):
      // ctx.system.getInfo()
      //   → context-factory 的 makeSystemApi()
      //   → ipcRenderer.invoke('tool:get-system-info')
      //   → Main 的 ipcMain.handle 里调 os.cpus() / os.totalmem() / process.versions
      //   → 返回纯 JS 对象(全部可序列化,不像 Buffer 需要特殊处理)
      const data = await ctx.system!.getInfo();
      setInfo(data);
    } catch (e) {
      rendererLog.error("SystemInfoTool: 获取系统信息失败", e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 挂载时自动加载一次
  useEffect(() => {
    void loadInfo();
    // 只在挂载时跑一次:loadInfo 是稳定引用,不需要进依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usedMem = info ? info.totalMem - info.freeMem : 0;
  const memPercent = info ? (usedMem / info.totalMem) * 100 : 0;

  return (
    <div className="tool">
      <header className="tool-header">
        <h2>系统信息</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={loadInfo} disabled={loading}>
            {loading ? "读取中..." : "刷新"}
          </button>
          <button
            onClick={() => ctx.window!.hide()}
            title="隐藏到系统托盘(从托盘图标可以唤回)"
          >
            隐藏到托盘
          </button>
        </div>
      </header>

      {error && (
        <div
          className="error"
          style={{ padding: "8px 16px", borderBottom: "1px solid #3c3c3c" }}
        >
          ⚠ {error}
        </div>
      )}

      <div style={{ padding: "16px", overflow: "auto", flex: 1 }}>
        {info && (
          <>
            {/* 内存占用进度条 —— 这是本工具唯一有"可视化"价值的部分 */}
            <div style={{ marginBottom: "20px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  marginBottom: "6px",
                }}
              >
                <span>内存占用</span>
                <span>
                  {formatBytes(usedMem)} / {formatBytes(info.totalMem)}(
                  {memPercent.toFixed(1)}%)
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
                    width: `${memPercent}%`,
                    background:
                      memPercent > 85
                        ? "#f48771"
                        : memPercent > 65
                          ? "#dcdcaa"
                          : "#4ec9b0",
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>

            {/* 键值对展示 */}
            <table style={{ width: "100%", fontSize: "13px", borderSpacing: "0" }}>
              <tbody>
                {[
                  ["操作系统", `${info.platform} (${info.arch})`],
                  ["系统版本", info.osVersion],
                  ["主机名", info.hostname],
                  ["CPU", info.cpuModel],
                  ["CPU 核心数", `${info.cpuCount} 核`],
                  ["系统运行时长", formatUptime(info.uptime)],
                  ["—", ""],
                  ["Electron 版本", info.electronVersion],
                  ["Chromium 版本", info.chromeVersion],
                  ["Node.js 版本", info.nodeVersion],
                  ["应用版本", info.appVersion],
                ].map(([label, value]) =>
                  label === "—" ? (
                    <tr key={label}>
                      <td colSpan={2} style={{ padding: "8px 0" }}>
                        <hr
                          style={{
                            border: "none",
                            borderTop: "1px solid #3c3c3c",
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={label}>
                      <td
                        style={{
                          padding: "5px 0",
                          color: "#858585",
                          width: "140px",
                        }}
                      >
                        {label}
                      </td>
                      <td style={{ padding: "5px 0", wordBreak: "break-all" }}>
                        {value}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>

            {/* 教学提示:告诉学习者这些数据为什么要走 IPC */}
            <div
              style={{
                marginTop: "20px",
                padding: "12px",
                background: "#252526",
                borderLeft: "3px solid #4ec9b0",
                fontSize: "12px",
                lineHeight: "1.7",
                color: "#a0a0a0",
              }}
            >
              <strong style={{ color: "#4ec9b0" }}>为什么这些数据要走 IPC?</strong>
              <br />
              <code>os.cpus()</code> / <code>os.totalmem()</code> /{" "}
              <code>process.versions</code> 都是 Node API,Renderer 在
              contextIsolation 下碰不到。
              <br />
              但它们<span style={{ color: "#dcdcaa" }}>只读、无入参、无副作用</span>
              ,是 IPC 里最安全的一类 —— 对比 Base64 工具的「读文件」,那个有副作用,
              所以需要文件大小限制和路径防御。
              <br />
              <br />
              阶段 5:本工具声明了 <code>["sys:info", "window:hide"]</code>,
              所以框架给它的 ctx 里有 <code>system</code> 和 <code>window</code>{" "}
              两个命名空间 —— 但也仅此而已。
            </div>
          </>
        )}
        {!info && !loading && !error && (
          <div style={{ color: "#858585" }}>暂无数据,点击「刷新」重试</div>
        )}
      </div>

      {/* 阶段 6-3:crashReporter 调试面板(临时,阶段 6 结束后删除) */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #3c3c3c",
          fontSize: "11px",
          color: "#858585",
          lineHeight: "1.7",
        }}
      >
        <strong style={{ color: "#f48771" }}>⚠ 调试:crashReporter 测试</strong>
        <br />
        <span>这两个按钮触发主进程崩溃/未捕获异常,验证 crashReporter 是否正常工作。</span>
        <br />
        <span>崩溃后应用会退出 —— 重启后查看日志文件确认崩溃报告已记录。</span>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            onClick={() => {
              const api = (window as unknown as {
                electronAPI?: { debugCrash?: () => Promise<void> };
              }).electronAPI;
              void api?.debugCrash?.();
            }}
            style={{
              padding: "4px 12px",
              fontSize: "11px",
              border: "1px solid #f48771",
              color: "#f48771",
              background: "transparent",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            触发 crash
          </button>
          <button
            onClick={() => {
              const api = (window as unknown as {
                electronAPI?: { debugUncaught?: () => Promise<void> };
              }).electronAPI;
              void api?.debugUncaught?.();
            }}
            style={{
              padding: "4px 12px",
              fontSize: "11px",
              border: "1px solid #f48771",
              color: "#f48771",
              background: "transparent",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            触发 uncaught
          </button>
        </div>
      </div>
    </div>
  );
}
