import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ok: '#16a34a',     // green-600
        warn: '#eab308',   // yellow-500
        err: '#dc2626',    // red-600
      },
    },
  },
  plugins: [],
};

export default config;
