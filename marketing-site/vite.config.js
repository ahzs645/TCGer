import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendProxyTarget = process.env.MARKETING_API_PROXY_TARGET || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, "")
      }
    }
  },
  build: {
    outDir: "../docs",
    emptyOutDir: false
  }
});
