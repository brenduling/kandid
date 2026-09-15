import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import { Link } from "react-router-dom";
import hero from "../assets/hero.png";
import logo from "../assets/kandidlogo.png";

const portals = [
  {
    title: "Students",
    text: "Open assigned elections, review candidates, vote when eligible, and keep your receipt after submission.",
    href: "/",
    icon: Vote,
  },
  {
    title: "Electoral Board",
    text: "Prepare election setup, candidates, voters, kiosk access, monitoring, results, and reports for your organization.",
    href: "/board-portal",
    icon: ClipboardCheck,
  },
  {
    title: "Super Admin",
    text: "Maintain organizations, student records, access, election operations, logs, archives, and system settings.",
    href: "/admin",
    icon: LayoutDashboard,
  },
];

const workflows = [
  { label: "Organizations", icon: Building2 },
  { label: "Students", icon: Users },
  { label: "Elections", icon: Vote },
  { label: "Candidates", icon: BadgeCheck },
  { label: "Results", icon: BarChart3 },
  { label: "Records", icon: FileText },
];

function Home() {
  return (
    <main className="kandid-product-home">
      <header className="kandid-product-nav" aria-label="KANDID public navigation">
        <Link to="/" className="kandid-product-brand" aria-label="KANDID student portal">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </Link>
        <nav>
          <Link to="/">Student</Link>
          <Link to="/board-portal">Board</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>

      <section className="kandid-product-hero">
        <div className="kandid-product-copy">
          <p className="kandid-product-kicker">
            <ShieldCheck size={16} />
            Campus election workspace
          </p>
          <h1>Run student elections with clearer setup, voting, and result workflows.</h1>
          <p>
            KANDID organizes the election lifecycle for students, Electoral Boards,
            and administrators in one role-based interface. It keeps eligibility,
            ballot access, receipts, monitoring, and results in predictable places.
          </p>
          <div className="kandid-product-actions">
            <Link to="/" className="kandid-product-primary">
              Open Student Portal
              <ArrowRight size={18} />
            </Link>
            <Link to="/board-portal" className="kandid-product-secondary">
              Board Portal
            </Link>
          </div>
        </div>

        <div className="kandid-product-visual" aria-label="KANDID election workflow preview">
          <div className="kandid-product-visual-head">
            <img src={hero} alt="" aria-hidden="true" />
            <div>
              <span>Election cycle</span>
              <strong>Setup to receipt</strong>
            </div>
          </div>
          <div className="kandid-product-flow">
            {workflows.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="kandid-product-portals" aria-label="KANDID portals">
        {portals.map((portal) => {
          const Icon = portal.icon;
          return (
            <Link key={portal.title} to={portal.href} className="kandid-product-card">
              <Icon size={22} />
              <strong>{portal.title}</strong>
              <p>{portal.text}</p>
              <span>
                Continue
                <ArrowRight size={16} />
              </span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}

export default Home;
