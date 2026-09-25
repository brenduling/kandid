import CandidateManagement from "../../components/CandidateManagement";
import "./Candidates.css";

function Candidates() {
  return (
    <CandidateManagement
      superAdminEditorial
      title="Candidate management"
      subtitle="Assign students as candidates and prepare campaign details."
    />
  );
}

export default Candidates;
