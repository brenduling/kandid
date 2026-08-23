import { registerSW } from "virtual:pwa-register";

let updateSW = null;

export function registerServiceWorker() {
  if (import.meta.env.DEV) {
    return null;
  }

  updateSW = registerSW({
    immediate: true,

    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent("kandid-pwa-update-available")
      );
    },

    onOfflineReady() {
      console.log("KANDID is ready for offline use.");
    },

    onRegisteredSW(swUrl, registration) {
      console.log(
        "KANDID service worker registered:",
        swUrl
      );

      if (registration) {
        console.log(
          "KANDID PWA update system active."
        );

        // Check for a new deployed version every 60 seconds
        setInterval(() => {
          registration.update().catch((error) => {
            console.error(
              "KANDID PWA update check failed:",
              error
            );
          });
        }, 60 * 1000);
      }
    },

    onRegisterError(error) {
      console.error(
        "KANDID service worker registration failed:",
        error
      );
    },
  });

  return updateSW;
}

export async function updateKandidPWA() {
  if (!updateSW) {
    console.warn(
      "KANDID PWA update function is not ready."
    );
    return;
  }

  await updateSW(true);
}