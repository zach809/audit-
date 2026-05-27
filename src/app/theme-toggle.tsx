"use client";

import { useEffect, useState } from "react";

type Theme = "day" | "night";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("cwca-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("night");

  useEffect(() => {
    const saved = window.localStorage.getItem("cwca-theme");
    const nextTheme: Theme = saved === "day" ? "day" : "night";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const nextTheme = theme === "night" ? "day" : "night";

  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      className="theme-toggle"
      onClick={() => {
        setTheme(nextTheme);
        applyTheme(nextTheme);
      }}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb" />
      </span>
      <span>{theme === "night" ? "Night" : "Day"}</span>
    </button>
  );
}
