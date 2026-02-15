import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        nq: {
          // Peanut.me inspired colors
          pink: '#FF90E8',
          'pink-light': '#FFB6C1',
          'pink-dark': '#E91E8C',
          yellow: '#FFC900',
          'yellow-light': '#FEF3C7',
          periwinkle: '#8B8BF5',
          'periwinkle-light': '#C4C4FC',
          purple: '#6340DF',
          cream: '#FAF4F0',
          black: '#000000',
          white: '#FFFFFF',
        },
        // Keep nimiq for backwards compatibility
        nimiq: {
          blue: '#1F2348',
          gold: '#E9B213',
          light: '#F5F5F5',
        },
      },
      fontFamily: {
        display: [
          'Impact',
          'Haettenschweiler',
          'Franklin Gothic Bold',
          'Charcoal',
          'Helvetica Inserat',
          'Bitstream Vera Sans Bold',
          'Arial Black',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderWidth: {
        '3': '3px',
      },
      borderRadius: {
        'sm': '2px',  // Peanut's minimal radius
        'pill': '9999px',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'nq': '4px 4px 0 0 #000000',
        'nq-sm': '2px 2px 0 0 #000000',
        'nq-lg': '6px 6px 0 0 #000000',
        'nq-hover': '6px 6px 0 0 #000000',
      },
    },
  },
  plugins: [],
};

export default config;
