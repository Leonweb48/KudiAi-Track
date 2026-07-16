/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0fdf4",
          100: "#d8f8cc",
          200: "#b2f090",
          400: "#5AC43D",
          500: "#3DA829",
          600: "#2E8020",
          700: "#246618",
          800: "#1a4e12",
          900: "#13380d",
        },
        navy: {
          DEFAULT: "#16255A",
          50:  "#EEF1F9",
          100: "#D5DCF0",
          200: "#99ABDA",
          300: "#5D7AC4",
          400: "#3355A0",
          500: "#16255A",
          600: "#111D46",
          700: "#0C1533",
          800: "#080E21",
          900: "#040710",
        },
        surface: {
          DEFAULT: "#F5F7FA",
          dark:    "#0F172A",
        },
      },
      fontFamily: {
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card:   "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        "card-md": "0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
        hero:   "0 8px 32px rgba(5,150,105,0.30)",
        float:  "0 -4px 24px rgba(0,0,0,0.08)",
        btn:    "0 2px 8px rgba(22,163,74,0.30)",
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "24px",
        "4xl": "32px",
      },
      // ── Semantic colour assignments ───────────────────────────────────────
      // These are naming conventions for Tailwind classes, not extra tokens.
      //
      //  brand (green) → positive / paid / success / brand CTA
      //  indigo        → PARTIAL / IN-PROGRESS — app-wide convention.
      //                  Use for any "started but not complete" state:
      //                  partially_paid invoices, partial disbursements, etc.
      //                  badge:   bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400
      //                  stripe:  bg-indigo-500
      //                  bar:     bg-indigo-500
      //  blue          → informational / sent / transient states
      //  amber         → WARNING SURFACES ONLY. Never for status chips or badges.
      //  red           → error / overdue / destructive actions
      //  slate         → neutral / draft / disabled / cancelled / secondary text

      // ── Z-index token scale ───────────────────────────────────────────────
      // Tier order (ascending):
      //   content(0) < sticky(30) < nav(40) < floating(55) < sheet(60) <
      //   sub-sheet(70) < modal(100) < lock(200) < pin-auth(210) <
      //   card-detail(260) < pin-scrim(300) < pin-sheet(301) < toast(400)
      // No ad-hoc z-[N] values outside this scale.
      // CSS custom-property mirrors live in src/index.css (--z-*).
      zIndex: {
        "sticky":      "30",
        "nav":         "40",
        "floating":    "55",
        "sheet":       "60",
        "sub-sheet":   "70",
        "modal":       "100",
        "lock":        "200",
        "pin-auth":    "210",
        "card-detail": "260",
        "pin-scrim":   "300",
        "pin-sheet":   "301",
        "toast":       "400",
        "tooltip":     "9999",
      },
      animation: {
        "fade-up":   "fadeUp 0.3s ease-out",
        "fade-in":   "fadeIn 0.2s ease-out",
        "pulse-slow":"pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%":   { opacity: 0, transform: "translateY(10px)" },
          "100%": { opacity: 1, transform: "translateY(0)"    },
        },
        fadeIn: {
          "0%":   { opacity: 0 },
          "100%": { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
