import { useEffect, useState } from "react";

const DISMISS_KEY = "kandid-pwa-install-dismissed-until";
const INSTALLED_KEY = "kandid-pwa-installed";
const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

let initialized = false;
let deferredPrompt = null;
const listeners = new Set();

function isStandaloneMode() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function getInstallDismissedUntil() {
  return Number(localStorage.getItem(DISMISS_KEY) || 0);
}

function isKnownInstalled() {
  return isStandaloneMode() || localStorage.getItem(INSTALLED_KEY) === "true";
}

function getPlatformInfo() {
  const userAgent = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(userAgent);

  return {
    isIOS,
    isSafari,
    supportsNativePrompt: Boolean(deferredPrompt),
  };
}

function getSnapshot() {
  const dismissedUntil = getInstallDismissedUntil();
  const standalone = isStandaloneMode();
  const installed = isKnownInstalled();

  return {
    canInstall: Boolean(deferredPrompt) && !standalone && !installed && dismissedUntil < Date.now(),
    deferredPrompt,
    dismissedUntil,
    installed,
    platform: getPlatformInfo(),
    shouldGuideIOS:
      getPlatformInfo().isIOS &&
      getPlatformInfo().isSafari &&
      !standalone &&
      !installed &&
      dismissedUntil < Date.now(),
    shouldShowInstalledHint: installed && !standalone && dismissedUntil < Date.now(),
    standalone,
  };
}

function emit() {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

export function initializePWAInstallTracking() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    localStorage.setItem(INSTALLED_KEY, "true");
    localStorage.removeItem(DISMISS_KEY);
    deferredPrompt = null;
    emit();
  });
}

export function dismissPWAInstallPrompt() {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_COOLDOWN_MS));
  emit();
}

export async function promptKandidInstall() {
  if (!deferredPrompt) return { outcome: "unavailable" };

  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  promptEvent.prompt();
  const choice = await promptEvent.userChoice;

  if (choice?.outcome === "accepted") {
    localStorage.setItem(INSTALLED_KEY, "true");
    localStorage.removeItem(DISMISS_KEY);
  } else {
    dismissPWAInstallPrompt();
  }

  emit();
  return choice;
}

export function usePWAInstallState() {
  const [state, setState] = useState(() => getSnapshot());

  useEffect(() => {
    initializePWAInstallTracking();
    listeners.add(setState);
    setState(getSnapshot());

    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
