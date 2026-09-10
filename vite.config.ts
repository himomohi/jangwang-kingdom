import { defineConfig } from "vite";

export default defineConfig({
  base: "/jangwang-kingdom/",
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
