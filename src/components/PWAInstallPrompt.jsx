import { Download, Home, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import logo from "../assets/kandidlogo.png";
import {
  dismissPWAInstallPrompt,
  promptKandidInstall,
  usePWAInstallState,
} from "../utils/pwaInstall";

function PWAInstallPrompt() {
  const [readyToShow, setReadyToShow] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const {
    canInstall,
    shouldGuideIOS,
    shouldShowInstalledHint,
    standalone,
  } = usePWAInstallState();

  useEffect(() => {
    const timer = window.setTimeout(() => setReadyToShow(true), 1800);

    function handleUpdateAvailable() {
      setUpdateAvailable(true);
    }

    window.addEventListener("kandid-pwa-update-available", handleUpdateAvailable);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("kandid-pwa-update-available", handleUpdateAvailable);
    };
  }, []);

  if (!readyToShow || standalone || updateAvailable || (!canInstall && !shouldGuideIOS && !shouldShowInstalledHint)) {
    return null;
  }

  const isGuidance = shouldGuideIOS && !canInstall;
  const isInstalledHint = shouldShowInstalledHint && !canInstall && !isGuidance;

  async function handleInstall() {
    await promptKandidInstall();
  }

  return (
    <aside className="kandid-pwa-install" aria-live="polite">
      <div className="kandid-pwa-card">
        <button
          type="button"
          className="kandid-pwa-close"
          onClick={dismissPWAInstallPrompt}
          aria-label="Dismiss install prompt"
        >
          <X size={17} />
        </button>

        <div className="kandid-pwa-head">
          <img src={logo} alt="KANDID Logo" />
          <div>
            <span>KANDID</span>
            <strong>Wait, you can count on me.</strong>
          </div>
        </div>

        <div className="kandid-pwa-body">
          {isInstalledHint ? (
            <>
              <Smartphone size={20} />
              <div>
                <h3>KANDID is installed</h3>
                <p>Open KANDID from your Home Screen, Start menu, dock, or apps list. You can continue here in the browser.</p>
              </div>
            </>
          ) : isGuidance ? (
            <>
              <Home size={20} />
              <div>
                <h3>Install KANDID</h3>
                <p>On iPhone or iPad, tap Share, choose Add to Home Screen, then tap Add.</p>
              </div>
            </>
          ) : (
            <>
              <Download size={20} />
              <div>
                <h3>Install KANDID</h3>
                <p>Keep KANDID closer on your device for quicker access.</p>
              </div>
            </>
          )}
        </div>

        <div className="kandid-pwa-actions">
          <button type="button" onClick={dismissPWAInstallPrompt}>
            {isInstalledHint || isGuidance ? "Continue Here" : "Not Now"}
          </button>

          {canInstall ? (
            <button type="button" onClick={handleInstall}>
              Install
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export default PWAInstallPrompt;
