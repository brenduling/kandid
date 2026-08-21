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
          icon: <AlertTriangle className="h-6 w-6 text-rose-400" />,
          badgeBg: "bg-rose-500/15 border-rose-500/30 text-rose-300",
          btnBg: "bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-rose-900/40",
          accentColor: "border-rose-500/20",
        };
      case "success":
        return {
          icon: <CheckCircle2 className="h-6 w-6 text-emerald-400" />,
          badgeBg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
          btnBg: "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/40",
          accentColor: "border-emerald-500/20",
        };
      case "error":
        return {
          icon: <XCircle className="h-6 w-6 text-red-400" />,
          badgeBg: "bg-red-500/15 border-red-500/30 text-red-300",
          btnBg: "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-red-900/40",
          accentColor: "border-red-500/20",
        };
      case "warning":
        return {
          icon: <AlertCircle className="h-6 w-6 text-amber-400" />,
          badgeBg: "bg-amber-500/15 border-amber-500/30 text-amber-300",
          btnBg: "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-900/40",
          accentColor: "border-amber-500/20",
        };
      default:
        return {
          icon: <Info className="h-6 w-6 text-cyan-400" />,
          badgeBg: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
          btnBg: "bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-teal-900/40",
          accentColor: "border-cyan-500/20",
        };
    }
  };

  const getToastIcon = (type) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />;
      case "error":
        return <XCircle className="h-5 w-5 text-rose-400 flex-shrink-0" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />;
      default:
        return <Info className="h-5 w-5 text-cyan-400 flex-shrink-0" />;
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
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="fixed inset-0 bg-black/75 backdrop-blur-md"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className={`relative z-10 w-full max-w-md overflow-hidden rounded-[28px] border bg-[#12161f] p-6 text-white shadow-2xl ${currentStyles?.accentColor || "border-white/10"}`}
            >
              {/* Glowing header accent */}
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border ${currentStyles?.badgeBg}`}
                >
                  {currentStyles?.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    {modal.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                    {modal.message}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
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
                    className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/35 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-7 flex items-center justify-end gap-3">
                {modal.showCancel && (
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition shadow-sm"
                  >
                    {modal.cancelText}
                  </button>
                )}

                <button
                  type="button"
                  onClick={confirmModal}
                  autoFocus={!modal.isPromptInput}
                  className={`rounded-2xl px-6 py-2.5 text-sm font-bold shadow-lg transition duration-150 ${currentStyles?.btnBg}`}
                >
                  {modal.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Toasts */}
      <div className="fixed bottom-5 right-5 z-[99999] flex max-w-sm flex-col gap-2.5 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/15 bg-[#0e131d]/95 p-4 text-white shadow-2xl backdrop-blur-xl"
            >
              {getToastIcon(t.type)}
              <div className="min-w-0 flex-1">
                {t.title && (
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    {t.title}
                  </h4>
                )}
                <p className="text-xs leading-relaxed text-slate-300 mt-0.5">
                  {t.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-white transition p-1"
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
