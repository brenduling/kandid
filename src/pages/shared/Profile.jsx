import { useEffect, useState } from "react";
import { ImagePlus, Save } from "lucide-react";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import { StudentAvatar } from "../../components/KandidImage";
import { fetchCurrentUserProfile, updateCurrentUserProfile } from "../../utils/profile";
import { getStoredUser } from "../../utils/auth";
import { readFileAsDataUrl } from "../../utils/files";
import { promptKandidInstall, usePWAInstallState } from "../../utils/pwaInstall";
import { usePrompt } from "../../context/PromptContext";
import { supabase } from "../../lib/supabaseClient";
import {
  clearOrganizationAccessCache,
  ensureProgram,
  getOrganizationCatalog,
  getPrograms,
  syncStudentsForOrganizationCoverage,
} from "../../utils/organizationAccess";

function ProfilePage() {
  const prompt = usePrompt();
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const pwaInstall = usePWAInstallState();
  const [programs, setPrograms] = useState([]);
  const [boardOrganization, setBoardOrganization] = useState(null);
  const [selectedProgramIds, setSelectedProgramIds] = useState([]);
  const [newProgram, setNewProgram] = useState("");
  const [coverageSaving, setCoverageSaving] = useState(false);
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

      if (data?.role === "electoral_board" && data?.organization_id) {
        const [programData, organizations] = await Promise.all([
          getPrograms(),
          getOrganizationCatalog(),
        ]);
        const organization = organizations.find(
          (item) => String(item.id) === String(data.organization_id),
        );

        if (active) {
          setPrograms(programData || []);
          setBoardOrganization(organization || null);
          setSelectedProgramIds(
            (organization?.organization_programs || [])
              .map((link) => String(link.program_id))
              .filter(Boolean),
          );
        }
      }

      setLoading(false);
    }

    loadProfile();

    return () => {
      active = false;
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
    await promptKandidInstall();
  }

  function toggleProgram(programId) {
    setSelectedProgramIds((previous) =>
      previous.includes(String(programId))
        ? previous.filter((id) => id !== String(programId))
        : [...previous, String(programId)],
    );
  }

  async function handleAddProgram() {
    const { data, error } = await ensureProgram(newProgram);

    if (error) {
      prompt.error(
        error.message ||
          "Program could not be added. Apply the organization sync migration first.",
      );
      return;
    }

    if (!data) return;

    setPrograms((previous) => {
      const exists = previous.some((program) => String(program.id) === String(data.id));
      return exists
        ? previous
        : [...previous, data].sort((a, b) =>
            String(a.code || a.name).localeCompare(String(b.code || b.name)),
          );
    });
    setSelectedProgramIds((previous) =>
      previous.includes(String(data.id)) ? previous : [...previous, String(data.id)],
    );
    setNewProgram("");
  }

  async function handleSaveCoverage() {
    if (!boardOrganization?.id) return;

    if (
      boardOrganization.organization_type === "departmental" &&
      programs.length > 0 &&
      selectedProgramIds.length === 0
    ) {
      prompt.error("Select at least one covered program for this departmental organization.");
      return;
    }

    setCoverageSaving(true);

    const { error: deleteError } = await supabase
      .from("organization_programs")
      .delete()
      .eq("organization_id", boardOrganization.id);

    if (deleteError) {
      setCoverageSaving(false);
      prompt.error(
        deleteError.message ||
          "Program coverage could not be saved. Apply the organization sync migration first.",
      );
      return;
    }

    if (
      boardOrganization.organization_type === "departmental" &&
      selectedProgramIds.length > 0
    ) {
      const rows = selectedProgramIds.map((programId) => ({
        organization_id: boardOrganization.id,
        program_id: Number(programId),
      }));

      const { error: insertError } = await supabase
        .from("organization_programs")
        .insert(rows);

      if (insertError) {
        setCoverageSaving(false);
        prompt.error(insertError.message || "Program coverage could not be saved.");
        return;
      }
    }

    clearOrganizationAccessCache();
    const { error: syncError } = await syncStudentsForOrganizationCoverage(
      boardOrganization.id,
    );

    setCoverageSaving(false);

    if (syncError) {
      prompt.error(syncError.message || "Coverage saved, but students could not be synced.");
      return;
    }

    const organizations = await getOrganizationCatalog();
    const organization = organizations.find(
      (item) => String(item.id) === String(boardOrganization.id),
    );
    setBoardOrganization(organization || boardOrganization);
    prompt.success("Program coverage saved and matching students synced.");
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
          <KandidInlineLoader message="Loading profile..." />
        </div>
      ) : (
        <div className="section-grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
          <div className="glass-panel-strong rounded-[30px] p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {user?.role === "student" ? (
                <StudentAvatar
                  student={{ ...user, photo_url: form.photo_url }}
                  className="!h-28 !w-28 !rounded-[28px]"
                  loading="eager"
                />
              ) : form.photo_url ? (
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

            {user?.role === "electoral_board" && boardOrganization ? (
              <div className="mt-4 rounded-[24px] bg-white/50 p-4">
                <p className="field-label !mb-1">Covered Programs</p>
                {boardOrganization.organization_type === "non_departmental" ? (
                  <p className="text-sm font-semibold text-[#1d262f]">
                    This non-departmental organization is open across programs.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={newProgram}
                        onChange={(event) => setNewProgram(event.target.value)}
                        className="field-shell w-full"
                        placeholder="Add program code"
                      />
                      <button
                        type="button"
                        onClick={handleAddProgram}
                        disabled={!newProgram.trim()}
                        className="secondary-btn justify-center disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add Program
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {programs.length === 0 ? (
                        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
                          No programs found yet. Apply the organization sync migration or add one above.
                        </div>
                      ) : (
                        programs.map((program) => {
                          const checked = selectedProgramIds.includes(String(program.id));

                          return (
                            <label
                              key={program.id}
                              className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm transition ${
                                checked
                                  ? "border-[#d35a25] bg-[rgba(211,90,37,0.08)] text-[#1d262f]"
                                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProgram(program.id)}
                                className="h-4 w-4"
                              />
                              <span className="font-bold">
                                {program.code || program.name}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveCoverage}
                      disabled={coverageSaving}
                      className="primary-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {coverageSaving ? "Syncing Students..." : "Save Covered Programs"}
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-4 rounded-[24px] bg-white/50 p-4">
              <p className="field-label !mb-1">App Install</p>
              <p className="text-sm font-semibold text-[#1d262f]">
                {pwaInstall.installed || pwaInstall.standalone
                  ? "Installed in app mode on this device."
                  : pwaInstall.shouldGuideIOS
                    ? "On iPhone or iPad, install KANDID from Share, then Add to Home Screen."
                    : pwaInstall.canInstall
                      ? "You can install KANDID for a cleaner mobile experience."
                      : "Use a supported browser install option when it is available on this device."}
              </p>
              {pwaInstall.canInstall ? (
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
                  <KandidButtonLoader label="Saving profile..." />
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
