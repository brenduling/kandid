import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, LogOut } from "lucide-react";

function MobileNav({ items, groups, onLogout }) {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState(null);
  const activeGroup = useMemo(
    () =>
      groups?.find((group) =>
        group.items.some((item) => location.pathname.startsWith(item.path)),
      ),
    [groups, location.pathname],
  );
  const selectedGroup = groups?.find((group) => group.label === openGroup);

  if (groups?.length) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
        {selectedGroup && (
          <div className="mobile-nav-panel glass-panel-strong mb-3 rounded-[26px] p-3 shadow-[0_20px_40px_rgba(7,17,16,0.18)]">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#64748b]">
                {selectedGroup.label}
              </p>
              <button
                type="button"
                onClick={() => setOpenGroup(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/5 text-[#334155]"
                aria-label={`Close ${selectedGroup.label} menu`}
              >
                <ChevronDown size={16} />
              </button>
            </div>

            <div className="mobile-nav-panel-grid">
              {selectedGroup.items.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpenGroup(null)}
                    className={({ isActive }) =>
                      `mobile-nav-panel-link ${isActive
                        ? "bg-[rgba(194,65,12,0.12)] text-[#c2410c]"
                        : "text-[#334155]"
                      }`
                    }
                  >
                    <Icon size={17} />
                    <span>{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        )}

        <nav className="mobile-nav glass-panel-strong flex items-stretch justify-around rounded-[30px] px-2 py-2 shadow-[0_20px_40px_rgba(7,17,16,0.18)]">
          {groups.map((group) => {
            const Icon = group.items[0]?.icon;
            const isActive =
              activeGroup?.label === group.label || openGroup === group.label;

            return (
              <button
                key={group.label}
                type="button"
                onClick={() =>
                  setOpenGroup((current) =>
                    current === group.label ? null : group.label,
                  )
                }
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold tracking-[0.02em] ${isActive
                    ? "bg-[rgba(194,65,12,0.12)] text-[#c2410c]"
                    : "text-gray-500"
                  }`}
              >
                {Icon && <Icon size={18} />}
                <span className="line-clamp-2 text-center leading-tight">
                  {group.label}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onLogout}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-[10px] font-bold tracking-[0.02em] text-gray-500"
          >
            <LogOut size={18} />
            <span className="line-clamp-2 text-center leading-tight">
              Logout
            </span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <nav className="mobile-nav glass-panel-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[30px] px-2 py-2 shadow-[0_20px_40px_rgba(7,17,16,0.18)] lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold tracking-[0.04em] ${isActive
                ? "bg-[rgba(17,128,106,0.14)] text-[#11806a]"
                : "text-gray-500"
              }`
            }
          >
            <Icon size={18} />
            <span className="truncate">{item.name}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export default MobileNav;
