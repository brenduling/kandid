import { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import StudentOrganizationCard, {
  getOrganizationIdentityMark,
} from "../../components/student/StudentOrganizationCard";
import StudentOrganizationDetail from "../../components/student/StudentOrganizationDetail";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { supabase } from "../../lib/supabaseClient";
import {
  getStudentOrganizationDirectory,
  selectActiveMemberships,
} from "../../utils/organizationAccess";
import "./Organizations.css";

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

  const directoryGroups = useMemo(() => {
    const memberOrganizations = [];
    const exploreOrganizations = [];

    for (const organization of filteredOrganizations) {
      if (memberIds.has(Number(organization.id))) {
        memberOrganizations.push(organization);
      } else {
        exploreOrganizations.push(organization);
      }
    }

    return [
      {
        key: "member",
        label: "Your Organizations",
        organizations: memberOrganizations,
      },
      {
        key: "explore",
        label: "Explore More",
        organizations: exploreOrganizations,
      },
    ].filter((group) => group.organizations.length > 0);
  }, [filteredOrganizations, memberIds]);

  const displayOrder = useMemo(() => {
    const order = new Map();
    let position = 0;

    for (const group of directoryGroups) {
      for (const organization of group.organizations) {
        position += 1;
        order.set(organization.id, position);
      }
    }

    return order;
  }, [directoryGroups]);

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
    return (
      <StudentOrganizationDetail
        organization={selectedOrganization}
        isMember={memberIds.has(Number(selectedOrganization.id))}
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

  return (
    <div className="student-organization-catalog w-full max-w-none">
      <div className="student-page-head student-organization-catalog-head">
        <div className="student-organization-catalog-head-copy-mobile">
          <span className="page-kicker">Explore Organizations</span>
          <h1>Organization Catalog</h1>
          <p>Browse student organizations and distinguish official membership from discovery.</p>
        </div>
        <div className="student-organization-catalog-head-copy-editorial">
          <span className="page-kicker">Explore Organizations</span>
          <h1>Find your place in WIT.</h1>
          <p>Browse the organizations that make up your student community.</p>
        </div>
      </div>

      <section className="student-section student-organization-catalog-directory">
        <div className="student-section-title">
          <Globe2 size={16} />
          <span className="student-organization-catalog-directory-label">Organizations</span>
          <span className="student-organization-catalog-directory-total">
            {counts.all} total
          </span>
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
              aria-pressed={filter === item.value}
            >
              <span>{item.label}</span>
              <strong>{counts[item.value]}</strong>
            </button>
          ))}
        </div>

        {loading ? (
          <StudentSkeletonGroup
            label="Loading organizations"
            className="student-organization-catalog-skeleton"
          >
            <div className="student-explore-grid student-organization-catalog-grid">
              {[0, 1, 2, 3].map((index) => (
                <div className="student-skeleton-row" key={index}>
                  <StudentSkeletonLine
                    variant="media"
                    width="2.9rem"
                    height="2.9rem"
                  />

                  <div className="student-skeleton-copy">
                    <StudentSkeletonLine width="46%" height="1rem" />
                    <StudentSkeletonLine width="82%" height="0.7rem" />
                    <StudentSkeletonLine width="34%" height="0.6rem" />
                  </div>
                </div>
              ))}
            </div>
          </StudentSkeletonGroup>
        ) : filteredOrganizations.length === 0 ? (
          <div className="student-empty-card mt-6">No organizations available.</div>
        ) : (
          directoryGroups.map((group) => (
            <section
              key={group.key}
              className="student-organization-catalog-group"
              aria-label={group.label}
            >
              <div className="student-organization-catalog-group-head">
                <span className="student-organization-catalog-group-title">
                  {group.label}
                </span>
                <span className="student-organization-catalog-group-count">
                  {group.organizations.length}
                </span>
              </div>

              <div className="student-explore-grid student-organization-catalog-grid">
                {group.organizations.map((organization) => (
                  <StudentOrganizationCard
                    key={organization.id}
                    organization={organization}
                    membershipState={
                      memberIds.has(Number(organization.id)) ? "member" : "explore"
                    }
                    identityMark={getOrganizationIdentityMark(organization)}
                    onView={handleViewOrganization}
                    displayIndex={displayOrder.get(organization.id)}
                    compact
                    editorial
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </section>
    </div>
  );
}

export default StudentOrganizations;
