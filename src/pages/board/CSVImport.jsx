import { useState } from "react";
import Papa from "papaparse";
import { Upload, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { syncStudentOrganizationMemberships } from "../../utils/organizationAccess";

function BoardCSVImport() {
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [importing, setImporting] = useState(false);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data);
        validateRows(result.data);
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
    if (!orgId) {
      alert("No organization assigned to this Electoral Board account.");
      return;
    }

    if (validRows.length === 0) return;

    setImporting(true);

    const { data: insertedStudents, error: studentError } = await supabase
      .from("students")
      .insert(validRows)
      .select();

    if (studentError) {
      alert(studentError.message);
      setImporting(false);
      return;
    }

    for (const student of insertedStudents || []) {
      const { error: membershipError } = await syncStudentOrganizationMemberships({
        studentId: student.id,
        program: student.program,
        explicitOrganizationIds: [orgId],
      });

      if (membershipError) {
        alert(membershipError.message);
        setImporting(false);
        return;
      }
    }

    alert("Students imported and assigned to your organization successfully.");

    setRows([]);
    setValidRows([]);
    setInvalidRows([]);
    setImporting(false);
  }

  return (
    <div className="content-section">
      <h1 className="text-3xl font-black">Board CSV Import</h1>
      <p className="surface-subcopy mt-1">
        Upload student records for your assigned organization.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="metric-card">
          <p className="surface-subcopy text-sm font-semibold">Total Rows</p>
          <h2 className="surface-heading mt-2 text-3xl font-black">{rows.length}</h2>
        </div>

        <div className="metric-card">
          <p className="surface-subcopy text-sm font-semibold">Valid Rows</p>
          <h2 className="mt-2 text-3xl font-black text-green-600">{validRows.length}</h2>
        </div>

        <div className="metric-card">
          <p className="surface-subcopy text-sm font-semibold">Invalid Rows</p>
          <h2 className="mt-2 text-3xl font-black text-red-600">{invalidRows.length}</h2>
        </div>
      </div>

      <div className="upload-shell mt-8 rounded-[28px] border-2 border-dashed border-[rgba(255,115,22,0.16)] p-8">
        <label className="flex cursor-pointer flex-col items-center justify-center text-center">
          <Upload size={42} className="text-[#ff5a1f]" />
          <h3 className="surface-heading mt-4 text-xl font-black">Upload CSV File</h3>
          <p className="surface-subcopy mt-1 text-sm">
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
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <div className="soft-card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-[rgba(255,115,22,0.12)] px-5 py-5">
              <CheckCircle className="text-green-600" size={20} />
              <h3 className="surface-heading font-black">Valid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {validRows.map((row, index) => (
                <div
                  key={index}
                  className="border-b border-[rgba(255,115,22,0.08)] px-5 py-3 text-sm last:border-b-0"
                >
                  <p className="surface-heading font-bold">
                    {row.student_number} - {row.first_name} {row.last_name}
                  </p>
                  <p className="surface-subcopy">
                    {row.program} | Year {row.year_level}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="soft-card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-[rgba(255,115,22,0.12)] px-5 py-5">
              <XCircle className="text-red-600" size={20} />
              <h3 className="surface-heading font-black">Invalid Records</h3>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {invalidRows.length === 0 ? (
                <p className="empty-copy p-5">No invalid records found.</p>
              ) : (
                invalidRows.map((row, index) => (
                  <div
                    key={index}
                    className="border-b border-[rgba(255,115,22,0.08)] px-5 py-3 text-sm last:border-b-0"
                  >
                    <p className="surface-heading font-bold">CSV Row {row.row}</p>
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
            className="primary-btn disabled:opacity-60"
          >
            {importing ? "Importing..." : `Import ${validRows.length} Students`}
          </button>
        </div>
      )}
    </div>
  );
}

export default BoardCSVImport;
