import { useEffect, useState } from "react";
import { Download, BarChart3, Users, Vote, FileText } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Reports() {
  const [students, setStudents] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [elections, setElections] = useState([]);
  const [votes, setVotes] = useState([]);

  useEffect(() => {
    fetchReportsData();
  }, []);

  async function fetchReportsData() {
    const { data: studentsData } = await supabase.from("students").select("*");
    const { data: orgsData } = await supabase.from("organizations").select("*");
    const { data: electionsData } = await supabase.from("elections").select("*");
    const { data: votesData } = await supabase.from("votes").select("*");

    setStudents(studentsData || []);
    setOrganizations(orgsData || []);
    setElections(electionsData || []);
    setVotes(votesData || []);
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

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  const totalVotes = votes.length;
  const uniqueVoters = new Set(votes.map((v) => v.student_id)).size;
  const turnout =
    students.length > 0 ? ((uniqueVoters / students.length) * 100).toFixed(1) : 0;

  const reports = [
    {
      title: "Student Voter List",
      description: "Export all registered students and voter data.",
      icon: Users,
      action: () => downloadCSV("student-voter-list.csv", students),
    },
    {
      title: "Organization List",
      description: "Export all registered student organizations.",
      icon: FileText,
      action: () => downloadCSV("organization-list.csv", organizations),
    },
    {
      title: "Election List",
      description: "Export all elections and their current statuses.",
      icon: Vote,
      action: () => downloadCSV("election-list.csv", elections),
    },
    {
      title: "Vote Records",
      description: "Export vote logs including hashes and blockchain records.",
      icon: BarChart3,
      action: () => downloadCSV("vote-records.csv", votes),
    },
  ];

  return (
    <div>
      <div>
        <h1 className="text-3xl font-black">Reports and Analytics</h1>
        <p className="text-gray-500 mt-1">
          Generate administrative reports and export election data.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-6 mt-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Students</p>
          <h2 className="text-3xl font-black mt-2">{students.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Organizations</p>
          <h2 className="text-3xl font-black mt-2">{organizations.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Elections</p>
          <h2 className="text-3xl font-black mt-2">{elections.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Turnout</p>
          <h2 className="text-3xl font-black mt-2">{turnout}%</h2>
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

export default Reports;