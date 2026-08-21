import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

function ReloadPrompt() {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW();

    if (!needRefresh) {
        return null;
    }

    return (
        <div className="fixed bottom-6 right-6 z-[9999] w-[360px] rounded-2xl bg-[#111827] p-5 text-white shadow-2xl">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white/10 p-3">
                    <RefreshCw size={20} />
                </div>

                <div className="flex-1">
                    <h3 className="font-black">
                        New version available
                    </h3>

                    <p className="mt-1 text-sm text-white/70">
                        A new version of Kandid is available.
                        Update now to use the latest version.
                    </p>
                </div>

                <button
                    onClick={() => setNeedRefresh(false)}
                    className="text-white/50 hover:text-white"
                >
                    <X size={18} />
                </button>
            </div>

            <button
                onClick={() => updateServiceWorker(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] px-4 py-3 font-bold hover:bg-[#e94d17]"
            >
                <RefreshCw size={17} />
                Update Kandid
            </button>
        </div>
    );
}

export default ReloadPrompt;