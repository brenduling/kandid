import { useEffect, useMemo, useState } from "react";
import { StudentAvatar } from "../../components/KandidImage";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "../../components/student/StudentSkeleton";
import { supabase } from "../../lib/supabaseClient";
import { getEligibleStudentOrganizationIds } from "../../utils/organizationAccess";

function StudentOfficers() {
  const [officers, setOfficers] = useState([]);
  const [filter, setFilter] = useState("current");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    let active = true;

    async function loadOfficers() {
      setLoading(true);

      const organizationIds = await getEligibleStudentOrganizationIds(user);

      if (organizationIds.length === 0) {
        if (active) {
          setOfficers([]);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("officers")
        .select(`
          *,
          organizations (
            name
          ),
          students (
            first_name,
            last_name,
            student_number,
            photo_url
          )
        `)
        .in("organization_id", organizationIds)
        .order("is_current", { ascending: false })
        .order("organization_id", { ascending: true })
        .order("display_order", { ascending: true })
        .order("term_end", { ascending: false });

      if (!active) return;

      setOfficers(data || []);
      setLoading(false);
    }

    loadOfficers();

    return () => {
      active = false;
    };
  }, [user.id]);

  const visibleOfficers = useMemo(() => {
    return officers.filter((officer) => {
      if (filter === "current" && !officer.is_current) return false;
      if (filter === "previous" && officer.is_current) return false;

      const fullName = officer.students
        ? `${officer.students.first_name} ${officer.students.last_name}`
        : officer.officer_name || "";

      const haystack = `${fullName} ${officer.position_title || ""} ${
        officer.organizations?.name || ""
      } ${officer.term_label || ""}`.toLowerCase();

      return haystack.includes(search.toLowerCase());
    });
  }, [filter, officers, search]);

  return (
    <div className="student-officers-desktop">
      <header className="student-officers-opening">
        <div className="student-officers-opening-copy">
          <span className="student-officers-kicker">Campus leadership</span>
          <h1>Your organization leaders.</h1>
          <p>Officers of your organizations.</p>
          <p>
            See the student leaders representing your organizations for the
            current term.
          </p>
        </div>

        <div className="student-officers-controls">
          <label>
            <span className="student-officers-control-label">Search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Officer, role, organization"
              className="student-officers-field"
            />
          </label>
          <label>
            <span className="student-officers-control-label">Term status</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="student-officers-field"
            >
              <option value="current">Current Officers</option>
              <option value="previous">Previous Officers</option>
              <option value="all">All Officers</option>
            </select>
          </label>
        </div>
      </header>

      <section className="student-officers-section" aria-label="Officer directory">
        <div className="student-officers-section-head">
          <div>
            <span className="student-officers-kicker">Directory</span>
            <h2>Current officers</h2>
          </div>
          {officers.length > 0 ? (
            <span className="student-officers-section-count">
              {visibleOfficers.length}{" "}
              {visibleOfficers.length === 1 ? "Officer" : "Officers"}
            </span>
          ) : null}
        </div>

        {loading ? (
          <StudentSkeletonGroup label="Loading officers">
            <ol className="student-officers-list">
              {[0, 1, 2].map((index) => (
                <li className="student-skeleton-row" key={index}>
                  <StudentSkeletonLine
                    variant="media"
                    width="2.75rem"
                    height="2.75rem"
                  />

                  <div className="student-skeleton-copy">
                    <StudentSkeletonLine width="40%" height="0.6rem" />
                    <StudentSkeletonLine width="58%" height="0.95rem" />
                    <StudentSkeletonLine width="86%" height="0.6rem" />
                  </div>

                  <StudentSkeletonLine width="4rem" height="0.7rem" />
                </li>
              ))}
            </ol>
          </StudentSkeletonGroup>
        ) : officers.length === 0 ? (
          <div className="student-officers-empty">
            <p className="student-officers-empty-title">
              No officers published yet.
            </p>
            <p className="student-officers-empty-copy">
              Your organization hasn't published its current officer list. When
              it does, you'll find it here.
            </p>
          </div>
        ) : visibleOfficers.length === 0 ? (
          <div className="student-officers-empty">
            <p className="student-officers-empty-title">
              No officers matched your filter.
            </p>
            <p className="student-officers-empty-copy">
              Adjust your search or term filter to see more results.
            </p>
          </div>
        ) : (
          <ol className="student-officers-list">
            {visibleOfficers.map((officer, index) => {
              const fullName = officer.students
                ? `${officer.students.first_name} ${officer.students.last_name}`
                : officer.officer_name || "Officer";

              return (
                <li key={officer.id} className="student-officer-row">
                  <span className="student-officer-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  {officer.students ? (
                    <StudentAvatar
                      student={officer.students}
                      className="student-officer-avatar"
                    />
                  ) : (
                    <span className="student-officer-avatar-fallback" aria-hidden="true" />
                  )}

                  <div className="student-officer-main">
                    <div className="student-officer-org">
                      {officer.organizations?.name || "Organization"}
                    </div>
                    <h3 className="student-officer-name">{fullName}</h3>
                    <dl className="student-officer-meta">
                      <div>
                        <dt>Position</dt>
                        <dd>{officer.position_title || "—"}</dd>
                      </div>
                      <div>
                        <dt>Term</dt>
                        <dd>{officer.term_label || "Not specified"}</dd>
                      </div>
                      <div>
                        <dt>ID</dt>
                        <dd>{officer.students?.student_number || "—"}</dd>
                      </div>
                    </dl>
                  </div>

                  <span
                    className={`student-officer-status is-${
                      officer.is_current ? "current" : "previous"
                    }`}
                  >
                    <span className="student-officer-status-mark" aria-hidden="true" />
                    {officer.is_current ? "Current" : "Previous"}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

export default StudentOfficers;