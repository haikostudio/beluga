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
        info: 'hsl(var(--info))',
        publie: 'hsl(var(--publie))',
        record: 'hsl(var(--record))',
        'record-fg': 'hsl(var(--record-fg))',
        // La convention d'avancement : orange = en cours, bleu = terminé.
        // Une seule source pour toute l'application (styles.css).
        'en-cours': 'hsl(var(--en-cours))',
        termine: 'hsl(var(--termine))',
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
        // Le voile s'efface AVEC le panneau : refermer est un geste, pas une
        // coupure — sans cette sortie, le noir disparaissait d'un coup.
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-up': { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'slide-down': { from: { transform: 'translateY(0)', opacity: '1' }, to: { transform: 'translateY(6px)', opacity: '0' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-out-left': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
        // Une feuille qui monte du BAS de l'écran : le geste des fenêtres et des
        // confirmations sur téléphone.
        'slide-sheet': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'slide-sheet-out': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(100%)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        // Un halo qui respire : le bouton qui vient de s'allumer attire l'œil
        // sans clignoter — un clignotement franc se lit comme une alarme.
        appel: {
          '0%,100%': { boxShadow: '0 0 0 0 hsl(var(--success) / 0)' },
          '50%': { boxShadow: '0 0 0 5px hsl(var(--success) / 0.35)' },
        },
        // Une ligne qui se rappelle à vous : trois oscillations courtes, de
        // faible amplitude. Elle signale, elle ne harcèle pas.
        secousse: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-3px)' },
          '40%': { transform: 'translateX(3px)' },
          '60%': { transform: 'translateX(-2px)' },
          '80%': { transform: 'translateX(2px)' },
        },
        // Une barre d'onde sonore : elle monte et redescend, jamais tout à fait
        // plate — c'est le mouvement, pas la hauteur, qui dit « ça parle ».
        onde: {
          '0%,100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        // La sortie dure autant que l'entrée du panneau qu'elle accompagne :
        // le voile et la feuille doivent partir ensemble.
        'fade-out': 'fade-out 200ms ease-in',
        'slide-up': 'slide-up 160ms ease-out',
        'slide-down': 'slide-down 160ms ease-in',
        'slide-in-left': 'slide-in-left 200ms ease-out',
        'slide-out-left': 'slide-out-left 200ms ease-in',
        'slide-sheet': 'slide-sheet 200ms ease-out',
        'slide-sheet-out': 'slide-sheet-out 200ms ease-in',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        appel: 'appel 1.8s ease-in-out 3',
        // Une seule passe : le motif contient déjà deux allers-retours.
        secousse: 'secousse 420ms ease-in-out 1',
        onde: 'onde 900ms ease-in-out infinite',
      },
    },
  },
  plugins: [
    // « survol » : ce pointeur sait-il survoler ? Même question que REQUETE_SURVOL
    // (shared/src/ouverture-pile.ts). Sert à ne masquer un repère au repos que là
    // où le survol le rend — jamais sur un téléphone, où il resterait introuvable.
    ({ addVariant }) => {
      addVariant('survol', '@media (hover: hover) and (pointer: fine)');
    },
  ],
};
