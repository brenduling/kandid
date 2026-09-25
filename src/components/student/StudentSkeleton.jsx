import "./StudentSkeleton.css";

const LINE_VARIANTS = {
  line: "",
  media: "is-media",
  track: "is-track",
};

export function StudentSkeletonLine({
  width = "100%",
  height = "0.85rem",
  variant = "line",
  className = "",
}) {
  const variantClass = LINE_VARIANTS[variant] || "";

  return (
    <span
      aria-hidden="true"
      className={`student-skeleton-line ${variantClass} ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

export function StudentSkeletonGroup({
  label = "Loading",
  className = "",
  style,
  children,
}) {
  return (
    <div
      className={`student-skeleton ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-label={label}
      style={style}
    >
      {children}
    </div>
  );
}
