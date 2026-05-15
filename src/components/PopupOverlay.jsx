import { useEffect } from "react";
import { createPortal } from "react-dom";

function PopupOverlay({ children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="modal-overlay">
      {children}
    </div>,
    document.body,
  );
}

export default PopupOverlay;
