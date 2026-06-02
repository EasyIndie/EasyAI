import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  resolve: {
    alias: {
      "@easyai/ui": path.resolve(repoRoot, "shared-ui/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
