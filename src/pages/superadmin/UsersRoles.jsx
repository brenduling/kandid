import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import OrganizationSelect from "../../components/OrganizationSelect";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import {
  createAdminUser,
  disableAdminUser,
  inviteExistingAdminUser,
  listAdminUsers,
  relinkExistingAdminUser,
  updateAdminUser,
} from "../../utils/adminUsers";
import { isSupabaseAdminAuthMode } from "../../utils/auth";

function UsersRoles() {
  const prompt = usePrompt();
  const [users, setUsers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const supabaseAdminAuthMode = isSupabaseAdminAuthMode();

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "electoral_board",
    organization_id: "",
    status: "active",
  });

  const fetchUsers = useCallback(async () => {
    const { data, error } = await listAdminUsers();

    if (error) {
      prompt.error(error.message || "Failed to load access accounts.");
      return;
    }

    setUsers(data || []);
  }, [prompt]);

  const fetchOrganizations = useCallback(async () => {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name", { ascending: true });

    if (!error) setOrganizations(data || []);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchUsers();
      fetchOrganizations();
    });
  }, [fetchOrganizations, fetchUsers]);

  function resetForm(role = "electoral_board") {
    setForm({
      full_name: "",
      email: "",
      password: "",
      role,
      organization_id: "",
      status: "active",
    });
  }

  function openCreate(role = "electoral_board") {
    setEditing(null);
    resetForm(role);
    setFormOpen(true);
  }

  function openEdit(user) {
    setEditing(user);
    setForm({
      full_name: user.full_name || "",
      email: user.email || "",
      password: "",
      role: user.role || "electoral_board",
      organization_id: user.organization_id || "",
      status: user.status || "active",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      organization_id:
        form.role === "super_admin"
          ? null
          : form.organization_id
            ? Number(form.organization_id)
            : null,
      status: form.status,
    };

    if (!supabaseAdminAuthMode && form.password) {
      payload.password = form.password;
    }

    if (!supabaseAdminAuthMode && !editing && !form.password) {
      setSubmitting(false);
      prompt.error("Temporary password is required while legacy admin auth mode is active.");
      return;
    }

    if (editing) {
      const result = await updateAdminUser(editing.id, payload);

      if (result.error) {
        setSubmitting(false);
        prompt.error(result.error.message || "Failed to save access account.");
        return;
      }
    } else {
      const result = await createAdminUser(payload);

      if (result.error) {
        setSubmitting(false);
        prompt.error(result.error.message || "Failed to save access account.");
        return;
      }
    }

    await logAuditEvent({
      action: editing ? "user_updated" : "user_created",
      entityType: "admin_user",
      entityId: editing?.id,
      entityLabel: payload.email,
      organizationId: payload.organization_id,
      status: "completed",
      metadata: { role: payload.role, account_status: payload.status },
    });
    prompt.success(editing ? "Access account updated." : "Access account prepared for secure invite.");
    setSubmitting(false);

    setFormOpen(false);
    fetchUsers();
  }

  async function handleDelete(user) {
    const analysis = await analyzeDeleteDependencies("admin_user", user);
    const label = user.email || user.full_name || "Access account";

    await logAuditEvent({
      action: "user_delete_blocked",
      entityType: "admin_user",
      entityId: user.id,
      entityLabel: label,
      organizationId: user.organization_id,
      organizationName: user.organizations?.name,
      status: "requires_action",
      metadata: { dependencies: analysis.dependencies, recommendation: analysis.recommendation },
    });

    const ok = await prompt.confirm({
      title: "Disable Access Account?",
      message: `${dependencyMessage(label, analysis)}\n\nThis will disable the administrative profile instead of deleting identity or history.`,
      type: "danger",
      confirmText: "Disable Account",
      cancelText: "Keep Account",
    });
    if (!ok) return;

    const result = await disableAdminUser(user.id);
    if (result.error) {
      prompt.error(result.error.message || "Failed to disable access account.");
      return;
    }
    prompt.success("Access account disabled.");
    await logAuditEvent({
      action: "user_updated",
      entityType: "admin_user",
      entityId: user.id,
      entityLabel: label,
      organizationId: user.organization_id,
      organizationName: user.organizations?.name,
      status: "completed",
    });
    fetchUsers();
  }

  async function handleSendSetupInvite(user) {
    if (!supabaseAdminAuthMode || user.auth_linked) return;

    const label = user.email || user.full_name || "this access account";
    const ok = await prompt.confirm({
      title: "Send Setup Invite?",
      message: `Send a secure Supabase Auth password setup invite to ${label}? This uses the existing access account row and will not copy the legacy password.`,
      type: "warning",
      confirmText: "Send Invite",
      cancelText: "Cancel",
    });
    if (!ok) return;

    const result = await inviteExistingAdminUser(user.id);
    if (result.error) {
      prompt.error(result.error.message || "Failed to send setup invite.");
      return;
    }

    if (result.meta?.email_verification_required) {
      prompt.warning(
        result.meta.message ||
          "Auth account exists but email verification/setup is incomplete.",
        "Setup verification required",
      );
      return;
    }

    prompt.success(result.meta?.message || "Secure account setup invite sent.");
    await logAuditEvent({
      action: "admin_auth_setup_invite_sent",
      entityType: "admin_user",
      entityId: user.id,
      entityLabel: label,
      organizationId: user.organization_id,
      organizationName: user.organizations?.name,
      status: "completed",
      metadata: { role: user.role },
    });
    fetchUsers();
  }

  async function handleRepairAuthLink(user) {
    if (!supabaseAdminAuthMode || !user.auth_linked) return;

    const label = user.email || user.full_name || "this access account";
    const ok = await prompt.confirm({
      title: "Repair Auth Link?",
      message: `Relink ${label} to the confirmed Supabase Auth user with the same email. The previous Auth user will not be deleted or disabled.`,
      type: "warning",
      confirmText: "Repair Link",
      cancelText: "Cancel",
    });
    if (!ok) return;

    const result = await relinkExistingAdminUser(user.id);
    if (result.error) {
      prompt.error(result.error.message || "Failed to repair Auth link.");
      return;
    }

    prompt.success(
      result.meta?.already_correct
        ? "Auth link already matches this account email."
        : "Auth link repaired."
    );

    await logAuditEvent({
      action: "admin_auth_link_repaired",
      entityType: "admin_user",
      entityId: user.id,
      entityLabel: label,
      organizationId: user.organization_id,
      organizationName: user.organizations?.name,
      status: "completed",
      metadata: {
        role: user.role,
        already_correct: Boolean(result.meta?.already_correct),
        relinked: Boolean(result.meta?.relinked),
      },
    });

    fetchUsers();
  }

  const superAdminCount = users.filter((user) => user.role === "super_admin").length;
  const boardUsers = users.filter((user) => user.role === "electoral_board");
  const activeBoardCount = boardUsers.filter((user) => user.status === "active").length;
  const unassignedBoards = boardUsers.filter((user) => !user.organization_id).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Access Control</div>
          <h1 className="page-title">
            Users and
            <span className="page-title-accent"> board access</span>
          </h1>
          <p className="page-subtitle">
            Register electoral board accounts for specific organizations and keep
            super admin access separate from organization-level operations.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <button onClick={() => openCreate("electoral_board")} className="primary-btn">
            <ShieldCheck size={18} />
            Add Electoral Board Access
          </button>
          <button onClick={() => openCreate("super_admin")} className="secondary-btn">
            <UserCog size={18} />
            Add Super Admin
          </button>
        </div>
      </div>

      <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Super Admins
              </p>
              <h2 className="mt-4 text-4xl font-black">{superAdminCount}</h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(17,128,106,0.12)] text-[#11806a]">
              <UserCog size={22} />
            </div>
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Board Accounts
              </p>
              <h2 className="mt-4 text-4xl font-black">{boardUsers.length}</h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(25,162,140,0.12)] text-[#11806a]">
              <ShieldCheck size={22} />
            </div>
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Active Boards
              </p>
              <h2 className="mt-4 text-4xl font-black">{activeBoardCount}</h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(54,147,111,0.12)] text-[#36936f]">
              <KeyRound size={22} />
            </div>
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Unassigned Boards
              </p>
              <h2 className="mt-4 text-4xl font-black">{unassignedBoards}</h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(208,199,109,0.16)] text-[#9b8a29]">
              <Building2 size={22} />
            </div>
          </div>
        </div>
      </div>

      <div className="section-grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="trust-card">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3 text-[#9ce7dd]">
              <ShieldCheck size={22} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Electoral Board Access
              </p>
              <h2 className="mt-1 text-2xl font-black">Assign one board to one org</h2>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {[
              "Each electoral board account can be linked to a specific organization.",
              "That account logs in through the board portal and only manages its assigned organization.",
              "Use disabled status to revoke access without deleting the record.",
            ].map((item) => (
              <div key={item} className="rounded-2xl bg-white/8 px-4 py-3 text-sm leading-6 text-white/74">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="soft-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Access Checklist
              </p>
              <h3 className="mt-2 text-2xl font-black">Before you create an account</h3>
            </div>
            <span className="status-pill">Smart Setup</span>
          </div>

          <div className="mt-6 space-y-3">
            {[
              ["Organization", "Choose the organization the board member will manage."],
              ["Email Address", "Use a valid email format for the board login credential."],
              ["Account Setup", "The server sends a Supabase Auth invite for password setup."],
              ["Status", "Keep it active for live use or disabled to hold the access record."],
            ].map(([title, copy]) => (
              <div key={title} className="info-row !items-start">
                <div>
                  <p className="text-sm font-bold text-[#102220]">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#5e726d]">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-grid grid-cols-1">
        <div className="table-shell">
          <div className="border-b border-[rgba(104,86,72,0.08)] px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
              Access Accounts
            </p>
            <h3 className="mt-2 text-xl font-black">Super admin and electoral board logins</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="table-head text-white">
                <tr>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Organization</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Auth</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-10 text-center text-gray-500">
                      No access accounts found.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-b border-[rgba(104,86,72,0.08)] last:border-b-0">
                      <td className="px-6 py-4 font-bold">{user.full_name}</td>
                      <td className="px-6 py-4 text-[#5e726d]">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className="status-pill capitalize">
                          {user.role?.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.role === "super_admin"
                          ? "All Organizations"
                          : user.organizations?.name || "Unassigned"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase ${
                            user.status === "active"
                              ? "bg-[rgba(54,147,111,0.14)] text-[#25704f]"
                              : "bg-[rgba(203,79,88,0.14)] text-[#a23846]"
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="status-pill">
                          {user.auth_linked ? "Auth Linked" : "Setup Pending"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEdit(user)}
                            className="secondary-btn !w-auto !px-3 !py-2 text-sm"
                          >
                            <Pencil size={15} />
                            Edit
                          </button>
                          {supabaseAdminAuthMode && !user.auth_linked ? (
                            <button
                              onClick={() => handleSendSetupInvite(user)}
                              className="secondary-btn !w-auto !px-3 !py-2 text-sm"
                            >
                              <KeyRound size={15} />
                              Send Setup Invite
                            </button>
                          ) : null}
                          {supabaseAdminAuthMode && user.auth_linked ? (
                            <button
                              onClick={() => handleRepairAuthLink(user)}
                              className="secondary-btn !w-auto !px-3 !py-2 text-sm"
                            >
                              <KeyRound size={15} />
                              Repair Auth Link
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleDelete(user)}
                            className="danger-btn !w-auto !px-3 !py-2 text-sm"
                          >
                            <Trash2 size={15} />
                            Disable
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="glass-panel-strong w-full max-w-xl rounded-[30px] p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                  {form.role === "electoral_board" ? "Board Access" : "System Access"}
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  {editing
                    ? "Edit access account"
                    : form.role === "electoral_board"
                      ? "Register electoral board"
                      : "Create super admin"}
                </h2>
              </div>

              <button
                onClick={() => setFormOpen(false)}
                className="rounded-2xl bg-white/70 p-2 hover:bg-white"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4">
              <div>
                <label className="field-label">Full Name</label>
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Board officer full name"
                  className="field-shell w-full"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Email</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="board@organization.com"
                    className="field-shell w-full"
                  />
                </div>
                {supabaseAdminAuthMode ? (
                <div className="app-panel">
                  <p className="text-sm font-bold text-[#102220]">Secure Account Setup</p>
                  <p className="mt-1 text-xs leading-5 text-[#5e726d]">
                    Passwords are established through Supabase Auth invite/setup during cutover.
                  </p>
                </div>
                ) : (
                <div>
                  <label className="field-label">Temporary Password</label>
                  <input
                    required={!editing}
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={editing ? "Leave blank to keep current" : "Set temporary password"}
                    className="field-shell w-full"
                  />
                </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role: e.target.value,
                        organization_id: e.target.value === "super_admin" ? "" : form.organization_id,
                      })
                    }
                    className="field-shell w-full"
                  >
                    <option value="super_admin">Super Admin</option>
                    <option value="electoral_board">Electoral Board</option>
                  </select>
                </div>

                <div>
                  <label className="field-label">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="field-shell w-full"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>

              {form.role === "electoral_board" ? (
                <OrganizationSelect
                  label="Assigned Organization"
                  organizations={organizations}
                  value={form.organization_id}
                  onChange={(organizationId) =>
                    setForm({ ...form, organization_id: organizationId })
                  }
                  placeholder="Select organization for this board account"
                />
              ) : (
                <div className="app-panel">
                  <p className="text-sm font-bold text-[#102220]">Organization Scope</p>
                  <p className="mt-1 text-xs leading-5 text-[#5e726d]">
                    Super admin accounts are not limited to one organization and can access the
                    full control workspace.
                  </p>
                </div>
              )}

              <button disabled={submitting} className="primary-btn mt-2">
                {submitting
                  ? "Saving access..."
                  : editing
                    ? "Save Access Changes"
                    : form.role === "electoral_board"
                      ? "Create Electoral Board Account"
                      : "Create Super Admin Account"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UsersRoles;
