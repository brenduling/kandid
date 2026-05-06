import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function Candidates() {
  const [candidates, setCandidates] = useState([]);
  const [positions, setPositions] = useState([]);
  const [students, setStudents] = useState([]);
  const [partylists, setPartylists] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState(null);

  const [form, setForm] = useState({
    position_id: "",
    student_id: "",
    partylist_id: "",
    photo: "",
    bio: "",
  });

  useEffect(() => {
    fetchCandidates();
    fetchPositions();
    fetchPartylists();
  }, []);

  async function fetchCandidates() {
    const { data, error } = await supabase
      .from("candidates")
      .select(`
        *,
        students (
          first_name,
          last_name,
          student_number
        ),
        positions (
          name,
          elections (
            title,
            organization_id
          )
        ),
        partylists (
          name
        )
      `)
      .order("id", { ascending: true });

    if (!error) setCandidates(data || []);
    if (error) console.log(error);
  }

  async function fetchPositions() {
    const { data, error } = await supabase
      .from("positions")
      .select(`
        id,
        name,
        elections (
          title,
          organization_id
        )
      `);

    if (!error) setPositions(data || []);
    if (error) console.log(error);
  }

  async function fetchPartylists() {
    const { data, error } = await supabase
      .from("partylists")
      .select("id, name")
      .order("name", { ascending: true });

    if (!error) setPartylists(data || []);
    if (error) console.log(error);
  }

  async function fetchStudentsByPosition(positionId) {
    if (!positionId) {
      setStudents([]);
      return;
    }

    const selectedPosition = positions.find(
      (position) => position.id === Number(positionId)
    );

    const orgId = selectedPosition?.elections?.organization_id;

    if (!orgId) {
      setStudents([]);
      return;
    }

    const { data, error } = await supabase
      .from("student_organizations")
      .select(`
        students (
          id,
          student_number,
          first_name,
          last_name,
          program,
          year_level
        )
      `)
      .eq("organization_id", orgId);

    if (error) {
      console.log(error);
      setStudents([]);
      return;
    }

    const eligibleStudents = data
      .map((item) => item.students)
      .filter(Boolean);

    setStudents(eligibleStudents);
  }

  function openCreateForm() {
    setEditingCandidate(null);
    setStudents([]);
    setForm({
      position_id: "",
      student_id: "",
      partylist_id: "",
      photo: "",
      bio: "",
    });
    setFormOpen(true);
  }

  async function openEditForm(candidate) {
    setEditingCandidate(candidate);
    setForm({
      position_id: candidate.position_id || "",
      student_id: candidate.student_id || "",
      partylist_id: candidate.partylist_id || "",
      photo: candidate.photo || "",
      bio: candidate.bio || "",
    });

    await fetchStudentsByPosition(candidate.position_id);
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      position_id: Number(form.position_id),
      student_id: Number(form.student_id),
      partylist_id: form.partylist_id ? Number(form.partylist_id) : null,
      photo: form.photo || null,
      bio: form.bio || null,
    };

    if (editingCandidate) {
      await supabase
        .from("candidates")
        .update(payload)
        .eq("id", editingCandidate.id);
    } else {
      await supabase.from("candidates").insert([payload]);
    }

    setFormOpen(false);
    fetchCandidates();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this candidate?");
    if (!confirmDelete) return;

    await supabase.from("candidates").delete().eq("id", id);
    fetchCandidates();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Candidate Management</h1>
          <p className="text-gray-500 mt-1">
            Assign students as candidates for each election position.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Candidate
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Candidate</th>
              <th className="px-6 py-4 text-sm">Student ID</th>
              <th className="px-6 py-4 text-sm">Position</th>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Partylist</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-10 text-center text-gray-500">
                  No candidates found.
                </td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr key={candidate.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">
                    {candidate.students?.first_name}{" "}
                    {candidate.students?.last_name}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-600">
                    {candidate.students?.student_number}
                  </td>

                  <td className="px-6 py-4">
                    {candidate.positions?.name || "Unknown"}
                  </td>

                  <td className="px-6 py-4 text-gray-600">
                    {candidate.positions?.elections?.title || "-"}
                  </td>

                  <td className="px-6 py-4">
                    {candidate.partylists?.name || "Independent"}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(candidate)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(candidate.id)}
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
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editingCandidate ? "Edit Candidate" : "Add Candidate"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <select
                required
                value={form.position_id}
                onChange={(e) => {
                  const selectedPositionId = e.target.value;

                  setForm({
                    ...form,
                    position_id: selectedPositionId,
                    student_id: "",
                  });

                  fetchStudentsByPosition(selectedPositionId);
                }}
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="">Select Position First</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name} — {position.elections?.title}
                  </option>
                ))}
              </select>

              <select
                required
                value={form.student_id}
                onChange={(e) =>
                  setForm({ ...form, student_id: e.target.value })
                }
                disabled={!form.position_id}
                className="w-full px-4 py-3 border rounded-xl outline-none disabled:bg-gray-100"
              >
                <option value="">
                  {form.position_id
                    ? "Select Eligible Student"
                    : "Select position first"}
                </option>

                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.last_name}, {student.first_name} —{" "}
                    {student.student_number}
                  </option>
                ))}
              </select>

              <select
                value={form.partylist_id}
                onChange={(e) =>
                  setForm({ ...form, partylist_id: e.target.value })
                }
                className="w-full px-4 py-3 border rounded-xl outline-none"
              >
                <option value="">Independent / No Partylist</option>
                {partylists.map((partylist) => (
                  <option key={partylist.id} value={partylist.id}>
                    {partylist.name}
                  </option>
                ))}
              </select>

              <input
                value={form.photo}
                onChange={(e) =>
                  setForm({ ...form, photo: e.target.value })
                }
                placeholder="Photo URL optional"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Candidate bio / credentials"
                className="w-full px-4 py-3 border rounded-xl outline-none"
                rows="4"
              />

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editingCandidate ? "Save Changes" : "Add Candidate"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Candidates;