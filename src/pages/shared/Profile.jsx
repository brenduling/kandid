import { useEffect, useState } from "react";
import { ImagePlus, LoaderCircle, Save } from "lucide-react";
import { fetchCurrentUserProfile, updateCurrentUserProfile } from "../../utils/profile";
import { getStoredUser } from "../../utils/auth";
import { readFileAsDataUrl } from "../../utils/files";
import { usePrompt } from "../../context/PromptContext";

function ProfilePage() {
  const prompt = usePrompt();
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(
    window.matchMedia("(display-mode: standalone)").matches,
  );
  const [form, setForm] = useState({
    full_name: "",
    first_name: "",
    last_name: "",
    email: "",
    photo_url: "",
    password: "",
  });

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      const { data, error } = await fetchCurrentUserProfile();

      if (!active) return;

      if (error) {
        setErrorMessage(error.message || "Failed to load profile.");
        setLoading(false);
        return;
      }

      setUser(data);
      setForm({
        full_name: data?.full_name || "",
        first_name: data?.first_name || "",
        last_name: data?.last_name || "",
        email: data?.email || "",
        photo_url: data?.photo_url || "",
        password: "",
      });
      setLoading(false);
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }

    function handleInstalled() {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handlePhotoUpload(file) {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setForm((current) => ({ ...current, photo_url: dataUrl }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");

    const payload =
      user?.role === "student"
        ? {
            email: form.email || null,
            photo_url: form.photo_url || null,
            ...(form.password ? { password: form.password } : {}),
          }
        : {
            full_name: form.full_name,
            email: form.email || null,
            photo_url: form.photo_url || null,
            ...(form.password ? { password: form.password } : {}),
          };

    const { data, error } = await updateCurrentUserProfile(payload);

    if (error) {
      setErrorMessage(error.message || "Failed to save profile.");
      setSaving(false);
      return;
    }

    setUser(data);
    setForm((current) => ({ ...current, password: "" }));
    setSaving(false);
    prompt.success("Profile updated successfully.");
  }

  async function handleInstallApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  const studentOrganizations =
    user?.student_organizations?.map((item) => item.organizations).filter(Boolean) || [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">My Profile</div>
          <h1 className="page-title">
            Personal account
            <span className="page-title-accent"> details</span>
          </h1>
          <p className="page-subtitle">
            Review your account information, update your profile photo, and keep
            your contact details current.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          <span className="inline-flex items-center gap-2">
            <LoaderCircle size={16} className="animate-spin" />
            Loading profile...
          </span>
        </div>
      ) : (
        <div className="section-grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
          <div className="glass-panel-strong rounded-[30px] p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {form.photo_url ? (
                <img
                  src={form.photo_url}
                  alt="Profile"
                  className="h-28 w-28 rounded-[28px] object-cover"
                />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-[rgba(232,108,47,0.12)] text-3xl font-black text-[#d35a25]">
                  {user?.role === "student"
                    ? user?.first_name?.[0] || "S"
                    : user?.full_name?.[0] || "A"}
                </div>
              )}

              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                  Account Snapshot
                </p>
                <h2 className="mt-2 text-3xl font-black text-[#18212b]">
                  {user?.role === "student"
                    ? `${user?.first_name || ""} ${user?.last_name || ""}`.trim()
                    : user?.full_name || "User"}
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  {user?.role === "student"
                    ? user?.student_number || "Student account"
                    : user?.role?.replaceAll("_", " ") || "System account"}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Role</p>
                <p className="text-sm font-semibold capitalize text-[#1d262f]">
                  {user?.role?.replaceAll("_", " ") || "-"}
                </p>
              </div>
              <div className="rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Date Added</p>
                <p className="text-sm font-semibold text-[#1d262f]">
                  {user?.created_at
                    ? new Date(user.created_at).toLocaleDateString()
                    : "-"}
                </p>
              </div>
              <div className="rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Status</p>
                <p className="text-sm font-semibold text-[#1d262f]">
                  {user?.status || "Active"}
                </p>
              </div>
              <div className="rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Organization</p>
                <p className="text-sm font-semibold text-[#1d262f]">
                  {user?.organizations?.name ||
                    studentOrganizations.map((org) => org.name).join(", ") ||
                    "Not assigned"}
                </p>
              </div>
            </div>

            {user?.role === "student" ? (
              <div className="mt-4 rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Academic Details</p>
                <p className="text-sm font-semibold text-[#1d262f]">
                  {user?.program || "Program not set"} - Year {user?.year_level || "-"}
                </p>
              </div>
            ) : null}

            <div className="mt-4 rounded-[24px] bg-white/50 p-4">
              <p className="field-label !mb-1">App Install</p>
              <p className="text-sm font-semibold text-[#1d262f]">
                {isInstalled
                  ? "Installed in app mode on this device."
                  : "You can install KANDID for a cleaner mobile experience."}
              </p>
              {!isInstalled && deferredPrompt ? (
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="secondary-btn mt-4"
                >
                  Install App
                </button>
              ) : null}
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="glass-panel rounded-[30px] p-6"
          >
            <div className="grid gap-5">
              {user?.role === "student" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label">First Name</label>
                    <input
                      readOnly
                      value={form.first_name}
                      className="field-shell w-full bg-white/50 text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="field-label">Last Name</label>
                    <input
                      readOnly
                      value={form.last_name}
                      className="field-shell w-full bg-white/50 text-gray-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="field-label">Full Name</label>
                  <input
                    value={form.full_name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        full_name: event.target.value,
                      }))
                    }
                    className="field-shell w-full"
                  />
                </div>
              )}

              <div>
                <label className="field-label">Email Address</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="field-shell w-full"
                />
              </div>

              <div>
                <label className="field-label">Profile Photo URL</label>
                <input
                  value={form.photo_url}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      photo_url: event.target.value,
                    }))
                  }
                  className="field-shell w-full"
                  placeholder="Paste an image URL or upload a file below"
                />
              </div>

              <div className="rounded-[24px] border border-black/5 bg-white/40 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#18212b]">Upload Photo</p>
                    <p className="mt-1 text-sm text-gray-500">
                      Works well for Android, iPhone, and desktop web installs.
                    </p>
                  </div>
                  <label className="secondary-btn cursor-pointer">
                    <ImagePlus size={18} />
                    Choose Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => handlePhotoUpload(event.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="field-label">New Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  className="field-shell w-full"
                  placeholder="Leave blank if you are not changing it"
                />
              </div>

              {errorMessage ? (
                <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {errorMessage}
                </div>
              ) : null}

              <button
                disabled={saving}
                className="primary-btn w-full disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? (
                  <>
                    <LoaderCircle size={18} className="animate-spin" />
                    Saving Profile...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Save Profile
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default ProfilePage;
