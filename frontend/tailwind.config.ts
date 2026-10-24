import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EAF6EE",
          100: "#D3EFDD",
          200: "#A7DFBB",
          500: "#00A63E",
          600: "#009236",
          700: "#00782D"
        },
        badge: {
          orangeBg: "#FFF3E5",
          orangeText: "#D9480F",
          grayBg: "#F3F4F6",
          grayText: "#4B5563",
          redBg: "#FEE2E2",
          redText: "#DC2626"
        },
        surface: {
          DEFAULT: "#FFFFFF",
          subtle: "#F9FAFB",
          input: "#F4F5F6",
          hover: "#F3F4F6"
        }
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        pixel: ["Silkscreen", "Pixelify Sans", "monospace"]
      },
      borderRadius: {
        card: "12px",
        input: "8px",
        pill: "9999px"
      }
    }
  },
  plugins: []
};

export default config;
