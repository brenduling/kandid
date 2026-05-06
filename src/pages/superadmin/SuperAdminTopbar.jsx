function SuperAdminTopbar() {
  return (
    <header className="h-20 bg-white border-b flex items-center justify-between px-8">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Super Admin Panel</h2>
        <p className="text-sm text-gray-500">
          Manage organizations, voters, elections, and blockchain records.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button className="px-4 py-2 rounded-lg bg-gray-100 text-sm font-semibold">
          Notifications
        </button>

        <div className="w-10 h-10 rounded-full bg-[#ff6a2a] flex items-center justify-center text-white font-bold">
          A
        </div>
      </div>
    </header>
  );
}

export default SuperAdminTopbar;