/**
 * LES AMBIANCES ET LEUR MODE CLAIR / SOMBRE.
 *
 * Une ambiance répond à « quelles couleurs ? » ; la clarté répond à « clair ou
 * sombre ? ». Ces deux choix sont indépendants. Le mode automatique ne remplace
 * plus l'ambiance : il laisse seulement l'ordinateur décider de la clarté.
 *
 * Les couleurs vivent dans `web/src/styles.css`. Ce catalogue ne garde que les
 * noms, les relations entre variantes et quatre couleurs d'aperçu par palette,
 * copiées des VRAIS jetons de la palette (contrôlé par `scripts/verif-themes.mjs`).
 */

export type ClarteTheme = 'clair' | 'sombre';
export type AmbianceId = 'origine' | 'sable' | 'ardoise' | 'givre' | 'sapin' | 'contraste';

/** La palette réellement posée sur l'écran : six ambiances, deux clartés. */
export type ThemeId =
  | 'sombre'
  | 'clair'
  | 'sable'
  | 'sable-sombre'
  | 'ardoise'
  | 'ardoise-clair'
  | 'givre'
  | 'givre-sombre'
  | 'sapin'
  | 'sapin-clair'
  | 'contraste'
  | 'contraste-sombre';

export type Theme = {
  id: ThemeId;
  ambiance: AmbianceId;
  libelle: string;
  description: string;
  clarte: ClarteTheme;
  plat: boolean;
  /**
   * Fond de page (`--bg`), teinte de la ligne active (`--ligne-active`),
   * accent (`--accent`), texte (`--text`). Ce sont les jetons qui PORTENT
   * l'ambiance : l'orange « en cours », commun aux douze palettes, n'y figure
   * plus — il rendait les six aperçus indiscernables.
   */
  apercu: [string, string, string, string];
};

export type Ambiance = {
  id: AmbianceId;
  libelle: string;
  description: string;
  variantes: Record<ClarteTheme, ThemeId>;
};

export const APPARENCE_PAR_DEFAUT: ThemeId = 'sombre';

/**
 * Les noms historiques sont conservés pour les cinq palettes déjà proposées.
 * Leur variante opposée reçoit un suffixe ; le thème neutre garde les noms
 * `sombre` et `clair`, lus par plusieurs contrôles plus anciens.
 */
