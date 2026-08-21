import React, { useEffect, useState } from "react";
import logo from "../assets/kandidlogo.png";
import "../index.css"; // Ensure splash CSS classes are available

/**
 * SplashScreen displays the Kandid logo with a fade‑in + slight scale animation.
 * It automatically hides after `duration` milliseconds (default 800 ms).
 */
const SplashScreen = ({ duration = 800 }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  if (!visible) return null;

  return (
    <div className="splash-screen flex items-center justify-center bg-black/70 fixed inset-0 z-50">
      <img src={logo} alt="KANDID Logo" className="h-24 w-24 object-contain splashFadeIn" />
    </div>
  );
};

export default SplashScreen;
