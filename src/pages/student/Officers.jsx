import { useEffect, useMemo, useState } from "react";
import { StudentAvatar } from "../../components/KandidImage";
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
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Leadership Directory</div>
          <h1 className="page-title">
            Current and former
            <span className="page-title-accent"> officers</span>
          </h1>
          <p className="page-subtitle">
            Explore leadership history across organizations with clearer filters and
            easier scanning.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="glass-panel-strong rounded-[24px] p-4">
            <label className="field-label">Search Directory</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Officer, role, organization"
              className="field-shell w-full"
            />
          </div>
          <div className="glass-panel-strong rounded-[24px] p-4">
            <label className="field-label">Filter by Term Status</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="field-shell w-full"
            >
              <option value="current">Current Officers</option>
              <option value="previous">Previous Officers</option>
              <option value="all">All Officers</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          Loading officers...
        </div>
      ) : visibleOfficers.length === 0 ? (
        <div className="glass-panel mt-8 rounded-[28px] p-8 text-gray-500">
          No officers matched your filter.
        </div>
      ) : (
        <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {visibleOfficers.map((officer, index) => {
            const fullName = officer.students
              ? `${officer.students.first_name} ${officer.students.last_name}`
              : officer.officer_name;

            return (
              <div
                key={officer.id}
                className="glass-panel-strong lift-card fade-up rounded-[30px] p-6"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  {officer.students ? (
                    <StudentAvatar
                      student={officer.students}
                      className="!h-14 !w-14 shrink-0 !rounded-2xl"
                    />
                  ) : null}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d35a25]">
                      {officer.organizations?.name || "Organization"}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">{fullName}</h2>
                  </div>
                  <span className="status-pill">
                    {officer.is_current ? "Current" : "Previous"}
                  </span>
                </div>

                <div className="mt-5 rounded-[24px] bg-white/50 p-4">
                  <p className="field-label !mb-1">Position</p>
                  <p className="font-semibold text-[#1d262f]">
                    {officer.position_title}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/40 p-4">
                    <p className="field-label !mb-1">Term Label</p>
                    <p className="font-semibold text-[#1d262f]">
                      {officer.term_label || "Not specified"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/40 p-4">
                    <p className="field-label !mb-1">Student Number</p>
                    <p className="font-semibold text-[#1d262f]">
                      {officer.students?.student_number || "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StudentOfficers;
