// SystemInfoTool.tsx —— 阶段 3:系统信息工具
//
// 这是阶段 3 的「热身工具」,用来验证 IPC 已经能跑通新链路。
//
// 但它有一个重要的教学价值:它让我们看到「哪些数据必须走 Main」。
//   - platform / arch / cpu / mem / versions → 全部是 Node API,Renderer 没有
//   - 这些数据有个共同特点:只读、无入参、无副作用 → IPC 里最安全的一类
//
// 对比阶段 2 的 Base64 工具:那个有「读文件」这个有副作用的操作,
// 所以要做大小限制、路径防御。这个工具什么都不改,零风险。

import { useEffect, useState } from "react";

// 与 preload.ts 的 SystemInfo 保持一致的本地类型
interface SystemInfo {
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

declare global {
  interface Window {
    electronAPI: {
      selectAndReadFile: () => Promise<{
        buffer: Uint8Array;
        name: string;
      } | null>;
      getSystemInfo: () => Promise<SystemInfo>;
      hideWindow: () => Promise<void>;
    };
  }
}

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

export function SystemInfoTool() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadInfo() {
    setLoading(true);
    setError(null);
    try {
      // 这里就是阶段 3 的新 IPC 链路:
      // window.electronAPI.getSystemInfo()
      //   → ipcRenderer.invoke('tool:get-system-info')
      //   → Main 的 ipcMain.handle 里调 os.cpus() / os.totalmem() / process.versions
      //   → 返回纯 JS 对象(全部可序列化,不像 Buffer 需要特殊处理)
      const data = await window.electronAPI.getSystemInfo();
      setInfo(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 组件挂载时自动加载一次
  //
  // ⚠️ 注意:这里的 useEffect 依赖数组是空的([])。
  //    在 React 严格模式下,开发环境会故意执行两次 effect(挂载→卸载→再挂载)。
  //    这里没有清理函数,所以会发两次 IPC 请求 —— 功能上无害(只读接口),
  //    但如果以后这里是「写文件」之类的有副作用操作,就会重复执行!
  //    阶段 4 我们会用一个真实 Bug 来演示这个问题。
  useEffect(() => {
    loadInfo();
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
            onClick={() => window.electronAPI.hideWindow()}
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
            </div>
          </>
        )}
        {!info && !loading && !error && (
          <div style={{ color: "#858585" }}>暂无数据,点击「刷新」重试</div>
        )}
      </div>
    </div>
  );
}
