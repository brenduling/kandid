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
  }, []);

  async function fetchReportData() {
    if (!orgId) return;

    const { data: electionData } = await supabase
      .from("elections")
      .select("*")
      .eq("organization_id", orgId);

    const electionIds = electionData?.map((election) => election.id) || [];

    setElections(electionData || []);

    if (electionIds.length === 0) return;

    const { data: positionData } = await supabase
      .from("positions")
      .select("*")
      .in("election_id", electionIds);

    const positionIds = positionData?.map((position) => position.id) || [];

    setPositions(positionData || []);

    if (positionIds.length > 0) {
      const { data: candidateData } = await supabase
        .from("candidates")
        .select(`
          *,
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

      setCandidates(candidateData || []);
    }

    const { data: voteData } = await supabase
      .from("votes")
      .select("*")
      .in("election_id", electionIds);

    setVotes(voteData || []);
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

      <div className="grid grid-cols-4 gap-6 mt-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Elections</p>
          <h2 className="text-3xl font-black mt-2">{elections.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Positions</p>
          <h2 className="text-3xl font-black mt-2">{positions.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Candidates</p>
          <h2 className="text-3xl font-black mt-2">{candidates.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Unique Voters</p>
          <h2 className="text-3xl font-black mt-2">{uniqueVoters}</h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        {reports.map((report) => {
          const Icon = report.icon;

          return (
            <div
              key={report.title}
              className="bg-white p-6 rounded-2xl shadow-sm flex items-center justify-between"
            >
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#ff5a1f] flex items-center justify-center">
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
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1d1d1d] text-white text-sm font-bold hover:bg-black"
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