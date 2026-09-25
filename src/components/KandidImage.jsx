import { useCallback, useMemo, useState } from "react";

function initialsFrom(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "K";
}

function KandidImage({
  src,
  alt,
  label,
  className = "",
  fit = "cover",
  loading = "lazy",
  title,
}) {
  const imageSrc = typeof src === "string" ? src.trim() : src;
  const [failedSrc, setFailedSrc] = useState(null);
  const initials = useMemo(() => initialsFrom(label || alt), [alt, label]);
  const canRenderImage = Boolean(imageSrc) && failedSrc !== imageSrc;
  const handleImageNode = useCallback((node) => {
    if (node?.complete && node.naturalWidth === 0) {
      setFailedSrc(imageSrc);
    }
  }, [imageSrc]);

  return (
    <span
      className={`kandid-image-frame ${className}`}
      title={title || label || alt}
      tabIndex={title || label ? 0 : undefined}
    >
      {canRenderImage ? (
        <img
          ref={handleImageNode}
          src={imageSrc}
          alt={alt || label || ""}
          loading={loading}
          decoding="async"
          onError={() => setFailedSrc(imageSrc)}
          style={{ objectFit: fit }}
        />
      ) : (
        <span className="kandid-image-fallback" aria-label={label || alt}>
          {initials}
        </span>
      )}
    </span>
  );
}

export function OrganizationLogo({ organization, className = "", loading = "lazy" }) {
  return (
    <KandidImage
      src={organization?.logo_url}
      alt={organization?.name ? `${organization.name} logo` : "Organization logo"}
      label={organization?.name}
      title={
        organization?.description
          ? `${organization.name} - ${organization.description}`
          : organization?.name
      }
      className={`organization-logo ${className}`}
      fit="contain"
      loading={loading}
    />
  );
}

export function StudentAvatar({ student, className = "", loading = "lazy" }) {
  const name = [student?.first_name, student?.last_name].filter(Boolean).join(" ");
  return (
    <KandidImage
      src={student?.photo_url}
      alt={name ? `${name} photo` : "Student photo"}
      label={name || student?.student_number}
      className={`student-avatar-img ${className}`}
      fit="cover"
      loading={loading}
    />
  );
}

export default KandidImage;
