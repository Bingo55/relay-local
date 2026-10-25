/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07080A',
        panel: '#0D0F13',
        panel2: '#12151A',
        cream: '#F3F0E8',
        muted: '#9A9AA5',
        line: 'rgba(255,255,255,0.08)',
        accent: '#F4A261',
        accent2: '#9AE6B4',
        danger: '#FF8F8F',
      },
      fontFamily: {
        display: ['Instrument Serif', 'Iowan Old Style', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: {
        content: '1280px',
      },
      spacing: {
        gutter: 'clamp(20px, 4vw, 48px)',
        section: 'clamp(72px, 9vw, 120px)',
      },
      borderRadius: {
        card: '14px',
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
