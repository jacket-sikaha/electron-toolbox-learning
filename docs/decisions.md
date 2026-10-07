# Architecture Decision Records (ADR)

> 架构决策日志。每个重要技术选型/架构调整记录一条 ADR。
> 格式:背景 → 决策 → 理由 → 后果 → 状态。

---

## ADR-001: 三进程模型与安全配置(阶段 1)

**状态**:✅ Accepted
**日期**:2026-10-07

### 背景

Electron 应用默认配置下 Renderer 拥有 Node 能力(nodeIntegration:true),会导致任意 XSS 升级为系统级入侵。需要从一开始选择正确的安全姿势。

### 决策

采用 Electron 官方推荐的安全配置:

- `nodeIntegration: false`
- `contextIsolation: true`
- `preload` 必填(即使阶段 1 空实现)
- Main 用 `app.isPackaged` 判断 dev/prod

### 理由

1. Renderer 必须渲染不可信数据,直接拥有 Node = 灾难
2. Preload 是受控桥,即使 Renderer 被攻破,攻击者也只能调白名单 API
3. `app.isPackaged` 不依赖构建工具,dev/prod 语义明确

### 后果

- 阶段 1 任何需要 Node 的功能都必须走 Preload + IPC(阶段 2 引入)
- 工程复杂度略增,但安全姿态从一开始就锁死
- 架构稳定:阶段 2 加文件 IO 时只改 Preload,不动 Main

---

## ADR-002: 项目文档结构(学习沉淀)

**状态**:✅ Accepted
**日期**:2026-10-07

### 背景

长期学习需要沉淀知识,防止上下文失控(Skill 第 17 条)。需要明确文档结构。

### 决策

建立 `docs/` 目录,包含:

- `learning-protocol.md` —— 学习方法论
- `knowledge-map.md` —— 知识点 checklist + 状态
- `architecture.md` —— 架构决策与演进
- `bug-lab.md` —— Bug 实验室
- `performance.md` —— 性能实验室
- `decisions.md`(本文件)—— ADR 日志

### 理由

- 文档分离:不同类型知识归档到不同文件,避免单文件膨胀
- checklist 可视化:Knowledge Map 进度一目了然
- ADR 风格:每个决策有背景/理由/后果,便于复盘

### 后果

- 每阶段结束需要更新多个文件(成本可控)
- 新增工具/阶段时,文档结构已就位,无需重构

---

(后续 ADR 持续追加)
