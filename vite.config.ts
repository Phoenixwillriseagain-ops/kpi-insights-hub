import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  base: "/",
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/xlsx/")) return "xlsx";
          if (id.includes("/recharts/") || id.includes("/d3-") || id.includes("/victory-vendor/")) return "recharts";
          if (id.includes("/@radix-ui/")) return "radix";
          if (id.includes("/html-to-image/")) return "html-to-image";
          if (id.includes("/lucide-react/")) return "lucide";
        },
      },
    },
  },
});
