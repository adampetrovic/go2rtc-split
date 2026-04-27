import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
