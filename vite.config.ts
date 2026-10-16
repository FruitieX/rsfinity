import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1600 },
  test: { environment: "node", testTimeout: 60_000 },
});
