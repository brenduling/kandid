import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import { supabase } from "../../lib/supabaseClient";
import {
  createCampaignMaterialsDraft,
  normalizeCampaignMaterialsInput,
  parseCampaignMaterials,
} from "../../utils/candidates";
import { usePrompt } from "../../context/PromptContext";

function BoardCandidates() {
  const prompt = usePrompt();
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
    platform: "",
    credentials: "",
    campaign_materials: createCampaignMaterialsDraft(),
  });

  const user = JSON.parse(localStorage.getItem("user"));
  const orgId = user?.organization_id;

  useEffect(() => {
    let active = true;

    async function loadData() {
      if (!orgId) return;

      const { data: elections } = await supabase
        .from("elections")
        .select("id")
        .eq("organization_id", orgId);

      const electionIds = elections?.map((election) => election.id) || [];

      if (electionIds.length === 0) {
        if (active) {
          setCandidates([]);
          setPositions([]);
          setPartylists([]);
        }
        return;
      }

      const { data: positionData } = await supabase
        .from("positions")
        .select(`
          id,
          name,
          election_id,
          elections (
            title
          )
        `)
        .in("election_id", electionIds);

      const positionIds = positionData?.map((position) => position.id) || [];

      let candidateData = [];

      if (positionIds.length > 0) {
        const { data } = await supabase
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
                title
              )
            ),
            partylists (
              name
            )
          `)
          .in("position_id", positionIds)
          .order("id", { ascending: true });

        candidateData = data || [];
      }

      const { data: partyData } = await supabase
        .from("partylists")
        .select("id, name, election_id")
        .in("election_id", electionIds);

      const { data: studentOrgData } = await supabase
        .from("student_organizations")
        .select(`
          students (
            id,
            student_number,
            first_name,
            last_name
          )
        `)
        .eq("organization_id", orgId);

      if (!active) return;

      setPositions(positionData || []);
      setCandidates(candidateData);
      setPartylists(partyData || []);
      setStudents(
        (studentOrgData || []).map((item) => item.students).filter(Boolean)
      );
    }

    loadData();

    return () => {
      active = false;
    };
  }, [orgId]);

  async function refreshCandidates() {
    if (!orgId) return;

    const { data: elections } = await supabase
      .from("elections")
      .select("id")
      .eq("organization_id", orgId);

    const electionIds = elections?.map((election) => election.id) || [];

    if (electionIds.length === 0) {
      setCandidates([]);
      setPositions([]);
      setPartylists([]);
      return;
    }

    const { data: positionData } = await supabase
      .from("positions")
      .select(`
        id,
        name,
        election_id,
        elections (
          title
        )
      `)
      .in("election_id", electionIds);

    const positionIds = positionData?.map((position) => position.id) || [];

    let candidateData = [];

    if (positionIds.length > 0) {
      const { data } = await supabase
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
              title
            )
          ),
          partylists (
            name
          )
        `)
        .in("position_id", positionIds)
        .order("id", { ascending: true });

      candidateData = data || [];
    }

    const { data: partyData } = await supabase
      .from("partylists")
      .select("id, name, election_id")
      .in("election_id", electionIds);

    setPositions(positionData || []);
    setCandidates(candidateData);
    setPartylists(partyData || []);
  }

  function openCreateForm() {
    setEditingCandidate(null);
    setForm({
      position_id: "",
      student_id: "",
      partylist_id: "",
      photo: "",
      bio: "",
      platform: "",
      credentials: "",
      campaign_materials: createCampaignMaterialsDraft(),
    });
    setFormOpen(true);
  }

  function openEditForm(candidate) {
    setEditingCandidate(candidate);
    setForm({
      position_id: candidate.position_id || "",
      student_id: candidate.student_id || "",
      partylist_id: candidate.partylist_id || "",
      photo: candidate.photo || "",
      bio: candidate.bio || "",
      platform: candidate.platform || "",
      credentials: candidate.credentials || "",
      campaign_materials: createCampaignMaterialsDraft(
        candidate.campaign_materials,
        candidate.campaign_media_urls
      ),
    });
    setFormOpen(true);
  }

  function updateMaterial(index, key, value) {
    const nextMaterials = [...form.campaign_materials];
    nextMaterials[index] = {
      ...nextMaterials[index],
      [key]: value,
    };
    setForm({ ...form, campaign_materials: nextMaterials });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const materials = normalizeCampaignMaterialsInput(form.campaign_materials);

    if (materials.length > 3) {
      await prompt.alert({
        title: "Campaign Limit",
        message: "Only 1 to 3 campaign materials are allowed per candidate.",
        type: "warning",
      });
      return;
    }

    const payload = {
      position_id: Number(form.position_id),
      student_id: Number(form.student_id),
      partylist_id: form.partylist_id ? Number(form.partylist_id) : null,
      photo: form.photo || null,
      bio: form.bio || null,
      platform: form.platform || null,
      credentials: form.credentials || null,
      campaign_materials: materials,
      campaign_media_urls: materials.map((item) => item.url),
    };

    const query = editingCandidate
      ? supabase.from("candidates").update(payload).eq("id", editingCandidate.id)
      : supabase.from("candidates").insert([payload]);

    const { error } = await query;

    if (error) {
      prompt.error(error.message);
      return;
    }

    prompt.success(editingCandidate ? "Candidate updated." : "Candidate created.");
    setFormOpen(false);
    refreshCandidates();
  }

  async function handleDelete(id) {
    const ok = await prompt.confirm({
      title: "Delete Candidate?",
      message: "Are you sure you want to remove this candidate?",
      type: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) {
      prompt.error(error.message || "Failed to delete candidate.");
      return;
    }
    prompt.success("Candidate deleted.");
    refreshCandidates();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Candidate Lineup</div>
          <h1 className="page-title">Board candidates</h1>
          <p className="page-subtitle">
            Manage candidates and campaign content for your organization.
          </p>
        </div>

        <button
          onClick={openCreateForm}
          className="primary-btn self-start lg:self-auto"
        >
          <Plus size={18} />
          Add Candidate
        </button>
      </div>

      <div className="table-shell mt-8">
        <table className="app-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Student ID</th>
              <th>Position</th>
              <th>Election</th>
              <th>Partylist</th>
              <th>Media</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-10 text-center empty-copy">
                  No candidates found for your organization.
                </td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="font-bold">
                    {candidate.students?.first_name} {candidate.students?.last_name}
                  </td>
                  <td className="text-[#5a5548]">
                    {candidate.students?.student_number}
                  </td>
                  <td>
                    {candidate.positions?.name || "Unknown"}
                  </td>
                  <td className="text-[#5a5548]">
                    {candidate.positions?.elections?.title || "-"}
                  </td>
                  <td>
                    {candidate.partylists?.name || "Independent"}
                  </td>
                  <td className="text-[#5a5548]">
                    {parseCampaignMaterials(
                      candidate.campaign_materials,
                      candidate.campaign_media_urls
                    ).length}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditForm(candidate)}
                        className="icon-action"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => handleDelete(candidate.id)}
                        className="icon-action icon-action-danger"
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
        <PopupOverlay>
          <div className="modal-card max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-black">
                {editingCandidate ? "Edit Candidate" : "Add Candidate"}
              </h2>

              <button
                onClick={() => setFormOpen(false)}
                className="icon-action"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form-stack">
              <div>
                <label className="field-label">Position</label>
              <select
                required
                value={form.position_id}
                onChange={(e) =>
                  setForm({ ...form, position_id: e.target.value })
                }
                className="field-shell w-full"
              >
                <option value="">Select Position</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name} - {position.elections?.title}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Student</label>
              <select
                required
                value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                className="field-shell w-full"
              >
                <option value="">Select Student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.last_name}, {student.first_name} - {student.student_number}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Partylist</label>
              <select
                value={form.partylist_id}
                onChange={(e) =>
                  setForm({ ...form, partylist_id: e.target.value })
                }
                className="field-shell w-full"
              >
                <option value="">Independent / No Partylist</option>
                {partylists.map((partylist) => (
                  <option key={partylist.id} value={partylist.id}>
                    {partylist.name}
                  </option>
                ))}
              </select>
              </div>

              <div>
                <label className="field-label">Photo URL</label>
              <input
                value={form.photo}
                onChange={(e) => setForm({ ...form, photo: e.target.value })}
                placeholder="Photo URL optional"
                className="field-shell w-full"
              />
              </div>

              <div>
                <label className="field-label">Platform</label>
              <textarea
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                placeholder="Candidate platform"
                className="field-shell min-h-[120px] w-full"
                rows="3"
              />
              </div>

              <div>
                <label className="field-label">Credentials</label>
              <textarea
                value={form.credentials}
                onChange={(e) =>
                  setForm({ ...form, credentials: e.target.value })
                }
                placeholder="Credentials and achievements"
                className="field-shell min-h-[120px] w-full"
                rows="3"
              />
              </div>

              <div>
                <label className="field-label">Bio</label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Candidate bio"
                className="field-shell min-h-[120px] w-full"
                rows="3"
              />
              </div>

              <div className="upload-shell">
                <p className="text-sm font-bold text-[#1d262f]">Campaign Materials</p>
                <p className="mt-1 text-xs text-[#5a5548]">
                  Add up to 3 downloadable or viewable materials per candidate.
                </p>

                <div className="mt-3 space-y-3">
                  {form.campaign_materials.map((material, index) => (
                    <div key={index} className="modal-form-grid rounded-xl border border-[rgba(255,115,22,0.12)] bg-white/45 p-4">
                      <input
                        value={material.label}
                        onChange={(e) =>
                          updateMaterial(index, "label", e.target.value)
                        }
                        placeholder={`Material title ${index + 1}`}
                        className="field-shell"
                      />
                      <select
                        value={material.type}
                        onChange={(e) =>
                          updateMaterial(index, "type", e.target.value)
                        }
                        className="field-shell"
                      >
                        <option value="link">Link</option>
                        <option value="document">Document</option>
                        <option value="media">Media</option>
                      </select>
                      <input
                        value={material.url}
                        onChange={(e) =>
                          updateMaterial(index, "url", e.target.value)
                        }
                        placeholder="https://..."
                        className="field-shell md:col-span-2"
                      />
                      <label className="md:col-span-2 flex items-center gap-3 rounded-xl bg-white/60 px-4 py-3 text-sm font-semibold text-[#1d262f]">
                        <input
                          type="checkbox"
                          checked={material.downloadable}
                          onChange={(e) =>
                            updateMaterial(index, "downloadable", e.target.checked)
                          }
                        />
                        Allow student download
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <button className="primary-btn w-full">
                {editingCandidate ? "Save Changes" : "Add Candidate"}
              </button>
            </form>
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default BoardCandidates;
