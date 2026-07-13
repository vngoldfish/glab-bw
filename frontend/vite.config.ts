import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

export default defineConfig({
  plugins: [react()],
  build: {
    // Code splitting: chia bundle thành nhiều chunk nhỏ để tải nhanh hơn
    rollupOptions: {
      output: {
        manualChunks: {
          // React core riêng
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // React Flow tách riêng (~300KB)
          "vendor-xyflow": ["@xyflow/react"],
          // Lucide icons tách riêng (~150KB)
          "vendor-lucide": ["lucide-react"],
          // Các trang lớn nhất tách riêng
          "page-workflow": ["./src/pages/WorkflowPage"],
          "page-video-editor": ["./src/pages/VideoEditorPage"],
          "page-settings": ["./src/pages/SettingsPage"],
          "page-docs": ["./src/pages/DocsPage", "./src/pages/ApiDocsPage"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        // When backend is restarting, Vite default is opaque 500 — surface a clear 502.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const r = res as ServerResponse | undefined;
            if (r && !r.headersSent && typeof r.writeHead === "function") {
              r.writeHead(502, { "Content-Type": "application/json" });
              r.end(
                JSON.stringify({
                  error: "Backend offline (127.0.0.1:8765). Start uvicorn / CHAY-APP.",
                  detail: String((err as Error)?.message || err),
                }),
              );
            }
          });
          proxy.on("proxyReq", (_proxyReq, req: IncomingMessage) => {
            // keep path as-is; useful when debugging space-encoded file URLs
            void req;
          });
        },
      },
    },
  },
});