// App.tsx —— Renderer 进程的根组件
//
// ════════════════════════════════════════════════════════════════════════
// 阶段 5:从 if/else 硬编码 → 注册表驱动
// ════════════════════════════════════════════════════════════════════════
//
// 阶段 4 结束时这个文件 73 行,4 个工具 = 8 处硬编码(4 个按钮 + 4 个渲染分支)。
// 每加一个工具要改两处 —— 这就是「不可扩展」的痛点。
//
// 阶段 5 改造后,这个文件不再知道「具体有哪些工具」:
//   - 侧边栏:TOOL_MANIFEST.map(...) 自动渲染
//   - 内容区:TOOL_COMPONENTS[activeId] 自动匹配组件
//   - ctx 注入:buildContext(entry.permissions) 按权限裁剪
//
// 加一个新工具,App.tsx 【一行都不用改】 —— 只改两个文件:
//   ① shared/tool-manifest.ts → 加声明(侧边栏自动出现)
//   ② src/tools/index.ts      → 加组件映射(界面能被渲染)
//
// 这就是注册表架构的核心价值:【开放-封闭原则】—— 对扩展开放(加新工具),
// 对修改封闭(已有的代码不用动)。
//
// ────────────────────────────────────────────────────────────────────────
// 数据流(工具激活时):
//
//   用户点侧边栏按钮
//     → setActiveTool(id)
//     → getToolEntry(id) 查到 manifest 里的 permissions
//     → buildContext(permissions) 裁剪出只含声明能力的 ctx
//     → TOOL_COMPONENTS[id] 拿到组件
//     → <Component ctx={ctx} /> 渲染
//
// 全程 App.tsx 不知道:通道名 / ipcRenderer / 具体工具有几个 / 它们要什么权限。
// ────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import { TOOL_MANIFEST, getToolEntry } from "../shared/tool-manifest";
import { TOOL_COMPONENTS, auditRegistry } from "./tools";
import { buildContext } from "./tools/context-factory";

// 开发期自检:清单里的每个 id 都要有对应组件,反之亦然。
// 在模块加载时跑一次,如果有不一致直接打 console.error。
// 阶段 6 做工程化时,这条会变成构建期检查(或 vitest 测试)。
{
  const problems = auditRegistry(TOOL_MANIFEST.map((t) => t.meta.id));
  if (problems.length > 0) {
    console.error("[registry audit]\n" + problems.join("\n"));
  }
}

export default function App() {
  const [activeTool, setActiveTool] = useState<string>("json-formatter");

  // 当前激活工具的 ctx —— 按 permissions 裁剪后的能力视图。
  // 切换工具时自动重新计算。
  //
  // 为什么用 useMemo?
  //   buildContext 每次调用会 new 出新的方法对象。
  //   不 memo 的话每次渲染都重建 ctx → 工具组件收到新 props → 不必要的重渲染。
  //   依赖数组只放 activeTool:切换工具才重建 ctx,其他 state 变化不动它。
  const ctx = useMemo(() => {
    const entry = getToolEntry(activeTool);
    if (!entry) return {};
    return buildContext(entry.permissions);
  }, [activeTool]);

  // 当前激活工具的组件
  const ActiveComponent = TOOL_COMPONENTS[activeTool];

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🧰 Toolbox</h1>
        <nav>
          {/* 侧边栏:从注册表自动渲染,不硬编码任何工具 */}
          {TOOL_MANIFEST.map((entry) => (
            <button
              key={entry.meta.id}
              className={activeTool === entry.meta.id ? "active" : ""}
              onClick={() => setActiveTool(entry.meta.id)}
            >
              <span style={{ marginRight: "6px" }}>{entry.meta.icon}</span>
              {entry.meta.name}
            </button>
          ))}
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
        {/* 内容区:按 id 从映射表取组件,注入裁剪后的 ctx */}
        {ActiveComponent ? (
          <ActiveComponent ctx={ctx} />
        ) : (
          <div style={{ padding: "40px", color: "#858585" }}>
            ⚠ 找不到工具组件:activeTool="{activeTool}"
            <br />
            <br />
            这说明 TOOL_MANIFEST 和 TOOL_COMPONENTS 不一致 ——
            打开控制台看 [registry audit] 的报错。
          </div>
        )}
      </main>
    </div>
  );
}
