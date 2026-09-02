import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { OrganizationLogo } from "./KandidImage";

function OrganizationSelect({
  label = "Organization",
  organizations = [],
  value,
  onChange,
  placeholder = "Select Organization",
}) {
  const [open, setOpen] = useState(false);
  const selectedOrganization = useMemo(
    () => organizations.find((org) => String(org.id) === String(value)),
    [organizations, value],
  );

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <label className="field-label">{label}</label>
      <button
        type="button"
        className="field-shell flex min-h-[3.75rem] w-full items-center justify-between gap-3 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-3">
          {selectedOrganization ? (
            <OrganizationLogo organization={selectedOrganization} className="!h-10 !w-10" />
          ) : null}
          <span className="truncate">
            {selectedOrganization?.name || placeholder}
          </span>
        </span>
        <ChevronDown size={18} className="shrink-0" />
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 z-50 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-[rgba(24,54,49,0.1)] bg-white p-2 shadow-2xl"
          role="listbox"
        >
          {organizations.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">No organizations found.</div>
          ) : (
            organizations.map((organization) => {
              const selected = String(organization.id) === String(value);

              return (
                <button
                  key={organization.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-orange-50 ${
                    selected ? "bg-orange-50 text-[#f4511e]" : "text-[#182033]"
                  }`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(String(organization.id));
                    setOpen(false);
                  }}
                >
                  <OrganizationLogo organization={organization} className="!h-10 !w-10" />
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {organization.name}
                  </span>
                  {selected ? <Check size={17} className="shrink-0" /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default OrganizationSelect;
