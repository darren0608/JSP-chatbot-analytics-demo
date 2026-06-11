import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a1915",
        paper: "#faf9f5",
        accent: "#c96442",
      },
    },
  },
  plugins: [],
};
export default config;
