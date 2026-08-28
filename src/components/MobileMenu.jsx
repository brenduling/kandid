import React, { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { X, ChevronDown, LogOut } from "lucide-react";
import { getProfileRoute } from "../utils/profile";

function MobileMenu({
  isOpen,
  onClose,
  menuGroups,
  user,
  onLogout,
  title = "Menu",
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const normalizedGroups = Array.isArray(menuGroups)
    ? menuGroups[0]?.items
      ? menuGroups
      : [{ label: "Navigation", items: menuGroups }]
    : [];

  // Track which groups are expanded in the mobile menu
  const [openGroups, setOpenGroups] = useState(() => {
    if (!normalizedGroups.length) return {};
    return Object.fromEntries(normalizedGroups.map((group) => [group.label, true]));
  });

  // Lock body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }));
  }

  function handleProfileClick() {
    onClose();
    if (user?.role) {
      navigate(getProfileRoute(user.role));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="absolute inset-y-0 right-0 flex w-4/5 max-w-sm flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <span className="text-sm font-black uppercase tracking-wider text-gray-900">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-500 hover:bg-gray-100"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {/* User Profile Summary */}
          {user && (
            <button
              onClick={handleProfileClick}
              className="mb-6 flex w-full items-center gap-3 rounded-2xl bg-gray-50 p-3 text-left transition hover:bg-gray-100"
            >
              {user.photo_url ? (
                <img
                  src={user.photo_url}
                  alt={user.full_name || "Profile"}
                  className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white shadow-sm"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-black text-orange-600 ring-2 ring-white shadow-sm">
                  {user.first_name?.[0] || "U"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">
                  {user.full_name || user.first_name || "User"}
                </p>
                <p className="truncate text-xs font-semibold capitalize text-gray-500">
                  {user.role ? user.role.replace("_", " ") : "User"}
                </p>
              </div>
            </button>
          )}

          {/* Navigation Groups */}
          {normalizedGroups.length > 0 ? (
            <div className="space-y-6">
              {normalizedGroups.map((group) => {
                const isGroupOpen =
                  openGroups[group.label] ??
                  group.items.some((item) =>
                    location.pathname.startsWith(item.path),
                  );

                return (
                  <div key={group.label} className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className="flex items-center justify-between px-2 py-1"
                    >
                      <span className="text-xs font-black uppercase tracking-wider text-gray-400">
                        {group.label}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform duration-200 ${
                          isGroupOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isGroupOpen && (
                      <div className="flex flex-col gap-1">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <NavLink
                              key={item.path}
                              to={item.path}
                              onClick={onClose}
                              className={({ isActive }) =>
                                `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${
                                  isActive
                                    ? "bg-orange-50 text-orange-600"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                                }`
                              }
                            >
                              <Icon size={18} />
                              <span>{item.name}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-2 text-sm font-semibold text-gray-500">
              No navigation items available.
            </p>
          )}
        </div>

        {/* Logout */}
        <div className="border-t border-gray-100 p-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              if (onLogout) onLogout();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default MobileMenu;
