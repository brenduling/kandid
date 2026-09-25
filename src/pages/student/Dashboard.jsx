import { useEffect, useMemo, useState } from "react";
import "./Dashboard.css";
import {
  ArrowRight,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import StudentOrganizationCard from "../../components/student/StudentOrganizationCard";
import StudentOrganizationDetail from "../../components/student/StudentOrganizationDetail";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { supabase } from "../../lib/supabaseClient";
import {
  compareElectionScheduleValues,
  formatLocalDateTime,
  getElectionPhase,
  isMissingElectionCoverColumn,
} from "../../utils/elections";
import {
  getStudentOrganizationDirectory,
  selectActiveMemberships,
} from "../../utils/organizationAccess";

const ORGANIZATION_FILTERS = [
  { value: "all", label: "All" },
  { value: "departmental", label: "Departmental" },
  { value: "non_departmental", label: "Non-Departmental" },
];

const IDENTITY_MARK_STOP_WORDS = new Set([
  "OF", "AND", "THE", "FOR", "IN", "AT", "ON", "A", "AN",
  "DE", "DEL", "LOS", "LAS", "DAS", "SAN", "SAINT",
]);

function getOrganizationIdentityMark(organization) {
  const name = String(organization?.name || "").trim();
  if (!name) return "";

  if (!/\s/.test(name)) {
    return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !IDENTITY_MARK_STOP_WORDS.has(word.toUpperCase()))
    .map((word) => word[0].toUpperCase())
    .join("");

  if (initials.length >= 2) {
    return initials.slice(0, 7);
  }

  return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 7);
}


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

  const studentName = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ") || "Student";

  const studentFirstName = user?.first_name?.trim() || studentName;

  const myOrganizationIds = myOrganizations
    .map((organization) => organization.id)
    .sort((first, second) => first - second)
    .join(",");

  const studentId = user?.id;

  const [votingState, setVotingState] = useState({
    status: "loading",
    openElection: null,
    nextOpenAt: "",
  });

  useEffect(() => {
    let active = true;

    async function loadVotingState() {
      if (!studentId || myOrganizationIds === "") {
        if (active) {
          setVotingState({ status: "none", openElection: null, nextOpenAt: "" });
        }
        return;
      }

      const [votesResponse, electionsResponse] = await Promise.all([
        supabase
          .from("votes")
          .select("election_id")
          .eq("student_id", studentId),
        supabase
          .from("elections")
          .select(
            "id, title, organization_id, campaign_start, campaign_end, start_date, end_date, status"
          )
          .in("organization_id", myOrganizationIds.split(",").map(Number))
          .neq("status", "draft")
          .neq("status", "archived")
          .order("start_date", { ascending: false }),
      ]);

      if (!active) return;

      if (votesResponse.error || electionsResponse.error) {
        setVotingState({ status: "none", openElection: null, nextOpenAt: "" });
        return;
      }

      const votedIds = new Set(
        (votesResponse.data || [])
          .map((voteRow) => Number(voteRow.election_id))
          .filter(Boolean)
      );

      const rows = electionsResponse.data || [];

      const openElections = rows.filter(
        (election) =>
          getElectionPhase(election) === "voting" &&
          !votedIds.has(Number(election.id))
      );

      const upcomingElections = rows
        .filter((election) =>
          ["campaign_upcoming", "campaign", "waiting", "scheduled"].includes(
            getElectionPhase(election)
          )
        )
        .sort((first, second) =>
          compareElectionScheduleValues(first.start_date, second.start_date)
        );

      if (openElections.length === 1) {
        setVotingState({
          status: "open",
          openElection: openElections[0],
          nextOpenAt: "",
        });
      } else if (openElections.length > 1) {
        setVotingState({ status: "open_multiple", openElection: null, nextOpenAt: "" });
      } else if (upcomingElections[0]) {
        setVotingState({
          status: "upcoming",
          openElection: null,
          nextOpenAt: formatLocalDateTime(upcomingElections[0].start_date),
        });
      } else {
        setVotingState({ status: "none", openElection: null, nextOpenAt: "" });
      }
    }

    loadVotingState();

    return () => {
      active = false;
    };
  }, [studentId, myOrganizationIds]);

  function renderVotingAction() {
    if (votingState.status === "open" && votingState.openElection) {
      return (
        <>
          <button
            type="button"
            onClick={openCurrentBallot}
            className="student-solid-btn student-dashboard-vote-action"
          >
            Cast Your Vote
          </button>

          <span className="student-dashboard-vote-context">
            {votingState.openElection.title}
          </span>
        </>
      );
    }

    if (votingState.status === "open_multiple") {
      return (
        <>
          <span className="student-dashboard-vote-status">
            Voting is open
          </span>

          <button
            type="button"
            onClick={() => navigate("/student/elections")}
            className="student-dashboard-view-button"
          >
            View Elections
          </button>
        </>
      );
    }

    if (votingState.status === "upcoming") {
      return (
        <>
          <span className="student-dashboard-vote-status">
            Voting opens {votingState.nextOpenAt}
          </span>

          <button
            type="button"
            onClick={() => navigate("/student/elections")}
            className="student-dashboard-view-button"
          >
            View Elections
          </button>
        </>
      );
    }

    if (votingState.status === "none") {
      return (
        <>
          <span className="student-dashboard-vote-status">
            No voting open right now
          </span>

          <button
            type="button"
            onClick={() => navigate("/student/elections")}
            className="student-dashboard-view-button"
          >
            View Elections
          </button>
        </>
      );
    }

    return null;
  }

  function openCurrentBallot() {
    if (votingState.openElection) {
      navigate(`/student/vote/${votingState.openElection.id}`);
    }
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
      const buildOrganizationElectionQuery = (includeCoverColumn = true) =>
        supabase
          .from("elections")
          .select(
            includeCoverColumn
              ? "id, title, cover_url, start_date, end_date, status"
              : "id, title, start_date, end_date, status"
          )
          .eq("organization_id", organization.id)
          .neq("status", "draft")
          .neq("status", "archived")
          .order("start_date", { ascending: false });

      /*
       * All three requests run simultaneously.
       */
      const [
        { data: officers, error: officersError },
        { data: electionRows, error: initialElectionsError },
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

        buildOrganizationElectionQuery(true),

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

      let elections = electionRows || [];
      let electionsError = initialElectionsError;

      if (isMissingElectionCoverColumn(initialElectionsError)) {
        const fallback = await buildOrganizationElectionQuery(false);
        elections = fallback.data || [];
        electionsError = fallback.error;
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
    return (
      <StudentOrganizationDetail
        organization={selectedOrganization}
        isMember={myOrganizations.some(
          (organization) => organization.id === selectedOrganization.id,
        )}
        memberCount={organizationMemberCount}
        memberCountError={organizationMemberCountError}
        officers={organizationOfficers}
        elections={organizationElections}
        activeTab={organizationTab}
        loading={detailLoading}
        onBack={() => setSelectedOrganization(null)}
        onTabChange={setOrganizationTab}
        onElectionView={() => navigate("/student/elections")}
      />
    );
  }

  /*
   * ============================================================
   * DASHBOARD VIEW
   * ============================================================
   */
  return (
    <div className="student-dashboard-desktop w-full max-w-none">
      {/* PAGE HEADER */}
      <div className="student-page-head student-dashboard-opening">
        <div className="student-dashboard-opening-copy">
          <span className="student-dashboard-eyebrow">
            Your Election Space
          </span>

          <h1>Here&rsquo;s where you are today.</h1>

          <p className="student-dashboard-greeting">
            <strong>{studentFirstName}</strong>, your organizations and next
            election steps are all here.
          </p>
        </div>

        <div className="student-page-actions">
          <div className="student-dashboard-actions-cluster">
            {renderVotingAction()}

            <span className="student-dashboard-action-note">
              When it matters, count on Kandid.
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <StudentSkeletonGroup label="Loading your election space">
          <div className="student-dashboard-grid">
            <aside className="student-dashboard-brief">
              <div className="student-skeleton-stack">
                <StudentSkeletonLine width="52%" height="0.6rem" />
                <StudentSkeletonLine width="72%" height="1.3rem" />
                <StudentSkeletonLine width="96%" height="0.65rem" />
                <StudentSkeletonLine width="84%" height="0.65rem" />
              </div>

              <div className="student-skeleton-stack">
                <StudentSkeletonLine width="100%" height="0.6rem" />
                <StudentSkeletonLine width="100%" height="0.6rem" />
                <StudentSkeletonLine width="100%" height="0.6rem" />
              </div>
            </aside>

            <div className="student-dashboard-main">
              <section className="student-section student-dashboard-section">
                <div className="student-dashboard-section-head">
                  <div className="student-skeleton-stack">
                    <StudentSkeletonLine width="40%" height="0.6rem" />
                    <StudentSkeletonLine width="58%" height="1.1rem" />
                  </div>
                </div>

                <div className="student-org-grid grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:gap-7">
                  {[0, 1].map((index) => (
                    <div className="student-skeleton-row" key={index}>
                      <StudentSkeletonLine
                        variant="media"
                        width="2.9rem"
                        height="2.9rem"
                      />

                      <div className="student-skeleton-copy">
                        <StudentSkeletonLine width="52%" height="0.95rem" />
                        <StudentSkeletonLine width="86%" height="0.65rem" />
                        <StudentSkeletonLine width="36%" height="0.6rem" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="student-section student-dashboard-section">
                <div className="student-dashboard-section-head">
                  <div className="student-skeleton-stack">
                    <StudentSkeletonLine width="34%" height="0.6rem" />
                    <StudentSkeletonLine width="62%" height="1.1rem" />
                  </div>
                </div>

                <div className="student-skeleton-stack">
                  <StudentSkeletonLine width="100%" height="0.65rem" />
                  <StudentSkeletonLine width="92%" height="0.65rem" />
                </div>
              </section>
            </div>
          </div>
        </StudentSkeletonGroup>
      ) : (
        <div className="student-dashboard-grid">
          <aside className="student-dashboard-brief">
            <div>
              <span className="student-dashboard-brief-label">
                Your Place In Kandid
              </span>

              <h2>
                {user?.program || "Student"}
              </h2>

              <p>
                Your active student and organization records shape the
                elections available to you.
              </p>
            </div>

            <dl className="student-dashboard-brief-list">
              <div>
                <dt>Memberships</dt>
                <dd>{myOrganizations.length}</dd>
              </div>

              <div>
                <dt>More to explore</dt>
                <dd>{otherOrganizations.length}</dd>
              </div>

              <div>
                <dt>Next up</dt>
                <dd>Check Elections</dd>
              </div>
            </dl>

          </aside>

          <div className="student-dashboard-main">
          {/* ==================================================
              MY ORGANIZATION
              ================================================== */}
          <section className="student-section student-dashboard-section">
            <div className="student-dashboard-section-head">
              <div>
                <span className="student-dashboard-section-kicker">
                  Your Campus Circle
                </span>

                <h2>
                  Your Organization{myOrganizations.length === 1 ? "" : "s"}
                </h2>
              </div>

              <span className="student-dashboard-section-count">
                {myOrganizations.length}{" "}
                {myOrganizations.length === 1
                  ? "Organization"
                  : "Organizations"}
              </span>
            </div>

            <div className="student-org-grid student-org-grid-primary grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:gap-7">
              {myOrganizations.length === 0 ? (
                <div className="student-empty-card">
                  You are not in any organizations yet.
                </div>
              ) : (
                myOrganizations.map((organization) => (
                  <StudentOrganizationCard
                    key={organization.id}
                    organization={organization}
                    membershipState="member"
                    identityMark={getOrganizationIdentityMark(organization)}
                    onView={handleViewOrganization}
                  />
                ))
              )}
            </div>
          </section>

          {/* ==================================================
              OTHER ORGANIZATIONS
              ================================================== */}
          <section className="student-section student-dashboard-section">
            <div className="student-dashboard-section-head">
              <div>
                <span className="student-dashboard-section-kicker">
                  Find More
                </span>

                <h2>
                  Other Organizations
                </h2>
              </div>

              <span className="student-dashboard-section-count">
                {filteredOtherOrganizations.length} shown
              </span>
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
                      identityMark={getOrganizationIdentityMark(organization)}
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

                    <span>Explore All Organizations</span>

                    <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="student-dashboard-election-strip">
            <div>
              <span className="student-dashboard-section-kicker">
                What&rsquo;s Next
              </span>

              <h2>
                Ready when an election opens
              </h2>

              <p>
                Campaigns, your vote, and published results all live in your
                election workspace &mdash; ready when you are.
              </p>
            </div>

          </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;
