import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    "border-white/8",
    "line-clamp-2",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "monospace"],
        sans: ["'DM Sans'", "sans-serif"],
      },
      colors: {
        ink: {
          DEFAULT: "#0a0a0f",
          soft:    "#12121a",
          muted:   "#1e1e2e",
        },
        signal: {
          DEFAULT: "#00ff9d",
          dim:     "#00cc7d",
          faint:   "rgba(0,255,157,0.08)",
        },
        ash: {
          DEFAULT: "#8b8ba7",
          light:   "#c4c4d4",
        },
      },
    },
  },
  plugins: [],
};
export default config;
