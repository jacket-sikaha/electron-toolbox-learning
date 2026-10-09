import { useState } from "react";
import { JsonFormatter } from "./tools/JsonFormatter";
import { Base64Tool } from "./tools/Base64Tool";
import { SystemInfoTool } from "./tools/SystemInfoTool";
import { BigFileBase64Tool } from "./tools/BigFileBase64Tool";

// App.tsx —— Renderer 进程的根组件
// 阶段 1:1 个工具 · 阶段 2:2 个工具(引入 IPC)· 阶段 3:3 个工具(引入托盘/系统集成)
// 阶段 4:4 个工具(Stream + Worker 大文件处理)
// 阶段 5 插件化架构时,这里会变成「工具注册表 + 路由」——
// 届时这份 if/else 列表会被彻底替换掉,这正是「架构随需求演进」的体现。
//
// ⚠️ 观察点:每加一个工具,这个文件就要改两处(按钮 + 渲染分支)。
//    这就是阶段 5 要解决的「不可扩展」问题。
export default function App() {
  const [activeTool, setActiveTool] = useState<string>("json-formatter");

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🧰 Toolbox</h1>
        <nav>
          <button
            className={activeTool === "json-formatter" ? "active" : ""}
            onClick={() => setActiveTool("json-formatter")}
          >
            JSON Formatter
          </button>
          <button
            className={activeTool === "base64" ? "active" : ""}
            onClick={() => setActiveTool("base64")}
          >
            Base64 工具
          </button>
          <button
            className={activeTool === "big-base64" ? "active" : ""}
            onClick={() => setActiveTool("big-base64")}
          >
            大文件 Base64
          </button>
          <button
            className={activeTool === "system-info" ? "active" : ""}
            onClick={() => setActiveTool("system-info")}
          >
            系统信息
          </button>
        </nav>
        <div
          style={{
            marginTop: "auto",
            padding: "12px 16px",
            fontSize: "11px",
            color: "#666",
            borderTop: "1px solid #3c3c3c",
            lineHeight: "1.6",
          }}
        >
          💡 点「隐藏到托盘」后,
          <br />
          窗口会消失但应用仍在运行 ——
          <br />
          看系统托盘区找回它。
        </div>
      </aside>
      <main className="content">
        {activeTool === "json-formatter" && <JsonFormatter />}
        {activeTool === "base64" && <Base64Tool />}
        {activeTool === "big-base64" && <BigFileBase64Tool />}
        {activeTool === "system-info" && <SystemInfoTool />}
      </main>
    </div>
  );
}
