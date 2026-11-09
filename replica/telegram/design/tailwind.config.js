// Maps tokens.css custom properties into Tailwind (web). For Expo use NativeWind with the same config.
const c = (n) => `var(--color-${n})`;
module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: Object.fromEntries(
        ["bg","surface","border","border-input","text","text-muted","accent","on-accent",
         "bubble-in","on-bubble-in","bubble-out","on-bubble-out","meta-out",
         "badge","on-badge","badge-muted","danger","success","online"].map((n) => [n, c(n)])),
      fontFamily: { sans: "var(--font-sans)" },
      borderRadius: { sm: "6px", md: "12px", bubble: "18px", lg: "20px" },
      fontSize: {
        xs: ["12px", "16px"], sm: ["14px", "20px"], base: ["16px", "22px"],
        lg: ["18px", "24px"], xl: ["24px", "30px"], display: ["32px", "38px"],
      },
      spacing: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 12: "48px" },
    },
  },
};
