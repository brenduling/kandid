import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      registerType: "prompt",

      workbox: {
        cleanupOutdatedCaches: true,
      },

      manifest: {
        name: "Kandid",
        short_name: "Kandid",
        description: "Centralized Election Management System",
        theme_color: "#111827",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
      },
    }),
  ],
});