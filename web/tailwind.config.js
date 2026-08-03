/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Aucune teinte écrite en dur ailleurs : tout passe par ces noms,
        // déclinés pour les deux thèmes dans styles.css (PLAN §17).
        bg: 'hsl(var(--bg))',
        surface: 'hsl(var(--surface))',
        raised: 'hsl(var(--raised))',
        border: 'hsl(var(--border))',
        text: 'hsl(var(--text))',
        muted: 'hsl(var(--muted))',
        faint: 'hsl(var(--faint))',
        accent: 'hsl(var(--accent))',
        'accent-fg': 'hsl(var(--accent-fg))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        record: 'hsl(var(--record))',
        'record-fg': 'hsl(var(--record-fg))',
      },
      borderRadius: {
        lg: '10px',
        md: '8px',
        sm: '6px',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        // Une feuille qui monte du BAS de l'écran : le geste des fenêtres et des
        // confirmations sur téléphone.
        'slide-sheet': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        // Un halo qui respire : le bouton qui vient de s'allumer attire l'œil
        // sans clignoter — un clignotement franc se lit comme une alarme.
        appel: {
          '0%,100%': { boxShadow: '0 0 0 0 hsl(var(--success) / 0)' },
          '50%': { boxShadow: '0 0 0 5px hsl(var(--success) / 0.35)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
        'slide-in-left': 'slide-in-left 200ms ease-out',
        'slide-sheet': 'slide-sheet 200ms ease-out',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        appel: 'appel 1.8s ease-in-out 3',
      },
    },
  },
  plugins: [],
};
