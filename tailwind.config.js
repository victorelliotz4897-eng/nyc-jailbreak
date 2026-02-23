/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'Courier New'", "Courier", "monospace"],
      },
      animation: {
        blink: "blink 1s step-start infinite",
        "scan-line": "scan-line 3s linear infinite",
        flicker: "flicker 0.15s infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.97" },
          "75%": { opacity: "0.99" },
        },
      },
    },
  },
  plugins: [],
}

