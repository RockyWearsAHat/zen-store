import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import express from "./plugins/viteExpress";

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 4000,
  },
  plugins: [react(), tailwindcss(), express("server/server.ts")],
  build: {
    outDir: "dist",
    // assetsDir: "assets", // default is fine
  },
});
