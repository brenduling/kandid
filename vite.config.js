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

      includeAssets: [
        "kandidlogo.png",
        "kandid-icon-192.png",
        "kandid-icon-512.png",
        "kandid-maskable-512.png",
        "apple-touch-icon.png",
      ],

      workbox: {
        cleanupOutdatedCaches: true,
      },

      manifest: {
        name: "Kandid",
        short_name: "Kandid",
        description: "Student election management with organization access, voting, receipts, results, and administration.",

        theme_color: "#ef4e23",
        background_color: "#fbf7ef",

        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait-primary",

        start_url: "/",
        scope: "/",
        categories: ["education", "productivity"],

        icons: [
          {
            src: "/kandid-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/kandid-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/kandid-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
