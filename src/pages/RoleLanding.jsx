import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  LockKeyhole,
  Menu,
  Network,
  ReceiptText,
  SearchCheck,
  Settings,
  ShieldCheck,
  Users,
  Vote,
  X,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import logo from "../assets/kandidlogo.png";
import { getDefaultRouteForUser, getStoredUser } from "../utils/auth";

const roleAccess = {
  student: "student",
  board: "electoral_board",
  admin: "super_admin",
};

const landingConfig = {
  student: {
    roleLabel: "Student Portal",
    className: "student",
    eyebrow: "Student elections",
    title: "Wait, you can count on me.",
    lead: "A simpler way to take part in your student organization elections.",
    about:
      "KANDID brings your student organization elections into one place, from seeing who's running to casting your vote and keeping your voting receipt.",
    loginLabel: "Student Login",
    loginPath: "/student-login",
    heroStats: [
      { label: "Organizations", value: "Your groups" },
      { label: "Elections", value: "Eligible only" },
      { label: "Receipt", value: "After voting" },
    ],
    features: [
      { title: "Your Elections", text: "See elections available to you based on your organization and eligibility.", icon: Vote },
      { title: "Meet Candidates", text: "Review candidate and campaign information before you vote.", icon: Users },
      { title: "Cast Your Vote", text: "Vote through the elections connected to your student account.", icon: ClipboardCheck },
      { title: "Your Receipt", text: "Keep your election receipt and verification information after voting.", icon: ReceiptText },
      { title: "Results", text: "View results when they are made available by the election administrators.", icon: BarChart3 },
      { title: "Organizations", text: "See the student organizations connected to your account.", icon: Building2 },
    ],
    steps: ["Sign in", "Choose an available election", "Review the candidates", "Cast your vote", "Keep your receipt"],
    policies: [
      { title: "Account Use", text: "Use the student account assigned to you and keep your access details private." },
      { title: "Voting Eligibility", text: "Your account can participate only in elections made available through your organization and election rules." },
      { title: "Vote Submission", text: "Review your choices before submitting; submitted votes follow the active election flow." },
      { title: "Privacy Notice", text: "Student information is used to connect accounts, organizations, eligibility, votes, and receipts inside KANDID." },
    ],
  },
  board: {
    roleLabel: "Electoral Board",
    className: "board",
    eyebrow: "Election operations",
    title: "Manage the election. Keep the process clear.",
    lead: "Prepare organization elections, manage candidates and students, monitor voting, and handle results from one workspace.",
    about:
      "KANDID gives Electoral Boards one place for their organization's election work: setup, candidates, eligibility, monitoring, reports, and results.",
    loginLabel: "Electoral Board Login",
    loginPath: "/eb-login",
    workflow: ["Students", "Positions", "Candidates", "Voting", "Results"],
    featureGroups: [
      { title: "Prepare", items: ["Students", "Positions", "Candidates", "Partylists", "Eligibility Rules"], icon: BookOpenCheck },
      { title: "Run", items: ["Election Management", "Voting Monitor", "Kiosk Voting"], icon: Vote },
      { title: "Complete", items: ["Results", "Reports", "Officers"], icon: BarChart3 },
    ],
    steps: ["Set up election", "Prepare candidates", "Open voting", "Monitor participation", "Manage results"],
    policies: [
      { title: "Authorized Board Access", text: "Board accounts should be used only by assigned election managers." },
      { title: "Organization Scope", text: "Election work is scoped to the organization assigned to the board account." },
      { title: "Student Information", text: "Student records should be handled responsibly while preparing eligibility and election access." },
      { title: "Result Handling", text: "Results and reports should be reviewed and managed according to the configured election process." },
    ],
  },
  admin: {
    roleLabel: "Super Admin",
    className: "admin",
    eyebrow: "System oversight",
    title: "One system. Every election connected.",
    lead: "Centralize organizations, students, elections, access, monitoring, and records across the KANDID platform.",
    about:
      "KANDID gives authorized administrators one place to manage organizations, elections, students, access, and system-level election records.",
    loginLabel: "Super Admin Login",
    loginPath: "/admin-login",
    systemMap: [
      { title: "Organizations", icon: Building2, detail: "Programs and membership" },
      { title: "Students", icon: Users, detail: "Records and imports" },
      { title: "Elections", icon: Vote, detail: "Setup and lifecycle" },
      { title: "Boards", icon: ShieldCheck, detail: "Users and roles" },
    ],
    featureGroups: [
      { title: "Organizations & Students", items: ["Organizations", "Students", "CSV Import"], icon: Building2 },
      { title: "Election Management", items: ["Elections", "Positions", "Candidates", "Partylists", "Eligibility"], icon: Vote },
      { title: "Monitoring", items: ["Voting Monitor", "Results", "Reports", "Blockchain Verification"], icon: SearchCheck },
      { title: "System", items: ["Users & Roles", "Audit Logs", "Archive", "System Settings"], icon: Settings },
    ],
    steps: ["Connect organizations", "Maintain student records", "Configure elections", "Oversee activity", "Review records"],
    policies: [
      { title: "Administrative Access", text: "Administrative access is intended for authorized system managers only." },
      { title: "Data Management", text: "Organization, student, and election records should be maintained with care and consistency." },
      { title: "Role Management", text: "Admin users are responsible for assigning and maintaining appropriate account access." },
      { title: "Auditability", text: "System records and logs support review of important administrative activity." },
    ],
  },
};

