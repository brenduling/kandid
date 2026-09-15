import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileCheck2,
  Fingerprint,
  ShieldCheck,
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
  board: {
    routePath: "/board-portal",
    audience: "Electoral Board",
    eyebrow: "Kandid",
    eyebrowDetail: "Electoral Board",
    title: "Run the election with Kandid.",
    lead: "Prepare. Organize. Monitor. Complete.",
    loginLabel: "Board Login",
    loginPath: "/eb-login",
    headerLabel: "Election Operations",
    deskTitle: "Kandid election desk",
    deskItems: ["Prepare", "Organize", "Monitor", "Complete"],
    sections: [
      {
        type: "steps",
        kicker: "Operational overview",
        title: "From preparation to results",
        items: [
          ["01", "Prepare", "Set the election."],
          ["02", "Organize", "Candidates & positions."],
          ["03", "Monitor", "Follow voting."],
          ["04", "Complete", "Results & records."],
        ],
      },
      {
        type: "trust",
        kicker: "The process, in view.",
        title: "Election work stays accountable",
        items: [
          ["Role-bound access", "Authorized Board users enter the workspace after login."],
          ["Private records", "Student and election-management records stay inside the authenticated app."],
          ["Clear handoff", "The landing page explains the desk; the workspace runs the election."],
        ],
      },
    ],
    finalKicker: "From preparation to results, keep it together.",
  },
  admin: {
    routePath: "/admin",
    audience: "Super Admin",
    eyebrow: "Kandid",
    eyebrowDetail: "System Administration",
    title: "System-wide oversight for Kandid.",
    lead: "Controlled access for platform oversight.",
    loginLabel: "Admin Login",
    loginPath: "/admin-login",
    headerLabel: "Privileged System Entrance",
    deskTitle: "Admin entry",
    deskItems: ["Role context", "Admin login", "Workspace access"],
    sections: [
      {
        type: "trust",
        kicker: "System level",
        title: "Controlled administration",
        items: [
          ["Organizations", "Manage organizations across Kandid."],
          ["Access", "Keep administration within authorized roles."],
          ["Oversight", "Maintain the system behind every election."],
        ],
      },
    ],
    finalKicker: null,
  },
};

const capabilityItems = [
  ["Elections", "From campaign to count."],
  ["Ballots", "Make your choice clear."],
  ["Results", "Know when the count is ready."],
  ["Receipts", "Keep your voting record."],
  ["Organizations", "Different groups. One Kandid."],
  ["Verification", "A record you can check."],
];

const journeyItems = [
  ["Discover", "See what's open."],
  ["Decide", "Know your choices."],
  ["Cast", "Submit your ballot."],
  ["Keep", "Hold on to your receipt."],
];

const trustItems = [
  ["One ballot", "One vote per election."],
  ["Clear status", "Know when it's recorded."],
  ["Your receipt", "Keep your voting record."],
];

