import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

function PopupOverlay({ children }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return undefined;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusable = Array.from(overlay.querySelectorAll(focusableSelector));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus?.();

    function handleKeyDown(event) {
      if (event.key !== "Tab" || focusable.length === 0) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    overlay.addEventListener("keydown", handleKeyDown);
    return () => overlay.removeEventListener("keydown", handleKeyDown);
  }, []);

  return createPortal(
    <div ref={overlayRef} className="modal-overlay" role="presentation">
      {children}
    </div>,
    document.body,
  );
}

export default PopupOverlay;
