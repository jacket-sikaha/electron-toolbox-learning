// JsonFormatter.tsx —— 第一个工具
//
// 设计判断:这个工具的逻辑放在 Renderer,因为:
//   1. 不需要 Node API(JSON.parse 是浏览器原生)
//   2. 不需要文件 IO(用户自己粘贴 JSON)
//   3. 不需要系统 API
// 如果一个功能不需要 Node,就放 Renderer —— 最小权限原则。
//
// ────────────────────────────────────────────────────────────────────────
// 阶段 5 变化:它现在收到 ToolProps,但 permissions 是 [] → ctx = {}
//
// 这不是「忘了给它能力」,而是最小权限原则的正面体现:
//   阶段 4 它虽然不用 Node,却仍然能调到 window.electronAPI.bigBase64();
//   阶段 5 它连 ctx.fs 这个属性都访问不到 —— 因为框架根本没创建它。
//
// 这个组件本身只是 boilerplate,你不需要重点看。
// 重点看的是「它放在 src/tools/ 下、跑在 Renderer 进程、拿到的 ctx 是空对象」
// 这几个架构事实。
// ────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import type { ToolProps } from "./types";

export function JsonFormatter(_props: ToolProps) {
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState(2);

  const { output, error } = useMemo(() => {
    if (!input.trim()) {
      return { output: "", error: null };
    }
    try {
      const parsed = JSON.parse(input);
      return { output: JSON.stringify(parsed, null, indent), error: null };
    } catch (e) {
      return { output: "", error: (e as Error).message };
    }
  }, [input, indent]);

  return (
    <div className="tool">
      <header className="tool-header">
        <h2>JSON Formatter</h2>
        <label>
          缩进:
          <select value={indent} onChange={(e) => setIndent(Number(e.target.value))}>
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value={0}>压缩</option>
          </select>
        </label>
      </header>

      {error && (
        <div className="error" style={{ padding: "8px 16px" }}>
          ⚠ {error}
        </div>
      )}

      <div className="tool-body">
        <textarea
          className="input-area"
          placeholder="粘贴 JSON..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <pre className="output-area">{output}</pre>
      </div>
    </div>
  );
}
