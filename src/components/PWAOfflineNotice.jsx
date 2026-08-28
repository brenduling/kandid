import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";

function PWAOfflineNotice() {
  const [offline, setOffline] = useState(() => !window.navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function handleOnline() {
      setOffline(false);
      setDismissed(false);
    }

    function handleOffline() {
      setOffline(true);
      setDismissed(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <aside className="kandid-offline-notice" role="status" aria-live="polite">
      <WifiOff size={18} />
      <div>
        <strong>You're offline.</strong>
        <span>KANDID needs a connection to load the latest election information.</span>
      </div>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss offline notice">
        <X size={16} />
      </button>
    </aside>
  );
}

export default PWAOfflineNotice;
