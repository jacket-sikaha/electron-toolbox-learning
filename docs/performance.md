# Performance Lab

> 性能实验室。所有性能问题必须量化,禁止"感觉比较慢"。
> 闭环:现象 → 指标 → 定位 → 原因 → 优化 → 再测量 → 比较。

---

## 性能指标清单

| 指标 | 单位 | 测量方式 | 目标 |
|------|------|---------|------|
| 启动时间(冷启动) | ms | 主进程 app ready 到窗口 ready-to-show | < 1500ms |
| 启动时间(渲染就绪) | ms | window ready-to-show 到 React mount | < 800ms |
| IPC 单次往返延迟 | ms | ipcRenderer.invoke + ipcMain.handle 测量 | < 5ms |
| IPC 大数据吞吐 | MB/s | 1MB / 10MB 数据 IPC 传输 | 阶段 4 测 |
| 内存(单窗口) | MB | process.memoryUsage + 渲染进程 | < 200MB |
| CPU(空闲) | % | 任务管理器 / process.cpuUsage | < 1% |
| Bundle Size | KB | dist/ 总大小 | 监控增长 |
| Build Time | s | pnpm build 总耗时 | 监控增长 |

---

## 性能实验记录

(每个性能实验完成下面的模板)

### Perf-001: [标题]

**日期**:
**指标**: 启动 / 内存 / CPU / IPC / IO / Bundle

**Baseline(基线)**:
```
具体数值 + 测量方式
```

**瓶颈定位**:
- 怀疑点 1: ...
- 怀疑点 2: ...

**假设**:
> 改 X 应该能让 Y 下降多少

**修改**:
> 改了什么

**重新测量**:
```
修改后数值
```

**比较**:
| 指标 | Baseline | After | 改善 |
|------|---------|-------|------|
| ... | ... | ... | ... |

**结论**:
> 是否验证假设?为什么?是否有副作用?

---

(待第一个性能实验时填入)
