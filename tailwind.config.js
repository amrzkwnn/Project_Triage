/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        canvas: '#F7F8FA',
        surface: '#FFFFFF',
        ink: '#0F172A',
        muted: '#64748B',
        faint: '#94A3B8',
        line: '#E7EAF0',
        brand: {
          DEFAULT: '#0F766E',
          deep: '#115E59',
          bright: '#0D9488',
          soft: '#CCFBF1',
          wash: '#F0FDFA',
        },
      },
      borderRadius: {
        card: '16px',
        chip: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)',
        lift: '0 2px 4px rgba(15,23,42,0.05), 0 12px 28px rgba(15,23,42,0.10)',
        pill: '0 1px 3px rgba(15,23,42,0.10)',
        phone:
          '0 10px 24px rgba(15,23,42,0.14), inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
    },
  },
  plugins: [],
};
