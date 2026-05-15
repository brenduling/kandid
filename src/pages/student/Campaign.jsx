import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Image, Link2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { parseCampaignMaterials } from "../../utils/candidates";
import { formatLocalDateTime, getElectionPhase } from "../../utils/elections";

function materialIcon(type) {
  if (type === "document") return FileText;
  if (type === "media") return Image;
  return Link2;
}

function StudentCampaign() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      setLoading(true);

      const { data: electionData } = await supabase
        .from("elections")
        .select("*, organizations(name)")
        .eq("id", electionId)
        .single();

      const { data: positionData } = await supabase
        .from("positions")
        .select("*")
        .eq("election_id", electionId)
        .order("id", { ascending: true });

      const positionIds = (positionData || []).map((position) => position.id);

      let candidateData = [];

      if (positionIds.length > 0) {
        const { data } = await supabase
          .from("candidates")
          .select(`
            *,
            students(first_name, last_name, student_number),
            partylists(name, logo_url)
          `)
          .in("position_id", positionIds);

        candidateData = data || [];
      }

      if (!active) return;

      setElection(electionData);
      setPositions(positionData || []);
      setCandidates(candidateData);
      setLoading(false);
    }

    loadCampaign();

    return () => {
      active = false;
    };
  }, [electionId]);

  if (loading) {
    return <div className="glass-panel rounded-[28px] p-8 text-gray-500">Loading campaign...</div>;
  }

  if (!election) {
    return <p className="font-bold text-red-600">Election not found.</p>;
  }

  const phase = getElectionPhase(election);

  if (phase !== "campaign") {
    return (
      <div className="glass-panel rounded-[30px] p-8">
        <div className="page-kicker">Campaign Module</div>
        <h1 className="page-title mt-4 text-3xl">Campaign period closed</h1>
        <p className="page-subtitle mt-3">
          Campaign materials are only visible during the campaign window before
          voting begins.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Campaign Start</p>
            <p className="text-sm font-semibold">{formatLocalDateTime(election.campaign_start)}</p>
          </div>
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Voting Start</p>
            <p className="text-sm font-semibold">{formatLocalDateTime(election.start_date)}</p>
          </div>
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Current Phase</p>
            <p className="text-sm font-semibold capitalize">{phase}</p>
          </div>
        </div>
        <button
          onClick={() => navigate("/student/elections")}
          className="secondary-btn mt-6"
        >
          Back to Elections
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="glass-panel-strong rounded-[30px] p-6">
        <div className="page-kicker">Campaign Module</div>
        <h1 className="page-title mt-4">
          Candidate campaign
          <span className="page-title-accent"> showcase</span>
        </h1>
        <p className="page-subtitle">
          Review campaign credentials, platforms, and downloadable supporting
          materials before the ballot opens.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Organization</p>
            <p className="text-sm font-semibold">{election.organizations?.name}</p>
          </div>
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Campaign Window Ends</p>
            <p className="text-sm font-semibold">{formatLocalDateTime(election.start_date)}</p>
          </div>
          <div className="rounded-2xl bg-white/45 p-4">
            <p className="field-label !mb-1">Election Title</p>
            <p className="text-sm font-semibold">{election.title}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {positions.map((position, index) => {
          const positionCandidates = candidates.filter(
            (candidate) => candidate.position_id === position.id
          );

          return (
            <div
              key={position.id}
              className="table-shell fade-up"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className="border-b border-[rgba(104,86,72,0.08)] px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8b6e5c]">
                  Running For
                </p>
                <h2 className="mt-2 text-2xl font-black">{position.name}</h2>
              </div>

              <div className="grid gap-4 p-6 xl:grid-cols-2">
                {positionCandidates.map((candidate) => {
                  const materials = parseCampaignMaterials(
                    candidate.campaign_materials,
                    candidate.campaign_media_urls
                  );

                  return (
                    <div
                      key={candidate.id}
                      className="glass-panel-strong rounded-[28px] p-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-xl font-black">
                            {candidate.students?.first_name} {candidate.students?.last_name}
                          </h3>
                          <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                            {candidate.partylists?.logo_url ? (
                              <img
                                src={candidate.partylists.logo_url}
                                alt={`${candidate.partylists.name} logo`}
                                className="h-8 w-8 rounded-xl object-cover"
                              />
                            ) : null}
                            <span>{candidate.partylists?.name || "Independent"}</span>
                          </div>
                        </div>
                        {candidate.photo ? (
                          <img
                            src={candidate.photo}
                            alt="Candidate"
                            className="h-16 w-16 rounded-[20px] object-cover"
                          />
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-3">
                        <div className="rounded-2xl bg-white/45 p-4">
                          <p className="field-label !mb-1">Platform</p>
                          <p className="text-sm leading-7 text-[#1d262f]">
                            {candidate.platform || "No platform provided."}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/45 p-4">
                          <p className="field-label !mb-1">Credentials</p>
                          <p className="text-sm leading-7 text-[#1d262f]">
                            {candidate.credentials ||
                              candidate.bio ||
                              "No credentials provided."}
                          </p>
                        </div>
                      </div>

                      {materials.length > 0 ? (
                        <div className="mt-5">
                          <p className="field-label">Campaign Materials</p>
                          <div className="space-y-3">
                            {materials.map((material, materialIndex) => {
                              const Icon = materialIcon(material.type);

                              return (
                                <div
                                  key={`${candidate.id}-${material.url}-${materialIndex}`}
                                  className="rounded-2xl bg-white/50 p-4"
                                >
                                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex items-start gap-3">
                                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(232,108,47,0.12)] text-[#d35a25]">
                                        <Icon size={18} />
                                      </div>
                                      <div>
                                        <p className="font-bold">{material.label}</p>
                                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                                          {material.type}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                      <a
                                        href={material.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="secondary-btn !px-4 !py-2 text-sm"
                                      >
                                        <ExternalLink size={16} />
                                        View
                                      </a>
                                      {material.downloadable ? (
                                        <a
                                          href={material.url}
                                          download
                                          target="_blank"
                                          rel="noreferrer"
                                          className="primary-btn !px-4 !py-2 text-sm"
                                        >
                                          <Download size={16} />
                                          Download
                                        </a>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={() => navigate("/student/elections")}
          className="secondary-btn"
        >
          Back to Elections
        </button>
      </div>
    </div>
  );
}

export default StudentCampaign;
