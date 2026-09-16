import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/client",
  base: "/AccessibilityLatest2026/",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), "src/client/github.html")
    }
  }
});
