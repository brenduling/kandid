import { ArrowRight } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import logo from "../assets/kandidlogo.png";
import { KandidHeroScene, KandidMascot } from "../components/KandidMascot";
import BoardLanding from "./BoardLanding";
import { getDefaultRouteForUser, getStoredUser } from "../utils/auth";

const roleAccess = {
  student: "student",
  board: "electoral_board",
  admin: "super_admin",
};

const landingConfig = {
  admin: {
    routePath: "/admin",
    loginLabel: "Admin Login",
    loginPath: "/admin-login",
    workflow: [
      ["Organize", "Set up organizations and their program structure."],
      ["Maintain", "Manage academic terms and student records."],
      ["Authorize", "Manage Electoral Board access and assignments."],
      ["Oversee", "Administer elections across organizations."],
      ["Review", "Follow audit activity and election records."],
    ],
    responsibilities: [
      ["The structure", "Organizations, programs, coverage, and academic terms."],
      ["The people", "Student records and authorized Electoral Board access."],
      ["The election", "Election setup, eligibility, candidates, and results."],
      ["The record", "Reports, audit history, archives, and verification."],
    ],
  },
};

const capabilityItems = [
  ["Find", "See the elections that apply to you."],
  ["Know", "Review candidates before you vote."],
  ["Vote", "Cast your ballot when eligible."],
  ["Keep", "Find your receipt afterward."],
  ["See", "Results when they're released."],
];

const capabilityPoses = ["find", "know", "vote", "keep", "see"];

const trustItems = [
  ["One ballot", "One vote per election."],
  ["Clear status", "Know when it's recorded."],
  ["Your receipt", "Keep your voting record."],
];

const trustPoses = ["protect", "status", "receipt"];

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

function AdminHeroScene() {
  const indexRows = ["ORG", "TERM", "ACCESS", "ELECTION"];

  return (
    <div
      className="admin-public-scene admin-public-hero-scene"
      role="img"
      aria-label="Kandid organizes a system index of organizations, academic terms, access, and elections."
    >
      <div className="admin-public-index-sheet" aria-hidden="true">
        <span className="admin-public-sheet-kicker">KANDID / SYSTEM INDEX</span>
        <strong>Structure, in order.</strong>
        <ol>
          {indexRows.map((label, index) => (
            <li key={label}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{label}</b>
              <i />
            </li>
          ))}
        </ol>
      </div>
      <KandidMascot pose="inspect" className="admin-public-scene-mascot" />
    </div>
  );
}

