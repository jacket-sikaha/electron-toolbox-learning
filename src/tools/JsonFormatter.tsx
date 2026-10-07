// JsonFormatter.tsx —— 第一个工具
//
// 设计判断:这个工具的逻辑放在 Renderer,因为:
//   1. 不需要 Node API(JSON.parse 是浏览器原生)
//   2. 不需要文件 IO(用户自己粘贴 JSON)
//   3. 不需要系统 API
// 如果一个功能不需要 Node,就放 Renderer —— 最小权限原则。
//
// 这个组件本身只是 boilerplate,你不需要重点看。
// 重点看的是「它放在 src/tools/ 下、跑在 Renderer 进程」这个架构决策。

import { useState, useMemo } from "react";

export function JsonFormatter() {
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
      <div className="tool-body">
        <textarea
          className="input-area"
          placeholder="粘贴 JSON..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <pre className="output-area">
          {error ? <span className="error">⚠ {error}</span> : output}
        </pre>
      </div>
    </div>
  );
}
