import configureVite from "../vite.config.js";
import process from "node:process";

export default async function configureAcceptance(context) {
  if (context.mode !== "isolated-board-acceptance" || !process.env.KANDID_BOARD_ACCEPTANCE_CACHE_DIR) {
    throw new Error("This config is only for the isolated Board acceptance runner.");
  }
  const configuration = await configureVite(context);
  return { ...configuration, cacheDir: process.env.KANDID_BOARD_ACCEPTANCE_CACHE_DIR };
}
