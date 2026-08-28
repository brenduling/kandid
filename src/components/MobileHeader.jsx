import React from "react";
import { Menu } from "lucide-react";
import GlobalSearch from "./GlobalSearch";
import NotificationCenter from "./NotificationCenter";
import logo from "../assets/kandidlogo.png";

function getMobilePlaceholder(role) {
  if (role === "student") return "Search elections, organizations, receipts...";
  if (role === "electoral_board") return "Search elections, students, reports...";
  return "Search users, organizations, elections...";
}

function MobileHeader({ user, onMenuClick }) {
  return (
    <header className="mobile-app-header fixed inset-x-0 top-0 z-40 border-b border-gray-100 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-xl lg:hidden">
      <div className="mobile-app-header-row">
        <div className="mobile-header-brand">
          <img
            src={logo}
            alt="KANDID Logo"
            className="h-8 w-8 object-contain"
            loading="lazy"
          />
          <span className="text-lg font-black tracking-tight text-[#111827]">
            KANDID
          </span>
        </div>

        {user ? (
          <GlobalSearch
            user={user}
            className="mobile-header-search"
            placeholder={getMobilePlaceholder(user.role)}
          />
        ) : null}

        <div className="mobile-header-actions">
          {user && <NotificationCenter user={user} />}

          <button
            type="button"
            onClick={onMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default MobileHeader;
