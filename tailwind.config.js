/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // FastClient pure dark palette
        fast: {
          dark: "#090B0E",        // App background - ultra-dark black
          canvas: "#0D0F12",      // Main content canvas - deep charcoal
          card: "#13161C",        // Cards & containers
          card2: "#161922",       // Secondary card surface
          border: "rgba(255,255,255,0.08)",
          borderSoft: "rgba(255,255,255,0.04)",
          text: "#ffffff",
          textSub: "#a1a1aa",
          textMuted: "#71717a",
          accent: "#e06b22",      // Vibrant warm orange/amber
          accent2: "#c85108",
          accentText: "#ffffff",
          danger: "#ef4444",
          success: "#22c55e",
          warn: "#f59e0b",
        },
        // Legacy brand token remapped to FastClient dark so all existing
        // `xryloth-*` utility classes render correctly in the new theme.
        xryloth: {
          50: "#f5f6f7",
          100: "#e4e4e7",
          200: "#d4d4d8",
          300: "#a1a1aa",
          400: "#a1a1aa",   // secondary text
          500: "#e06b22",   // primary accent
          600: "#c85108",
          700: "#9a4a12",
          800: "#13161C",   // dark surface
          900: "#0D0F12",   // deep charcoal
          950: "#090B0E",   // ultra-dark app bg
          accent_text: "#ffffff",
        },
        glass: {
          50: "rgba(255, 255, 255, 0.03)",
          100: "rgba(255, 255, 255, 0.05)",
          200: "rgba(255, 255, 255, 0.08)",
        },
      },
      backdropBlur: {
        xs: "2px",
        md: "12px",
      },
      boxShadow: {
        "fast-glow": "0 0 20px rgba(224, 107, 34, 0.25)",
        "fast-card": "0 8px 32px rgba(0, 0, 0, 0.4)",
        "fast-inset": "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        "xryloth-glow": "0 0 20px rgba(224, 107, 34, 0.3), 0 0 45px rgba(224, 107, 34, 0.1)",
        "xryloth-glow-hover": "0 0 26px rgba(224, 107, 34, 0.45), 0 0 60px rgba(224, 107, 34, 0.15)",
      },
      borderRadius: {
        "xl": "16px",
        "2xl": "24px",
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
