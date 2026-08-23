import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { registerServiceWorker } from "./utils/pwa";
import kandidLogo from "./assets/kandidlogo.png";

registerServiceWorker();

const favicon = document.querySelector("link[rel='icon']");

if (favicon) {
  favicon.href = kandidLogo;
  favicon.type = "image/png";
}

const appleIcon = document.querySelector(
  "link[rel='apple-touch-icon']"
);

if (appleIcon) {
  appleIcon.href = kandidLogo;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);