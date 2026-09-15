import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

function OfficerLogin() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          Officer Login
        </h1>
        <p className="text-gray-500 mb-6">
          Access the election management portal.
        </p>

        <form className="space-y-4">
          <div>
            <label className="text-sm font-semibold">Email</label>
            <input
              type="email"
              className="w-full mt-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-700"
              placeholder="Enter email"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Password</label>
            <div className="student-auth-password mt-1">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-700"
                placeholder="Enter password"
              />
              <button
                type="button"
                className="student-auth-eye-btn"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-gray-800 text-white font-bold hover:bg-gray-700"
          >
            Login as Officer
          </button>
        </form>
      </div>
    </div>
  );
}

export default OfficerLogin;
