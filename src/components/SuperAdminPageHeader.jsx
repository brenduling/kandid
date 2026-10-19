import "./SuperAdminPageHeader.css";

export default function SuperAdminPageHeader({
  section,
  title,
  description,
  actions,
  context,
}) {
  return (
    <header className="sa-page-header">
      <div className="sa-page-header-eyebrow">
        <span>Super Admin / {section}</span>
        <span className="sa-page-header-eyebrow-rule" aria-hidden="true" />
      </div>
      <h1 className="sa-page-header-title">{title}</h1>
      {description ? <p className="sa-page-header-description">{description}</p> : null}
      {actions ? <div className="sa-page-header-actions">{actions}</div> : null}
      {context ? <div className="sa-page-header-context">{context}</div> : null}
    </header>
  );
}
