import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ImagePlus, Save, X } from "lucide-react";
import "./Profile.css";
import PopupOverlay from "../../components/PopupOverlay";
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
import { toBoardFacingError } from "../../utils/boardFeedback";
import { supabase } from "../../lib/supabaseClient";
import {
  getPasswordChecks,
  isPasswordValid,
} from "../../utils/password";
import {
  getOrganizationCatalog,
} from "../../utils/organizationAccess";
import { organizationMembershipScopeLabel } from "../../utils/organizationMembershipScope";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";

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

function passwordUpdateErrorMessage(error) {
  const message = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (message.includes("weak") || message.includes("password")) {
    if (message.includes("current password") || message.includes("current_password")) {
      return "Your current password could not be verified. Check it and try again.";
    }
    if (message.includes("weak") || message.includes("length") || message.includes("character")) {
      return "Supabase Auth rejected the new password. Review the requirements and try a different password.";
    }
  }
  if (message.includes("reauth") || message.includes("nonce")) {
    return "Your secure session needs verification. Sign out and sign in again, then retry the password change.";
  }
  if (message.includes("session") || Number(error?.status) === 401) {
    return "Your session has expired. Sign in again before changing your password.";
  }
  return "We could not update your password. Please try again.";
}

function ProfilePage() {
  const prompt = usePrompt();
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const pwaInstall = usePWAInstallState();
  const [boardOrganization, setBoardOrganization] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const passwordSubmitRef = useRef(false);
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
        setErrorMessage(toBoardFacingError(error.message, "Failed to load profile."));
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
        const organizations = await getOrganizationCatalog();
        const organization = organizations.find(
          (item) => String(item.id) === String(data.organization_id),
        );

        if (active) {
          setBoardOrganization(organization || null);
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
        : user?.role === "electoral_board"
          ? {
              email: form.email || null,
              photo_url: form.photo_url || null,
            }
        : {
            full_name: form.full_name,
            email: form.email || null,
            photo_url: form.photo_url || null,
            ...(form.password ? { password: form.password } : {}),
          };

    const { data, error, emailChangePending } = await updateCurrentUserProfile(payload);

    if (error) {
      setErrorMessage(
        form.password
          ? passwordChangeMessage(error)
          : isBoard
            ? toBoardFacingError(error.message, "Failed to save profile.")
            : error.message || "Failed to save profile.",
      );
      setSaving(false);
      return;
    }

    setUser(data);
    setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
    setSaving(false);
    prompt.success(emailChangePending
      ? "Profile photo updated. Confirm the email change using the verification message from Supabase."
      : "Profile updated successfully.");
  }

  function resetPasswordDialog() {
    if (passwordSubmitting) return;
    setPasswordDialogOpen(false);
    setPasswordError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    if (passwordSubmitRef.current) return;

    setPasswordError("");
    if (!secureAdminProfile) {
      setPasswordError("Password changes require a signed-in Supabase Auth Board account.");
      return;
    }
    if (!currentPassword) {
      setPasswordError("Enter your current password to continue.");
      return;
    }
    if (!isPasswordValid(newPassword)) {
      setPasswordError("Choose a new password that meets every requirement shown below.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("The new password and confirmation do not match.");
      return;
    }

    passwordSubmitRef.current = true;
    setPasswordSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });

      if (error) {
        setPasswordError(passwordUpdateErrorMessage(error));
        return;
      }

      setPasswordDialogOpen(false);
      setPasswordError("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
      prompt.success("Password updated successfully.");
    } catch {
      setPasswordError("We could not update your password. Check your connection and try again.");
    } finally {
      passwordSubmitRef.current = false;
      setPasswordSubmitting(false);
    }
  }

  async function handleInstallApp() {
    await promptKandidInstall();
  }

  const studentMemberships = user?.current_organization_memberships || [];
  const studentOrganizations =
    studentMemberships.map((item) => item.organizations).filter(Boolean) || [];
  const secureAdminProfile =
    isSupabaseAdminAuthMode() &&
    (user?.role === "super_admin" || user?.role === "electoral_board");

  const isStudent = user?.role === "student";
  const isBoard = user?.role === "electoral_board";
  const isSuperAdmin = user?.role === "super_admin";
  const boardOrganizationName =
    boardOrganization?.name ||
    user?.organization_name ||
    user?.organizations?.name ||
    "your assigned organization";
  const displayName = isStudent
    ? [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || "Student"
    : user?.full_name || "User";
  const statusLabel = user?.status
    ? user.status.charAt(0).toUpperCase() + user.status.slice(1)
    : "—";
  const passwordEntered = Boolean(form.password);
  const passwordChecks = getPasswordChecks(form.password);
  const passwordsMatch = passwordEntered && form.confirmPassword === form.password;
  const canSubmitPassword =
    !passwordEntered || (isPasswordValid(form.password) && passwordsMatch);

  return (
    <div className={`student-settings-desktop${isBoard ? " board-profile-page" : ""}`}>
      {isBoard ? (
        <header className="board-students-masthead board-profile-masthead">
          <div className="board-students-context">
            <span className="board-students-eyebrow">
              Electoral Board / {boardOrganizationName}
            </span>
            <span className="board-students-context-rule" aria-hidden="true" />
          </div>
          <div className="board-students-baseline">
            <h1 className="page-title board-students-title">Profile</h1>
          </div>
          <p className="board-students-standfirst">
            Manage your Board account details and profile photo.
          </p>
        </header>
      ) : isSuperAdmin ? (
        <SuperAdminPageHeader
          section="Access management"
          title="Profile"
          description="Review your Super Admin account details and profile photo."
        />
      ) : (
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
      )}

      {loading ? (
        isBoard ? (
          <div className="board-profile-loading" role="status" aria-label="Loading Board profile" aria-busy="true">
            <span className="sr-only">Loading Board profile</span>
            <section className="board-profile-loading-identity" aria-hidden="true">
              <span className="board-profile-skeleton is-avatar" />
              <span className="board-profile-loading-copy">
                <span className="board-profile-skeleton is-short" />
                <span className="board-profile-skeleton is-heading" />
                <span className="board-profile-skeleton is-medium" />
              </span>
            </section>
            <section className="board-profile-loading-section" aria-hidden="true">
              <span className="board-profile-skeleton is-label" />
              <span className="board-profile-skeleton is-section-title" />
              <span className="board-profile-skeleton is-field" />
              <span className="board-profile-skeleton is-field" />
            </section>
            <section className="board-profile-loading-section" aria-hidden="true">
              <span className="board-profile-skeleton is-label" />
              <span className="board-profile-skeleton is-section-title" />
              <span className="board-profile-skeleton is-medium" />
            </section>
          </div>
        ) : isStudent ? (
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
          <section className={`student-settings-section${isBoard ? " board-profile-identity-section" : ""}`}>
            <div className={`student-settings-identity${isBoard ? " board-profile-identity" : ""}`}>
              {isBoard ? (
                <div className="board-profile-avatar-group">
                  {form.photo_url ? (
                    <img
                      src={form.photo_url}
                      alt="Profile"
                      className="student-settings-photo-img"
                    />
                  ) : (
                    <div className="student-settings-photo-fallback">
                      {user?.full_name?.[0] || "A"}
                    </div>
                  )}
                  <label className="student-settings-photo-action board-profile-photo-action">
                    <ImagePlus size={15} />
                    Change photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => handlePhotoUpload(event.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <>
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
                      {user?.full_name?.[0] || "A"}
                    </div>
                  )}
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
                </>
              )}

              <div className={`student-settings-identity-copy${isBoard ? " board-profile-identity-copy" : ""}`}>
                <span className="student-settings-eyebrow">{isBoard ? "Account holder" : "Profile"}</span>
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
                ) : isBoard ? (
                  <p>Electoral Board · {boardOrganizationName}</p>
                ) : (
                  <p>{user?.role?.replaceAll("_", " ") || "System account"}</p>
                )}
              </div>

            </div>
          </section>

          {/* ====================================================
              ACCOUNT
              ==================================================== */}
          <section className={`student-settings-section${isBoard ? " board-profile-account-section" : ""}`}>
            <div className={`student-settings-section-head${isBoard ? " board-profile-account-head" : ""}`}>
              {isBoard ? <span className="board-profile-section-kicker">Account details</span> : null}
              <h2>{isBoard ? "Your information" : "Account"}</h2>
            </div>

            <form onSubmit={handleSubmit} className={`student-settings-form${isBoard ? " board-profile-form" : ""}`}>
              <div className={`student-settings-field${isBoard ? " board-profile-field" : ""}${isBoard && secureAdminProfile ? " board-profile-managed-field" : ""}`}>
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
                    {isBoard
                      ? "This email is managed through secure account management."
                      : "Admin email changes are handled through secure account management."}
                  </p>
                ) : null}
              </div>

              {isBoard ? (
                <div className="student-settings-field board-profile-field board-profile-managed-field">
                  <label>Full name</label>
                  <input
                    value={form.full_name}
                    readOnly
                    className="student-settings-input is-readonly"
                  />
                  <p className="student-settings-field-note">
                    Managed by the system administrator.
                  </p>
                </div>
              ) : !isStudent ? (
                <div className={`student-settings-field${isBoard ? " board-profile-field" : ""}`}>
                  <label>{isBoard ? "Full name" : "Full Name"}</label>
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

              {!isStudent && !isBoard ? (
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

              {isBoard ? (
                <details className="board-profile-photo-url">
                  <summary>Use an image URL instead</summary>
                  <div className="student-settings-field board-profile-field">
                    <label htmlFor="board-profile-photo-url">Profile image URL</label>
                    <input
                      id="board-profile-photo-url"
                      type="text"
                      value={form.photo_url}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, photo_url: event.target.value }))
                      }
                      className="student-settings-input"
                      placeholder="https://example.com/photo.jpg"
                    />
                    <p className="student-settings-field-note">Save your profile to apply the image.</p>
                  </div>
                </details>
              ) : null}

              {!secureAdminProfile && !isBoard ? (
                <div className="student-settings-password-stack">
                  <div className="student-settings-field">
                    <label>New Password</label>
                    <div className="student-settings-password-field">
                      <input
                        id="profile-new-password"
                        type={showPassword ? "text" : "password"}
                        data-password-policy="true"
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
                          id="profile-confirm-new-password"
                          type={showConfirmPassword ? "text" : "password"}
                          data-match-field="#profile-new-password"
                          data-match-message="Confirm password must match your new password."
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

          {isBoard ? (
            <section className="student-settings-section board-profile-security-section">
              <div className="student-settings-section-head board-profile-security-head">
                <span className="board-profile-section-kicker">Security</span>
                <h2>Password</h2>
              </div>
              {secureAdminProfile ? (
                <div className="board-profile-security-row">
                  <p>Update the password you use to access your Electoral Board account.</p>
                  <button
                    type="button"
                    className="board-profile-change-password"
                    onClick={() => {
                      setPasswordError("");
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmNewPassword("");
                      setPasswordDialogOpen(true);
                    }}
                  >
                    Change password
                  </button>
                </div>
              ) : (
                <p className="student-settings-section-note">
                  This account uses legacy sign-in, which cannot safely change a password from Profile. Ask a Kandid administrator to move it to Supabase Auth.
                </p>
              )}
            </section>
          ) : null}

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
            <section className="student-settings-section board-profile-organization-section">
              <div className="student-settings-section-head board-profile-organization-head">
                <span className="board-profile-section-kicker">Organization settings · {boardOrganization.name}</span>
                <h2>{boardOrganization.membership_scope === "program" ? "Covered Programs" : "Membership Scope"}</h2>
              </div>
              <p className="student-settings-section-note">
                Organization membership scope is managed by the system administrator.
              </p>
              <div className="mt-3 board-profile-coverage-controls">
                {boardOrganization.membership_scope === "institution" ? (
                  <p className="text-sm font-semibold text-[#1d262f]">
                    {organizationMembershipScopeLabel("institution")} applies across the institution; program coverage is not applicable.
                  </p>
                ) : boardOrganization.membership_scope === "manual" ? (
                  <p className="text-sm font-semibold text-[#1d262f]">
                    {organizationMembershipScopeLabel("manual")} across programs.
                  </p>
                ) : boardOrganization.membership_scope === "program" ? (
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-[#1d262f]">
                    {(boardOrganization.organization_programs || [])
                      .map((link) => link.programs)
                      .filter(Boolean)
                      .sort((left, right) =>
                        String(left.code || left.name).localeCompare(
                          String(right.code || right.name),
                        ),
                      )
                      .map((program) => (
                        <span key={program.id}>
                          {program.code || program.name}
                        </span>
                      ))}
                    {(boardOrganization.organization_programs || []).filter(
                      (link) => link.programs,
                    ).length === 0 ? (
                      <span className="text-sm font-normal text-gray-500">
                        No covered programs are assigned.
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">Membership scope is not available.</p>
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
      {isBoard && passwordDialogOpen ? (
        <PopupOverlay>
          <section
            className="board-profile-password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="board-profile-password-title"
          >
            <header className="board-profile-password-header">
              <div>
                <span>Security</span>
                <h2 id="board-profile-password-title">Change password</h2>
                <p>Update the password you use to access your Electoral Board account.</p>
              </div>
              <button
                type="button"
                className="board-profile-password-close"
                onClick={resetPasswordDialog}
                disabled={passwordSubmitting}
                aria-label="Close change password"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <form className="board-profile-password-form" onSubmit={handlePasswordChange}>
              <div className="board-profile-password-fields">
                <PasswordField
                  id="board-current-password"
                  label="Current password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  visible={showCurrentPassword}
                  onToggle={() => setShowCurrentPassword((value) => !value)}
                  autoComplete="current-password"
                  disabled={passwordSubmitting}
                />
                <PasswordField
                  id="board-new-password"
                  label="New password"
                  value={newPassword}
                  onChange={setNewPassword}
                  visible={showNewPassword}
                  onToggle={() => setShowNewPassword((value) => !value)}
                  passwordPolicy
                  autoComplete="new-password"
                  disabled={passwordSubmitting}
                />
                <PasswordField
                  id="board-confirm-new-password"
                  label="Confirm new password"
                  value={confirmNewPassword}
                  onChange={setConfirmNewPassword}
                  visible={showConfirmNewPassword}
                  onToggle={() => setShowConfirmNewPassword((value) => !value)}
                  matchField="#board-new-password"
                  matchMessage="Confirm password must match your new password."
                  autoComplete="new-password"
                  disabled={passwordSubmitting}
                />
              </div>

              <div className="board-profile-password-rules" aria-live="polite">
                <span>New password requirements</span>
                <ul>
                  {getPasswordChecks(newPassword).map((check) => (
                    <li key={check.id} className={check.met ? "is-met" : ""}>
                      <i aria-hidden="true">{check.met ? "✓" : "○"}</i>{check.label}
                    </li>
                  ))}
                </ul>
              </div>

              {confirmNewPassword ? (
                <p
                  className={`board-profile-password-match ${newPassword === confirmNewPassword ? "is-match" : "is-mismatch"}`}
                  aria-live="polite"
                >
                  {newPassword === confirmNewPassword
                    ? "New passwords match."
                    : "New passwords do not match."}
                </p>
              ) : null}

              {passwordError ? <p className="board-profile-password-error" role="alert">{passwordError}</p> : null}

              <footer className="board-profile-password-actions">
                <button
                  type="button"
                  className="board-profile-password-cancel"
                  onClick={resetPasswordDialog}
                  disabled={passwordSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="board-profile-password-submit"
                  disabled={passwordSubmitting || !currentPassword || !isPasswordValid(newPassword) || newPassword !== confirmNewPassword}
                >
                  {passwordSubmitting ? <KandidButtonLoader label="Updating password..." /> : "Update password"}
                </button>
              </footer>
            </form>
          </section>
        </PopupOverlay>
      ) : null}
    </div>
  );
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, disabled, passwordPolicy = false, matchField = "", matchMessage = "" }) {
  return (
    <div className="board-profile-password-field">
      <label htmlFor={id}>{label}</label>
      <div>
        <input
          id={id}
          type={visible ? "text" : "password"}
          data-password-policy={passwordPolicy ? "true" : undefined}
          data-match-field={matchField || undefined}
          data-match-message={matchMessage || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export default ProfilePage;
