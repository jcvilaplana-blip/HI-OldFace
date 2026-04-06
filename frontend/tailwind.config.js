/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        oldface: {
          50:  '#e6e6ff',
          100: '#b3b3ff',
          200: '#8080ff',
          300: '#4d4dff',
          400: '#1a1aff',
          500: '#000080',
          600: '#000066',
          700: '#00004d',
          800: '#000033',
          900: '#00001a',
        }
      },
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
      animation: {
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.3s ease-out',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'bounce-gentle': 'bounceGentle 0.6s ease-in-out',
        'pulse-ring': 'pulseRing 1.5s ease-out infinite',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(100%)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 }
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 }
        },
        scaleIn: {
          from: { transform: 'scale(0.8)', opacity: 0 },
          to: { transform: 'scale(1)', opacity: 1 }
        },
        bounceGentle: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' }
        },
        pulseRing: {
          '0%': { transform: 'scale(1)', opacity: 0.8 },
          '100%': { transform: 'scale(1.8)', opacity: 0 }
        }
      }
    }
  },
  plugins: []
};
