import { useState } from "react";
import { JsonFormatter } from "./tools/JsonFormatter";
import { Base64Tool } from "./tools/Base64Tool";

// App.tsx —— Renderer 进程的根组件
// 阶段 2:两个工具,JSON Formatter + Base64
// 阶段 5 插件化架构时,这里会变成「工具注册表 + 路由」
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
        </nav>
      </aside>
      <main className="content">
        {activeTool === "json-formatter" && <JsonFormatter />}
        {activeTool === "base64" && <Base64Tool />}
      </main>
    </div>
  );
}
