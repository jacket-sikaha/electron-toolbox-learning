# Electron Toolbox Learning

> 通过构建一个可无限扩展的 Electron Desktop Toolbox 学习 Electron。
> 学习方法论见 [docs/learning-protocol.md](./docs/learning-protocol.md)。

## 学习目标

四个一级能力(优先级从高到低):

1. **架构设计** —— 模块边界、数据流、生命周期、扩展方式
2. **重点基础** —— 进程模型、IPC、生命周期、安全配置
3. **Bug / 安全 / 边界** —— 高频 Bug、内存泄漏、安全风险、生产环境差异
4. **性能与工程优化** —— 启动、CPU、内存、IPC、打包、日志

## 当前状态

- **阶段**:1(地基:进程模型 + 最小实现)
- **进度**:理论已通,最小实现已生成,待运行验证
- **下一步**:运行 `pnpm dev` 验证 → 进入阶段 2(IPC 与安全边界)

## 项目结构

```
electron-toolbox-learning/
├── docs/                 # 学习文档
│   ├── learning-protocol.md
│   ├── knowledge-map.md
│   ├── architecture.md
│   ├── bug-lab.md
│   ├── performance.md
│   └── decisions.md
├── electron/             # Main 进程 + Preload
│   ├── main.ts
│   └── preload.ts
├── src/                  # Renderer(React SPA)
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── tools/
│       └── JsonFormatter.tsx
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.node.json
```

## 开发

```bash
pnpm install
pnpm dev
```

## 学习文档导航

- [Knowledge Map](./docs/knowledge-map.md) —— 知识点进度
- [Architecture](./docs/architecture.md) —— 架构决策与复盘
- [Bug Lab](./docs/bug-lab.md) —— Bug 实验室
- [Performance Lab](./docs/performance.md) —— 性能实验室
- [Decisions](./docs/decisions.md) —— ADR 日志
- [Learning Protocol](./docs/learning-protocol.md) —— 学习方法论
