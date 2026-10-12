// src/tools/index.ts —— 组件映射表(只在 Renderer)
//
// ════════════════════════════════════════════════════════════════════════
// 阶段 5 核心文件 4/4:声明与实现分离的「实现」这一半
// ════════════════════════════════════════════════════════════════════════
//
// 为什么这张表不能放进 shared/tool-manifest.ts?
//   因为它 import 的是 React 组件 —— Main 进程 import 组件会直接崩
//   (Node 里没有 document / window,构建也过不去)。
//   所以:【纯数据共享,React 实现留在 Renderer】。
//
// 这张表 + TOOL_MANIFEST 的分工:
//   TOOL_MANIFEST   :「有哪些工具、叫什么、要什么权限」← 两端都要读
//   TOOL_COMPONENTS :「id 对应的界面在哪」           ← 只有 Renderer 要读
//
// 加一个新工具,总共改两个文件:
//   ① shared/tool-manifest.ts  → 加一条声明(侧边栏自动出现)
//   ② src/tools/index.ts       → 加一行映射(界面能被渲染出来)
//
// ★ 这就是阶段 7 做懒加载时要动的地方 —— 到时候把静态 import
//   换成 React.lazy(() => import("./XxxTool")),这张表结构不变。
//   一个「预留的接口位」:现在写下它成本极低,以后改造收益极高。

import type { ComponentType } from "react";
import type { ToolProps } from "./types";

import { JsonFormatter } from "./JsonFormatter";
import { Base64Tool } from "./Base64Tool";
import { BigFileBase64Tool } from "./BigFileBase64Tool";
import { SystemInfoTool } from "./SystemInfoTool";

/**
 * id → 组件 的映射。
 *
 * key 必须与 shared/tool-manifest.ts 里的 meta.id 完全一致 ——
 * 不一致的后果是「侧边栏有这个工具,点了却渲染不出东西」。
 * 这类「字符串 key 对不上」的问题 TypeScript 帮不了你,
 * 所以下面 export 了一个自检函数,开发期可以跑一次。
 */
export const TOOL_COMPONENTS: Record<string, ComponentType<ToolProps>> = {
  "json-formatter": JsonFormatter,
  base64: Base64Tool,
  "big-base64": BigFileBase64Tool,
  "system-info": SystemInfoTool,
};

/**
 * 开发期自检:清单里的每个 id 都要有对应组件,反之亦然。
 *
 * 为什么需要它?因为「注册表」这种机制最典型的故障就是「登记了但没有实现」。
 * 把这类检查写成代码(而不是靠人记住),是注册表架构能不能长期维护的关键。
 * 阶段 6 做工程化时,这条会变成构建期的一道检查。
 *
 * @returns 不一致项的说明;全部一致时返回空数组
 */
export function auditRegistry(
  manifestIds: readonly string[]
): string[] {
  const problems: string[] = [];

  for (const id of manifestIds) {
    if (!TOOL_COMPONENTS[id]) {
      problems.push(`❌ 清单里声明了工具「${id}」,但 TOOL_COMPONENTS 里没有对应组件`);
    }
  }
  for (const id of Object.keys(TOOL_COMPONENTS)) {
    if (!manifestIds.includes(id)) {
      problems.push(`❌ TOOL_COMPONENTS 里有组件「${id}」,但清单里没有声明它`);
    }
  }

  return problems;
}
