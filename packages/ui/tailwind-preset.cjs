/** Общий Tailwind-пресет: токены дизайн-системы «Calm Security» */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: { xs: '480px', sm: '640px', md: '768px', lg: '1024px', xl: '1440px' },
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        fg: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--text-muted) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-2': 'rgb(var(--primary-2) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'primary-fg': 'rgb(var(--primary-fg) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      borderRadius: { input: '8px', btn: '14px', card: '22px' },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.05), 0 6px 18px rgba(16,24,40,.06)',
        glow: '0 0 0 1px rgb(var(--primary) / .35), 0 8px 30px rgb(var(--primary) / .25)',
      },
      transitionTimingFunction: { soft: 'cubic-bezier(.2,.8,.2,1)' },
      keyframes: {
        'pulse-ring': { '0%': { transform: 'scale(.9)', opacity: '.7' }, '100%': { transform: 'scale(1.5)', opacity: '0' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'pulse-ring': 'pulse-ring 1.8s cubic-bezier(.2,.8,.2,1) infinite', 'fade-up': 'fade-up .25s cubic-bezier(.2,.8,.2,1) both' },
    },
  },
};
