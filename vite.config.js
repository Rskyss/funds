import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND_PORT = process.env.BACKEND_PORT || 8787;
// 开发端口可用 FRONTEND_PORT 覆盖（本机 5173 常被其它服务占用）
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 5174);

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: {
    port: FRONTEND_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
