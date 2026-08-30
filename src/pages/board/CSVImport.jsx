import { useState } from "react";
import Papa from "papaparse";
import { Upload, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  findOrCreateStudentByNumber,
  syncStudentOrganizationMemberships,
} from "../../utils/organizationAccess";
import { logAuditEvent } from "../../utils/auditLog";
import { usePrompt } from "../../context/PromptContext";

function BoardCSVImport() {
  const prompt = usePrompt();
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [importing, setImporting] = useState(false);

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;
  const orgName = user?.organizations?.name;

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
      prompt.error("No organization assigned to this Electoral Board account.");
      return;
    }

    if (validRows.length === 0) return;

    setImporting(true);

    const importedStudents = [];
    let createdCount = 0;
    let linkedExistingCount = 0;
    let alreadyMemberCount = 0;

    for (const row of validRows) {
      const {
        data: student,
        created,
        error: studentError,
      } = await findOrCreateStudentByNumber(row);

      if (studentError || !student) {
        prompt.error(studentError?.message || "Student import failed.");
        setImporting(false);
        return;
      }

      const {
        error: membershipError,
        createdOrganizationIds = [],
        existingOrganizationIds = [],
      } = await syncStudentOrganizationMemberships({
        studentId: student.id,
        program: student.program,
        explicitOrganizationIds: [orgId],
      });

      if (membershipError) {
        prompt.error(membershipError.message || "Student organization sync failed.");
        setImporting(false);
        return;
      }

      importedStudents.push(student);
      if (created) createdCount += 1;
      else linkedExistingCount += 1;

      if (
        existingOrganizationIds.includes(Number(orgId)) &&
        !createdOrganizationIds.includes(Number(orgId))
      ) {
        alreadyMemberCount += 1;
      }
    }

    prompt.success(
      `Student import completed. ${createdCount} created, ${linkedExistingCount} existing processed, ${alreadyMemberCount} already members.`
    );
    await logAuditEvent({
      action: "student_batch_imported",
      entityType: "student",
      entityLabel: "Board CSV Import",
      organizationId: orgId,
      organizationName: orgName,
      status: "completed",
      metadata: {
        imported_count: importedStudents.length,
        created_count: createdCount,
        linked_existing_count: linkedExistingCount,
        already_member_count: alreadyMemberCount,
        invalid_count: invalidRows.length,
      },
    });

    setRows([]);
    setValidRows([]);
    setInvalidRows([]);
    setImporting(false);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Student Records</div>
          <h1 className="page-title">Board CSV import</h1>
          <p className="page-subtitle">
            Upload student records for your assigned organization.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Total Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,90,31,0.1)] text-[#ff5a1f]">
              <Upload size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{rows.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Valid Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{validRows.length}</h2>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <p className="field-label">Invalid Rows</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
              <XCircle size={18} />
            </span>
          </div>
          <h2 className="mt-6 text-4xl font-black leading-none">{invalidRows.length}</h2>
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