const transparencyGroups = [
  {
    title: "Your information",
    summary: "Kandid may use student, election, organization, session, timestamp, notification, and audit information to decide what the right account should see.",
    details: [
      "Student information can include student number, name, program, year level, organization membership, eligibility or enrollment information, and profile information available to Kandid.",
      "Kandid needs this to answer practical questions: who are you, which elections apply to you, are you eligible, have you already voted, and what should you see.",
      "Public Kandid should not expose another student's student number, credentials, private membership or eligibility records, individual ballot, private receipt, private voting status, or user-linked verification information.",
    ],
  },
  {
    title: "Your ballot",
    summary: "A valid submitted ballot is recorded by Kandid and used by the election system according to the election's rules.",
    details: [
      "An individual student's ballot should not be presented publicly.",
      "A receipt provides a record that a voting submission was created or recorded.",
      "The receipt is not intended to publicly reveal whom the student voted for, even when technical verification information appears on the student's receipt.",
    ],
  },
  {
    title: "The hash",
    summary: "A hash acts like a digital fingerprint of a voting record.",
    details: [
      "If the underlying information changes, recalculating the hash produces a different value. That can help detect a mismatch.",
      "Hash does not mean ballot. A hash should not be treated as a readable copy of the student's choices.",
      "Hashing helps verification, but hashing alone does not prevent every possible change or replace the rest of the election system.",
    ],
  },
  {
    title: "Blockchain verification",
    summary: "Kandid does not need to put the student's readable ballot choices on the blockchain.",
    details: [
      "The hash creates the fingerprint. Blockchain anchoring provides a separate record that the fingerprint can later be checked against.",
      "Technical information may include a vote hash, transaction identifier, network or block information, and recording timestamp.",
      "Blockchain does not replace the database, authentication, authorization, eligibility, vote counting, result calculation, account security, infrastructure, or election administration.",
    ],
  },
  {
    title: "Pending verification",
    summary: "Vote recorded and security verification in progress are not necessarily the same stage.",
    details: [
      "A blockchain verification delay should not automatically mean the ballot was rejected or removed from the election count.",
      "Kandid should explain verification status calmly and avoid absolute claims such as unhackable, 100% secure, impossible to alter, or completely tamper-proof.",
      "Security also depends on server-side logic, database controls, authorized roles, account practices, infrastructure, and election governance.",
    ],
  },
  {
    title: "Results and publication",
    summary: "Result visibility depends on configured and reviewed election release rules.",
    details: [
      "Results may be delayed, released after voting, restricted to appropriate users, or shown after election completion.",
      "Candidate information and campaign materials may be processed as part of an election, but their visibility depends on applicable election or organization rules.",
      "Kandid should only publicly describe someone as elected, new President, or new officer when the system and election process have established an official outcome.",
    ],
  },
  {
    title: "Public content",
    summary: "Public sections should use only information approved for public viewing.",
    details: [
      "An image existing inside Kandid does not automatically mean it should appear publicly.",
      "Public photography should not imply who someone voted for, whether someone voted, candidate preference, or ballot choice.",
      "Kandid should not fabricate public activity, participation, or outcomes.",
    ],
  },
  {
    title: "Roles and responsibilities",
    summary: "Kandid provides the system, but it does not replace authorized election governance.",
    details: [
      "Students should use only authorized accounts, protect credentials, provide accurate information when required, follow applicable election rules, and avoid interfering with system operation.",
      "Electoral Boards are responsible for appropriate schedules, positions, candidates, eligibility, campaign periods, voting periods, and result-release settings.",
      "Administrative access is restricted to authorized roles. Kandid also depends on supporting services such as internet connectivity, hosting, database and authentication services, and blockchain infrastructure where verification is used.",
      "Kandid may evolve. For questions about information or election access, contact the appropriate authorized WIT/Kandid representative.",
    ],
  },
];

