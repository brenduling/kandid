export function getPasswordChecks(password = "") {
  const value = String(password || "");
  return [
    { id: "length", label: "6+ chars", met: value.length >= 6 },
    { id: "letter", label: "Letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "Number", met: /\d/.test(value) },
    { id: "special", label: "Symbol", met: /[^A-Za-z0-9]/.test(value) },
  ];
}

export function isPasswordValid(password = "") {
  return getPasswordChecks(password).every((check) => check.met);
}

export function getPasswordStrength(password = "") {
  const value = String(password || "");
  if (!value) return { label: "Weak", score: 0 };

  let score = 0;
  if (value.length >= 6) score += 1;
  if (value.length >= 10) score += 1;
  if (/[A-Za-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score >= 5) return { label: "Strong", score: 4 };
  if (score >= 4) return { label: "Good", score: 3 };
  if (score >= 3) return { label: "Fair", score: 2 };
  return { label: "Weak", score: 1 };
}

export function getPasswordSecurityMessage(label) {
  if (label === "Strong") return "Strong resistance";
  if (label === "Good") return "Harder to guess";
  if (label === "Fair") return "Could be stronger";
  if (label === "Weak") return "Easy to guess";
  return "Start typing";
}