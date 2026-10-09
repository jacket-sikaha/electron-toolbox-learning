// electron/base64-worker.ts —— Worker 线程:负责 Base64 编码计算
//
// ============================================================================
// 为什么需要这个文件?
// ----------------------------------------------------------------------------
// Base64 编码 100MB 数据是 CPU 密集任务。如果跑在 Main 主线程上:
//   - Main 主线程被占满 → 事件循环阻塞
//   - 所有窗口失去响应、菜单点不动、托盘没反应、IPC 全部卡住
//   - 用户以为程序死了,去任务管理器强杀
//
// Worker Threads 的价值:把这段计算搬到「另一个线程」。
// 主线程只负责「把数据交给 Worker」和「接收 Worker 的结果」,
// 全程不被占用,界面保持流畅。
//
// ============================================================================
// 线程间通信:postMessage / parentPort.on('message')
// ----------------------------------------------------------------------------
// Worker 和主线程是两个独立的 JS 环境(不共享内存),只能通过消息传递:
//   主线程:worker.postMessage({ id, chunk })   → 发任务
//   Worker:parentPort.on('message', ...)        → 收任务
//   Worker:parentPort.postMessage({ id, result }) → 回结果
//
// 注意:chunk 是 Buffer,通过 structured clone 传递时会被复制一份
// (不是零拷贝)。这是 Worker 的固有代价 —— 换来的是主线程不卡。
// ============================================================================

import { parentPort } from "node:worker_threads";

// Worker 收到的任务结构
interface EncodeTask {
  id: number; // 任务序号,用于匹配「哪个请求对应哪个响应」
  chunk: Uint8Array; // 要编码的数据块
  mustAlign?: boolean; // true = 这一块后面还有数据,长度必须是 3 的倍数(Bug-A 护栏)
}

// Worker 返回的结果结构
interface EncodeResult {
  id: number;
  base64: string;
}

// 关键设计 1:只在 worker_threads 环境里执行
// 这个文件既是 Worker 的入口,也可能被 tsc 当普通模块编译。
// 加这个判断可以避免在非 Worker 环境(比如误被 import 到主线程)时报错。
if (parentPort) {
  // 关键设计 2:监听主线程发来的任务
  parentPort.on("message", (task: EncodeTask) => {
    const { id, chunk } = task;

    // 关键设计 3:Base64 编码
    //
    // 这里用 Buffer.from(chunk).toString('base64')。
    // 为什么不用浏览器那个 btoa?
    //   - btoa 只接受「字符串」参数,chunk 是字节数据,直接传会报错
    //   - 而且 btoa 对非 Latin-1 字符会抛 InvalidCharacterError
    //   - Buffer 是 Node 原生,专门处理字节 → Base64,无需额外转换
    //
    // ⚠️ 关键约束:这个 chunk 的大小必须是 3 的倍数!
    //    Base64 是「3 字节 → 4 字符」。如果一块数据的长度不是 3 的倍数,
    //    这一块单独编码后末尾会带 padding(=),拼到整体里就错了。
    //    这个约束由主线程保证(见 main.ts 的 BLOCK_SIZE 定义),
    //    Worker 这边只管编码,不负责校验 —— 职责分离。
    const base64 = Buffer.from(chunk).toString("base64");

    // 防御性断言(Bug-A 的产物):中间块必须是 3 的倍数
    //
    // 注意这里的判断方式 —— 不是简单断言「chunk.length % 3 === 0」,
    // 因为「最后一块」允许是任意长度(它的 padding 是合法结尾)。
    // 主线程通过 task.mustAlign 告诉我们「这一块后面还有没有数据」。
    //
    // 这个断言的价值:即使主线程的 BLOCK_SIZE 断言被绕过(比如未来加了
    // 新的分块策略),Worker 这一层也能挡住 —— 纵深防御,两层护栏。
    if (task.mustAlign && chunk.length % 3 !== 0) {
      throw new Error(
        `[致命错误] 中间块长度必须是 3 的倍数(Bug-A),当前 ${chunk.length}(余 ${chunk.length % 3})`
      );
    }

    // 关键设计 4:把结果发回主线程,带上 id 用于配对
    parentPort!.postMessage({ id, base64 } satisfies EncodeResult);
  });

  // 关键设计 5:Worker 出错时通知主线程
  // 注意:这里的错误指的是「Worker 里未捕获的异常」。
  // 如果在 message 处理器里 try/catch 了,就不会走到这里。
  parentPort.on("error", (err) => {
    // 不吞掉错误 —— 让主线程的 worker.on('error') 能收到
    console.error("[base64-worker] error:", err);
  });
}
