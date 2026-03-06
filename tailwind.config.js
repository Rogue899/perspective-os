/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        border:  'rgb(var(--color-border) / <alpha-value>)',
        accent:  'rgb(var(--color-accent) / <alpha-value>)',
        dim:     'rgb(var(--color-dim) / <alpha-value>)',
        // Bias colors
        right:   '#ef4444',
        left:    '#3b82f6',
        state:   '#8b5cf6',
        gulf:    '#f59e0b',
        center:  '#6b7280',
        osint:   '#06b6d4',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        marquee: 'marquee 40s linear infinite',
      },
      keyframes: {
        marquee: {
          '0%':   { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    }
  },
  plugins: []
}
