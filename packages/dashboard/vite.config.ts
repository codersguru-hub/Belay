import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    host: "127.0.0.1",
    port: 3421,
    proxy: {
      "/api": "http://127.0.0.1:3420",
      "/events": { target: "ws://127.0.0.1:3420", ws: true }
    }
  }
});
