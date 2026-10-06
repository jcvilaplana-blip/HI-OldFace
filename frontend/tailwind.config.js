/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        oldface: {
          50:  '#F3F8FA',
          100: '#E3EDF2',   // fondo claro
          200: '#98C1D9',   // azul cielo
          300: '#7AA3BD',
          400: '#4E7D96',   // azul acero (cabeceras)
          500: '#3D5A80',   // PRIMARIO
          600: '#34506F',
          700: '#293241',   // azul pizarra (textos)
          800: '#1D2433',
          900: '#0A0D25',   // casi negro
        },
        accent: {
          DEFAULT: '#EE6C4D', // naranja de acción (botón +, avisos)
          light:   '#FF844B',
        },
        ice: '#E0FBFC'
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
