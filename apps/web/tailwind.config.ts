import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#0284C7', success: '#16A34A', warning: '#D97706', danger: '#DC2626', ink: '#0F172A'
      },
      // Self-hosted variable font from @fontsource-variable/noto-sans-thai (imported in main.tsx).
      fontFamily: { sans: ['"Noto Sans Thai Variable"', '"Noto Sans Thai"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
} satisfies Config;

