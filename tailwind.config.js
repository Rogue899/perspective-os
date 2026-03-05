/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#0a0e0a',
        surface: '#111711',
        border:  '#1e2a1e',
        accent:  '#22c55e',
        dim:     '#6b7280',
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
