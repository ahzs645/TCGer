import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendProxyTarget = process.env.MARKETING_API_PROXY_TARGET || "http://localhost:3001";

function staticApiDocsRewrite() {
  return {
    name: "static-api-docs-rewrite",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const pathname = req.url.split("?")[0];
        if (pathname === "/api/docs" || pathname === "/api/docs/") {
          req.url = "/api/docs/index.html";
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), staticApiDocsRewrite()],
  server: {
    proxy: {
      "^/api/(?!docs(?:/|$)|openapi\\.yaml$)": {
        target: backendProxyTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, "")
      }
    }
  }
});
