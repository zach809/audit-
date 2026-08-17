import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        ground: "#F7FAFC",
        paper: "#FFFFFF",
        ink: "#082344",
        "ink-2": "#5B6B7F",
        blue: "#255D89",
        "blue-soft": "#D7E2EE",
        "blue-wash": "#EDF3F9",
        rule: "#082344",
        "rule-soft": "#C8D6E4",
        ok: "#247A84",
        late: "#c25410",
        missing: "#B42318",
        waiting: "#5B6B7F",
      },
      borderRadius: {
        none: "0",
        sm: "0",
        DEFAULT: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "0",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "ui-sans-serif", "sans-serif"],
        serif: ["var(--font-newsreader)", "Newsreader", "ui-serif", "serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        stamp: "4px 4px 0 #082344",
      },
    },
  },
  plugins: [],
};

export default config;
