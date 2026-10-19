import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import logo from "../assets/kandidlogo.png";
import { KandidMascot } from "../components/KandidMascot";
import "./BoardLanding.css";

const workflow = [
  ["Set up", "Create the election and set its schedule."],
  ["Organize", "Prepare positions and candidates."],
  ["Open", "Make the ballot available when ready."],
  ["Watch", "Follow voting activity and status."],
  ["Results", "Review and release results under the election's settings."],
];

const responsibilities = [
  ["The timing", "Set campaign and voting periods."],
  ["The ballot", "Prepare positions, candidates, and eligibility."],
  ["The outcome", "Review results and control when they appear."],
];

function BoardHeroScene() {
  return (
    <svg
      className="board-public-hero-scene"
      viewBox="0 0 600 440"
      fill="none"
      role="img"
      aria-label="Kandid checks an election plan and prepares the ballot stages."
    >
      <path d="M261 61h260v321H261z" fill="#17181c" />
      <path d="M276 76h230v291H276z" fill="#f8f6f1" />
      <path d="M297 101h90" stroke="#f4512c" strokeWidth="5" />
      <path d="M297 118h178M297 132h132" stroke="#17181c" strokeWidth="2" />
      <path d="M297 159h186M297 210h186M297 261h186M297 312h186" stroke="#bbb5aa" strokeWidth="1.5" />
      <path d="M305 174h19v19h-19zM305 225h19v19h-19zM305 276h19v19h-19zM305 327h19v19h-19z" stroke="#17181c" strokeWidth="2" />
      <path d="m309 183 5 5 9-11m-14 58 5 5 9-11" stroke="#f4512c" strokeWidth="3" />
      <path d="M343 175h95M343 189h68M343 226h112M343 240h80M343 277h99M343 291h55M343 328h109M343 342h72" stroke="#17181c" strokeWidth="2" />
      <path d="M493 143h44v26h-44z" fill="#f4512c" />
      <path d="M503 155h24" stroke="#fffdf8" strokeWidth="2" />
      <KandidMascot pose="know" x="5" y="108" width="282" height="300" />
    </svg>
  );
}

function LoginLink({ className = "" }) {
  return (
    <Link to="/eb-login" className={`board-public-login ${className}`}>
      Board Login <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}

function BoardLanding() {
  return (
    <main id="top" className="board-public-site k-paper-canvas">
      <div className="board-public-first-view">
        <header className="board-public-header board-public-canvas">
          <a href="#top" className="board-public-brand" aria-label="Kandid Board home">
            <img src={logo} alt="KANDID Logo" />
            <span>KANDID</span>
          </a>
          <nav className="board-public-nav" aria-label="Electoral Board landing navigation">
            <a href="#workflow">How It Works</a>
            <a href="#responsibilities">What You Control</a>
            <Link to="/eb-login">Board Login</Link>
          </nav>
        </header>

        <section className="board-public-hero board-public-canvas" aria-labelledby="board-public-title">
          <div className="board-public-hero-copy">
            <p className="board-public-eyebrow">Electoral Board</p>
            <h1 id="board-public-title">Run the election.</h1>
            <p className="board-public-hero-deck">Kandid keeps every phase clear.</p>
            <p className="board-public-hero-line">Prepare the ballot. Follow the vote. Bring the results into view.</p>
            <LoginLink />
          </div>
          <BoardHeroScene />
        </section>
      </div>

      <section id="workflow" className="board-public-workflow board-public-canvas" aria-labelledby="board-workflow-title">
        <div className="board-public-section-heading">
          <p className="board-public-eyebrow">The work</p>
          <h2 id="board-workflow-title">From setup to result.</h2>
        </div>
        <ol className="board-public-workflow-list">
          {workflow.map(([title, text], index) => (
            <li key={title}>
              <span className="board-public-step-number">{String(index + 1).padStart(2, "0")}</span>
              {index === 1 ? <KandidMascot pose="know" className="board-public-step-mascot" /> : null}
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="responsibilities" className="board-public-responsibilities board-public-canvas" aria-labelledby="board-responsibilities-title">
        <div className="board-public-section-heading">
          <p className="board-public-eyebrow">In your hands</p>
          <h2 id="board-responsibilities-title">Know what's under your control.</h2>
        </div>
        <div className="board-public-responsibility-list">
          {responsibilities.map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="board-public-trust board-public-canvas" aria-labelledby="board-trust-title">
        <div>
          <p className="board-public-eyebrow">Before it goes live</p>
          <h2 id="board-trust-title">Look it over. Then move it forward.</h2>
          <p>Check the schedule, ballot, and result settings as the election moves through each phase.</p>
        </div>
        <div className="board-public-review" aria-hidden="true">
          <KandidMascot pose="inspect" />
          <span className="board-public-review-sheet">
            <i /><i /><i />
          </span>
        </div>
      </section>

      <section className="board-public-closing board-public-canvas" aria-label="Board Login">
        <h2>Ready when the election is.</h2>
        <div className="board-public-closing-action">
          <LoginLink />
          <KandidMascot pose="close" />
        </div>
      </section>

      <footer className="board-public-footer board-public-canvas">
        <strong>KANDID</strong>
        <span>Centralized Election Management System</span>
        <span>Western Institute of Technology</span>
      </footer>
    </main>
  );
}

export default BoardLanding;
