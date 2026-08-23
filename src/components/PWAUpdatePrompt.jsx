import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { updateKandidPWA } from "../utils/pwa";

function PWAUpdatePrompt() {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        function handleUpdateAvailable() {
            setUpdateAvailable(true);
        }

        window.addEventListener(
            "kandid-pwa-update-available",
            handleUpdateAvailable
        );

        return () => {
            window.removeEventListener(
                "kandid-pwa-update-available",
                handleUpdateAvailable
            );
        };
    }, []);

    async function handleUpdate() {
        try {
            setUpdating(true);
            await updateKandidPWA();
        } catch (error) {
            console.error("KANDID update failed:", error);
            setUpdating(false);
        }
    }

    if (!updateAvailable) return null;

    return (
        <div className="fixed bottom-5 right-5 z-[99999] w-[min(440px,calc(100vw-2rem))]">
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
                <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-[#e86c2f]">
                        <RefreshCw size={22} />
                    </div>

                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-black text-gray-900">
                            New KANDID version available
                        </h3>

                        <p className="mt-1 text-sm leading-5 text-gray-500">
                            A newer version of KANDID is ready. Update now to use
                            the latest interface and features.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => setUpdateAvailable(false)}
                        disabled={updating}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                        aria-label="Close update notification"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="mt-5 flex gap-2">
                    <button
                        type="button"
                        onClick={() => setUpdateAvailable(false)}
                        disabled={updating}
                        className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                        Later
                    </button>

                    <button
                        type="button"
                        onClick={handleUpdate}
                        disabled={updating}
                        className="flex-1 rounded-xl bg-[#e86c2f] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#d85b24] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {updating ? "Updating..." : "Update Now"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default PWAUpdatePrompt;