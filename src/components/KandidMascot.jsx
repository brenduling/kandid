const armPaths = {
  guide: ["M31 84 13 78 7 91", "M130 82 145 74 149 62"],
  find: ["M31 85 14 80 8 94", "M130 83 137 72 143 67"],
  know: ["M31 84 17 77 12 90", "M130 83 146 92 151 104"],
  vote: ["M31 85 14 91 9 103", "M130 82 145 77 149 63"],
  keep: ["M31 85 15 82 9 95", "M130 81 145 70 149 55"],
  see: ["M31 82 17 65 9 51", "M130 82 145 65 153 51"],
  protect: ["M31 86 22 101 13 100", "M130 85 144 95 149 89"],
  status: ["M31 85 16 84 9 96", "M130 83 144 76 149 83"],
  receipt: ["M31 85 16 83 9 96", "M130 82 144 69 149 54"],
  inspect: ["M31 86 15 85 9 97", "M130 83 137 73 143 68"],
  close: ["M31 85 15 76 5 80", "M130 83 146 66 153 55"],
};

function MascotProp({ pose }) {
  if (pose === "find" || pose === "inspect") {
    return (
      <g stroke="#17181c" strokeWidth="2.5" fill="none">
        <circle cx="146" cy="53" r="12" />
        <path d="m138 62-9 14" />
      </g>
    );
  }

  if (pose === "know") {
    return (
      <g stroke="#17181c" strokeWidth="1.7">
        <path d="M3 50h31v48H3z" fill="#f8f6f1" />
        <path d="M9 60h19M9 69h15M9 78h19M9 87h12" />
        <path d="M10 59h9" stroke="#f4512c" strokeWidth="2.5" />
      </g>
    );
  }

  if (pose === "guide" || pose === "vote" || pose === "protect") {
    const x = pose === "protect" ? 2 : 136;
    const y = pose === "protect" ? 78 : 35;
    return (
      <g stroke="#17181c" strokeWidth="1.7">
        <path d={`M${x} ${y}h23v36h-23z`} fill="#f8f6f1" />
        <path d={`M${x + 5} ${y + 9}h13M${x + 5} ${y + 17}h13M${x + 5} ${y + 25}h8`} />
        <path d={`M${x + 5} ${y + 9}h7`} stroke="#f4512c" strokeWidth="2.5" />
      </g>
    );
  }

  if (pose === "keep" || pose === "receipt") {
    return (
      <g stroke="#17181c" strokeWidth="1.7">
        <path d="M137 29h21v45h-21z" fill="#f8f6f1" />
        <path d="M142 39h11M142 47h11M142 55h8M142 64h4m3 0h2m3 0h2" />
        <path d="M142 39h7" stroke="#f4512c" strokeWidth="2.5" />
      </g>
    );
  }

  if (pose === "status") {
    return (
      <g stroke="#17181c" strokeWidth="1.7">
        <path d="M135 65h23v32h-23z" fill="#f8f6f1" />
        <path d="m140 80 5 5 9-12" stroke="#f4512c" strokeWidth="2.5" fill="none" />
      </g>
    );
  }

  return null;
}

export function KandidMascot({ pose = "guide", ...svgProps }) {
  const [leftArm, rightArm] = armPaths[pose] || armPaths.guide;
  const smiling = pose === "see" || pose === "close" || pose === "receipt";

  return (
    <svg viewBox="0 0 160 170" fill="none" aria-hidden="true" focusable="false" {...svgProps}>
      <g stroke="#17181c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d={leftArm} />
        <path d={rightArm} />
        <path d="m60 133-8 27-10 2M101 133l10 27 10 2" />
      </g>
      <MascotProp pose={pose} />
      <path d="M80 27 132 57 80 87 28 57Z" fill="#ff744e" />
      <path d="M28 57 80 87v55l-52-31Z" fill="#d94821" />
      <path d="M132 57 80 87v55l52-31Z" fill="#ad310f" />
      <path d="M62 57h36" stroke="#9f2a0a" strokeWidth="5" strokeLinecap="round" />
      <path d="M69 34h23v27H69z" fill="#fffdf8" />
      <g fill="#17181c">
        <path d="M96 93h4v5h-4zM114 88h4v5h-4z" />
      </g>
      <path
        d={smiling ? "M101 108q8 7 15-3" : "M103 108l10-2"}
        stroke="#17181c"
        strokeWidth="2.3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function KandidHeroScene(props) {
  return (
    <svg
      viewBox="0 0 600 360"
      fill="none"
      role="img"
      aria-label="Kandid guides a ballot into a recording chamber and a voting receipt emerges."
      {...props}
    >
      <path d="M322 92h184v195H322z" fill="#17181c" />
      <path d="M343 113h142v153H343z" fill="#f8f6f1" />
      <path d="M358 129h112M358 249h112" stroke="#17181c" strokeWidth="1.5" />
      <path d="M378 149h72v72h-72z" stroke="#17181c" strokeWidth="2" />
      <path d="M392 163h44v44h-44z" fill="#f4512c" />
      <path d="M408 179h12v12h-12z" fill="#17181c" />
      <path d="M322 165h22v55h-22zM484 213h23v43h-23z" fill="#f8f6f1" />
      <path d="M340 185h36M450 185h21v49h23" stroke="#f4512c" strokeWidth="3" />
      <path d="m487 228 7 6-7 6" stroke="#f4512c" strokeWidth="3" />
      <path d="M489 212h78v105h-78z" fill="#f8f6f1" stroke="#17181c" strokeWidth="2" />
      <path d="M500 229h29M500 246h56M500 260h42M500 274h50" stroke="#17181c" strokeWidth="1.5" />
      <path d="M500 291h6v12h-6zM510 291h4v12h-4zM518 291h8v12h-8zM530 291h4v12h-4zM538 291h7v12h-7zM549 291h4v12h-4z" fill="#17181c" />
      <path d="M500 229h15" stroke="#f4512c" strokeWidth="3" />
      <KandidMascot pose="guide" x="18" y="32" width="304" height="304" />
    </svg>
  );
}
