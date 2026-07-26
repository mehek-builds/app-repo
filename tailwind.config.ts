import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      // Same pair as the website. The deck still says Geist and is stale; see src/styles/tokens.ts.
      fontFamily: {
        sans: ['Hanken Grotesk Variable', 'Hanken Grotesk', 'sans-serif'],
        mono: ['Azeret Mono Variable', 'Azeret Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // Deck section 04: two radii cover the whole system.
        card: '20px',
        control: '999px',
        inner: '12px',
      },
      colors: {
        gray: {
          50: '#faf9f7',   // surface-alt
          100: '#f1efec',
          200: '#e8e6e1',  // border (site hairline)
          300: '#d8d5ce',
          400: '#a3a19a',  // faint
          500: '#84827b',
          600: '#6b6a64',  // muted
          700: '#4b4a45',
          800: '#2e2d29',
          900: '#1d1c19',
          950: '#12120f',  // ink
        },
        // 600 is the Litos signature blue #6b84e8, not the saturated #3157d5 this shipped with.
        brand: {
          50: '#f7f9ff',
          100: '#eef1fe',  // brand-soft
          200: '#dbe1fb',
          300: '#b9c5f5',
          400: '#95a6ef',
          500: '#7d93eb',
          600: '#6b84e8',  // brand
          700: '#4a61c6',
          800: '#3d51ad',  // brand-ink
        },
        success: {
          50: '#eaf6ee',   // positive-soft
          200: '#b4dcc1',
          600: '#15803d',  // positive
          700: '#116632',
        },
        warning: {
          50: '#fdf3e7',   // warn-soft
          200: '#eccfa4',
          500: '#b45309',  // warn
          700: '#8c4007',
        },
        danger: {
          50: '#fbeaea',   // danger-soft
          200: '#eebcbc',
          600: '#b91c1c',  // danger
          700: '#951616',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-450px 0' },
          '100%': { backgroundPosition: '450px 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.34s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down': 'slide-down 0.24s cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-right': 'slide-in-right 0.26s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
