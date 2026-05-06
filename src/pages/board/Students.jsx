import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function BoardStudents() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

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

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    fetchStudents();
  }, []);

  async function fetchStudents() {
    const { data, error } = await supabase
      .from("student_organizations")
      .select(`
        students (
          id,
          student_number,
          first_name,
          last_name,
          email,
          program,
          year_level,
          is_shs,
          status
        )
      `)
      .eq("organization_id", orgId);

    if (error) {
      console.log(error);
      return;
    }

    const list = data.map((item) => item.students).filter(Boolean);
    setStudents(list);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const { data: insertedStudent, error: studentError } = await supabase
      .from("students")
      .insert([
        {
          ...form,
          year_level: Number(form.year_level),
        },
      ])
      .select()
      .single();

    if (studentError) {
      alert(studentError.message);
      return;
    }

    const { error: orgError } = await supabase
      .from("student_organizations")
      .insert([
        {
          student_id: insertedStudent.id,
          organization_id: orgId,
          role: "member",
        },
      ]);

    if (orgError) {
      alert(orgError.message);
      return;
    }

    alert("Student added successfully.");
    setFormOpen(false);
    fetchStudents();
  }

  const filteredStudents = students.filter((student) => {
    const fullName = `${student.first_name} ${student.last_name}`.toLowerCase();

    return (
      fullName.includes(search.toLowerCase()) ||
      student.student_number?.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Board Students</h1>
          <p className="text-gray-500 mt-1">
            Manage students under your assigned organization.
          </p>
        </div>

        <button
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold"
        >
          <Plus size={18} />
          Add Student
        </button>
      </div>

      <div className="mt-8 flex items-center gap-3 bg-white px-4 py-3 rounded-xl shadow-sm w-96">
        <Search size={18} className="text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="outline-none w-full text-sm"
          placeholder="Search student..."
        />
      </div>

      <div className="mt-6 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Student ID</th>
              <th className="px-6 py-4 text-sm">Name</th>
              <th className="px-6 py-4 text-sm">Program</th>
              <th className="px-6 py-4 text-sm">Year</th>
              <th className="px-6 py-4 text-sm">Status</th>
            </tr>
          </thead>

          <tbody>
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-500">
                  No students found.
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr key={student.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">
                    {student.student_number}
                  </td>
                  <td className="px-6 py-4">
                    {student.first_name} {student.last_name}
                    <p className="text-xs text-gray-500">{student.email}</p>
                  </td>
                  <td className="px-6 py-4">{student.program}</td>
                  <td className="px-6 py-4">{student.year_level}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                      {student.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-xl rounded-2xl p-6">
            <h2 className="text-2xl font-black mb-4">Add Student</h2>

            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <input required placeholder="Student ID" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} className="px-4 py-3 border rounded-xl" />
              <input required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-4 py-3 border rounded-xl" />
              <input required placeholder="First Name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="px-4 py-3 border rounded-xl" />
              <input required placeholder="Last Name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="px-4 py-3 border rounded-xl" />
              <input required placeholder="Program" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="px-4 py-3 border rounded-xl" />
              <input required type="number" placeholder="Year Level" value={form.year_level} onChange={(e) => setForm({ ...form, year_level: e.target.value })} className="px-4 py-3 border rounded-xl" />

              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="py-3 rounded-xl font-bold bg-gray-100"
              >
                Cancel
              </button>

              <button className="py-3 rounded-xl font-bold bg-[#ff5a1f] text-white">
                Save Student
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardStudents;