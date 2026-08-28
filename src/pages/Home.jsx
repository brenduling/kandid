import {
  Binary,
  CheckCircle2,
  GraduationCap,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

function Home() {
  return (
    <div className="app-shell relative flex min-h-screen items-center overflow-hidden px-6 py-10">
      <div className="ambient-orb left-[-110px] top-20 h-96 w-96 bg-[rgba(17,128,106,0.18)]" />
      <div className="ambient-orb bottom-10 right-[-90px] h-80 w-80 bg-[rgba(34,211,238,0.16)]" />

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="fade-up">
          <div className="page-kicker">
            <Binary size={14} />
            Blockchain-governed campus election platform
          </div>

          <h1 className="page-title max-w-4xl text-6xl leading-[0.95] lg:text-7xl">
            Secure digital voting,
            <span className="page-title-accent"> built for modern governance</span>
          </h1>

          <p className="page-subtitle text-base lg:text-lg">
            KANDID is a blockchain-ready e-voting workspace for universities and
            student organizations. It brings campaign intelligence, vote control,
            role-based governance, and verification-driven trust into one premium
            glass dashboard that feels institutional, secure, and production-ready.
          </p>

          <div className="mt-8 max-w-2xl rounded-[28px] border border-white/10 bg-white/5 px-5 py-4">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-white/48">
              Direct Portal Access
            </p>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Use the login link provided by your organization. Student and
              Electoral Board accounts now enter through separate role-specific
              URLs.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {[
              "Blockchain verification layer",
              "Controlled result visibility",
              "Precinct and QR voting rules",
            ].map((item) => (
              <div key={item} className="secure-badge">
                <CheckCircle2 size={14} />
                {item}
              </div>
            ))}
          </div>

          <div className="section-grid grid-cols-1 md:grid-cols-3">
            {[
              ["Tamper-aware", "Blockchain receipt hashes and audit visibility strengthen trust after every ballot."],
              ["Governance-ready", "Campaign windows, voter access controls, and result release rules stay organized."],
              ["Institutional scale", "Built for multi-organization elections with separate student, board, and admin portals."],
            ].map(([title, copy], index) => (
              <div key={title} className="metric-card lift-card">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.16)] text-[#7ddff3]">
                  {index === 0 ? <ShieldCheck size={18} /> : index === 1 ? <Landmark size={18} /> : <TrendingUp size={18} />}
                </div>
                <h3 className="surface-title text-lg font-black">{title}</h3>
                <p className="surface-copy mt-2 text-sm leading-7">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="fade-up space-y-5" style={{ animationDelay: "90ms" }}>
          <div className="hero-mesh rounded-[34px] p-7 text-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                  Trust Layer
                </p>
                <h2 className="mt-2 text-3xl font-black">Verified election experience</h2>
              </div>
              <div className="rounded-[22px] bg-white/10 p-4 text-[#7ddff3]">
                <LockKeyhole size={28} />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <span className="landing-chip">End-to-end election flow</span>
              <span className="landing-chip">Ledger-backed verification</span>
              <span className="landing-chip">Mobile-first governance</span>
            </div>

            <div className="glow-divider mt-6" />

            <div className="mt-6 grid gap-3">
              {[
                "Role-based access for students, board members, and administrators",
                "Vote receipts with verification hashes for every submitted ballot",
                "Blockchain-ready verification pages and transparent audit trails",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-white/7 px-4 py-3">
                  <ShieldCheck size={18} className="mt-0.5 text-[#7ddff3]" />
                  <p className="text-sm leading-6 text-white/72">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["99.9%", "Session continuity"],
                ["3", "Role-specific portals"],
                ["Live", "Audit readiness"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl bg-white/8 px-4 py-4">
                  <p className="text-2xl font-black">{value}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-white/48">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel-strong rounded-[34px] p-7">
            <div className="flex items-center justify-between">
              <div>
                <p className="surface-muted text-xs font-bold uppercase tracking-[0.18em]">
                  Public Access
                </p>
                <h2 className="surface-title mt-2 text-3xl font-black">Student Portal</h2>
              </div>
              <div className="rounded-[22px] bg-[rgba(37,99,235,0.16)] p-4 text-[#7ddff3]">
                <GraduationCap size={28} />
              </div>
            </div>

            <p className="surface-copy mt-4 text-sm leading-7">
              Students can explore campaign materials before polls open, cast a
              ballot once voting starts, and review receipts and allowed results
              after submission.
            </p>

            <p className="surface-muted mt-6 rounded-2xl border border-[rgba(34,211,238,0.12)] bg-white/35 px-5 py-4 text-sm font-bold">
              Students should open the student portal link assigned by their
              organization.
            </p>
          </div>

          <div className="glass-panel-dark rounded-[34px] p-7 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                  Restricted Access
                </p>
                <h2 className="mt-2 text-3xl font-black">Election Operations</h2>
              </div>
              <div className="rounded-[22px] bg-white/10 p-4 text-[#7ddff3]">
                <ShieldCheck size={28} />
              </div>
            </div>

            <p className="mt-4 text-sm leading-7 text-white/65">
              Electoral Board members manage elections, candidates, officers,
              campaign periods, blockchain verification, and results using an
              interface designed for speed, oversight, and accountability.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                ["Live election setup", "Schedule, positions, and candidates"],
                ["Institutional oversight", "Results, reports, and archives"],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-2xl bg-white/7 px-4 py-4">
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-2 text-xs leading-6 text-white/58">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Home;