export const THEMES: readonly Theme[] = [
  {
    id: 'sombre',
    ambiance: 'origine',
    libelle: 'Origine',
    description: 'Neutre et fidèle au dessin historique de Beluga Build.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(0 0% 0%)', 'hsl(0 0% 18%)', 'hsl(0 0% 100%)', 'hsl(0 0% 100%)'],
  },
  {
    id: 'clair',
    ambiance: 'origine',
    libelle: 'Origine',
    description: 'Neutre et fidèle au dessin historique de Beluga Build.',
    clarte: 'clair',
    plat: false,
    apercu: ['hsl(0 0% 100%)', 'hsl(0 0% 88%)', 'hsl(0 0% 0%)', 'hsl(0 0% 0%)'],
  },
  {
    id: 'sable',
    ambiance: 'sable',
    libelle: 'Sable',
    description: 'Chaud et doux, dans des beiges et des bruns.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(40 27% 91%)', 'hsl(40 24% 84%)', 'hsl(28 30% 22%)', 'hsl(35 22% 15%)'],
  },
  {
    id: 'sable-sombre',
    ambiance: 'sable',
    libelle: 'Sable',
    description: 'Chaud et doux, dans des beiges et des bruns.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(35 18% 9%)', 'hsl(34 17% 27%)', 'hsl(38 70% 68%)', 'hsl(40 24% 94%)'],
  },
  {
    id: 'ardoise',
    ambiance: 'ardoise',
    libelle: 'Ardoise',
    description: 'Calme et feutré, dans des gris bleutés.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(220 14% 11%)', 'hsl(220 13% 28%)', 'hsl(215 20% 95%)', 'hsl(215 20% 95%)'],
  },
  {
    id: 'ardoise-clair',
    ambiance: 'ardoise',
    libelle: 'Ardoise',
    description: 'Calme et feutré, dans des gris bleutés.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(220 18% 93%)', 'hsl(220 15% 79%)', 'hsl(220 45% 28%)', 'hsl(222 24% 13%)'],
  },
  {
    id: 'givre',
    ambiance: 'givre',
    libelle: 'Givre',
    description: 'Froid et lumineux, dans des blancs et des bleus glacés.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(210 30% 94%)', 'hsl(210 22% 80%)', 'hsl(217 70% 38%)', 'hsl(215 35% 12%)'],
  },
  {
    id: 'givre-sombre',
    ambiance: 'givre',
    libelle: 'Givre',
    description: 'Froid et lumineux, dans des blancs et des bleus glacés.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(210 24% 8%)', 'hsl(209 22% 26%)', 'hsl(198 70% 72%)', 'hsl(205 34% 95%)'],
  },
  {
    id: 'sapin',
    ambiance: 'sapin',
    libelle: 'Sapin',
    description: 'Naturel et profond, dans des verts de forêt.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(150 18% 9%)', 'hsl(148 16% 26%)', 'hsl(38 55% 55%)', 'hsl(60 12% 90%)'],
  },
  {
    id: 'sapin-clair',
    ambiance: 'sapin',
    libelle: 'Sapin',
    description: 'Naturel et profond, dans des verts de forêt.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(145 20% 92%)', 'hsl(145 16% 78%)', 'hsl(150 38% 24%)', 'hsl(150 25% 13%)'],
  },
  {
    id: 'contraste',
    ambiance: 'contraste',
    libelle: 'Contraste',
    description: 'Très marqué, pour lire facilement dans les situations difficiles.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(45 6% 92%)', 'hsl(45 10% 78%)', 'hsl(45 15% 10%)', 'hsl(45 10% 4%)'],
  },
  {
    id: 'contraste-sombre',
    ambiance: 'contraste',
    libelle: 'Contraste',
    description: 'Très marqué, pour lire facilement dans les situations difficiles.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(45 8% 4%)', 'hsl(45 7% 26%)', 'hsl(45 15% 96%)', 'hsl(45 10% 98%)'],
  },
];

export const AMBIANCES: readonly Ambiance[] = [
  {
    id: 'origine',
    libelle: 'Origine',
    description: 'Neutre et fidèle au dessin historique de Beluga Build.',
    variantes: { clair: 'clair', sombre: 'sombre' },
  },
  {
    id: 'sable',
    libelle: 'Sable',
    description: 'Chaud et doux, dans des beiges et des bruns.',
    variantes: { clair: 'sable', sombre: 'sable-sombre' },
  },
  {
    id: 'ardoise',
    libelle: 'Ardoise',
    description: 'Calme et feutré, dans des gris bleutés.',
    variantes: { clair: 'ardoise-clair', sombre: 'ardoise' },
  },
  {
    id: 'givre',
    libelle: 'Givre',
    description: 'Froid et lumineux, dans des blancs et des bleus glacés.',
    variantes: { clair: 'givre', sombre: 'givre-sombre' },
  },
  {
    id: 'sapin',
    libelle: 'Sapin',
    description: 'Naturel et profond, dans des verts de forêt.',
    variantes: { clair: 'sapin-clair', sombre: 'sapin' },
  },
  {
    id: 'contraste',
    libelle: 'Contraste',
    description: 'Très marqué, pour lire facilement dans les situations difficiles.',
    variantes: { clair: 'contraste', sombre: 'contraste-sombre' },
  },
];

const ANCIENS_NOMS: Record<string, ThemeId> = { dark: 'sombre', light: 'clair' };

export function themeValide(valeur: unknown): ThemeId {
  if (typeof valeur !== 'string') return APPARENCE_PAR_DEFAUT;
  const nom = valeur.trim().toLowerCase();
  if (THEMES.some((theme) => theme.id === nom)) return nom as ThemeId;
  return ANCIENS_NOMS[nom] ?? APPARENCE_PAR_DEFAUT;
}

