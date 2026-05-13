import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.MANAGER_DEV_API_ORIGIN ?? "http://localhost:3001";

export default defineConfig({
  base: "/manager/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "^/manager/(me|leads)(/.*)?$": {
        target: apiTarget,
        changeOrigin: true
      },
      "/auth": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: false
  }
});
