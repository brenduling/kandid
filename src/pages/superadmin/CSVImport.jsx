import { useState } from "react";
import Papa from "papaparse";
import { Upload, FileText, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function CSVImport() {
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [importing, setImporting] = useState(false);

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsedRows = result.data;
        setRows(parsedRows);
        validateRows(parsedRows);
      },
    });
  }

  function validateRows(data) {
    const valid = [];
    const invalid = [];

    data.forEach((row, index) => {
      const requiredFields = [
        "student_number",
        "first_name",
        "last_name",
        "email",
        "program",
        "year_level",
        "is_shs",
      ];

      const missing = requiredFields.filter((field) => !row[field]);

      if (missing.length > 0) {
        invalid.push({
          row: index + 2,
          reason: `Missing: ${missing.join(", ")}`,
          data: row,
        });
      } else {
        valid.push({
          student_number: row.student_number.trim(),
          first_name: row.first_name.trim(),
          last_name: row.last_name.trim(),
          email: row.email.trim(),
          program: row.program.trim(),
          year_level: Number(row.year_level),
          is_shs: row.is_shs.toLowerCase() === "true",
          status: "pending",
        });
      }
    });

    setValidRows(valid);
    setInvalidRows(invalid);
  }
async function importStudents() {
  if (validRows.length === 0) return;

  setImporting(true);

  const programOrgMap = {
    BSIT: "PSITS",
    BSA: "JPIA",
    BSBA: "JMA",
    SHS: "SHS",
    BSHM: "JEHMS",
  };

  const { data: insertedStudents, error: studentError } = await supabase
    .from("students")
    .insert(validRows)
    .select();

  if (studentError) {
    setImporting(false);
    alert(studentError.message);
    return;
  }

  const { data: organizations, error: orgError } = await supabase
    .from("organizations")
    .select("id, name");

  if (orgError) {
    setImporting(false);
    alert(orgError.message);
    return;
  }

  const memberships = [];

  insertedStudents.forEach((student) => {
    const program = student.program?.toUpperCase();

    const witsgOrg = organizations.find(
      (org) => org.name.toUpperCase() === "WITSG"
    );

    const programOrgName = programOrgMap[program] || student.program;

    const programOrg = organizations.find(
      (org) => org.name.toUpperCase() === programOrgName.toUpperCase()
    );

    if (!student.is_shs && witsgOrg) {
      memberships.push({
        student_id: student.id,
        organization_id: witsgOrg.id,
        role: "member",
      });
    }

    if (programOrg) {
      memberships.push({
        student_id: student.id,
        organization_id: programOrg.id,
        role: "member",
      });
    }
  });

  if (memberships.length > 0) {
    const { error: membershipError } = await supabase
      .from("student_organizations")
      .insert(memberships);

    if (membershipError) {
      setImporting(false);
      alert(membershipError.message);
      return;
    }
  }

  setImporting(false);
  alert("Students imported and assigned to organizations successfully.");

  setRows([]);
  setValidRows([]);
  setInvalidRows([]);
}

  return (
    <div>
      <div>
        <h1 className="text-3xl font-black">CSV Import Center</h1>
        <p className="text-gray-500 mt-1">
          Upload and validate student CSV records before importing.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-6 mt-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Total Rows</p>
          <h2 className="text-3xl font-black mt-2">{rows.length}</h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Valid Rows</p>
          <h2 className="text-3xl font-black mt-2 text-green-600">
            {validRows.length}
          </h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Invalid Rows</p>
          <h2 className="text-3xl font-black mt-2 text-red-600">
            {invalidRows.length}
          </h2>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm">
          <p className="text-sm text-gray-500">Status</p>
          <h2 className="text-xl font-black mt-3">
            {rows.length > 0 ? "Ready" : "Waiting"}
          </h2>
        </div>
      </div>

      <div className="mt-8 bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300">
        <label className="flex flex-col items-center justify-center cursor-pointer">
          <Upload size={42} className="text-[#ff5a1f]" />
          <h3 className="text-xl font-black mt-4">Upload CSV File</h3>
          <p className="text-gray-500 text-sm mt-1">
            Required columns: student_number, first_name, last_name, email,
            program, year_level, is_shs
          </p>

          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {rows.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b flex items-center gap-2">
              <CheckCircle className="text-green-600" size={20} />
              <h3 className="font-black">Valid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {validRows.map((row, index) => (
                <div key={index} className="px-5 py-3 border-b text-sm">
                  <p className="font-bold">
                    {row.student_number} — {row.first_name} {row.last_name}
                  </p>
                  <p className="text-gray-500">
                    {row.program} | Year {row.year_level} |{" "}
                    {row.is_shs ? "SHS" : "College"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b flex items-center gap-2">
              <XCircle className="text-red-600" size={20} />
              <h3 className="font-black">Invalid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {invalidRows.length === 0 ? (
                <p className="p-5 text-sm text-gray-500">
                  No invalid records found.
                </p>
              ) : (
                invalidRows.map((row, index) => (
                  <div key={index} className="px-5 py-3 border-b text-sm">
                    <p className="font-bold">CSV Row {row.row}</p>
                    <p className="text-red-600">{row.reason}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {validRows.length > 0 && (
        <div className="mt-8 flex justify-end">
          <button
            onClick={importStudents}
            disabled={importing}
            className="bg-[#ff5a1f] text-white px-8 py-4 rounded-xl font-black hover:bg-[#e24d17] disabled:opacity-60"
          >
            {importing ? "Importing..." : `Import ${validRows.length} Students`}
          </button>
        </div>
      )}
    </div>
  );
}

export default CSVImport;