import PageHeader from "./PageHeader";

const stats = [
  { label: "Organizations", value: "11" },
  { label: "Students", value: "600" },
  { label: "Active Elections", value: "2" },
  { label: "Votes Cast", value: "0" },
];

function SuperAdminDashboard() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="System-wide overview of KANDID voting operations."
      />

      <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <h2 className="text-4xl font-black mt-3 text-gray-900">
              {stat.value}
            </h2>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border">
          <h3 className="font-bold text-xl mb-4">Recent Activities</h3>
          <div className="space-y-4 text-sm text-gray-600">
            <p>System initialized successfully.</p>
            <p>Database connection established.</p>
            <p>Super admin panel created.</p>
          </div>
        </div>

        <div className="bg-[#1f1f1f] text-white p-6 rounded-2xl shadow-sm">
          <h3 className="font-bold text-xl mb-4">Blockchain Status</h3>
          <p className="text-gray-300">
            Vote hash verification module is ready for integration.
          </p>

          <div className="mt-6 inline-block px-4 py-2 bg-green-500/20 text-green-300 rounded-full text-sm font-bold">
            Ready
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminDashboard;
