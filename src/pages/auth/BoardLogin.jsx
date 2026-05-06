import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

function BoardLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from("admin_users")
      .select(`
        *,
        organizations (
          id,
          name
        )
      `)
      .eq("email", email)
      .single();

    if (error || !data) {
      alert("Invalid email");
      setLoading(false);
      return;
    }

    if (data.password !== password) {
      alert("Incorrect password");
      setLoading(false);
      return;
    }

    if (data.role !== "electoral_board") {
      alert("Unauthorized access");
      setLoading(false);
      return;
    }

    if (data.status !== "active") {
      alert("Account is disabled");
      setLoading(false);
      return;
    }

    // save session
    localStorage.setItem("user", JSON.stringify(data));

    // redirect to board panel
    navigate("/board/dashboard");

    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f3ef]">
      <form
        onSubmit={handleLogin}
        className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-sm"
      >
        <h1 className="text-2xl font-black text-center text-[#ff5a1f]">
          KANDID
        </h1>
        <p className="text-center text-gray-500 text-sm mt-1 mb-6">
          Electoral Board Login
        </p>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            required
            className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            required
            className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-[#ff5a1f]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#ff5a1f] text-white py-3 rounded-xl font-bold hover:bg-[#e24d17] transition"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          For authorized electoral board personnel only.
        </p>
      </form>
    </div>
  );
}

export default BoardLogin;