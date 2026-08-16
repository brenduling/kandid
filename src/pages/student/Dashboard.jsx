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
        .select("organization_id, organizations(id, name)")
        .eq("student_id", user.id);

      const memberOrganizations =
        memberships?.map((item) => item.organizations).filter(Boolean) || [];
      const memberIds = new Set(memberOrganizations.map((item) => item.id));

      const { data: organizations } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name", { ascending: true });

      if (!active) return;

      setMyOrganizations(memberOrganizations);
      setOtherOrganizations(
        (organizations || []).filter((organization) => !memberIds.has(organization.id)),
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
      <div>
        <button
          onClick={() => setSelectedOrganization(null)}
          className="student-back-link"
        >
          <ArrowLeft size={15} />
          {initials(selectedOrganization.name)}
        </button>

        <section className="student-campaign-hero student-org-detail-hero">
          <div className="student-campaign-icon">
            <UsersRound size={34} />
          </div>
          <div>
            <h1>{selectedOrganization.name}</h1>
            <p>{organizationMemberCount} active members</p>
          </div>
        </section>

        <div className="student-campaign-tabs">
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

        <section className="student-org-detail-panel">
          {detailLoading ? (
            <div className="student-empty-card">Loading organization details...</div>
          ) : organizationTab === "officers" ? (
            <>
              <select className="student-org-year-select" defaultValue="2026-2027">
                <option>2026-2027</option>
                <option>2025-2026</option>
                <option>2024-2025</option>
              </select>

              <div className="student-officer-stack">
                {visibleOfficers.length === 0 ? (
                  <div>
                    <h2>President</h2>
                    <div className="student-officer-placeholder">
                      <span />
                      <div>
                        <i />
                        <i />
                      </div>
                    </div>
                  </div>
                ) : (
                  visibleOfficers.map((officer) => {
                    const fullName = officer.students
                      ? `${officer.students.first_name} ${officer.students.last_name}`
                      : officer.officer_name;

                    return (
                      <div key={officer.id}>
                        <h2>{officer.position_title || "Officer"}</h2>
                        <div className="student-officer-row">
                          <div className="student-officer-avatar">
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
            <div className="student-org-election-list">
              {organizationElections.length === 0 ? (
                <div className="student-empty-card">No elections listed for this organization.</div>
              ) : (
                organizationElections.map((election) => (
                  <article key={election.id} className="student-org-election-card">
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
    <div>
      <div className="student-page-head">
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
          <section className="student-section">
            <div className="student-section-title">
              <Building2 size={16} />
              My Organization
            </div>
            <div className="student-org-grid student-org-grid-primary">
              {myOrganizations.length === 0 ? (
                <div className="student-empty-card">No organization assigned.</div>
              ) : (
                myOrganizations.map((organization) => (
                  <article key={organization.id} className="student-org-card">
                    <div className="student-org-cover">
                      <span>{initials(organization.name)}</span>
                    </div>
                    <h2>{initials(organization.name)}</h2>
                    <p>{organization.name}</p>
                    <button onClick={() => handleViewOrganization(organization)}>
                      View
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="student-section">
            <div className="student-section-title">
              <Globe2 size={16} />
              Other Departmental Organizations
            </div>
            <div className="student-org-grid">
              {otherOrganizations.slice(0, 3).map((organization) => (
                <article key={organization.id} className="student-org-card student-org-card-small">
                  <div className="student-org-cover">
                    <span>{initials(organization.name)}</span>
                  </div>
                  <h2>{initials(organization.name)}</h2>
                  <p>{organization.name}</p>
                  <button onClick={() => handleViewOrganization(organization)}>
                    View
                  </button>
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
