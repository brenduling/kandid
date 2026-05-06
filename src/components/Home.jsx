import { Link } from "react-router-dom";

function Home() {
  return (
    <div className="min-h-screen bg-[#f8f6f2] text-gray-800">
      <nav className="h-16 flex items-center justify-between px-10 bg-white border-b">
        <h1 className="font-bold text-[#a83200]">KANDID</h1>

        <div className="flex gap-8 text-sm font-semibold">
          <span>DASHBOARD</span>
          <span>ELECTIONS</span>
          <span>REPORTS</span>
        </div>
      </nav>

      <main className="min-h-[calc(100vh-64px)] flex items-center justify-between px-20">
        <section>
          <span className="text-xs bg-yellow-100 px-4 py-2 rounded-full font-bold">
            BLOCKCHAIN SECURED
          </span>

          <h2 className="text-7xl font-black mt-8 leading-tight">
            Welcome <br />
            to <br />
            <span className="text-[#a83200]">KANDID</span>
          </h2>

          <p className="mt-6 text-gray-600 max-w-md">
            Secure, Transparent, and Immutable Voting. Empowering institutional
            democracy through cryptographic proof.
          </p>
        </section>

        <section className="flex gap-8">
          <div className="w-64 bg-white p-8 rounded-2xl shadow-lg border-t-4 border-yellow-400">
            <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
              👤
            </div>

            <h3 className="text-2xl font-bold mb-3">Student</h3>
            <p className="text-sm text-gray-600 mb-8">
              Access active ballots, verify candidate profiles, and cast your
              vote securely.
            </p>

            <Link
              to="/student-login"
              className="block text-center bg-[#c7370a] text-white py-3 rounded-lg font-bold text-sm hover:bg-[#a83200]"
            >
              ENTER AS STUDENT →
            </Link>
          </div>

          <div className="w-64 bg-white p-8 rounded-2xl shadow-lg border-t-4 border-gray-400">
            <div className="w-14 h-14 bg-gray-200 rounded-xl flex items-center justify-center mb-6">
              🛡️
            </div>

            <h3 className="text-2xl font-bold mb-3">Officer</h3>
            <p className="text-sm text-gray-600 mb-8">
              Manage election cycles, verify voter eligibility, and monitor
              results.
            </p>

            <Link
              to="/officer-login"
              className="block text-center bg-gray-300 text-gray-800 py-3 rounded-lg font-bold text-sm hover:bg-gray-400"
            >
              OFFICER PORTAL
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Home;