import { Search, UserCheck } from "lucide-react";
import { StudentAvatar } from "./KandidImage";

function studentName(student) {
  return [student?.first_name, student?.last_name].filter(Boolean).join(" ").trim();
}

function studentSearchText(student) {
  return [
    studentName(student),
    student?.student_number,
    student?.program,
    student?.year_level ? `Year ${student.year_level}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function StudentSearchPicker({
  label = "Student",
  students = [],
  value,
  onChange,
  query,
  onQueryChange,
  disabled = false,
  placeholder = "Search student name or number",
  emptyText = "No students available.",
}) {
  const selectedStudent = students.find((student) => String(student.id) === String(value));
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const visibleStudents = students
    .filter((student) => !normalizedQuery || studentSearchText(student).includes(normalizedQuery))
    .slice(0, 8);

  return (
    <div className="student-search-picker">
      <label className="field-label">{label}</label>
      <div className="student-search-picker-input">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          disabled={disabled}
          placeholder={disabled ? "Select position first" : placeholder}
        />
      </div>

      {selectedStudent ? (
        <div className="student-search-picker-selected">
          <StudentAvatar student={selectedStudent} className="!h-11 !w-11" />
          <div>
            <strong>{studentName(selectedStudent) || "Selected student"}</strong>
            <span>{selectedStudent.student_number || "No student number"}</span>
          </div>
          <UserCheck size={18} />
          <button
            type="button"
            className="student-search-picker-change"
            onClick={() => {
              onChange("");
              onQueryChange("");
            }}
            disabled={disabled}
          >
            Change
          </button>
        </div>
      ) : null}

      {!selectedStudent ? (
        <div className="student-search-picker-list">
          {visibleStudents.length === 0 ? (
            <div className="student-search-picker-empty">{emptyText}</div>
          ) : (
            visibleStudents.map((student) => (
              <button
                key={student.id}
                type="button"
                className={`student-search-picker-option ${
                  String(student.id) === String(value) ? "is-selected" : ""
                }`}
                onClick={() => {
                  onChange(String(student.id));
                  onQueryChange(studentName(student) || student.student_number || "");
                }}
                disabled={disabled}
              >
                <StudentAvatar student={student} className="!h-10 !w-10" />
                <span>
                  <strong>{studentName(student) || "Unnamed student"}</strong>
                  <small>{student.student_number || "No student number"}</small>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default StudentSearchPicker;
