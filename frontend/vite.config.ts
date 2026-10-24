import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:4000",
        changeOrigin: true
      },
      "/auth": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:4000",
        changeOrigin: true
      },
      "/admin": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
