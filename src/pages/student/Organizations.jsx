import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Globe2, UserRound, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  OrganizationLogo,
  StudentAvatar,
} from "../../components/KandidImage";
import StudentOrganizationCard, {
  getOrganizationDescription,
  getOrganizationTypeLabel,
} from "../../components/student/StudentOrganizationCard";
import { supabase } from "../../lib/supabaseClient";
import { formatLocalDate } from "../../utils/elections";
import {
  getStudentOrganizationDirectory,
  selectActiveMemberships,
} from "../../utils/organizationAccess";

const ORGANIZATION_FILTERS = [
  { value: "all", label: "All" },
  { value: "departmental", label: "Departmental" },
  { value: "non_departmental", label: "Non-Departmental" },
];

function StudentOrganizations() {
  const [organizations, setOrganizations] = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [organizationTab, setOrganizationTab] = useState("about");
  const [organizationOfficers, setOrganizationOfficers] = useState([]);
  const [organizationElections, setOrganizationElections] = useState([]);
  const [organizationMemberCount, setOrganizationMemberCount] = useState(0);
  const [organizationMemberCountError, setOrganizationMemberCountError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadOrganizations() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const {
        memberOrganizations,
        otherOrganizations,
        memberIds: activeMemberIds,
      } = await getStudentOrganizationDirectory(user);

      const rows = [...memberOrganizations, ...otherOrganizations];
      const uniqueRows = Array.from(
        new Map(rows.map((organization) => [Number(organization.id), organization])).values(),
      ).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      if (!active) return;

      setOrganizations(uniqueRows);
      setMemberIds(activeMemberIds);
      setLoading(false);

      const ids = uniqueRows.map((organization) => organization.id).filter(Boolean);
      if (ids.length === 0) return;

      const { data, error } = await supabase
        .from("organizations")
        .select("id, logo_url")
        .in("id", ids);

      if (!active || error) return;

      const logoMap = new Map((data || []).map((organization) => [
        Number(organization.id),
        organization.logo_url,
      ]));

      setOrganizations((previous) =>
        previous.map((organization) => ({
          ...organization,
          logo_url: logoMap.get(Number(organization.id)) || organization.logo_url || null,
        })),
      );
    }

    loadOrganizations();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const filteredOrganizations = useMemo(() => {
    if (filter === "all") return organizations;
    return organizations.filter((organization) => organization.organization_type === filter);
  }, [filter, organizations]);

  const counts = useMemo(
    () => ({
      all: organizations.length,
      departmental: organizations.filter(
        (organization) => organization.organization_type !== "non_departmental",
      ).length,
      non_departmental: organizations.filter(
        (organization) => organization.organization_type === "non_departmental",
      ).length,
    }),
    [organizations],
  );

  async function handleViewOrganization(organization) {
    setSelectedOrganization(organization);
    setOrganizationTab("about");
    setOrganizationOfficers([]);
    setOrganizationElections([]);
    setOrganizationMemberCount(0);
    setOrganizationMemberCountError("");
    setDetailLoading(true);

    const [
      { data: officers, error: officersError },
      { data: elections, error: electionsError },
      { data: memberships, error: countError },
    ] = await Promise.all([
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
        .neq("status", "draft")
        .neq("status", "archived")
        .order("start_date", { ascending: false }),
      selectActiveMemberships(
        "organization_id",
        [["organization_id", organization.id]],
      ),
    ]);

    if (officersError) console.error("Failed to load organization officers:", officersError);
    if (electionsError) console.error("Failed to load organization elections:", electionsError);
    if (countError) console.error("Failed to load organization member count:", countError);

    setOrganizationOfficers(officers || []);
    setOrganizationElections(elections || []);
    setOrganizationMemberCount(countError ? 0 : (memberships || []).length);
    setOrganizationMemberCountError(countError ? "Member count unavailable" : "");
    setDetailLoading(false);
  }

  if (selectedOrganization) {
    const isMember = memberIds.has(Number(selectedOrganization.id));
    const visibleOfficers =
      organizationOfficers.filter((officer) => officer.is_current).length > 0
        ? organizationOfficers.filter((officer) => officer.is_current)
        : organizationOfficers;

    return (
      <div className="w-full max-w-none">
        <button
          type="button"
          onClick={() => setSelectedOrganization(null)}
          className="student-back-link"
        >
          <ArrowLeft size={15} />
          Back to organizations
        </button>

        <section className="student-campaign-hero student-org-detail-hero w-full max-w-none overflow-hidden px-6 py-6 md:px-8 md:py-8 lg:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <OrganizationLogo
              organization={selectedOrganization}
              className="!h-[clamp(5.5rem,8vw,8rem)] !w-[clamp(5.5rem,8vw,8rem)] !p-2.5"
              loading="eager"
            />

            <div className="min-w-0">
              <span className="mb-2 inline-flex rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#f4511e]">
                {getOrganizationTypeLabel(selectedOrganization)}
              </span>
              <h1 className="truncate">{selectedOrganization.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {isMember ? "Member" : "Explore"}
                </span>
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationMemberCountError ||
                    `${organizationMemberCount} active member${
                      organizationMemberCount === 1 ? "" : "s"
                    }`}
                </span>
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationElections.length} election{organizationElections.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="student-campaign-tabs w-full">
          {["about", "officers", "elections"].map((tab) => (
            <button
              key={tab}
              type="button"
              className={organizationTab === tab ? "active" : ""}
              onClick={() => setOrganizationTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <section className="student-org-detail-panel w-full max-w-none px-5 py-6 md:px-8 lg:px-10">
          {detailLoading ? (
            <div className="student-empty-card flex min-h-[280px] w-full items-center justify-center">
              Loading organization details...
            </div>
          ) : organizationTab === "about" ? (
            <div className="student-org-about">
              <p className="student-directory-card-label">About</p>
              <h2>{selectedOrganization.name}</h2>
              <p>{getOrganizationDescription(selectedOrganization)}</p>
            </div>
          ) : organizationTab === "officers" ? (
            <div className="student-officer-stack w-full space-y-6 lg:space-y-8">
              {visibleOfficers.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-12 text-center">
                  <UsersRound size={28} className="text-[#f4511e]" />
                  <h2 className="mt-5 text-xl font-black text-[#182033]">
                    No officers to display
                  </h2>
                </div>
              ) : (
                visibleOfficers.map((officer) => {
                  const fullName = officer.students
                    ? `${officer.students.first_name} ${officer.students.last_name}`
                    : officer.officer_name;

                  return (
                    <div key={officer.id}>
                      <h2>{officer.position_title || "Officer"}</h2>
                      <div className="student-officer-row w-full min-h-[110px] px-5 py-5 md:min-h-[130px] md:px-7 md:py-6 lg:min-h-[150px]">
                        {officer.students ? (
                          <StudentAvatar
                            student={officer.students}
                            className="student-officer-avatar !h-[clamp(4rem,6vw,6rem)] !w-[clamp(4rem,6vw,6rem)]"
                          />
                        ) : (
                          <div className="student-officer-avatar !h-[clamp(4rem,6vw,6rem)] !w-[clamp(4rem,6vw,6rem)]">
                            <UserRound size={34} />
                          </div>
                        )}
                        <div>
                          <strong>{fullName || "Officer"}</strong>
                          <p>{officer.term_label || "Current Term"}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="student-org-election-list grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
              {organizationElections.length === 0 ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-10 text-center">
                  <CalendarDays size={30} className="text-[#f4511e]" />
                  <h2 className="mt-4 text-xl font-black text-[#182033]">
                    No elections listed
                  </h2>
                </div>
              ) : (
                organizationElections.map((election) => (
                  <article
                    key={election.id}
                    className="student-org-election-card w-full min-w-0 min-h-[140px] px-6 py-6 lg:min-h-[170px] lg:px-8 lg:py-8"
                  >
                    <div>
                      <h2>{election.title}</h2>
                      <p>
                        {election.start_date
                          ? formatLocalDate(election.start_date)
                          : "No start date"}
                      </p>
                    </div>
                    <button type="button" onClick={() => navigate("/student/elections")}>
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
      <div className="student-page-head">
        <div>
          <span className="page-kicker">Explore Organizations</span>
          <h1>Organization Catalog</h1>
          <p>Browse student organizations and distinguish official membership from discovery.</p>
        </div>
      </div>

      <section className="student-section">
        <div className="student-section-title">
          <Globe2 size={16} />
          Organizations
        </div>

        <div className="student-directory-filter-bar" aria-label="Organization filters">
          {ORGANIZATION_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`student-directory-filter-chip ${
                filter === item.value ? "student-directory-filter-chip-active" : ""
              }`}
            >
              <span>{item.label}</span>
              <strong>{counts[item.value]}</strong>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="student-empty-card mt-6">Loading organizations...</div>
        ) : filteredOrganizations.length === 0 ? (
          <div className="student-empty-card mt-6">No organizations available.</div>
        ) : (
          <div className="student-explore-grid">
            {filteredOrganizations.map((organization) => (
              <StudentOrganizationCard
                key={organization.id}
                organization={organization}
                membershipState={memberIds.has(Number(organization.id)) ? "member" : "explore"}
                onView={handleViewOrganization}
                compact
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default StudentOrganizations;
