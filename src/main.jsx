import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { registerServiceWorker } from "./utils/pwa";
import { initializePWAInstallTracking } from "./utils/pwaInstall";

registerServiceWorker();
initializePWAInstallTracking();

function getPWADeploymentMeta(pathname) {
  if (pathname.startsWith("/board") || pathname.startsWith("/eb-login")) {
    return {
      manifest: "/manifest-board.webmanifest",
      title: "KANDID Electoral Board",
    };
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/super-admin")) {
    return {
      manifest: "/manifest-admin.webmanifest",
      title: "KANDID Super Admin",
    };
  }

  return {
    manifest: "/manifest-student.webmanifest",
    title: "KANDID",
  };
}

const pwaMeta = getPWADeploymentMeta(window.location.pathname);
const manifest = document.querySelector("link[rel='manifest']");
const favicon = document.querySelector("link[rel='icon']");
const appleTitle = document.querySelector("meta[name='apple-mobile-web-app-title']");

if (manifest) {
  manifest.href = pwaMeta.manifest;
}

if (appleTitle) {
  appleTitle.content = pwaMeta.title;
}

if (favicon) {
  favicon.href = "/kandid-icon-192.png";
  favicon.type = "image/png";
}

const appleIcon = document.querySelector(
  "link[rel='apple-touch-icon']"
);

if (appleIcon) {
  appleIcon.href = "/apple-touch-icon.png";
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
