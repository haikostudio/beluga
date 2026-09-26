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
        // Le contenu NEUF d'un prompt envoyé (facturé), face au gris du
        // contenu déjà présent (`--faint`) — un jaune franc, distinct de
        // l'orange d'avertissement (`warning`) et de l'orange d'avancement
        // (`en-cours`), pour ne pas emprunter leur sens.
        nouveau: 'hsl(var(--nouveau))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',
        publie: 'hsl(var(--publie))',
        record: 'hsl(var(--record))',
        'record-fg': 'hsl(var(--record-fg))',
        // La convention d'avancement : orange = en cours, bleu = terminé.
        // Une seule source pour toute l'application (styles.css).
        'en-cours': 'hsl(var(--en-cours))',
        termine: 'hsl(var(--termine))',
        // La frise des cartes et la barre d'étapes du tiroir, seulement : le
        // jaune qui scintille pendant le travail d'un agent (styles.css).
        travail: 'hsl(var(--travail))',
        'termine-fg': 'hsl(var(--termine-fg))',
        // Le gris propre au cadre d'un plan : il se repère dans le fil sans
        // emprunter une couleur d'état (styles.css).
        'fond-plan': 'hsl(var(--fond-plan))',
        // Le voile qui assombrit la page derrière une fenêtre ou un tiroir. Il
        // s'écrit toujours avec sa part (`bg-voile/70`) : le jeton ne porte que
        // la teinte, chaque endroit garde son opacité.
        voile: 'hsl(var(--voile))',
        // Le texte lisible SUR une couleur d'état (bouton rouge, badge orange).
        'sur-etat': 'hsl(var(--sur-etat))',
        // L'onglet actif du menu du bas, sur téléphone : un repère de navigation,
        // jamais un état d'avancement.
        actif: 'hsl(var(--actif))',
        'actif-fg': 'hsl(var(--actif-fg))',
        // Le fond d'un bouton « contour » au repos. Transparent dans les deux
        // thèmes d'origine, un voile translucide dans les thèmes plats, où la
        // bordure ne dessine plus rien. Son alpha vit DANS le jeton : on n'écrit
        // jamais `bg-controle/50`, qui produirait un `hsl()` invalide.
        controle: 'hsl(var(--controle))',
        // Le fond de la ligne du projet OUVERT, colonne de gauche : distinct du
        // fond de page et du survol dans les quatre thèmes (styles.css).
        'ligne-active': 'hsl(var(--ligne-active))',
        // Le fond du bandeau d'étape sous une carte (chronomètre, étape en
        // cours) : distinct du corps de la carte et de la colonne, sans trait.
        'bandeau-etape': 'hsl(var(--bandeau-etape))',
        // Le fond du bloc des étapes collé au-dessus du composeur (étape en
        // cours, décompte des tâches, temps) : distinct de la conversation
        // qu'il porte tantôt sur bg, tantôt sur surface (styles.css).
        'bloc-etapes': 'hsl(var(--bloc-etapes))',
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
        // LES DEUX RYTHMES DE LA FRISE : le jaune du travail SCINTILLE (vif,
        // irrégulier, un halo qui s'allume) ; le bleu « fini, à voir »
        // CLIGNOTE (lent, franc, allumé/éteint). Jamais le même battement :
        // on distingue d'un coup d'œil « ça travaille » de « ça vous attend ».
        scintille: {
          '0%,100%': { opacity: '1', boxShadow: '0 0 0 0 hsl(var(--travail) / 0)' },
          '25%': { opacity: '0.55', boxShadow: '0 0 4px 1px hsl(var(--travail) / 0.7)' },
          '40%': { opacity: '1', boxShadow: '0 0 6px 2px hsl(var(--travail) / 0.55)' },
          '60%': { opacity: '0.7', boxShadow: '0 0 2px 0 hsl(var(--travail) / 0.3)' },
        },
        clignote: { '0%,45%': { opacity: '1' }, '55%,95%': { opacity: '0.15' }, '100%': { opacity: '1' } },
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
        // Le compte à rebours d'un message d'information : la barre se vide
        // en 10 secondes, la durée exacte de `DUREE_MESSAGE_MS`.
        'barre-message': { from: { transform: 'scaleX(1)' }, to: { transform: 'scaleX(0)' } },
        // Le battement d'une SILHOUETTE de contenu (skeleton) : une respiration
        // lente et faible, qui dit « ça arrive » sans attirer l'œil comme une
        // alerte. Jamais un balayage brillant, qui trancherait sur un fond noir.
        silhouette: { '0%,100%': { opacity: '0.5' }, '50%': { opacity: '0.85' } },
        // LA BARRE DU CADRAGE QUAND ON NE PEUT PAS LA CHIFFRER : un tiers de
        // barre qui traverse. C'est un TÉMOIN DE TRAVAIL — il dit « ça
        // réfléchit », pas « c'est à tel pourcentage » — et il ne s'éteint donc
        // pas avec « moins d'animations », comme la roue et l'arc de l'agent.
        'cadrage-glisse': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
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
        scintille: 'scintille 0.9s ease-in-out infinite',
        clignote: 'clignote 1.4s ease-in-out infinite',
        appel: 'appel 1.8s ease-in-out 3',
        // Une seule passe : le motif contient déjà deux allers-retours.
        secousse: 'secousse 420ms ease-in-out 1',
        onde: 'onde 900ms ease-in-out infinite',
        'barre-message': 'barre-message 10000ms linear forwards',
        silhouette: 'silhouette 1.4s ease-in-out infinite',
        'cadrage-glisse': 'cadrage-glisse 1.6s ease-in-out infinite',
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
