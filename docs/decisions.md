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

## ADR-003:阶段 2 IPC 架构与安全设计

**状态**:✅ Accepted
**日期**:2026-10-08

### 背景

Base64 工具需要读本地文件,Renderer 在安全配置下没有 `fs` / `dialog` 等 Node API,必须通过 IPC 让 Main 干活。需要设计 Preload API 签名和防御策略。

### 决策

1. **方案 2:零入参 API** —— `selectAndReadFile()` 不接收 path,Main 内部 `dialog` 选完直接读
2. **API 合并**:选文件 + 读文件合并为一个原子操作,不暴露 `readFile(path)`
3. **channel 命名**:`tool:select-and-read-file`,`tool:` 前缀分组
4. **handle/invoke 而非 on/send**:双向通信 + Promise,异步友好
5. **纵深防御**:Main 侧加 10MB 文件大小限制(阶段 4 改 Stream)

### 理由

1. **零入参 = 零攻击面**:Renderer 不传 path,无法伪造路径,天然防路径穿越
2. **API 合并减少暴露面**:暴露 `readFile(path)` 会让 path 成为攻击向量
3. **handle/invoke 是 Electron 推荐姿势**:返回 Promise,比 on/send 的回调风格更安全
4. **纵深防御**:即使方案 2 天然安全,Main 仍守文件大小边界,防 OOM

### 后果

- Renderer 拿不到 path,无法自行选择读哪个文件(安全特性,非缺陷)
- 文件大小限制 10MB,大文件需等阶段 4 Stream 改造
- 后续工具增多后,channel 命名的 `tool:` 前缀分组会发挥作用

---

(后续 ADR 持续追加)
