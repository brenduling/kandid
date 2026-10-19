import { useEffect, useState } from "react";
import { formatAcademicTerm, listAcademicTerms } from "../utils/academicTerms";

export default function AcademicTermSelect({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  className = "",
}) {
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    listAcademicTerms().then(({ data, error, unavailable }) => {
      if (!active) return;
      setTerms(data || []);
      setLoadError(error?.message || (unavailable ? "Academic terms are unavailable." : ""));
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setLoadError(error?.message || "Academic terms could not be loaded.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <select
        id={id}
        required={required}
        value={value == null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        disabled={loading || Boolean(loadError) || disabled}
      >
        <option value="">{loading ? "Loading academic terms…" : "Select academic term"}</option>
        {terms.map((term) => (
          <option key={term.id} value={term.id}>
            {formatAcademicTerm(term)}{term.status === "active" ? " · Active" : ""}
          </option>
        ))}
      </select>
      <small>
        {loadError || (terms.length === 0 && !loading
          ? "Create an academic term before creating an election."
          : "Choose the academic term this election belongs to; it is not inferred from the active term.")}
      </small>
    </>
  );
}
