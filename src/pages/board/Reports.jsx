import { useEffect, useState } from "react";
import { Download, FileText, Vote, Users, BarChart3 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardReports() {
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
      .select("id, title, organization_id, campaign_start, campaign_end, start_date, end_date, status, venue, created_at")
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
        .select("id, name, election_id, max_winners, display_order, created_at")
        .in("election_id", electionIds),
      supabase
        .from("votes")
        .select("id, election_id, position_id, candidate_id, student_id, vote_hash, blockchain_tx_hash, vote_timestamp")
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
          photo_url,
          status,
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
      alert("No data to export.");
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
      <div>
        <h1 className="text-3xl font-black">Board Reports</h1>
        <p className="text-gray-500 mt-1">
          Export election records for your assigned organization.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-8 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        <div className="metric-card">
          <p className="text-sm text-gray-500">Elections</p>
          <h2 className="text-3xl font-black mt-2">{elections.length}</h2>
        </div>

        <div className="metric-card">
          <p className="text-sm text-gray-500">Positions</p>
          <h2 className="text-3xl font-black mt-2">{positions.length}</h2>
        </div>

        <div className="metric-card">
          <p className="text-sm text-gray-500">Candidates</p>
          <h2 className="text-3xl font-black mt-2">{candidates.length}</h2>
        </div>

        <div className="metric-card">
          <p className="text-sm text-gray-500">Unique Voters</p>
          <h2 className="text-3xl font-black mt-2">{uniqueVoters}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-8 xl:grid-cols-2 xl:gap-6">
        {reports.map((report) => {
          const Icon = report.icon;

          return (
            <div
              key={report.title}
              className="metric-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[rgba(194,65,12,0.08)] text-[#ff5a1f] flex items-center justify-center">
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