export function themeParId(valeur: unknown): Theme {
  const id = themeValide(valeur);
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function ambianceParId(valeur: unknown): Ambiance {
  const id = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  return AMBIANCES.find((ambiance) => ambiance.id === id) ?? AMBIANCES[0];
}

export function themeDeLAmbiance(ambiance: unknown, clarte: ClarteTheme): ThemeId {
  return ambianceParId(ambiance).variantes[clarte];
}

export function estThemeSombre(valeur: unknown): boolean {
  return themeParId(valeur).clarte === 'sombre';
}

export function couleurDeBandeau(valeur: unknown): string {
  return themeParId(valeur).apercu[0];
}

/* ------------------------------------------------------------------ */
/* Le réglage enregistré : ambiance, clarté manuelle, automatique     */
/* ------------------------------------------------------------------ */

export type ReglageApparence = {
  ambiance: AmbianceId;
  /** Le choix à retrouver quand le mode automatique est coupé. */
  clarte: ClarteTheme;
  automatique: boolean;
};

export const REGLAGE_APPARENCE_PAR_DEFAUT: ReglageApparence = {
  ambiance: 'origine',
  clarte: 'sombre',
  automatique: false,
};

/** Ancienne valeur, reconnue pour ne perdre aucun réglage existant. */
export const THEME_SYSTEME = 'systeme';
type ChoixAutomatique = `auto-${AmbianceId}-${ClarteTheme}`;
export type ThemeChoisi = ThemeId | ChoixAutomatique | typeof THEME_SYSTEME;

export function reglageApparenceValide(valeur: unknown): ReglageApparence | null {
  if (typeof valeur !== 'string') return null;
  const nom = valeur.trim().toLowerCase();

  if (nom === THEME_SYSTEME) return { ...REGLAGE_APPARENCE_PAR_DEFAUT, automatique: true };

  const automatique = /^auto-(origine|sable|ardoise|givre|sapin|contraste)-(clair|sombre)$/.exec(nom);
  if (automatique) {
    return {
      ambiance: automatique[1] as AmbianceId,
      clarte: automatique[2] as ClarteTheme,
      automatique: true,
    };
  }

  const ancien = ANCIENS_NOMS[nom] ?? nom;
  const theme = THEMES.find((item) => item.id === ancien);
  return theme ? { ambiance: theme.ambiance, clarte: theme.clarte, automatique: false } : null;
}

export function themeChoisiDepuisReglage(reglage: ReglageApparence): ThemeChoisi {
  const ambiance = ambianceParId(reglage.ambiance).id;
  const clarte: ClarteTheme = reglage.clarte === 'clair' ? 'clair' : 'sombre';
  return reglage.automatique ? `auto-${ambiance}-${clarte}` : themeDeLAmbiance(ambiance, clarte);
}

/** Un choix enregistré, normalisé sans confondre absence et valeur par défaut. */
export function themeChoisiValide(valeur: unknown): ThemeChoisi | null {
  const reglage = reglageApparenceValide(valeur);
  return reglage ? themeChoisiDepuisReglage(reglage) : null;
}

export function themeDuSysteme(ambiance: unknown, systemeSombre: boolean): ThemeId {
  return themeDeLAmbiance(ambiance, systemeSombre ? 'sombre' : 'clair');
}

export type SourceDeTheme = 'projet' | 'general';

export type ThemeApplique = {
  theme: ThemeId;
  source: SourceDeTheme;
  choisi: ThemeChoisi;
  ambiance: AmbianceId;
  clarteChoisie: ClarteTheme;
  clarteAppliquee: ClarteTheme;
  automatique: boolean;
  parLeSysteme: boolean;
  /**
   * LE RÉGLAGE CLAIR / SOMBRE DE L'ORDINATEUR A-T-IL SEULEMENT ÉTÉ LU ?
   *
   * Faux sur un réglage manuel : ni l'heure, ni le coucher du soleil, ni un
   * réglage d'écran ne peuvent alors rien changer. C'est ce drapeau que
   * l'interface lit pour décider de s'ABONNER ou non aux changements du
   * système (`useSystemeSombre`, `web/src/lib/theme.ts`) : une entrée qu'on
   * n'écoute pas ne peut pas faire basculer une page immobile.
   */
  ecouteLeSysteme: boolean;
};

/** Les trois entrées d'où le thème peut venir. */
export type EntreeDeTheme = {
  duProjet?: unknown;
  general?: unknown;
  systemeSombre?: boolean;
};

/** Le projet passe devant le général ; l'ordinateur ne décide que de la clarté. */
export function themeAAppliquer(entree: EntreeDeTheme): ThemeApplique {
  const duProjet = reglageApparenceValide(entree.duProjet);
  const general = reglageApparenceValide(entree.general);
  const reglage = duProjet ?? general ?? REGLAGE_APPARENCE_PAR_DEFAUT;
  const source: SourceDeTheme = duProjet ? 'projet' : 'general';
  const clarteAppliquee: ClarteTheme = reglage.automatique
    ? entree.systemeSombre
      ? 'sombre'
      : 'clair'
    : reglage.clarte;

  return {
    theme: themeDeLAmbiance(reglage.ambiance, clarteAppliquee),
    source,
    choisi: themeChoisiDepuisReglage(reglage),
    ambiance: reglage.ambiance,
    clarteChoisie: reglage.clarte,
    clarteAppliquee,
    automatique: reglage.automatique,
    parLeSysteme: reglage.automatique,
    ecouteLeSysteme: reglage.automatique,
  };
}

/* ------------------------------------------------------------------ */
/* SANS GESTE, L'APPARENCE NE BOUGE PAS — et si elle bouge, on sait   */
/* pourquoi.                                                          */
/* ------------------------------------------------------------------ */

/**
 * CE QU'ON RETIENT D'UNE ENTRÉE QUI REVIENT VIDE.
 *
 * Le réglage vit EN BASE et voyage par le canal temps réel. Une reconnexion,
 * une réponse partielle ou une erreur peuvent le rendre ABSENT quelques
 * instants : le lire alors comme « rien de réglé » ferait retomber l'écran sur
 * le sombre d'origine, puis rebondir sur le vrai thème dès la réponse suivante.
 * Deux bascules, aucun geste. On garde donc le DERNIER CHOIX CONNU tant qu'une
 * valeur lisible ne le remplace pas — absence n'est pas remise à zéro.
 *
 * Rend `undefined` seulement quand rien n'a jamais été connu : c'est alors le
 * défaut qui s'applique, pour la première fois et non en remplacement.
 */
export function apparenceRetenue(dernierConnu: unknown, recue: unknown): unknown {
  if (reglageApparenceValide(recue)) return recue;
  return reglageApparenceValide(dernierConnu) ? dernierConnu : undefined;
}

/** Laquelle des trois entrées a bougé entre deux calculs d'apparence. */
export type CauseDeBascule = 'projet' | 'general' | 'systeme';

/** Le même choix écrit de deux façons ne compte pas pour un changement. */
function memeReglage(avant: unknown, apres: unknown): boolean {
  const un = reglageApparenceValide(avant);
  const deux = reglageApparenceValide(apres);
  if (!un || !deux) return !un && !deux;
  return themeChoisiDepuisReglage(un) === themeChoisiDepuisReglage(deux);
}

/**
 * CE QUI A BOUGÉ, NOMMÉ — la clé pour ne pas re-débattre d'un incident.
 *
 * Le réglage clair / sombre de l'ordinateur n'est retenu comme cause que si
 * l'apparence l'ÉCOUTAIT vraiment : en manuel, il peut basculer autant qu'il
 * veut, il n'explique rien. Une liste vide veut dire « aucune entrée n'a
 * bougé » : si le thème a changé quand même, c'est un défaut, et le rapporter
 * ainsi est justement le but.
 */
export function causeDeLaBascule(avant: EntreeDeTheme, apres: EntreeDeTheme): CauseDeBascule[] {
  const causes: CauseDeBascule[] = [];
  if (!memeReglage(avant.duProjet, apres.duProjet)) causes.push('projet');
  if (!memeReglage(avant.general, apres.general)) causes.push('general');
  const ecoute = themeAAppliquer(apres).ecouteLeSysteme || themeAAppliquer(avant).ecouteLeSysteme;
  if (ecoute && !!avant.systemeSombre !== !!apres.systemeSombre) causes.push('systeme');
  return causes;
}
