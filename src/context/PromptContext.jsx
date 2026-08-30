import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  HelpCircle,
  X,
  AlertCircle,
} from "lucide-react";

const PromptContext = createContext(null);

export function PromptProvider({ children }) {
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [promptInputValue, setPromptInputValue] = useState("");

  // Dismiss active modal
  const closeModal = useCallback(() => {
    if (modal?.resolve) {
      modal.resolve(modal.isPromptInput ? null : false);
    }
    setModal(null);
    setPromptInputValue("");
  }, [modal]);

  // Confirm / Accept active modal
  const confirmModal = useCallback(() => {
    if (modal?.resolve) {
      if (modal.isPromptInput) {
        modal.resolve(promptInputValue);
      } else {
        modal.resolve(true);
      }
    }
    setModal(null);
    setPromptInputValue("");
  }, [modal, promptInputValue]);

  // Handle keyboard events (Esc to close, Enter to submit)
  useEffect(() => {
    if (!modal) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      } else if (e.key === "Enter" && !e.shiftKey) {
        // If not in a textarea, submit on enter
        if (e.target.tagName !== "TEXTAREA") {
          e.preventDefault();
          confirmModal();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modal, closeModal, confirmModal]);

  // Core dialog functions
  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      const opts = typeof options === "string" ? { message: options } : (options || {});
      setModal({
        id: Date.now(),
        type: opts.type || "warning", // 'warning' | 'danger' | 'info' | 'success'
        title: opts.title || (opts.type === "danger" ? "Confirm Delete" : "Are you sure?"),
        message: opts.message || "Please confirm to proceed.",
        confirmText: opts.confirmText || (opts.type === "danger" ? "Delete" : "Confirm"),
        cancelText: opts.cancelText || "Cancel",
        showCancel: opts.showCancel !== false,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((options) => {
    return new Promise((resolve) => {
      const opts = typeof options === "string" ? { message: options } : (options || {});
      setModal({
        id: Date.now(),
        type: opts.type || "info", // 'info' | 'error' | 'warning' | 'success'
        title: opts.title || (opts.type === "error" ? "Notice" : opts.type === "success" ? "Success" : "Information"),
        message: opts.message || "",
        confirmText: opts.confirmText || "OK",
        showCancel: false,
        resolve: () => resolve(),
      });
    });
  }, []);

  const prompt = useCallback((options) => {
    return new Promise((resolve) => {
      const opts = typeof options === "string" ? { message: options } : (options || {});
      setPromptInputValue(opts.defaultValue || "");
      setModal({
        id: Date.now(),
        type: opts.type || "info",
        title: opts.title || "Input Required",
        message: opts.message || "Please enter a value:",
        placeholder: opts.placeholder || "",
        confirmText: opts.confirmText || "Submit",
        cancelText: opts.cancelText || "Cancel",
        showCancel: true,
        isPromptInput: true,
        resolve,
      });
    });
  }, []);

  // Toast system
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options) => {
    const opts = typeof options === "string" ? { message: options } : (options || {});
    const id = Date.now() + Math.random();
    const newToast = {
      id,
      title: opts.title,
      message: opts.message,
      type: opts.type || "info", // 'success' | 'error' | 'info' | 'warning'
      duration: opts.duration || 4000,
    };

    setToasts((prev) => [...prev, newToast]);

    if (newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }
  }, [removeToast]);

  const success = useCallback((message, title = "Success") => {
    toast({ message, title, type: "success" });
  }, [toast]);

  const error = useCallback((message, title = "Error") => {
    toast({ message, title, type: "error" });
  }, [toast]);

  const info = useCallback((message, title = "Notice") => {
    toast({ message, title, type: "info" });
  }, [toast]);

  const warning = useCallback((message, title = "Warning") => {
    toast({ message, title, type: "warning" });
  }, [toast]);

  const getVariantStyles = (type) => {
    switch (type) {
      case "danger":
        return {
          icon: <AlertTriangle className="h-5 w-5 text-rose-600" />,
          badgeBg: "bg-rose-50 border-rose-200 text-rose-700",
          btnBg: "danger-btn",
          accentColor: "border-rose-200",
          eyebrow: "Sensitive Operation",
        };
      case "success":
        return {
          icon: <CheckCircle2 className="h-5 w-5 text-emerald-700" />,
          badgeBg: "bg-emerald-50 border-emerald-200 text-emerald-700",
          btnBg: "primary-btn",
          accentColor: "border-emerald-200",
          eyebrow: "Configuration Complete",
        };
      case "error":
        return {
          icon: <XCircle className="h-5 w-5 text-rose-600" />,
          badgeBg: "bg-rose-50 border-rose-200 text-rose-700",
          btnBg: "danger-btn",
          accentColor: "border-rose-200",
          eyebrow: "Configuration Issue",
        };
      case "warning":
        return {
          icon: <AlertCircle className="h-5 w-5 text-orange-600" />,
          badgeBg: "bg-orange-50 border-orange-200 text-orange-700",
          btnBg: "primary-btn",
          accentColor: "border-orange-200",
          eyebrow: "Review Configuration",
        };
      default:
        return {
          icon: <Info className="h-5 w-5 text-[#ef4e23]" />,
          badgeBg: "bg-orange-50 border-orange-200 text-orange-700",
          btnBg: "primary-btn",
          accentColor: "border-orange-200",
          eyebrow: "Configuration",
        };
    }
  };

  const getToastIcon = (type) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 flex-shrink-0" />;
      case "error":
        return <XCircle className="h-5 w-5 flex-shrink-0" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 flex-shrink-0" />;
      default:
        return <Info className="h-5 w-5 flex-shrink-0" />;
    }
  };

  const currentStyles = modal ? getVariantStyles(modal.type) : null;

  return (
    <PromptContext.Provider
      value={{
        confirm,
        alert,
        prompt,
        toast,
        success,
        error,
        info,
        warning,
      }}
    >
      {children}

      {/* Modal Dialog */}
      <AnimatePresence>
        {modal && (
          <div className="modal-overlay prompt-overlay">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.985, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              role="dialog"
              aria-modal="true"
              className={`config-modal relative z-10 w-full max-w-md overflow-hidden border ${currentStyles?.accentColor || "border-orange-200"}`}
            >
              <div className="config-modal-accent" />
              <div className="config-modal-header">
                <div
                  className={`config-icon ${currentStyles?.badgeBg}`}
                >
                  {currentStyles?.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="config-eyebrow">{currentStyles?.eyebrow}</p>
                  <h3 className="config-title">
                    {modal.title}
                  </h3>
                  <p className="config-description">
                    {modal.message}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="config-close-btn"
                  aria-label="Close dialog"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Prompt text input if needed */}
              {modal.isPromptInput && (
                <div className="mt-5">
                  <input
                    type="text"
                    value={promptInputValue}
                    onChange={(e) => setPromptInputValue(e.target.value)}
                    placeholder={modal.placeholder}
                    autoFocus
                    className="field-shell w-full"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="config-footer">
                {modal.showCancel && (
                  <button
                    type="button"
                    onClick={closeModal}
                    className="secondary-btn"
                  >
                    {modal.cancelText}
                  </button>
                )}

                <button
                  type="button"
                  onClick={confirmModal}
                  autoFocus={!modal.isPromptInput}
                  className={currentStyles?.btnBg}
                >
                  {modal.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Toasts */}
      <div className="kandid-toast-viewport">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`kandid-toast kandid-toast-${t.type || "info"}`}
              role={t.type === "error" ? "alert" : "status"}
              aria-live={t.type === "error" ? "assertive" : "polite"}
            >
              <div className="kandid-toast-icon">
                {getToastIcon(t.type)}
              </div>
              <div className="kandid-toast-copy">
                {t.title && (
                  <h4 className="kandid-toast-title">
                    {t.title}
                  </h4>
                )}
                <p className="kandid-toast-message">
                  {t.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="kandid-toast-close"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </PromptContext.Provider>
  );
}

export function usePrompt() {
  const context = useContext(PromptContext);
  if (!context) {
    throw new Error("usePrompt must be used within a PromptProvider");
  }
  return context;
}

export default PromptContext;