function PublicHeader({ config }) {
  const [open, setOpen] = useState(false);
  const links = [
    { label: "About", href: "#about" },
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Policies", href: "#policies" },
  ];

  return (
    <header className="kandid-landing-header">
      <a className="kandid-landing-brand" href="#top" aria-label="KANDID home">
        <img src={logo} alt="KANDID Logo" />
        <span>KANDID</span>
      </a>

      <nav className="kandid-landing-nav" aria-label="Landing sections">
        {links.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>

      <Link to={config.loginPath} className="kandid-landing-login">
        {config.loginLabel}
      </Link>

      <button
        type="button"
        className="kandid-landing-menu"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open ? (
        <div className="kandid-landing-mobile-menu">
          {links.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <Link to={config.loginPath}>{config.loginLabel}</Link>
        </div>
      ) : null}
    </header>
  );
}

function StudentVisual({ config }) {
  return (
    <div className="kandid-hero-visual student-visual" aria-label="Student election overview preview">
      <div className="student-ballot-card">
        <span>Available election</span>
        <strong>Organization Election</strong>
        <div className="student-ballot-lines">
          <i />
          <i />
          <i />
        </div>
        <div className="student-ballot-check">
          <CheckCircle2 size={18} />
          Vote receipt ready
        </div>
      </div>
      <div className="student-stat-grid">
        {config.heroStats.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardVisual({ config }) {
  return (
    <div className="kandid-hero-visual board-visual" aria-label="Electoral Board workflow preview">
      {config.workflow.map((item, index) => (
        <div className="board-flow-item" key={item}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{item}</strong>
        </div>
      ))}
    </div>
  );
}

function AdminVisual({ config }) {
  return (
    <div className="kandid-hero-visual admin-visual" aria-label="Super Admin system map preview">
      <div className="admin-map-core">
        <Network size={24} />
        <strong>KANDID</strong>
      </div>
      <div className="admin-map-grid">
        {config.systemMap.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title}>
              <Icon size={18} />
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeroVisual({ config, role }) {
  if (role === "board") return <BoardVisual config={config} />;
  if (role === "admin") return <AdminVisual config={config} />;
  return <StudentVisual config={config} />;
}

function FeatureSection({ config, role }) {
  if (role === "student") {
    return (
      <div className="kandid-feature-grid">
        {config.features.map((item) => {
          const Icon = item.icon;
          return (
            <article className="kandid-feature-card" key={item.title}>
              <Icon size={20} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`kandid-feature-groups ${role === "admin" ? "admin-groups" : ""}`}>
      {config.featureGroups.map((group) => {
        const Icon = group.icon;
        return (
          <article className="kandid-feature-group" key={group.title}>
            <div>
              <Icon size={22} />
              <h3>{group.title}</h3>
            </div>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function RoleLanding({ role = "student" }) {
  const config = landingConfig[role] || landingConfig.student;
  const user = getStoredUser();

  if (roleAccess[role] && user?.role === roleAccess[role]) {
    return <Navigate to={getDefaultRouteForUser(user)} replace />;
  }

  return (
    <main id="top" className={`kandid-landing kandid-landing-${config.className}`}>
      <PublicHeader config={config} />

      <section className="kandid-landing-hero">
        <div className="kandid-hero-copy">
          <p className="kandid-landing-role">{config.roleLabel}</p>
          <span className="kandid-landing-eyebrow">{config.eyebrow}</span>
          <h1>{config.title}</h1>
          <p className="kandid-landing-copy">{config.lead}</p>
          <Link to={config.loginPath} className="kandid-landing-action">
            {config.loginLabel}
            <ArrowRight size={18} />
          </Link>
        </div>
        <HeroVisual config={config} role={role} />
      </section>

      <section id="about" className="kandid-landing-section kandid-about-section">
        <div>
          <span className="kandid-section-kicker">About KANDID</span>
          <h2>{role === "student" ? "Built around your election access." : role === "board" ? "One place for your organization's election." : "System control with clear oversight."}</h2>
        </div>
        <p>{config.about}</p>
      </section>

      <section id="features" className="kandid-landing-section">
        <div className="kandid-section-head">
          <span className="kandid-section-kicker">Features</span>
          <h2>{role === "student" ? "Everything students need to participate." : role === "board" ? "A workflow for election teams." : "Grouped tools for platform management."}</h2>
        </div>
        <FeatureSection config={config} role={role} />
      </section>

      <section id="how-it-works" className={`kandid-landing-section kandid-steps-section ${role === "board" ? "board-steps" : ""}`}>
        <div className="kandid-section-head">
          <span className="kandid-section-kicker">How It Works</span>
          <h2>{role === "student" ? "Simple from sign in to receipt." : role === "board" ? "Prepare, run, and complete." : "Connect, maintain, and oversee."}</h2>
        </div>
        <div className="kandid-step-list">
          {config.steps.map((step, index) => (
            <div className="kandid-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>

      <section id="policies" className="kandid-landing-section kandid-policy-section">
        <div className="kandid-section-head">
          <span className="kandid-section-kicker">Policies</span>
          <h2>{role === "student" ? "Your vote is yours." : role === "board" ? "Responsible election management." : "Administrative responsibility."}</h2>
          <p>
            These summaries are informational placeholders for this KANDID interface and can be replaced with approved institutional terms and privacy text.
          </p>
        </div>
        <div className="kandid-policy-grid">
          {config.policies.map((item) => (
            <article key={item.title}>
              <LockKeyhole size={18} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <div className="kandid-policy-actions">
          <a href="#policies">
            <FileText size={16} />
            Terms & Conditions
          </a>
          <a href="#policies">
            <ShieldCheck size={16} />
            Privacy Notice
          </a>
        </div>
      </section>

      <section className="kandid-final-cta">
        <span>Ready to continue?</span>
        <h2>{config.roleLabel}</h2>
        <Link to={config.loginPath} className="kandid-landing-action">
          {config.loginLabel}
          <ArrowRight size={18} />
        </Link>
      </section>

      <footer className="kandid-landing-footer">
        <div className="kandid-landing-brand">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </div>
        <p>Wait, you can count on me.</p>
      </footer>
    </main>
  );
}

export default RoleLanding;