function EntryDesk({ config }) {
  return (
    <aside className="kandid-entry-panel" aria-labelledby="kandid-entry-desk-title">
      <div className="kandid-entry-panel-head">
        <span>{config.audience}</span>
        <h2 id="kandid-entry-desk-title">{config.deskTitle}</h2>
      </div>
      <ul className="kandid-entry-desk-list">
        {config.deskItems.map((item) => (
          <li key={item}>
            <BadgeCheck size={17} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function NumberedSection({ section }) {
  return (
    <section className="kandid-entry-section" aria-labelledby={`${section.type}-section-title`}>
      <div className="kandid-entry-section-head">
        <span>{section.kicker}</span>
        <h2 id={`${section.type}-section-title`}>{section.title}</h2>
      </div>
      <div className="kandid-entry-step-grid">
        {section.items.map(([number, title, text]) => (
          <article className="kandid-entry-step" key={title}>
            <span>{number}</span>
            <strong>{title}</strong>
            {text ? <p>{text}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function TrustSection({ section }) {
  return (
    <section className="kandid-entry-section kandid-entry-trust" aria-labelledby={`${section.type}-section-title`}>
      <div className="kandid-entry-section-head">
        <span>{section.kicker}</span>
        <h2 id={`${section.type}-section-title`}>{section.title}</h2>
      </div>
      <div className="kandid-entry-trust-grid">
        {section.items.map(([title, text]) => (
          <article key={title}>
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>{title}</strong>
            {text ? <p>{text}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function EntrySection({ section }) {
  if (section.type === "trust") return <TrustSection section={section} />;
  return <NumberedSection section={section} />;
}

function RoleEntryLanding({ role }) {
  const config = landingConfig[role];

  return (
    <main id="top" className={`kandid-landing kandid-entry kandid-entry-${role} k-paper-canvas`}>
      <header className="kandid-entry-header">
        <Link to={config.routePath} className="kandid-entry-brand" aria-label="Kandid">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </Link>
        <span className="kandid-entry-descriptor">{config.headerLabel}</span>
        <Link to={config.loginPath} className="kandid-entry-header-action">
          {config.loginLabel}
        </Link>
      </header>

      <section className="kandid-entry-shell" aria-labelledby="kandid-entry-title">
        <div className="kandid-entry-intro">
          <p className="kandid-entry-kicker">
            {config.eyebrow}
            <span>{config.eyebrowDetail}</span>
          </p>
          <h1 id="kandid-entry-title">{config.title}</h1>
          <p className="kandid-entry-copy">{config.lead}</p>
          <div className="kandid-entry-primary">
            <Link to={config.loginPath} className="kandid-entry-primary-action">
              {config.loginLabel}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <EntryDesk config={config} />
      </section>

      <div className="kandid-entry-content">
        {config.sections.map((section) => (
          <EntrySection key={`${role}-${section.type}-${section.title}`} section={section} />
        ))}
      </div>

      {config.finalKicker ? (
        <section className="kandid-entry-final" aria-label={`${config.audience} entry`}>
          <span>{config.finalKicker}</span>
          <Link to={config.loginPath} className="kandid-entry-secondary-action">
            {config.loginLabel}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      <footer className="kandid-entry-footer">
        <span>Kandid</span>
        <span>Centralized Election Management System</span>
        <Building2 size={16} aria-hidden="true" />
      </footer>
    </main>
  );
}

function SectionHead({ id, eyebrow, title, copy }) {
  return (
    <div className="kandid-public-section-head">
      <span>{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </div>
  );
}

function PublicWebsite() {
  return (
    <main id="top" className="kandid-public-site k-paper-canvas">
      <header className="kandid-public-masthead">
        <a href="#top" className="kandid-public-brand" aria-label="Kandid home">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </a>
        <nav className="kandid-public-nav" aria-label="Kandid public navigation">
          <a href="#can-do">Kandid Can Do</a>
          <a href="#journey">How It Works</a>
          <a href="#about">About</a>
          <Link to="/student-login">Student Login</Link>
        </nav>
      </header>

      <section className="kandid-public-hero" aria-labelledby="kandid-public-title">
        <div className="kandid-public-hero-copy">
          <p className="kandid-public-kicker">Digital student elections</p>
          <h1 id="kandid-public-title">KANDID</h1>
          <p className="kandid-public-tagline">Wait, you can count on me.</p>
          <p className="kandid-public-lead">Your elections. Your ballot. Your receipt.</p>
          <Link to="/student-login" className="kandid-public-primary">
            Student Login
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>

        <aside className="kandid-public-hero-note" aria-label="Kandid public promise">
          <span>Before login</span>
          <strong>Understand Kandid.</strong>
          <span>After login</span>
          <strong>Use Kandid.</strong>
        </aside>
      </section>

      <section id="can-do" className="kandid-public-section kandid-public-capabilities" aria-labelledby="can-do-title">
        <SectionHead
          id="can-do-title"
          eyebrow="System"
          title="KANDID CAN DO"
          copy="What the system provides, said in student-facing language."
        />
        <div className="kandid-public-capability-list">
          {capabilityItems.map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="journey" className="kandid-public-section kandid-public-journey" aria-labelledby="journey-title">
        <SectionHead
          id="journey-title"
          eyebrow="Student journey"
          title="HOW KANDID WORKS"
          copy="The path from public election awareness to a private voting record."
        />
        <div className="kandid-public-journey-line">
          {journeyItems.map(([title, text], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kandid-public-section kandid-public-trust" aria-labelledby="trust-title">
        <SectionHead
          id="trust-title"
          eyebrow="Trust"
          title="EXPLAIN THE TRUST"
          copy="Kandid should help students understand the controls behind the interface."
        />
        <div className="kandid-public-trust-list">
          {trustItems.map(([title, text]) => (
            <article key={title}>
              <CheckCircle2 size={20} aria-hidden="true" />
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="transparency" className="kandid-public-section kandid-public-transparency" aria-labelledby="transparency-title">
        <SectionHead
          id="transparency-title"
          eyebrow="Plain-language guide"
          title="PRIVACY & TRANSPARENCY"
          copy="What Kandid knows. Why Kandid needs it. What stays private. How vote verification works."
        />
        <div className="kandid-public-transparency-grid">
          <article className="kandid-public-transparency-lead">
            <p>
              How Kandid handles information and verification. Formal institutional policies, when approved, take precedence.
            </p>
          </article>

          <div className="kandid-public-disclosures">
            {transparencyGroups.map((group, index) => (
              <details key={group.title} className="kandid-public-disclosure">
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{group.title}</strong>
                </summary>
                <p>{group.summary}</p>
                <ul>
                  {group.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="kandid-public-section kandid-public-about" aria-labelledby="about-title">
        <SectionHead
          id="about-title"
          eyebrow="About"
          title="ABOUT KANDID"
          copy="Kandid is a centralized election management system designed for student organizations of Western Institute of Technology."
        />
        <div className="kandid-public-about-body">
          <p>
            It supports appropriate election administration, candidate and campaign information, eligibility, voting, results, officers, receipts, and vote-record verification.
          </p>
          <p>
            Kandid reports the election while Kandid runs the election: before login, students can understand the system; after login, they can take part in what applies to them.
          </p>
        </div>
      </section>

      <section className="kandid-public-verification" aria-labelledby="verification-title">
        <div>
          <Fingerprint size={28} aria-hidden="true" />
          <h2 id="verification-title">Hash first. Blockchain second.</h2>
        </div>
        <p>
          A hash is a digital fingerprint of a voting record. Blockchain anchoring gives that fingerprint a separate place to be checked later. It does not publish readable ballot choices, and it does not replace Kandid's database, eligibility checks, authentication, authorization, counting, or result rules.
        </p>
        <p>
          A vote can be recorded while security verification is still in progress. Pending verification should not automatically be read as a rejected ballot.
        </p>
      </section>

      <section className="kandid-public-closing" aria-label="Kandid closing signature">
        <FileCheck2 size={24} aria-hidden="true" />
        <span>When it matters, count on Kandid.</span>
        <Link to="/student-login" className="kandid-public-primary">
          Student Login
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>

      <footer className="kandid-public-footer">
        <div>
          <strong>KANDID</strong>
          <span>Centralized Election Management System</span>
          <span>Western Institute of Technology</span>
        </div>
        <nav aria-label="Kandid footer navigation">
          <a href="#about">About</a>
          <a href="#transparency">Privacy & Transparency</a>
          <Link to="/student-login">Student Login</Link>
        </nav>
      </footer>
    </main>
  );
}

function RoleLanding({ role = "student" }) {
  const activeRole = landingConfig[role] ? role : "student";
  const user = getStoredUser();

  if (roleAccess[activeRole] && user?.role === roleAccess[activeRole]) {
    return <Navigate to={getDefaultRouteForUser(user)} replace />;
  }

  if (activeRole === "student") {
    return <PublicWebsite />;
  }

  return <RoleEntryLanding role={activeRole} />;
}

export default RoleLanding;
