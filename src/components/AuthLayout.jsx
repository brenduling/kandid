import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/kandidlogo.png";

function AuthLayout({
  roleLabel,
  title,
  copy,
  backTo = "/",
  children,
}) {
  const navigate = useNavigate();
  const screenRef = useRef(null);
  const [keyboardActive, setKeyboardActive] = useState(false);

  useEffect(() => {
    const root = screenRef.current;
    if (!root) return undefined;

    let focusTimer;
    let blurTimer;

    const isKeyboardViewport = () =>
      window.matchMedia("(max-width: 1023px), (pointer: coarse)").matches;

    const updateVisualViewport = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;

      root.style.setProperty("--kandid-visual-height", `${viewport.height}px`);

      if (isKeyboardViewport()) {
        setKeyboardActive(window.innerHeight - viewport.height > 120);
      }
    };

    const isFormControl = (target) =>
      target instanceof HTMLElement && target.matches("input, textarea, select");

    const handleFocusIn = (event) => {
      if (!isFormControl(event.target) || !isKeyboardViewport()) return;

      window.clearTimeout(focusTimer);
      window.clearTimeout(blurTimer);
      setKeyboardActive(true);
      focusTimer = window.setTimeout(() => {
        event.target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      }, 220);
    };

    const handleFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (!root.contains(activeElement) || !isFormControl(activeElement)) {
          setKeyboardActive(false);
        }
      }, 160);
    };

    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("focusout", handleFocusOut);
    window.visualViewport?.addEventListener("resize", updateVisualViewport);
    window.visualViewport?.addEventListener("scroll", updateVisualViewport);
    updateVisualViewport();

    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(blurTimer);
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("focusout", handleFocusOut);
      window.visualViewport?.removeEventListener("resize", updateVisualViewport);
      window.visualViewport?.removeEventListener("scroll", updateVisualViewport);
    };
  }, []);

  return (
    <div
      ref={screenRef}
      className={`kandid-auth-screen${keyboardActive ? " is-keyboard-active" : ""}`}
    >
      <section className="kandid-auth-identity">
        <div className="kandid-auth-brand">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </div>
        <div>
          <p>{roleLabel}</p>
          <h1>Wait, you can count on me.</h1>
          <span>{copy}</span>
        </div>
      </section>

      <main className="kandid-auth-main">
        <button
          type="button"
          className="kandid-auth-back"
          onClick={() => navigate(backTo)}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <section className="kandid-auth-card">
          <div className="kandid-auth-card-head">
            <span>
              <LockKeyhole size={14} />
              {roleLabel}
            </span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </div>
          {children}
        </section>
      </main>
    </div>
  );
}

export default AuthLayout;
