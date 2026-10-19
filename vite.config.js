import { defineConfig, loadEnv } from "vite";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { validateSupabaseBuildEnvironment } from "./scripts/supabase-env-policy.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  validateSupabaseBuildEnvironment(mode, env);
  const localProductionReadonly = mode === "localhost-production-readonly";

  if (localProductionReadonly) {
    const modeEnvPath = resolve(process.cwd(), `.env.${mode}.local`);
    if (!existsSync(modeEnvPath)) {
      throw new Error("Local production testing blocked: the explicit ignored mode configuration is missing.");
    }
    const explicitEnv = parseDotenv(readFileSync(modeEnvPath));
    validateSupabaseBuildEnvironment(mode, explicitEnv);
    for (const key of [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_KEY",
      "KANDID_SUPABASE_KEY_PROJECT_REF",
      "KANDID_LOCAL_PRODUCTION_READONLY",
    ]) {
      if (!explicitEnv[key] || env[key] !== explicitEnv[key]) {
        throw new Error("Local production testing blocked: Vite environment does not match the explicit opt-in file.");
      }
    }
  }

  return {
  server: localProductionReadonly
    ? { host: "localhost", port: 5173, strictPort: true }
    : mode === "development"
      ? { host: "localhost", port: 5174, strictPort: true }
      : undefined,
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
  };
});
