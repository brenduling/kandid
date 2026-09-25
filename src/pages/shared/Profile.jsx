import { useEffect, useState } from "react";
import { Eye, EyeOff, ImagePlus, Save } from "lucide-react";
import { KandidButtonLoader, KandidInlineLoader } from "../../components/KandidLoader";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { StudentAvatar } from "../../components/KandidImage";
import { fetchCurrentUserProfile, updateCurrentUserProfile } from "../../utils/profile";
import { getStoredUser, isSupabaseAdminAuthMode } from "../../utils/auth";
import { readFileAsDataUrl } from "../../utils/files";
import { promptKandidInstall, usePWAInstallState } from "../../utils/pwaInstall";
import { usePrompt } from "../../context/PromptContext";
import { supabase } from "../../lib/supabaseClient";
import {
  getPasswordChecks,
  isPasswordValid,
} from "../../utils/password";
import {
  clearOrganizationAccessCache,
  ensureProgram,
  getOrganizationCatalog,
  getPrograms,
  syncStudentsForOrganizationCoverage,
} from "../../utils/organizationAccess";

function MembershipLogo({ organization }) {
  const [failed, setFailed] = useState(false);
  const initial = String(organization?.name || "Organ").trim().charAt(0).toUpperCase();

  if (!organization?.logo_url || failed) {
    return (
      <span className="student-settings-org-logo" aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      src={organization.logo_url}
      alt=""
      className="student-settings-org-logo"
      onError={() => setFailed(true)}
    />
  );
}

function passwordChangeMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("same") && message.includes("password")) {
    return "Your new password must be different from your current password.";
  }
  if (message.includes("weak") || message.includes("fewer") || message.includes("at least")) {
    return "That password is too weak. Review the requirements above and try again.";
  }
  return error?.message || "We could not change your password. Please try again.";
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    first_name: "",
    last_name: "",
    email: "",
    photo_url: "",
    password: "",
    confirmPassword: "",
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
        confirmPassword: "",
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

    const passwordEntered = Boolean(form.password);

    if (passwordEntered) {
      if (!isPasswordValid(form.password)) {
        setErrorMessage("Your new password must satisfy every requirement below.");
        setSaving(false);
        return;
      }
      if (form.confirmPassword !== form.password) {
        setErrorMessage("New password confirmation does not match.");
        setSaving(false);
        return;
      }
    }

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
      setErrorMessage(
        form.password ? passwordChangeMessage(error) : error.message || "Failed to save profile.",
      );
      setSaving(false);
      return;
    }

    setUser(data);
    setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
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

  const studentMemberships = user?.student_organizations || [];
  const studentOrganizations =
    studentMemberships.map((item) => item.organizations).filter(Boolean) || [];
  const secureAdminProfile =
    isSupabaseAdminAuthMode() &&
    (user?.role === "super_admin" || user?.role === "electoral_board");

  const isStudent = user?.role === "student";
  const isBoard = user?.role === "electoral_board";
  const displayName = isStudent
    ? [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || "Student"
    : user?.full_name || "User";
  const statusLabel = user?.status
    ? user.status.charAt(0).toUpperCase() + user.status.slice(1)
    : "—";
  const passwordEntered = Boolean(form.password);
  const passwordChecks = getPasswordChecks(form.password);
  const passwordsMatch = passwordEntered && form.confirmPassword === form.password;
  const passwordIncomplete = passwordEntered && !isPasswordValid(form.password);
  const canSubmitPassword =
    !passwordEntered || (isPasswordValid(form.password) && passwordsMatch);

  return (
    <div className="student-settings-desktop">
      <header className="student-settings-opening">
        <div className="student-settings-opening-copy">
          <span className="student-settings-kicker">
            {isStudent ? "Your Account" : "My Profile"}
          </span>
          <h1>
            {isStudent ? "Settings that belong to you." : "Personal account details."}
          </h1>
          <p>
            {isStudent
              ? "Your profile, account access, and Kandid on this device."
              : "Review your account information, update your profile photo, and keep your contact details current."}
          </p>
        </div>
      </header>

      {loading ? (
        isStudent ? (
          <StudentSkeletonGroup
            label="Loading your settings"
            className="student-settings-skeleton"
          >
            <section className="student-settings-section">
              <div className="student-skeleton-row">
                <StudentSkeletonLine
                  variant="media"
                  width="4.25rem"
                  height="4.25rem"
                />

                <div className="student-skeleton-copy">
                  <StudentSkeletonLine width="54%" height="1.05rem" />
                  <StudentSkeletonLine width="38%" height="0.65rem" />
                  <StudentSkeletonLine width="64%" height="0.65rem" />
                </div>
              </div>
            </section>

            <section className="student-settings-section">
              <div className="student-skeleton-stack">
                <StudentSkeletonLine width="100%" height="2.4rem" />
                <StudentSkeletonLine width="100%" height="2.4rem" />
                <StudentSkeletonLine width="100%" height="2.4rem" />
              </div>
            </section>

            <section className="student-settings-section">
              <div className="student-skeleton-stack">
                <StudentSkeletonLine width="72%" height="0.7rem" />
                <StudentSkeletonLine width="100%" height="2.4rem" />
                <StudentSkeletonLine width="88%" height="2.4rem" />
              </div>
            </section>
          </StudentSkeletonGroup>
        ) : (
          <div className="student-settings-state">
            <KandidInlineLoader message="Loading profile..." />
          </div>
        )
      ) : (
        <div className="student-settings-body">
          {/* ====================================================
              PROFILE IDENTITY
              ==================================================== */}
          <section className="student-settings-section">
            <div className="student-settings-identity">
              {isStudent ? (
                <StudentAvatar
                  student={{ ...user, photo_url: form.photo_url }}
                  className="student-settings-photo-img"
                  loading="eager"
                />
              ) : form.photo_url ? (
                <img
                  src={form.photo_url}
                  alt="Profile"
                  className="student-settings-photo-img"
                />
              ) : (
                <div className="student-settings-photo-fallback">
                  {isStudent
                    ? user?.first_name?.[0] || "S"
                    : user?.full_name?.[0] || "A"}
                </div>
              )}

              <div className="student-settings-identity-copy">
                <span className="student-settings-eyebrow">Profile</span>
                <h2>{displayName}</h2>
                {isStudent ? (
                  <>
                    <p>Student ID {user?.student_number || "—"}</p>
                    <p>
                      {[user?.program, user?.year_level ? `Year ${user?.year_level}` : ""]
                        .filter(Boolean)
                        .join(" · ") || "Not set"}
                    </p>
                  </>
                ) : (
                  <p>{user?.role?.replaceAll("_", " ") || "System account"}</p>
                )}
              </div>

              <label className="student-settings-photo-action">
                <ImagePlus size={16} />
                Choose Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handlePhotoUpload(event.target.files?.[0])}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* ====================================================
              ACCOUNT
              ==================================================== */}
          <section className="student-settings-section">
            <div className="student-settings-section-head">
              <h2>Account</h2>
            </div>

            <form onSubmit={handleSubmit} className="student-settings-form">
              <div className="student-settings-field">
                <label>Email address</label>
                <input
                  type="email"
                  readOnly={secureAdminProfile}
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className={`student-settings-input ${secureAdminProfile ? "is-readonly" : ""}`}
                />
                {secureAdminProfile ? (
                  <p className="student-settings-field-note">
                    Admin email changes are handled through secure account management.
                  </p>
                ) : null}
              </div>

              {!isStudent ? (
                <div className="student-settings-field">
                  <label>Full Name</label>
                  <input
                    value={form.full_name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        full_name: event.target.value,
                      }))
                    }
                    className="student-settings-input"
                  />
                </div>
              ) : null}

              {!isStudent ? (
                <div className="student-settings-field">
                  <label>Profile Photo URL</label>
                  <input
                    value={form.photo_url}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        photo_url: event.target.value,
                      }))
                    }
                    className="student-settings-input"
                    placeholder="Paste an image URL"
                  />
                </div>
              ) : null}

              {!secureAdminProfile ? (
                <div className="student-settings-password-stack">
                  <div className="student-settings-field">
                    <label>New Password</label>
                    <div className="student-settings-password-field">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            password: event.target.value,
                            confirmPassword: current.confirmPassword,
                          }))
                        }
                        autoComplete="new-password"
                        className="student-settings-input"
                        placeholder="Change password"
                      />
                      <button
                        type="button"
                        className="student-settings-eye-btn"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-live="polite"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {passwordEntered ? (
                      <div className="student-settings-password-requirements" aria-live="polite">
                        <span>Password Requirements</span>
                        <div className="student-settings-password-checks">
                          {passwordChecks.map((check) => (
                            <span key={check.id} className={check.met ? "is-met" : ""}>
                              <i aria-hidden="true">{check.met ? "✓" : "○"}</i>
                              {check.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="student-settings-field-note">
                        Leave blank to keep your current password.
                      </p>
                    )}
                  </div>

                  {passwordEntered ? (
                    <div className="student-settings-field">
                      <label>Confirm New Password</label>
                      <div className="student-settings-password-field">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          value={form.confirmPassword}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              confirmPassword: event.target.value,
                            }))
                          }
                          autoComplete="new-password"
                          className="student-settings-input"
                          placeholder="Retype new password"
                        />
                        <button
                          type="button"
                          className="student-settings-eye-btn"
                          onClick={() => setShowConfirmPassword((current) => !current)}
                          aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                          aria-live="polite"
                        >
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {form.confirmPassword ? (
                        <p
                          className={`student-settings-field-note ${
                            passwordsMatch ? "is-match" : "is-mismatch"
                          }`}
                          aria-live="polite"
                        >
                          {passwordsMatch ? "✓ Passwords match." : "× Passwords do not match."}
                        </p>
                      ) : (
                        <p className="student-settings-field-note">
                          Retype your new password to confirm it.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="student-settings-error">{errorMessage}</div>
              ) : null}

              <div className="student-settings-actions">
                <button
                  type="submit"
                  disabled={saving || !canSubmitPassword}
                  className="student-settings-save"
                >
                  {saving ? (
                    <KandidButtonLoader label="Saving changes..." />
                  ) : (
                    <>
                      <Save size={16} />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* ====================================================
              YOUR STUDENT RECORD
              ==================================================== */}
          {isStudent ? (
            <>
            <section className="student-settings-section">
              <div className="student-settings-section-head">
                <h2>Your Student Record</h2>
              </div>
              <p className="student-settings-section-note">
                These details come from your current school record.
              </p>

              <div className="student-settings-record">
                <div className="student-settings-record-head">
                  <span>Student ID</span>
                  <span>Program</span>
                  <span>Year Level</span>
                  <span>Account Status</span>
                </div>
                <div className="student-settings-record-body">
                  <strong>{user?.student_number || "—"}</strong>
                  <strong>{user?.program || "—"}</strong>
                  <strong>{user?.year_level ? `Year ${user?.year_level}` : "—"}</strong>
                  <strong>{statusLabel}</strong>
                </div>
              </div>

              <p className="student-settings-section-note">
                If something here is incorrect, contact your department.
              </p>
            </section>

            {/* ====================================================
                YOUR ORGANIZATIONS
                ==================================================== */}
            <section className="student-settings-section">
              <div className="student-settings-section-head">
                <h2>Your Organizations</h2>
              </div>
              <p className="student-settings-section-note">
                The student communities you belong to.
              </p>

              {studentOrganizations.length > 0 ? (
                <div className="student-settings-org-grid">
                  {studentOrganizations.map((organization) => (
                    <div
                      key={organization?.id || organization?.name}
                      className="student-settings-org-item"
                    >
                      <MembershipLogo organization={organization} />
                      <div className="student-settings-org-copy">
                        <strong className="student-settings-org-acronym">
                          {organization?.name || "Organization"}
                        </strong>
                        {organization?.description &&
                        organization.description !== organization.name ? (
                          <span className="student-settings-org-full">
                            {organization.description}
                          </span>
                        ) : null}
                        <span className="student-settings-org-eyebrow">Member</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="student-settings-org-empty">
                  You are not part of any organization yet.
                </p>
              )}
            </section>
            </>
          ) : null}

          {/* ====================================================
              BOARD — COVERED PROGRAMS
              ==================================================== */}
          {isBoard && boardOrganization ? (
            <section className="student-settings-section">
              <div className="student-settings-section-head">
                <h2>Covered Programs</h2>
              </div>
              <p className="student-settings-section-note">
                Manage which programs this organization covers and sync matching students.
              </p>
              <div className="mt-3">
                {boardOrganization.organization_type === "non_departmental" ? (
                  <p className="text-sm font-semibold text-[#1d262f]">
                    This non-departmental organization is open across programs.
                  </p>
                ) : (
                  <div className="space-y-3">
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
            </section>
          ) : null}

          {/* ====================================================
              KANDID ON THIS DEVICE
              ==================================================== */}
          <section className="student-settings-section">
            <div className="student-settings-section-head">
              <h2>Kandid on This Device</h2>
            </div>

            <div className="student-settings-install">
              <div className="student-settings-install-copy">
                <strong>Install Kandid</strong>
                <p>Add Kandid to this device for quicker access.</p>
                {pwaInstall.canInstall ? null : (
                  <span className="student-settings-install-status">
                    {pwaInstall.installed || pwaInstall.standalone
                      ? "Kandid is installed on this device."
                      : pwaInstall.shouldGuideIOS
                        ? "On iPhone or iPad, install KANDID from Share, then Add to Home Screen."
                        : "Use a supported browser install option when it is available on this device."}
                  </span>
                )}
              </div>
              {pwaInstall.canInstall ? (
                <div className="student-settings-install-state">
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="student-settings-install-action"
                  >
                    Install Kandid
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default ProfilePage;