import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";

function EligibilityRules() {
  const [rules, setRules] = useState([]);
  const [elections, setElections] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    election_id: "",
    program: "",
    min_year_level: "",
    max_year_level: "",
    allow_shs: false,
  });

  useEffect(() => {
    fetchRules();
    fetchElections();
  }, []);

  async function fetchRules() {
    const { data, error } = await supabase
      .from("eligibility_rules")
      .select(`
        *,
        elections (
          title
        )
      `)
      .order("id", { ascending: true });

    if (!error) setRules(data || []);
    if (error) console.log(error);
  }

  async function fetchElections() {
    const { data, error } = await supabase
      .from("elections")
      .select("id, title")
      .order("id", { ascending: true });

    if (!error) setElections(data || []);
    if (error) console.log(error);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      election_id: "",
      program: "",
      min_year_level: "",
      max_year_level: "",
      allow_shs: false,
    });
    setFormOpen(true);
  }

  function openEdit(rule) {
    setEditing(rule);
    setForm({
      election_id: rule.election_id || "",
      program: rule.program || "",
      min_year_level: rule.min_year_level || "",
      max_year_level: rule.max_year_level || "",
      allow_shs: rule.allow_shs || false,
    });
    setFormOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      election_id: Number(form.election_id),
      program: form.program || null,
      min_year_level: form.min_year_level
        ? Number(form.min_year_level)
        : null,
      max_year_level: form.max_year_level
        ? Number(form.max_year_level)
        : null,
      allow_shs: form.allow_shs,
    };

    if (editing) {
      await supabase
        .from("eligibility_rules")
        .update(payload)
        .eq("id", editing.id);
    } else {
      await supabase.from("eligibility_rules").insert([payload]);
    }

    setFormOpen(false);
    fetchRules();
  }

  async function handleDelete(id) {
    const confirmDelete = window.confirm("Delete this eligibility rule?");
    if (!confirmDelete) return;

    await supabase.from("eligibility_rules").delete().eq("id", id);
    fetchRules();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Eligibility Rules</h1>
          <p className="text-gray-500 mt-1">
            Define who is allowed to vote in each election.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#ff5a1f] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#e24d17]"
        >
          <Plus size={18} />
          Add Rule
        </button>
      </div>

      <div className="mt-8 bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#1d1d1d] text-white">
            <tr>
              <th className="px-6 py-4 text-sm">Election</th>
              <th className="px-6 py-4 text-sm">Program</th>
              <th className="px-6 py-4 text-sm">Year Level</th>
              <th className="px-6 py-4 text-sm">SHS Allowed</th>
              <th className="px-6 py-4 text-sm text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-500">
                  No eligibility rules found.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="border-b last:border-b-0">
                  <td className="px-6 py-4 font-bold">
                    {rule.elections?.title || "Unknown Election"}
                  </td>

                  <td className="px-6 py-4">
                    {rule.program || "All Programs"}
                  </td>

                  <td className="px-6 py-4">
                    {rule.min_year_level || "-"} to{" "}
                    {rule.max_year_level || "-"}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        rule.allow_shs
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {rule.allow_shs ? "Yes" : "No"}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(rule)}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(rule.id)}
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
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black">
                {editing ? "Edit Eligibility Rule" : "Add Eligibility Rule"}
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
                value={form.election_id}
                onChange={(e) =>
                  setForm({ ...form, election_id: e.target.value })
                }
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              >
                <option value="">Select Election</option>
                {elections.map((election) => (
                  <option key={election.id} value={election.id}>
                    {election.title}
                  </option>
                ))}
              </select>

              <input
                value={form.program}
                onChange={(e) =>
                  setForm({ ...form, program: e.target.value })
                }
                placeholder="Program e.g. BSIT (leave blank for all)"
                className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
              />

              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  min="1"
                  value={form.min_year_level}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      min_year_level: e.target.value,
                    })
                  }
                  placeholder="Min Year Level"
                  className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
                />

                <input
                  type="number"
                  min="1"
                  value={form.max_year_level}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_year_level: e.target.value,
                    })
                  }
                  placeholder="Max Year Level"
                  className="px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
                />
              </div>

              <label className="flex items-center gap-3 px-4 py-3 border rounded-xl">
                <input
                  type="checkbox"
                  checked={form.allow_shs}
                  onChange={(e) =>
                    setForm({ ...form, allow_shs: e.target.checked })
                  }
                />
                <span className="font-semibold text-sm">
                  Allow SHS students to vote
                </span>
              </label>

              <button className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17]">
                {editing ? "Save Changes" : "Create Rule"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default EligibilityRules;