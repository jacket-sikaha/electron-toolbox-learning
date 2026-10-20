// 本地更新源(仅用于验证 electron-updater 的 generic provider,不要用于生产)
//
// 用法:
//   node scripts/dev-update-server.mjs <目录> [端口]
//   node scripts/dev-update-server.mjs D:\updates-src 8080
//
// 它把目录挂在 http://127.0.0.1:8080/updates/ 下 —— 这个路径必须和
// package.json 里 build.publish.url 的结尾一致,否则客户端会 404。
//
// 为什么需要它:
//   electron-updater 的 generic provider 只做两件事:
//     1) GET <url>/latest.yml?noCache=<random>   拿版本清单
//     2) GET <url>/<files[0].url>                拿安装包
//   所以一个「能返回这两个文件、content-length 正确」的静态服务就够了。
//   用 `npx serve` 之类也行,但本地不联网时这个零依赖脚本最稳。

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootArg = process.argv[2] ?? "release";
const port = Number(process.argv[3] ?? 8080);
const root = resolve(rootArg);

// 必须与 package.json 的 build.publish.url 路径保持一致
const prefix = "/updates/";

const MIME = {
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".exe": "application/octet-stream",
  ".blockmap": "application/octet-stream",
  ".zip": "application/octet-stream",
  ".dmg": "application/octet-stream",
};

const server = createServer((req, res) => {
  // 用完整 URL 解析,这样 ?noCache=xxx 这种查询串会被自动忽略
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith(prefix)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`只在这个路径下提供文件: ${prefix}\n收到: ${pathname}\n`);
    return;
  }

  const rel = pathname.slice(prefix.length);
  // 防目录穿越:normalize + 前缀校验
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  let size;
  try {
    size = statSync(file).size;
  } catch {
    console.log(`  [404] ${rel}`);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    // 把「实际服务的根目录」写进响应体。
    // 否则客户端只看到一个光秃秃的 404,而 electron-updater 还会把它包装成
    // 「Please double check that your authentication token is correct」——
    // 我们用的是 generic provider,根本没有 token。那句提示是从 GitHub provider
    // 继承来的通用文案,纯属误导。
    res.end(`not found: ${rel}\n实际服务的根目录: ${root}\n`);
    return;
  }

  console.log(`  [200] ${rel}  (${size} bytes)`);
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": size,
    // 明确告诉客户端不支持分段:generic provider 会据此退化成整包下载,
    // 而不是去发 Range 请求然后拿到一个 200 + 全量,把自己搞糊涂。
    "accept-ranges": "none",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

// ── 启动自检 ────────────────────────────────────────────────────────────────
// 这个自检是「被真实踩坑踩出来」的:有人起服务时忘了传目录,
// 于是 rootArg 回退到 "release",被 resolve 成「当前工作目录/release」——
// 一个恰好存在、但里面没有 latest.yml 的旧构建目录。
// 结果:服务看起来一切正常,客户端却稳定 404,然后被那句 token 提示带偏。
// 结论(和 Bug-008 同一条):**允许配置错,但不允许配置错了不吭声。**
function preflight() {
  const latest = join(root, "latest.yml");
  const st = statSync(latest, { throwIfNoEntry: false });

  if (!process.argv[2]) {
    console.log("");
    console.log("⚠ 没有传目录参数,已回退到默认值 'release'。");
    console.log(`  它被解析成: ${root}`);
    console.log(`  这通常不是你想要的 —— 请显式传 electron-builder 的输出目录:`);
    console.log(`    node scripts\\\\dev-update-server.mjs D:\\\\path\\\\to\\\\release 8080`);
  }

  if (!st) {
    console.log("");
    console.log("⚠ 这个目录里没有 latest.yml —— 客户端检查更新必然拿到 404。");
    console.log(`  自检: Test-Path '${latest}'`);
    console.log(`  当前目录内容: ${
      (() => {
        try {
          return readdirSync(root).join(", ") || "(空目录)";
        } catch {
          return "(目录不存在或不可读)";
        }
      })()
    }`);
    console.log("");
  } else {
    console.log(`  ✓ latest.yml 就位 (${st.size} bytes)`);
    // 顺手把「客户端会要哪些文件」写出来,方便对照 —— 少一次猜。
    try {
      const yml = readFileSync(latest, "utf8");
      const names = [...yml.matchAll(/^\s*-\s*url:\s*(.+)$/gm)].map((m) => m[1].trim());
      if (names.length) {
        for (const n of names) {
          const ok = statSync(join(root, n), { throwIfNoEntry: false });
          console.log(`    ${ok ? "✓" : "✗"} ${n}${ok ? ` (${ok.size} bytes)` : " —— latest.yml 提到了它,但目录里没有!"}`);
        }
      }
    } catch {
      /* 只做辅助提示,读失败不影响服务 */
    }
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`更新源已启动`);
  console.log(`  目录: ${root}`);
  console.log(`  地址: http://127.0.0.1:${port}${prefix}`);
  preflight();
  console.log(`  自检: curl http://127.0.0.1:${port}${prefix}latest.yml`);
});
