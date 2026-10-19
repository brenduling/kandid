import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function StudentCaptcha({ onToken, resetKey = 0 }) {
  const hostRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return undefined;

    let disposed = false;
    const renderWidget = () => {
      if (disposed || !hostRef.current || !window.turnstile || widgetIdRef.current !== null) return;
      try {
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          size: "flexible",
          theme: "light",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
          "timeout-callback": () => onTokenRef.current(""),
        });
        setReady(true);
      } catch {
        setLoadFailed(true);
      }
    };

    const existing = document.querySelector(`script[src^="${TURNSTILE_SCRIPT}"]`);
    const script = existing || document.createElement("script");
    const onLoad = () => renderWidget();
    const onError = () => setLoadFailed(true);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.turnstile) {
      renderWidget();
    }

    return () => {
      disposed = true;
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenRef.current("");
    }
  }, [resetKey]);

  if (!siteKey) {
    return <p className="student-captcha-warning" role="status">Secure verification is not configured. Please contact support.</p>;
  }

  return (
    <div className="student-captcha" aria-label="Security verification">
      <div ref={hostRef} />
      {!ready && !loadFailed ? <span>Loading security verification…</span> : null}
      {loadFailed ? <span role="alert">Security verification is unavailable. Please try again later.</span> : null}
    </div>
  );
}
