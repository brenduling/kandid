function StudentLogin() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <h1 className="text-3xl font-bold text-[#a83200] mb-2">
          Student Login
        </h1>
        <p className="text-gray-500 mb-6">
          Enter your student credentials to continue.
        </p>

        <form className="space-y-4">
          <div>
            <label className="text-sm font-semibold">Student ID</label>
            <input
              type="text"
              className="w-full mt-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#a83200]"
              placeholder="Enter student ID"
            />
          </div>

          <div>
            <label className="text-sm font-semibold">Password</label>
            <input
              type="password"
              className="w-full mt-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#a83200]"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-[#a83200] text-white font-bold hover:bg-[#872900]"
          >
            Login as Student
          </button>
        </form>
      </div>
    </div>
  );
}

export default StudentLogin;