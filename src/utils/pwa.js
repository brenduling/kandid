import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker() {
  if (import.meta.env.DEV) {
    return;
  }

  return registerSW({
    immediate: true,

    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent("kandid-pwa-update")
      );
    },

    onOfflineReady() {
      console.log("KANDID is ready for offline use.");
    },

    onRegisteredSW(swUrl, registration) {
      console.log("KANDID service worker registered:", swUrl);

      if (registration) {
        console.log("KANDID PWA update system active.");
      }
    },

    onRegisterError(error) {
      console.error(
        "KANDID service worker registration failed:",
        error
      );
    },
  });
}