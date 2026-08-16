import logo from "../assets/kandidlogo.png";

function StudentAuthShell({ children }) {
  return (
    <div className="student-auth-screen">
      <aside className="student-auth-rail">
        <div className="student-auth-brand">
          <img src={logo} alt="KANDID Logo" className="h-11 w-11 object-contain" />
          <span>KANDID</span>
        </div>

        <div className="student-auth-copy">
          <h1>
            Secure Student
            <span>Voting Portal.</span>
          </h1>
          <p>Authenticate to access your active ballots and candidate profiles.</p>
          <div className="student-auth-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
      </aside>

      <main className="student-auth-main">{children}</main>
    </div>
  );
}

export default StudentAuthShell;
