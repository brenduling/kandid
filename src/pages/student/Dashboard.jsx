import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Globe2,
  Plus,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  OrganizationLogo as BaseOrganizationLogo,
  StudentAvatar,
} from "../../components/KandidImage";
import StudentOrganizationCard, {
  getOrganizationDescription,
  getOrganizationTypeLabel,
} from "../../components/student/StudentOrganizationCard";
import { supabase } from "../../lib/supabaseClient";
import { compareElectionScheduleValues, formatLocalDate, getElectionPhase } from "../../utils/elections";
import {
  getStudentOrganizationDirectory,
  selectActiveMemberships,
} from "../../utils/organizationAccess";

const ORGANIZATION_FILTERS = [
  { value: "all", label: "All" },
  { value: "departmental", label: "Departmental" },
  { value: "non_departmental", label: "Non-Departmental" },
];


function StudentDashboard() {
  const [myOrganizations, setMyOrganizations] = useState([]);
  const [otherOrganizations, setOtherOrganizations] = useState([]);
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [organizationFilter, setOrganizationFilter] = useState("all");

  const [organizationOfficers, setOrganizationOfficers] = useState([]);
  const [organizationElections, setOrganizationElections] = useState([]);
  const [organizationMemberCount, setOrganizationMemberCount] = useState(0);
  const [organizationMemberCountError, setOrganizationMemberCountError] = useState("");

  const [organizationTab, setOrganizationTab] = useState("about");

  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const user = JSON.parse(localStorage.getItem("user"));
  const navigate = useNavigate();

  /*
   * ============================================================
   * LOAD ORGANIZATIONS
   * ============================================================
   *
   * IMPORTANT:
   * We intentionally DO NOT request logo_url from the main
   * organizations query.
   *
   * Your previous request was downloading potentially huge
   * Base64 images from the database.
   *
   * We first load lightweight organization information.
   * Logos are loaded separately only for the organizations
   * that are actually displayed.
   */
  useEffect(() => {
    let active = true;

    async function loadOrganizations() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        /*
         * Run both queries at the same time.
         */
        const {
          memberOrganizations,
          otherOrganizations: explorableOrganizations,
        } = await getStudentOrganizationDirectory(user);

        if (!active) return;

        /*
         * Set lightweight data immediately.
         */
        setMyOrganizations(memberOrganizations);
        setOtherOrganizations(explorableOrganizations);

        /*
         * Initial UI can now render without waiting for Base64 logos.
         */
        setLoading(false);

        /*
         * ========================================================
         * LOAD ONLY REQUIRED LOGOS
         * ========================================================
         *
         * We only need:
         * - logos for the student's organizations
         * - first 3 organizations for each discovery filter
         *
         * This prevents the dashboard from downloading every
         * organization's image.
         */
        const visibleOtherOrganizations = [
          ...explorableOrganizations.slice(0, 3),
          ...explorableOrganizations
            .filter(
              (organization) =>
                organization.organization_type !== "non_departmental"
            )
            .slice(0, 3),
          ...explorableOrganizations
            .filter(
              (organization) =>
                organization.organization_type === "non_departmental"
            )
            .slice(0, 3),
        ];

        const visibleOrganizationIds = [
          ...memberOrganizations.map((organization) => organization.id),
          ...visibleOtherOrganizations.map((organization) => organization.id),
        ];

        const uniqueOrganizationIds = [
          ...new Set(visibleOrganizationIds),
        ];

        if (uniqueOrganizationIds.length === 0) {
          return;
        }

        /*
         * Fetch only the logos needed by the dashboard.
         */
        const { data: logoOrganizations, error: logoError } =
          await supabase
            .from("organizations")
            .select("id, logo_url")
            .in("id", uniqueOrganizationIds);

        if (!active) return;

        if (logoError) {
          console.error(
            "Failed to load organization logos:",
            logoError
          );
          return;
        }

        const logoMap = new Map(
          (logoOrganizations || []).map((organization) => [
            organization.id,
            organization.logo_url,
          ])
        );

        /*
         * Attach logos to the already-rendered organization data.
         */
        setMyOrganizations((previous) =>
          previous.map((organization) => ({
            ...organization,
            logo_url: logoMap.get(organization.id) || null,
          }))
        );

        setOtherOrganizations((previous) =>
          previous.map((organization) => ({
            ...organization,
            logo_url: logoMap.get(organization.id) || null,
          }))
        );
      } catch (error) {
        console.error(
          "Unexpected organization loading error:",
          error
        );

        if (active) {
          setLoading(false);
        }
      }
    }

    loadOrganizations();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const filteredOtherOrganizations = useMemo(() => {
    if (organizationFilter === "all") {
      return otherOrganizations;
    }

    return otherOrganizations.filter(
      (organization) =>
        organization.organization_type === organizationFilter
    );
  }, [organizationFilter, otherOrganizations]);

  const visibleOtherOrganizations = useMemo(
    () => filteredOtherOrganizations.slice(0, 3),
    [filteredOtherOrganizations]
  );

  const organizationFilterCounts = useMemo(
    () => ({
      all: otherOrganizations.length,
      departmental: otherOrganizations.filter(
        (organization) =>
          organization.organization_type !== "non_departmental"
      ).length,
      non_departmental: otherOrganizations.filter(
        (organization) =>
          organization.organization_type === "non_departmental"
      ).length,
    }),
    [otherOrganizations]
  );

  const emptyDiscoveryMessage =
    organizationFilter === "non_departmental"
      ? "No non-departmental organizations available."
      : organizationFilter === "departmental"
      ? "No departmental organizations available."
      : "No other organizations available.";

  async function handleCastVoteShortcut() {
    const organizationIds = myOrganizations.map((organization) => organization.id);

    if (organizationIds.length === 0) {
      navigate("/student/elections");
      return;
    }

    const { data, error } = await supabase
      .from("elections")
      .select("id, campaign_start, campaign_end, start_date, end_date, status")
      .in("organization_id", organizationIds)
      .neq("status", "draft")
      .neq("status", "archived")
      .order("start_date", { ascending: false });

    if (error) {
      navigate("/student/elections");
      return;
    }

    const sortedElections = [...(data || [])].sort((first, second) =>
      compareElectionScheduleValues(second.start_date, first.start_date)
    );
    const openElection = sortedElections.find(
      (election) => getElectionPhase(election) === "voting",
    );
    const campaignElection = sortedElections.find(
      (election) => getElectionPhase(election) === "campaign",
    );

    if (openElection) {
      navigate(`/student/vote/${openElection.id}`);
      return;
    }

    if (campaignElection) {
      navigate(`/student/elections/${campaignElection.id}/campaign`);
      return;
    }

    navigate("/student/elections");
  }

  /*
   * ============================================================
   * OPEN ORGANIZATION DETAILS
   * ============================================================
   */
  async function handleViewOrganization(organization) {
    setSelectedOrganization(organization);
    setOrganizationTab("about");

    setOrganizationOfficers([]);
    setOrganizationElections([]);
    setOrganizationMemberCount(0);
    setOrganizationMemberCountError("");

    setDetailLoading(true);

    try {
      /*
       * All three requests run simultaneously.
       */
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
          .select(
            "id, title, start_date, end_date, status"
          )
          .eq("organization_id", organization.id)
          .neq("status", "draft")
          .neq("status", "archived")
          .order("start_date", { ascending: false }),

        selectActiveMemberships(
          "organization_id",
          [["organization_id", organization.id]],
        ),
      ]);

      if (officersError) {
        console.error(
          "Failed to load organization officers:",
          officersError
        );
      }

      if (electionsError) {
        console.error(
          "Failed to load organization elections:",
          electionsError
        );
      }

      if (countError) {
        console.error(
          "Failed to load organization member count:",
          countError
        );
      }

      setOrganizationOfficers(officers || []);
      setOrganizationElections(elections || []);
      setOrganizationMemberCount(countError ? 0 : (memberships || []).length);
      setOrganizationMemberCountError(countError ? "Member count unavailable" : "");
    } catch (error) {
      console.error(
        "Unexpected organization detail error:",
        error
      );
    } finally {
      setDetailLoading(false);
    }
  }

  /*
   * ============================================================
   * ORGANIZATION DETAIL VIEW
   * ============================================================
   */
  if (selectedOrganization) {
    const currentOfficers = organizationOfficers.filter(
      (officer) => officer.is_current
    );

    const visibleOfficers =
      currentOfficers.length > 0
        ? currentOfficers
        : organizationOfficers;

    return (
      <div className="w-full max-w-none">
        {/* BACK BUTTON */}
        <button
          type="button"
          onClick={() => setSelectedOrganization(null)}
          className="student-back-link"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {/* ORGANIZATION HERO */}
        <section className="student-campaign-hero student-org-detail-hero w-full max-w-none overflow-hidden px-6 py-6 md:px-8 md:py-8 lg:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <BaseOrganizationLogo
              organization={selectedOrganization}
              className="!h-[clamp(5.5rem,8vw,8rem)] !w-[clamp(5.5rem,8vw,8rem)] !p-2.5"
              loading="eager"
            />

            <div className="min-w-0">
              <span className="mb-2 inline-flex rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#f4511e]">
                {selectedOrganization.organization_type ===
                  "non_departmental"
                  ? "Non-Departmental Organization"
                  : "Departmental Organization"}
              </span>

              <h1 className="truncate">
                {selectedOrganization.name}
              </h1>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {myOrganizations.some(
                    (organization) => organization.id === selectedOrganization.id,
                  )
                    ? "Member"
                    : "Explore"}
                </span>

                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationMemberCountError ||
                    `${organizationMemberCount} active member${
                      organizationMemberCount === 1 ? "" : "s"
                    }`}
                </span>

                <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-gray-700">
                  {organizationElections.length} election
                  {organizationElections.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* TABS */}
        <div className="student-campaign-tabs w-full">
          <button
            type="button"
            className={
              organizationTab === "about"
                ? "active"
                : ""
            }
            onClick={() =>
              setOrganizationTab("about")
            }
          >
            About
          </button>

          <button
            type="button"
            className={
              organizationTab === "officers"
                ? "active"
                : ""
            }
            onClick={() =>
              setOrganizationTab("officers")
            }
          >
            Officers
          </button>

          <button
            type="button"
            className={
              organizationTab === "elections"
                ? "active"
                : ""
            }
            onClick={() =>
              setOrganizationTab("elections")
            }
          >
            Elections
          </button>
        </div>

        {/* DETAILS */}
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
            <>
              <select
                className="student-org-year-select"
                defaultValue="2026-2027"
              >
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
                      This organization does not have any
                      current officers available for the
                      selected term.
                    </p>
                  </div>
                ) : (
                  visibleOfficers.map((officer) => {
                    const fullName =
                      officer.students
                        ? `${officer.students.first_name} ${officer.students.last_name}`
                        : officer.officer_name;

                    return (
                      <div key={officer.id}>
                        <h2>
                          {officer.position_title ||
                            "Officer"}
                        </h2>

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
                            <strong>
                              {fullName || "Officer"}
                            </strong>

                            <p>
                              {officer.term_label ||
                                "2026-2027"}
                            </p>
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
                  <CalendarDays
                    size={30}
                    className="text-[#f4511e]"
                  />

                  <h2 className="mt-4 text-xl font-black text-[#182033]">
                    No elections listed
                  </h2>

                  <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
                    There are currently no elections
                    available for this organization.
                  </p>
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

                    <button
                      type="button"
                      onClick={() =>
                        navigate("/student/elections")
                      }
                    >
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

  /*
   * ============================================================
   * DASHBOARD VIEW
   * ============================================================
   */
  return (
    <div className="w-full max-w-none">
      {/* PAGE HEADER */}
      <div className="student-page-head">
        <div>
          <h1>Dashboard</h1>

          <p>
            Welcome back to the Student Election Portal.
          </p>
        </div>

        <div className="student-page-actions">
          <button
            type="button"
            onClick={handleCastVoteShortcut}
            className="student-solid-btn student-dashboard-vote-action"
          >
            Cast Your Vote
          </button>
        </div>
      </div>

      {loading ? (
        <div className="student-empty-card">
          Loading organizations...
        </div>
      ) : (
        <>
          {/* ==================================================
              MY ORGANIZATION
              ================================================== */}
          <section className="student-section">
            <div className="student-section-title">
              <Building2 size={16} />
              My Organization
            </div>

            <div className="student-org-grid student-org-grid-primary grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:gap-7">
              {myOrganizations.length === 0 ? (
                <div className="student-empty-card">
                  No organization assigned.
                </div>
              ) : (
                myOrganizations.map((organization) => (
                  <StudentOrganizationCard
                    key={organization.id}
                    organization={organization}
                    membershipState="member"
                    onView={handleViewOrganization}
                  />
                ))
              )}
            </div>
          </section>

          {/* ==================================================
              OTHER ORGANIZATIONS
              ================================================== */}
          <section className="student-section">
            <div className="student-section-title">
              <Globe2 size={16} />
              Other Organizations
            </div>

            <div
              className="student-directory-filter-bar"
              aria-label="Organization filters"
            >
              {ORGANIZATION_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() =>
                    setOrganizationFilter(filter.value)
                  }
                  className={`student-directory-filter-chip ${
                    organizationFilter === filter.value
                      ? "student-directory-filter-chip-active"
                      : ""
                  }`}
                >
                  <span>{filter.label}</span>
                  <strong>
                    {organizationFilterCounts[filter.value]}
                  </strong>
                </button>
              ))}
            </div>

            <div className="student-org-grid grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-7">
              {visibleOtherOrganizations.length === 0 ? (
                <div className="student-empty-card">
                  {emptyDiscoveryMessage}
                </div>
              ) : (
                <>
                  {visibleOtherOrganizations.map((organization) => (
                    <StudentOrganizationCard
                      key={organization.id}
                      organization={organization}
                      membershipState="explore"
                      onView={handleViewOrganization}
                    />
                  ))}

                  {/* EXPLORE ALL */}
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/student/organizations")
                    }
                    className="student-explore-card"
                  >
                    <Plus size={28} />

                    <span>Explore All</span>

                    <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default StudentDashboard;
