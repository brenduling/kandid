import { NavLink } from "react-router-dom";

function MobileNav({ items }) {
  return (
    <nav className="mobile-nav glass-panel-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[30px] px-2 py-2 shadow-[0_20px_40px_rgba(7,17,16,0.18)] lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold tracking-[0.04em] ${
                isActive
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
