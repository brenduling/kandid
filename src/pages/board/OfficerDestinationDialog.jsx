import { X } from "lucide-react";
import PopupOverlay from "../../components/PopupOverlay";
import "./Officers.css";

function OfficerDestinationDialog({ onSelect, onClose }) {
  return (
    <PopupOverlay>
      <div className="popup-sheet board-officer-modal board-officer-destination" role="dialog" aria-modal="true" aria-labelledby="officer-destination-title">
        <header className="board-officer-modal-header">
          <div>
            <p className="board-officer-modal-eyebrow">Officer record</p>
            <h2 id="officer-destination-title" className="board-officer-modal-title">Where should this officer go?</h2>
            <p className="board-officer-modal-intro">Choose the leadership roster to update.</p>
          </div>
          <button type="button" className="board-officer-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="board-officer-destination-options">
          <button type="button" onClick={() => onSelect("current")}>
            <strong>Current Leadership</strong>
            <span>Add one officer to the team serving now.</span>
          </button>
          <button type="button" onClick={() => onSelect("new")}>
            <strong>New Officers</strong>
            <span>Prepare an officer for the next roster release.</span>
          </button>
        </div>
        <div className="board-officer-modal-actions">
          <button type="button" className="board-officer-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </PopupOverlay>
  );
}

export default OfficerDestinationDialog;
