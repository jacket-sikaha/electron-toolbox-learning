import { useState } from "react";
import { JsonFormatter } from "./tools/JsonFormatter";

// App.tsx —— Renderer 进程的根组件
// 阶段 1:只有一个工具,直接渲染。
// 阶段 5 插件化架构时,这里会变成「工具注册表 + 路由」。
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
        </nav>
      </aside>
      <main className="content">
        {activeTool === "json-formatter" && <JsonFormatter />}
      </main>
    </div>
  );
}
