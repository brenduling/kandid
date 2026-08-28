import { useEffect, useState } from "react";
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
import { supabase } from "../../lib/supabaseClient";
import {
  getEligibleStudentOrganizations,
  getOrganizationCatalog,
} from "../../utils/organizationAccess";

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
    <div className="flex h-[clamp(7rem,9vw,10rem)] w-[clamp(7rem,9vw,10rem)] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.12)] ring-1 ring-gray-100">
      {organization?.logo_url && !imageError ? (
        <img
          src={organization.logo_url}
          alt={`${organization.name || "Organization"} logo`}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          decoding="async"
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
        const [memberOrganizations, organizations] = await Promise.all([
          getEligibleStudentOrganizations(user),
          getOrganizationCatalog(),
        ]);

        if (!active) return;

        const memberIds = new Set(
          memberOrganizations.map((organization) => organization.id)
        );

        /*
         * Other departmental organizations only.
         */
        const otherDepartmentalOrganizations = (
          organizations || []
        ).filter(
          (organization) =>
            !memberIds.has(organization.id) &&
            organization.organization_type !== "non_departmental"
        );

        /*
         * Set lightweight data immediately.
         */
        setMyOrganizations(memberOrganizations);
        setOtherOrganizations(otherDepartmentalOrganizations);

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
         * - first 3 other departmental organizations
         *
         * This prevents the dashboard from downloading every
         * organization's image.
         */
        const visibleOtherOrganizations =
          otherDepartmentalOrganizations.slice(0, 3);

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

  /*
   * ============================================================
   * OPEN ORGANIZATION DETAILS
   * ============================================================
   */
  async function handleViewOrganization(organization) {
    setSelectedOrganization(organization);
    setOrganizationTab("officers");

    setOrganizationOfficers([]);
    setOrganizationElections([]);
    setOrganizationMemberCount(0);

    setDetailLoading(true);

    try {
      /*
       * All three requests run simultaneously.
       */
      const [
        { data: officers, error: officersError },
        { data: elections, error: electionsError },
        { count, error: countError },
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
          .neq("status", "archived")
          .order("start_date", { ascending: false }),

        supabase
          .from("student_organizations")
          .select("student_id", {
            count: "exact",
            head: true,
          })
          .eq("organization_id", organization.id),
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
      setOrganizationMemberCount(count || 0);
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
            <div className="flex h-[clamp(5.5rem,8vw,8rem)] w-[clamp(5.5rem,8vw,8rem)] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-gray-100">
              {selectedOrganization.logo_url ? (
                <img
                  src={selectedOrganization.logo_url}
                  alt={`${selectedOrganization.name} logo`}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[#f4511e]">
                  <UsersRound size={36} />
                </span>
              )}
            </div>

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

        {/* TABS */}
        <div className="student-campaign-tabs w-full">
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
                          <div className="student-officer-avatar !h-[clamp(4rem,6vw,6rem)] !w-[clamp(4rem,6vw,6rem)]">
                            {officer.students?.photo_url ? (
                              <img
                                src={
                                  officer.students.photo_url
                                }
                                alt={fullName}
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <UserRound size={34} />
                            )}
                          </div>

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
                          ? new Date(
                            election.start_date
                          ).toLocaleDateString()
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
            onClick={() =>
              navigate("/student/elections")
            }
            className="student-outline-btn"
          >
            <CalendarDays size={16} />
            View Election Schedule
          </button>

          <button
            type="button"
            onClick={() =>
              navigate("/student/elections")
            }
            className="student-solid-btn"
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
                  <article
                    key={organization.id}
                    className="group w-full min-w-0 overflow-hidden rounded-3xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(15,23,42,0.10)]"
                  >
                    {/* CARD IMAGE */}
                    <div className="relative flex h-[clamp(13rem,18vw,18rem)] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fffaf7] via-white to-[#f5f7fb]">
                      <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-[#f4511e]/[0.06]" />

                      <div className="absolute -bottom-12 -right-8 h-32 w-32 rounded-full bg-blue-500/[0.04]" />

                      <OrganizationLogo
                        organization={organization}
                      />

                      <span className="absolute left-3 top-3 rounded-full border border-gray-200 bg-white/95 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500 shadow-sm backdrop-blur">
                        {organization.organization_type ===
                          "non_departmental"
                          ? "Non-Departmental"
                          : "Departmental"}
                      </span>
                    </div>

                    {/* CARD CONTENT */}
                    <div className="px-3 pb-2 pt-5">
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
                            {organization.organization_type ===
                              "non_departmental"
                              ? "Non-Departmental"
                              : "Departmental"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleViewOrganization(
                              organization
                            )
                          }
                          className="shrink-0 rounded-xl bg-[#f4511e] px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-[#d94718] focus:outline-none focus:ring-2 focus:ring-[#f4511e]/30"
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

          {/* ==================================================
              OTHER DEPARTMENTAL ORGANIZATIONS
              ================================================== */}
          <section className="student-section">
            <div className="student-section-title">
              <Globe2 size={16} />
              Other Departmental Organizations
            </div>

            <div className="student-org-grid grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-7">
              {otherOrganizations.length === 0 ? (
                <div className="student-empty-card">
                  No other departmental organizations available.
                </div>
              ) : (
                <>
                  {otherOrganizations
                    .slice(0, 3)
                    .map((organization) => (
                      <article
                        key={organization.id}
                        className="group w-full min-w-0 overflow-hidden rounded-3xl border border-gray-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_38px_rgba(15,23,42,0.09)]"
                      >
                        {/* CARD IMAGE */}
                        <div className="relative flex h-[clamp(11rem,15vw,15rem)] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#fffaf7] via-white to-[#f5f7fb]">
                          <OrganizationLogo
                            organization={organization}
                          />

                          <span className="absolute left-3 top-3 rounded-full border border-gray-200 bg-white/95 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.1em] text-gray-500 shadow-sm backdrop-blur">
                            Departmental
                          </span>
                        </div>

                        {/* CARD CONTENT */}
                        <div className="px-3 pb-2 pt-4">
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
                              onClick={() =>
                                handleViewOrganization(
                                  organization
                                )
                              }
                              className="shrink-0 rounded-xl bg-[#f4511e] px-3.5 py-2 text-xs font-black text-white transition hover:bg-[#d94718] focus:outline-none focus:ring-2 focus:ring-[#f4511e]/30"
                            >
                              View
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}

                  {/* EXPLORE ALL */}
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/student/elections")
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