function AdminWorkflow({ config }) {
  return (
    <section id="admin-workflow" className="admin-public-workflow admin-public-canvas" aria-labelledby="admin-workflow-title">
      <div className="admin-public-section-heading">
        <p className="admin-public-eyebrow">The system</p>
        <h2 id="admin-workflow-title">From structure to oversight.</h2>
      </div>
      <ol className="admin-public-workflow-list">
        {config.workflow.map(([title, text], index) => (
          <li key={title}>
            <span className="admin-public-step-number">{String(index + 1).padStart(2, "0")}</span>
            <strong>{title}</strong>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AdminResponsibilities({ config }) {
  return (
    <section id="admin-responsibilities" className="admin-public-responsibilities admin-public-canvas" aria-labelledby="admin-responsibilities-title">
      <div className="admin-public-section-heading">
        <p className="admin-public-eyebrow">System responsibility</p>
        <h2 id="admin-responsibilities-title">Know what keeps Kandid together.</h2>
      </div>
      <div className="admin-public-responsibility-list">
        {config.responsibilities.map(([title, text]) => (
          <article key={title}>
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminCheckpoint() {
  return (
    <section className="admin-public-checkpoint admin-public-canvas" aria-labelledby="admin-checkpoint-title">
      <div>
        <p className="admin-public-eyebrow">Across Kandid</p>
        <h2 id="admin-checkpoint-title">Keep every layer in view.</h2>
        <p>Organizations grow. Academic terms move forward. Boards change hands. Keep the structures and records behind their elections in view.</p>
      </div>
      <div className="admin-public-checkpoint-scene" aria-hidden="true">
        <div className="admin-public-index-tabs"><span>ORG</span><span>TERM</span><span>ACCESS</span></div>
        <KandidMascot pose="know" />
        <div className="admin-public-checkpoint-sheet"><i /><i /><i /><i /></div>
      </div>
    </section>
  );
}

function AdminLanding() {
  const config = landingConfig.admin;

  return (
    <main id="top" className="admin-public-site k-paper-canvas">
      <div className="admin-public-first-view">
        <header className="admin-public-header admin-public-canvas">
          <Link to={config.routePath} className="admin-public-brand" aria-label="Kandid Super Admin home">
            <img src={logo} alt="KANDID" />
            <span>KANDID</span>
          </Link>
          <nav className="admin-public-nav" aria-label="Super Admin landing navigation">
            <a href="#admin-workflow">How It Works</a>
            <a href="#admin-responsibilities">What You Manage</a>
            <Link to={config.loginPath}>{config.loginLabel}</Link>
          </nav>
        </header>

        <section className="admin-public-hero admin-public-canvas" aria-labelledby="admin-public-title">
          <div className="admin-public-hero-copy">
            <p className="admin-public-eyebrow">Super Admin</p>
            <h1 id="admin-public-title">Keep Kandid<br />in order.</h1>
            <p className="admin-public-hero-deck">Kandid keeps the structure behind every election clear.</p>
            <p className="admin-public-hero-line">Maintain organizations, academic terms, and the records behind each election.</p>
            <Link to={config.loginPath} className="admin-public-login">
              {config.loginLabel} <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <AdminHeroScene />
        </section>
      </div>

      <AdminWorkflow config={config} />
      <AdminResponsibilities config={config} />
      <AdminCheckpoint />

      <section id="admin-login-cta" className="admin-public-closing admin-public-canvas" aria-label="Super Admin login">
        <h2>Keep Kandid ready.</h2>
        <div className="admin-public-closing-action">
          <Link to={config.loginPath} className="admin-public-login">
            {config.loginLabel} <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <KandidMascot pose="close" />
        </div>
      </section>

      <footer className="admin-public-footer admin-public-canvas">
        <strong>KANDID</strong>
        <span>Centralized Election Management System</span>
        <span>Western Institute of Technology</span>
      </footer>
    </main>
  );
}

function PublicWebsite() {
  return (
    <main id="top" className="kandid-public-site k-paper-canvas">
      <div className="kandid-public-first-view">
        <header className="kandid-public-masthead">
          <a href="#top" className="kandid-public-brand" aria-label="Kandid home">
            <img src={logo} alt="KANDID Logo" />
            <span>KANDID</span>
          </a>
          <nav className="kandid-public-nav" aria-label="Kandid public navigation">
            <a href="#can-do">What You Can Do</a>
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

          <KandidHeroScene className="kandid-public-hero-visual" />
        </section>
      </div>

      <section id="can-do" className="kandid-public-section kandid-public-capabilities" aria-labelledby="can-do-title">
        <h2 id="can-do-title">Your election, made clear.</h2>
        <ol id="journey" className="kandid-public-capability-list">
          {capabilityItems.map(([title, text], index) => (
            <li key={title}>
              <KandidMascot pose={capabilityPoses[index]} className="kandid-public-step-mascot" />
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="kandid-public-section kandid-public-trust" aria-labelledby="trust-title">
        <h2 id="trust-title">Your vote, in view.</h2>
        <div className="kandid-public-trust-list">
          {trustItems.map(([title, text], index) => (
            <article key={title}>
              <KandidMascot pose={trustPoses[index]} className="kandid-public-trust-mascot" />
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <details id="transparency" className="kandid-public-details">
          <summary>
            <strong>Understand the details</strong>
            <span className="kandid-public-details-hint">Privacy, verification, and how your ballot is protected</span>
            <KandidMascot pose="inspect" className="kandid-public-details-mascot" />
          </summary>
          <div className="kandid-public-details-body">
            <div className="kandid-public-verification" aria-labelledby="verification-title">
              <h3 id="verification-title">Hash first. Blockchain second.</h3>
              <p>A hash is a digital fingerprint of a voting record. Blockchain anchoring gives that fingerprint a separate place to be checked later. It does not publish readable ballot choices, and it does not replace Kandid's database, eligibility checks, authentication, authorization, counting, or result rules.</p>
              <p>A vote can be recorded while security verification is still in progress. Pending verification should not automatically be read as a rejected ballot.</p>
            </div>
            <p className="kandid-public-policy-note">How Kandid handles information and verification is explained below. Formal institutional policies, when approved, take precedence.</p>
            <div className="kandid-public-disclosures">
              {transparencyGroups.map((group) => (
                <details key={group.title} className="kandid-public-disclosure">
                  <summary>
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
        </details>
      </section>

      <section className="kandid-public-closing" aria-label="Kandid closing signature">
        <span>When it matters, count on Kandid.</span>
        <div className="kandid-public-closing-action">
          <Link to="/student-login" className="kandid-public-primary">
            Student Login
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="kandid-public-footer">
        <div id="about" className="kandid-public-about">
          <strong>About Kandid</strong>
          <p>Kandid is the centralized election management system for student organizations of Western Institute of Technology, bringing elections, voting, results, receipts, and verification together.</p>
        </div>
        <div className="kandid-public-footer-meta">
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
  const activeRole = roleAccess[role] ? role : "student";
  const user = getStoredUser();

  if (roleAccess[activeRole] && user?.role === roleAccess[activeRole]) {
    return <Navigate to={getDefaultRouteForUser(user)} replace />;
  }

  if (activeRole === "student") {
    return <PublicWebsite />;
  }

  if (activeRole === "board") {
    return <BoardLanding />;
  }

  return <AdminLanding />;
}

export default RoleLanding;
