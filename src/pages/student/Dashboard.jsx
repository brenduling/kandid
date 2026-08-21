import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, Globe2, Plus, UserRound, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function initials(name = "Organization") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function OrganizationLogo({ organization }) {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="flex h-[clamp(7rem,10vw,11rem)] w-[clamp(7rem,10vw,11rem)] shrink-0 items-center justify-center rounded-full bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.12)] ring-1 ring-gray-100">
      {organization?.logo_url && !imageError ? (
        <img
          src={organization.logo_url}
          alt={`${organization.name || "Organization"} logo`}
          className="h-full w-full object-contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <span className="text-3xl font-black tracking-tight text-[#d94718]">
          {initials(organization?.name)}
        </span>
      )}
    </div>
  );
}

function StudentDashboard() {
  const [myOrganizations, setMyOrganizations] = useState([]);
  const [otherOrganizations, setOtherOrganizations] = useState([]);
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [organizationOfficers, setOrganizationOfficers] = useState([]);
  const [organizationElections, setOrganizationElections] = useState([]);
  const [organizationMemberCount, setOrganizationMemberCount] = useState(0);
  const [organizationTab, setOrganizationTab] = useState("officers");
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function loadOrganizations() {
      setLoading(true);

      const { data: memberships } = await supabase
        .from("student_organizations")
        .select("organization_id, organizations(id, name, logo_url, organization_type)")
        .eq("student_id", user.id);

      const memberOrganizations =
        memberships?.map((item) => item.organizations).filter(Boolean) || [];
      const memberIds = new Set(memberOrganizations.map((item) => item.id));

      const { data: organizations } = await supabase
        .from("organizations")
        .select("id, name, logo_url, organization_type")
        .order("name", { ascending: true });

      if (!active) return;

      setMyOrganizations(memberOrganizations);
      setOtherOrganizations(
        (organizations || []).filter(
          (organization) =>
            !memberIds.has(organization.id) &&
            organization.organization_type !== "non_departmental"
        ),
      );
      setLoading(false);
    }

    loadOrganizations();

    return () => {
      active = false;
    };
  }, [user.id]);

  async function handleViewOrganization(organization) {
    setSelectedOrganization(organization);
    setOrganizationTab("officers");
    setDetailLoading(true);

    const [{ data: officers }, { data: elections }, { count }] = await Promise.all([
      supabase
        .from("officers")
        .select(`
          *,
          students (
            first_name,
            last_name,
            student_number,
            photo_url
          )
        `)
        .eq("organization_id", organization.id)
        .order("is_current", { ascending: false })
        .order("display_order", { ascending: true }),
      supabase
        .from("elections")
        .select("id, title, start_date, end_date, status")
        .eq("organization_id", organization.id)
        .neq("status", "archived")
        .order("start_date", { ascending: false }),
      supabase
        .from("student_organizations")
        .select("student_id", { count: "exact", head: true })
        .eq("organization_id", organization.id),
    ]);

    setOrganizationOfficers(officers || []);
    setOrganizationElections(elections || []);
    setOrganizationMemberCount(count || 0);
    setDetailLoading(false);
  }

  if (selectedOrganization) {
    const currentOfficers = organizationOfficers.filter((officer) => officer.is_current);
    const visibleOfficers = currentOfficers.length > 0 ? currentOfficers : organizationOfficers;

    return (
      <div className="w-full max-w-none">
        <button
          onClick={() => setSelectedOrganization(null)}
          className="student-back-link"
          aria-label="Back to organizations"
        >
          <ArrowLeft size={15} />
          <span>Back</span>
        </button>

        <section className="student-campaign-hero student-org-detail-hero w-full max-w-none overflow-hidden px-6 py-6 md:px-8 md:py-8 lg:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <div className="flex h-[clamp(5.5rem,8vw,8rem)] w-[clamp(5.5rem,8vw,8rem)] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-gray-100">
              {selectedOrganization.logo_url ? (
                <img
                  src={selectedOrganization.logo_url}
                  alt={`${selectedOrganization.name} logo`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[#f4511e]">
                  <UsersRound size={36} />
                </span>
              )}
            </div>

            <div className="min-w-0">
              <span className="mb-2 inline-flex rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#f4511e]">
                {selectedOrganization.organization_type === "non_departmental"
                  ? "Non-Departmental Organization"
                  : "Departmental Organization"}
              </span>

              <h1 className="truncate">{selectedOrganization.name}</h1>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationMemberCount} active member
                  {organizationMemberCount === 1 ? "" : "s"}
                </span>
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationElections.length} election
                  {organizationElections.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="student-campaign-tabs w-full">
          <button
            type="button"
            className={organizationTab === "officers" ? "active" : ""}
            onClick={() => setOrganizationTab("officers")}
          >
            Officers
          </button>
          <button
            type="button"
            className={organizationTab === "elections" ? "active" : ""}
            onClick={() => setOrganizationTab("elections")}
          >
            Elections
          </button>
        </div>

        <section className="student-org-detail-panel w-full max-w-none px-5 py-6 md:px-8 lg:px-10">
          {detailLoading ? (
            <div className="student-empty-card w-full min-h-[280px] flex items-center justify-center">Loading organization details...</div>
          ) : organizationTab === "officers" ? (
            <>
              <select className="student-org-year-select" defaultValue="2026-2027">
                <option>2026-2027</option>
                <option>2025-2026</option>
                <option>2024-2025</option>
              </select>

              <div className="student-officer-stack w-full space-y-6 lg:space-y-8">
                {visibleOfficers.length === 0 ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#f4511e] shadow-sm ring-1 ring-gray-100">
                      <UsersRound size={28} />
                    </div>

                    <h2 className="mt-5 text-xl font-black text-[#182033]">
                      No officers to display
                    </h2>

                    <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
                      This organization does not have any current officers
                      available for the selected term.
                    </p>
                  </div>
                ) : (
                  visibleOfficers.map((officer) => {
                    const fullName = officer.students
                      ? `${officer.students.first_name} ${officer.students.last_name}`
                      : officer.officer_name;

                    return (
                      <div key={officer.id}>
                        <h2>{officer.position_title || "Officer"}</h2>
                        <div className="student-officer-row w-full min-h-[110px] md:min-h-[130px] lg:min-h-[150px] px-5 py-5 md:px-7 md:py-6">
                          <div className="student-officer-avatar !h-[clamp(4rem,6vw,6rem)] !w-[clamp(4rem,6vw,6rem)]">
                            {officer.students?.photo_url ? (
                              <img src={officer.students.photo_url} alt={fullName} />
                            ) : (
                              <UserRound size={34} />
                            )}
                          </div>
                          <div>
                            <strong>{fullName || "Officer"}</strong>
                            <p>{officer.term_label || "2026-2027"}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="student-org-election-list grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
              {organizationElections.length === 0 ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-10 text-center">
                  <CalendarDays size={30} className="text-[#f4511e]" />
                  <h2 className="mt-4 text-xl font-black text-[#182033]">
                    No elections listed
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
                    There are currently no elections available for this
                    organization.
                  </p>
                </div>
              ) : (
                organizationElections.map((election) => (
                  <article key={election.id} className="student-org-election-card w-full min-w-0 min-h-[140px] px-6 py-6 lg:min-h-[170px] lg:px-8 lg:py-8">
                    <div>
                      <h2>{election.title}</h2>
                      <p>
                        {election.start_date
                          ? new Date(election.start_date).toLocaleDateString()
                          : "No start date"}
                      </p>
                    </div>
                    <button onClick={() => navigate("/student/elections")}>
                      View Overview
                    </button>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none">
      <div className="student-page-head w-full">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back to the Student Election Portal.</p>
        </div>
        <div className="student-page-actions">
          <button onClick={() => navigate("/student/elections")} className="student-outline-btn">
            <CalendarDays size={16} />
            View Election Schedule
          </button>
          <button onClick={() => navigate("/student/elections")} className="student-solid-btn">
            Cast Your Vote
          </button>
        </div>
      </div>

      {loading ? (
        <div className="student-empty-card">Loading organizations...</div>
      ) : (
        <>
          <section className="student-section w-full">
            <div className="student-section-title">
              <Building2 size={16} />
              My Organization
            </div>
            <div className="student-org-grid student-org-grid-primary grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:gap-8">
              {myOrganizations.length === 0 ? (
                <div className="student-empty-card">No organization assigned.</div>
              ) : (
                myOrganizations.map((organization) => (
                  <article
                    key={organization.id}
                    className="group w-full min-w-0 overflow-hidden rounded-3xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(15,23,42,0.10)]"
                  >
                    <div className="relative flex h-[clamp(15rem,20vw,22rem)] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fffaf7] via-white to-[#f5f7fb]">
                      <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-[#f4511e]/[0.06]" />
                      <div className="absolute -bottom-12 -right-8 h-32 w-32 rounded-full bg-blue-500/[0.04]" />

                      <OrganizationLogo organization={organization} />

                      <span className="absolute left-3 top-3 rounded-full border border-gray-200 bg-white/95 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500 shadow-sm backdrop-blur">
                        {organization.organization_type === "non_departmental"
                          ? "Non-Departmental"
                          : "Departmental"}
                      </span>
                    </div>

                    <div className="px-4 pb-3 pt-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-lg font-black leading-tight text-[#182033]">
                            {organization.name}
                          </h2>
                        </div>

                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-emerald-700">
                          Member
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-gray-400">
                            Organization Type
                          </p>
                          <p className="mt-0.5 text-xs font-bold text-gray-700">
                            {organization.organization_type === "non_departmental"
                              ? "Non-Departmental"
                              : "Departmental"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleViewOrganization(organization)}
                          className="shrink-0 rounded-xl bg-[#f4511e] px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[#d94718] focus:outline-none focus:ring-2 focus:ring-[#f4511e]/30"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="student-section w-full">
            <div className="student-section-title">
              <Globe2 size={16} />
              Other Departmental Organizations
            </div>
            <div className="student-org-grid grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-8">
              {otherOrganizations.slice(0, 3).map((organization) => (
                <article
                  key={organization.id}
                  className="group w-full min-w-0 overflow-hidden rounded-3xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(15,23,42,0.09)]"
                >
                  <div className="relative flex h-[clamp(13rem,17vw,18rem)] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fffaf7] via-white to-[#f5f7fb]">
                    <OrganizationLogo organization={organization} />

                    <span className="absolute left-3 top-3 rounded-full border border-gray-200 bg-white/95 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.1em] text-gray-500 shadow-sm backdrop-blur">
                      Departmental
                    </span>
                  </div>

                  <div className="px-4 pb-3 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-black leading-tight text-[#182033]">
                          {organization.name}
                        </h2>
                      </div>

                      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.1em] text-gray-500">
                        Explore
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                      <div>
                        <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-gray-400">
                          Organization Type
                        </p>
                        <p className="mt-0.5 text-xs font-bold text-gray-700">
                          Departmental
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleViewOrganization(organization)}
                        className="shrink-0 rounded-xl bg-[#f4511e] px-3.5 py-2 text-xs font-black text-white transition hover:bg-[#d94718] focus:outline-none focus:ring-2 focus:ring-[#f4511e]/30"
                      >
                        View
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              <button
                type="button"
                onClick={() => navigate("/student/elections")}
                className="student-explore-card"
              >
                <Plus size={28} />
                <span>Explore All</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default StudentDashboard;