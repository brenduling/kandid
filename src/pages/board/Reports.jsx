import { useEffect, useState } from "react";
import { Download, FileText, Vote, Users, BarChart3 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { usePrompt } from "../../context/PromptContext";

function BoardReports() {
  const prompt = usePrompt();
  const [elections, setElections] = useState([]);
  const [positions, setPositions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [votes, setVotes] = useState([]);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name || "organization";

  useEffect(() => {
    fetchReportData();
  }, [orgId]);

  async function fetchReportData() {
    if (!orgId) return;

    const { data: electionData, error: electionError } = await supabase
      .from("elections")
      .select("id, title, organization_id, campaign_start, campaign_end, start_date, end_date, status, location_label, created_at")
      .eq("organization_id", orgId);

    if (electionError) {
      console.error("Failed to load board report elections:", electionError);
      return;
    }

    const electionIds = electionData?.map((election) => election.id) || [];

    setElections(electionData || []);
    setPositions([]);
    setCandidates([]);
    setVotes([]);

    if (electionIds.length === 0) return;

    const [
      { data: positionData, error: positionError },
      { data: voteData, error: voteError },
    ] = await Promise.all([
      supabase
        .from("positions")
        .select("id, name, election_id, max_votes")
        .in("election_id", electionIds),
      supabase
        .from("votes")
        .select("id, election_id, position_id, candidate_id, student_id, vote_hash, blockchain_tx_id, vote_timestamp")
        .in("election_id", electionIds),
    ]);

    if (positionError) {
      console.error("Failed to load board report positions:", positionError);
    }

    if (voteError) {
      console.error("Failed to load board report votes:", voteError);
    }

    const positionIds = positionData?.map((position) => position.id) || [];

    setPositions(positionData || []);
    setVotes(voteData || []);

    if (positionIds.length > 0) {
      const { data: candidateData, error: candidateError } = await supabase
        .from("candidates")
        .select(`
          id,
          position_id,
          student_id,
          partylist_id,
          platform,
          photo,
          campaign_status,
          created_at,
          students (
            first_name,
            last_name,
            student_number
          ),
          positions (
            name
          )
        `)
        .in("position_id", positionIds);

      if (candidateError) {
        console.error("Failed to load board report candidates:", candidateError);
      }

      setCandidates(candidateData || []);
    }
  }

  function downloadCSV(filename, rows) {
    if (!rows.length) {
      prompt.info("No data to export.");
      return;
    }

    const headers = Object.keys(rows[0]);

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((field) => {
            const value = row[field] ?? "";
            return `"${String(value).replaceAll('"', '""')}"`;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  const reports = [
    {
      title: "Election Report",
      description: "Export elections handled by your organization.",
      icon: Vote,
      action: () =>
        downloadCSV(`${orgName}-elections.csv`, elections),
    },
    {
      title: "Position Report",
      description: "Export positions created under your elections.",
      icon: FileText,
      action: () =>
        downloadCSV(`${orgName}-positions.csv`, positions),
    },
    {
      title: "Candidate Report",
      description: "Export candidate records and assigned positions.",
      icon: Users,
      action: () =>
        downloadCSV(`${orgName}-candidates.csv`, candidates),
    },
    {
      title: "Vote Report",
      description: "Export vote records for your organization elections.",
      icon: BarChart3,
      action: () =>
        downloadCSV(`${orgName}-votes.csv`, votes),
    },
  ];

  const uniqueVoters = new Set(votes.map((vote) => vote.student_id)).size;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Records Export</div>
          <h1 className="page-title">Board reports</h1>
          <p className="page-subtitle">
          Export election records for your assigned organization.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-8 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Elections</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Vote size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{elections.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Positions</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <FileText size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{positions.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Candidates</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Users size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{candidates.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Unique Voters</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <BarChart3 size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{uniqueVoters}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-8 xl:grid-cols-2 xl:gap-6">
        {reports.map((report) => {
          const Icon = report.icon;

          return (
            <div
              key={report.title}
              className="entity-card lift-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
                  <Icon size={22} />
                </div>

                <div>
                  <h3 className="font-black text-lg">{report.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {report.description}
                  </p>
                </div>
              </div>

              <button
                onClick={report.action}
                className="primary-btn w-full sm:w-auto"
              >
                <Download size={16} />
                Export
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BoardReports;
