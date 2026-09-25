import {
  ArrowLeft,
  CalendarDays,
  UserRound,
  UsersRound,
} from "lucide-react";
import { OrganizationLogo, StudentAvatar } from "../KandidImage";
import {
  getOrganizationDescription,
  getOrganizationTypeLabel,
} from "./StudentOrganizationCard";
import { formatLocalDate } from "../../utils/elections";
import {
  StudentSkeletonGroup,
  StudentSkeletonLine,
} from "./StudentSkeleton";
import "../../pages/student/Organizations.css";

const DETAIL_TABS = ["about", "officers", "elections"];

function StudentOrganizationDetail({
  organization,
  isMember,
  memberCount,
  memberCountError,
  officers,
  elections,
  activeTab,
  loading,
  onBack,
  onTabChange,
  onElectionView,
}) {
  const currentOfficers = officers.filter((officer) => officer.is_current);
  const visibleOfficers = currentOfficers.length > 0 ? currentOfficers : officers;

  return (
    <div className="student-organization-detail w-full max-w-none">
      <button type="button" onClick={onBack} className="student-back-link">
        <ArrowLeft size={15} />
        Back to organizations
      </button>

      <section className="student-campaign-hero student-org-detail-hero w-full max-w-none">
        <div className="student-org-detail-identity">
          <OrganizationLogo
            organization={organization}
            className="student-org-detail-logo"
            loading="eager"
          />

          <div className="student-org-detail-copy">
            <span className="student-org-detail-type">
              {getOrganizationTypeLabel(organization)}
            </span>
            <h1>{organization.name}</h1>

            <div className="student-org-detail-stats">
              <div>
                <span>Relationship</span>
                <strong>{isMember ? "Member" : "Explore"}</strong>
              </div>
              <div>
                <span>Community</span>
                <strong>
                  {memberCountError ||
                    `${memberCount} active member${memberCount === 1 ? "" : "s"}`}
                </strong>
              </div>
              <div>
                <span>Elections</span>
                <strong>
                  {elections.length} election{elections.length === 1 ? "" : "s"}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="student-campaign-tabs student-org-detail-tabs w-full">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="student-org-detail-panel student-org-detail-workspace w-full max-w-none">
        {loading ? (
          <StudentSkeletonGroup
            label="Loading organization details"
            className="student-org-detail-skeleton"
          >
            <div className="student-skeleton-stack">
              <StudentSkeletonLine width="28%" height="0.65rem" />
              <StudentSkeletonLine width="62%" height="1.15rem" />
              <StudentSkeletonLine width="88%" height="0.7rem" />
            </div>

            <div className="student-skeleton-stack">
              <StudentSkeletonLine width="100%" height="0.7rem" />
              <StudentSkeletonLine width="94%" height="0.7rem" />
              <StudentSkeletonLine width="72%" height="0.7rem" />
            </div>
          </StudentSkeletonGroup>
        ) : activeTab === "about" ? (
          <div className="student-org-about">
            <p className="student-directory-card-label">About</p>
            <p>{getOrganizationDescription(organization)}</p>
          </div>
        ) : activeTab === "officers" ? (
          <div className="student-officer-stack w-full">
            {visibleOfficers.length === 0 ? (
              <div className="student-org-detail-empty flex min-h-[240px] flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/70 px-6 py-12 text-center">
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
            {elections.length === 0 ? (
              <div className="student-org-detail-empty flex min-h-[220px] flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/70 px-6 py-10 text-center">
                <CalendarDays size={30} className="text-[#f4511e]" />
                <h2 className="mt-4 text-xl font-black text-[#182033]">
                  No elections listed
                </h2>
              </div>
            ) : (
              elections.map((election) => (
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
                  <button type="button" onClick={() => onElectionView(election)}>
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

export default StudentOrganizationDetail;
