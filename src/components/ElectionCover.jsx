import { ImageIcon } from "lucide-react";

function ElectionCover({ election, className = "", compact = false }) {
  const title = election?.title || "Election";
  const coverUrl = election?.cover_url;

  return (
    <div className={`election-cover ${compact ? "election-cover-compact" : ""} ${className}`}>
      {coverUrl ? (
        <img src={coverUrl} alt={`${title} cover`} loading="lazy" decoding="async" />
      ) : (
        <div className="election-cover-fallback">
          <ImageIcon size={compact ? 18 : 24} />
          <span>{title.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}

export default ElectionCover;
