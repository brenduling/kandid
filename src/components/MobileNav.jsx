import React from "react";
import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";

function MobileNav({ primaryItems, onLogout }) {
  if (!primaryItems || primaryItems.length === 0) return null;

  return (
    <nav className="mobile-nav glass-panel-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[30px] px-2 py-2 shadow-[0_20px_40px_rgba(7,17,16,0.18)] lg:hidden">
      {primaryItems.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `mobile-nav-item ${
                isActive
                  ? "mobile-nav-item-active"
                  : ""
              }`
            }
            aria-label={item.name}
          >
            <Icon size={18} />
            <span className="truncate">{item.name}</span>
          </NavLink>
        );
      })}

      {onLogout ? (
        <button
          type="button"
          onClick={onLogout}
          className="mobile-nav-item"
          aria-label="Logout"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      ) : null}
    </nav>
  );
}

export default MobileNav;
