import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
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