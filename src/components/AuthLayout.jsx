import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/kandidlogo.png";

function AuthLayout({
  roleLabel,
  title,
  copy,
  backTo = "/",
  children,
}) {
  const navigate = useNavigate();

  return (
    <div className="kandid-auth-screen">
      <section className="kandid-auth-identity">
        <div className="kandid-auth-brand">
          <img src={logo} alt="KANDID Logo" />
          <span>KANDID</span>
        </div>
        <div>
          <p>{roleLabel}</p>
          <h1>Wait, you can count on me.</h1>
          <span>{copy}</span>
        </div>
      </section>

      <main className="kandid-auth-main">
        <button
          type="button"
          className="kandid-auth-back"
          onClick={() => navigate(backTo)}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <section className="kandid-auth-card">
          <div className="kandid-auth-card-head">
            <span>
              <LockKeyhole size={14} />
              {roleLabel}
            </span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </div>
          {children}
        </section>
      </main>
    </div>
  );
}

export default AuthLayout;
