import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { Upload, CheckCircle, XCircle } from "lucide-react";
import { createMasterlistImport } from "../../utils/superAdminMasterlistImport";
import { formatAcademicTerm, listAcademicTerms } from "../../utils/academicTerms";
import { usePrompt } from "../../context/PromptContext";

function CSVImport() {
  const navigate = useNavigate();
  const prompt = usePrompt();
  const [rows, setRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [terms, setTerms] = useState([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [termLoading, setTermLoading] = useState(true);
  const [selectedFileName, setSelectedFileName] = useState("");

  const availableTerms = useMemo(
    () => terms.filter((term) => term.status !== "closed"),
    [terms],
  );

  useEffect(() => {
    let active = true;

    async function loadTerms() {
      setTermLoading(true);
      const { data, error } = await listAcademicTerms({ force: true });

      if (!active) return;

      if (error) {
        prompt.error(error.message || "Academic terms could not be loaded.");
        setTerms([]);
      } else {
        const loadedTerms = data || [];
        setTerms(loadedTerms);
        const draftTerm =
          loadedTerms.find((term) => term.status === "draft") ||
          loadedTerms.find((term) => term.status === "active") ||
          null;
        setSelectedTermId(draftTerm?.id ? String(draftTerm.id) : "");
      }

      setTermLoading(false);
    }

    loadTerms();

    return () => {
      active = false;
    };
  }, [prompt]);

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFileName(file.name);

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
        "program",
        "year_level",
      ];

      const missing = requiredFields.filter((field) => !row[field]);
      const email = row.email?.trim() || "";

      if (missing.length > 0) {
        invalid.push({
          row: index + 2,
          reason: `Missing: ${missing.join(", ")}`,
          data: row,
        });
      } else if (email && !email.includes("@")) {
        invalid.push({
          row: index + 2,
          reason: "Invalid email format",
          data: row,
        });
      } else {
        valid.push({
          row_number: index + 2,
          student_number: row.student_number.trim(),
          first_name: row.first_name.trim(),
          last_name: row.last_name.trim(),
          email,
          program: row.program.trim(),
          year_level: Number(row.year_level),
          is_shs: false,
          status: "pending",
        });
      }
    });

    setValidRows(valid);
    setInvalidRows(invalid);
  }

  async function importStudents() {
    if (validRows.length === 0) return;
    if (!selectedTermId) {
      prompt.error("Choose an academic term before staging the masterlist.");
      return;
    }

    setImporting(true);

    const { data, error } = await createMasterlistImport({
      academicTermId: selectedTermId,
      fileName: selectedFileName || "masterlist.csv",
      rows: validRows,
    });

    setImporting(false);

    if (error || !data?.import?.id) {
      prompt.error(error?.message || "Masterlist could not be staged.");
      return;
    }

    prompt.success("Masterlist staged for review.");
    navigate(`/super-admin/masterlist/review/${data.import.id}`);
  }

  return (
    <div className="content-section">
      <div>
        <h1 className="text-3xl font-black">CSV Import Center</h1>
        <p className="surface-subcopy mt-1">
          Upload and validate a semester masterlist before review and finalization.
        </p>
      </div>

      <div className="soft-card mt-8">
        <label className="field-label" htmlFor="academic-term">
          Academic Term
        </label>
        <select
          id="academic-term"
          value={selectedTermId}
          onChange={(event) => setSelectedTermId(event.target.value)}
          disabled={termLoading || importing}
          className="input mt-2"
        >
          <option value="">
            {termLoading ? "Loading academic terms..." : "Select academic term"}
          </option>
          {availableTerms.map((term) => (
            <option key={term.id} value={term.id}>
              {formatAcademicTerm(term)} - {term.status}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

        <div className="metric-card">
          <p className="surface-subcopy text-sm font-semibold">Status</p>
          <h2 className="surface-heading mt-3 text-xl font-black">
            {rows.length > 0 ? "Ready" : "Waiting"}
          </h2>
        </div>
      </div>

      <div className="upload-shell mt-8 rounded-[28px] border-2 border-dashed border-[rgba(255,115,22,0.16)] p-8">
        <label className="flex cursor-pointer flex-col items-center justify-center text-center">
          <Upload size={42} className="text-[#ff5a1f]" />
          <h3 className="surface-heading mt-4 text-xl font-black">Upload CSV File</h3>
          <p className="surface-subcopy mt-1 text-sm">
            Required columns: student_number, first_name, last_name, program,
            year_level. Email is optional.
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
            disabled={importing || !selectedTermId}
            className="primary-btn disabled:opacity-60"
          >
            {importing ? "Staging..." : `Stage ${validRows.length} Records`}
          </button>
        </div>
      )}
    </div>
  );
}

export default CSVImport;
