// 开发模式：同时启动后端（另一端口）+ Vite dev，Vite 代理 /api 到后端。
// 不改 server.mjs，仅通过 PORT 环境变量让后端跑在 8787。
import { spawn } from "node:child_process";

const BACKEND_PORT = process.env.BACKEND_PORT || "8787";

const procs = [];

function run(name, cmd, args, env) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  p.on("exit", (code) => {
    console.log(`[dev] ${name} 退出 (code=${code})，关闭其余进程`);
    shutdown();
  });
  procs.push(p);
  return p;
}

function shutdown() {
  for (const p of procs) {
    if (!p.killed) p.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("backend", "node", ["--env-file=.env", "server.mjs"], { PORT: BACKEND_PORT });
run("vite", "npx", ["vite"], { BACKEND_PORT });

console.log(`[dev] 后端 http://127.0.0.1:${BACKEND_PORT} · 前端 http://localhost:5173`);
