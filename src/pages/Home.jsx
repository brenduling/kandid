import { useNavigate } from "react-router-dom";
import { GraduationCap, ShieldCheck, Smartphone } from "lucide-react";

function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f6f3ef] flex items-center justify-center px-6">
      <div className="w-full max-w-6xl grid grid-cols-2 gap-10 items-center">
        <section>
          <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm text-sm font-bold text-[#ff5a1f]">
            <Smartphone size={16} />
            PWA Ready Voting System
          </div>

          <h1 className="text-7xl font-black leading-tight mt-8 text-[#1d1d1d]">
            KANDID
          </h1>

          <p className="text-2xl font-bold text-gray-700 mt-3">
            Secure Student Election Platform
          </p>

          <p className="text-gray-500 mt-5 max-w-lg leading-relaxed">
            A web-based and installable voting system for students and electoral
            board members. Built for secure access, organized elections, and
            transparent vote monitoring.
          </p>

          <div className="mt-8 bg-white rounded-2xl p-5 shadow-sm max-w-md">
            <p className="text-sm font-bold text-gray-800">
              Access reminder:
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Super Admin access is restricted and not shown on this public
              portal.
            </p>
          </div>
        </section>

        <section className="grid gap-6">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-orange-100">
            <div className="w-14 h-14 bg-orange-100 text-[#ff5a1f] rounded-2xl flex items-center justify-center">
              <GraduationCap size={30} />
            </div>

            <h2 className="text-3xl font-black mt-6">Student</h2>

            <p className="text-gray-500 mt-3">
              Login to view eligible elections, cast your vote, and check your
              voting receipt.
            </p>

            <button
              onClick={() => navigate("/student-login")}
              className="w-full mt-8 bg-[#ff5a1f] text-white py-4 rounded-xl font-black hover:bg-[#e24d17] transition"
            >
              Login as Student
            </button>

            <button
              onClick={() => navigate("/student-setup")}
              className="w-full mt-3 text-sm font-bold text-[#ff5a1f] hover:underline"
            >
              First time? Setup your account
            </button>
          </div>

          <div className="bg-[#1d1d1d] text-white rounded-3xl p-8 shadow-sm">
            <div className="w-14 h-14 bg-white/10 text-[#ff5a1f] rounded-2xl flex items-center justify-center">
              <ShieldCheck size={30} />
            </div>

            <h2 className="text-3xl font-black mt-6">Electoral Board</h2>

            <p className="text-white/60 mt-3">
              Manage assigned organization elections, candidates, positions,
              rules, monitoring, and results.
            </p>

            <button
              onClick={() => navigate("/board-login")}
              className="w-full mt-8 bg-white text-[#1d1d1d] py-4 rounded-xl font-black hover:bg-gray-100 transition"
            >
              Login as Electoral Board
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Home;