import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend ports default to the run.sh values but can be overridden via env
// (e.g. API_PORT=8081) so the proxy always points at the running api-server.
const API_PORT = process.env.API_PORT ?? "8080";
const ML_PORT = process.env.ML_PORT ?? "8001";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
      // Direct line to the Topic-Cluster ml-service so the browser can
      // cluster posts it fetched itself (e.g. the user's home timeline).
      "/ml": {
        target: `http://localhost:${ML_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ml/, ""),
      },
    },
  },
});
