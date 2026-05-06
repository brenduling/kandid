import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Students() {
  const [students, setStudents] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState("all");

  const [form, setForm] = useState({
    student_number: "",
    first_name: "",
    last_name: "",
    email: "",
    program: "",
    year_level: "",
    is_shs: false,
    status: "pending",
  });

  useEffect(() => {
    fetchStudents();
  }, []);

  async function fetchStudents() {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .order("id", { ascending: true });

    if (!error) setStudents(data || []);
  }

  function openCreateForm() {
    setEditingStudent(null);
    setForm({
      student_number: "",
      first_name: "",
      last_name: "",
      email: "",
      program: "",
      year_level: "",
      is_shs: false,
      status: "pending",
    });
    setFormOpen(true);
  }

  function openEditForm(student) {
    setEditingStudent(student);
    setForm({
      student_number: student.student_number || "",
      first_name: student.first_name || "",
      last_name: student.last_name || "",
      email: student.email || "",
      program: student.program || "",
      year_level: student.year_level || "",
      is_shs: student.is_shs || false,
      status: student.status || "pending",
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      student_number: form.student_number,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      program: form.program,
      year_level: Number(form.year_level),
      is_shs: form.is_shs,
      status: form.status,
    };

    if (editingStudent) {
      await supabase.from("students").update(payload).eq("id", editingStudent.id);
    } else {
      await supabase.from("students").insert([payload]);
    }

    setFormOpen(false);
    fetchStudents();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this student record?");
    if (!confirmDelete) return;

    await supabase.from("students").delete().eq("id", id);
    fetchStudents();
  }

  const filteredStudents = students.filter((student) => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      student.student_number?.toLowerCase().includes(search.toLowerCase());

    const matchesProgram =
      programFilter === "all" || student.program === programFilter;

    return matchesSearch && matchesProgram;
  });

  const programs = [...new Set(students.map((s) => s.program).filter(Boolean))];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Student Management</h1>
          <p className="text-gray-500 mt-1">
            Manage student voter records and eligibility data.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Student
        </button>
      </div>

      <div className="mt-8 flex gap-4">
        <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-xl w-96 shadow-sm">
          <Search size={18} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="outline-none w-full text-sm"
            placeholder="Search by name or student ID..."
          />
        </div>

        <select
          value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}
          className="bg-white px-4 py-3 rounded-xl shadow-sm outline-none text-sm"
        >
          <option value="all">All Programs</option>
          {programs.map((program) => (
            <option key={program} value={program}>
              {program}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Student ID</th>
              <th className="px-6 py-4 text-sm">Name</th>
              <th className="px-6 py-4 text-sm">Program</th>
              <th className="px-6 py-4 text-sm">Year</th>
              <th className="px-6 py-4 text-sm">SHS</th>
              <th className="px-6 py-4 text-sm">Status</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center text-gray-500">
                  No students found.
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">{student.student_number}</td>
                  <td className="px-6 py-4">
                    {student.first_name} {student.last_name}
                    <p className="text-xs text-gray-500">{student.email}</p>
                  </td>
                  <td className="px-6 py-4">{student.program}</td>
                  <td className="px-6 py-4">{student.year_level}</td>
                  <td className="px-6 py-4">{student.is_shs ? "Yes" : "No"}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                      {student.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(student)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(student.id)}
                        className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editingStudent ? "Edit Student" : "Add Student"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <input
                required
                value={form.student_number}
                onChange={(e) =>
                  setForm({ ...form, student_number: e.target.value })
                }
                placeholder="Student ID"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                value={form.first_name}
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
                placeholder="First Name"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                value={form.last_name}
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
                placeholder="Last Name"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                value={form.program}
                onChange={(e) => setForm({ ...form, program: e.target.value })}
                placeholder="Program e.g. BSIT"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <input
                required
                type="number"
                value={form.year_level}
                onChange={(e) =>
                  setForm({ ...form, year_level: e.target.value })
                }
                placeholder="Year Level"
                className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="px-4 py-3 border rounded-xl outline-none"
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>

              <label className="flex items-center gap-3 px-4 py-3 border rounded-xl">
                <input
                  type="checkbox"
                  checked={form.is_shs}
                  onChange={(e) =>
                    setForm({ ...form, is_shs: e.target.checked })
                  }
                />
                SHS Student
              </label>

              <button className="col-span-2 bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editingStudent ? "Save Changes" : "Create Student"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Students;