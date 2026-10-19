/**
 * UNE SEULE APPARENCE, NOIR ET BLANC, EN DEUX CLARTÉS.
 *
 * L'interface n'a plus d'ambiances colorées : elle est monochrome, et le seul
 * choix qui reste est « clair ou sombre ? » — à la main, ou laissé à
 * l'ordinateur (mode automatique).
 *
 * LES ANCIENS CHOIX SE RELISENT. Dix palettes ont existé (sable, ardoise,
 * givre, sapin, contraste, chacune en clair et en sombre). Un réglage général,
 * ou un repère local qui porte encore l'un de ces noms se
 * lit comme SA CLARTÉ : « sable » devient clair, « sapin » devient sombre. Rien
 * n'est réécrit en base — c'est la lecture qui traduit, et le prochain choix
 * enregistre un nom d'aujourd'hui.
 *
 * Les couleurs vivent dans `web/src/styles.css`. Ce catalogue ne garde que les
 * noms et quatre couleurs d'aperçu par clarté, copiées des VRAIS jetons
 * (contrôlé par `scripts/verif-themes.mjs`).
 */

export type ClarteTheme = 'clair' | 'sombre';
/**
 * L'ambiance n'a plus qu'une valeur. Le type et le champ sont GARDÉS : le
 * réglage enregistré s'écrit toujours « auto-origine-clair », forme que les
 * serveurs déjà en service savent relire.
 */
export type AmbianceId = 'origine';

/** La palette réellement posée sur l'écran. */
export type ThemeId = 'sombre' | 'clair';

export type Theme = {
  id: ThemeId;
  ambiance: AmbianceId;
  libelle: string;
  description: string;
  clarte: ClarteTheme;
  plat: boolean;
  /**
   * Fond de page (`--bg`), teinte de la ligne active (`--ligne-active`),
   * accent (`--accent`), texte (`--text`) : ce qui distingue une clarté de
   * l'autre d'un coup d'œil.
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

export const THEMES: readonly Theme[] = [
  {
    id: 'sombre',
    ambiance: 'origine',
    libelle: 'Sombre',
    description: 'Noir et blanc, sur fond sombre.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(0 0% 13%)', 'hsl(0 0% 19%)', 'hsl(0 0% 96%)', 'hsl(0 0% 93%)'],
  },
  {
    id: 'clair',
    ambiance: 'origine',
    libelle: 'Clair',
    description: 'Noir et blanc, sur fond clair.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(0 0% 100%)', 'hsl(0 0% 93%)', 'hsl(0 0% 5%)', 'hsl(0 0% 5%)'],
  },
];

export const AMBIANCES: readonly Ambiance[] = [
  {
    id: 'origine',
    libelle: 'Noir et blanc',
    description: 'Une seule apparence, en clair ou en sombre.',
    variantes: { clair: 'clair', sombre: 'sombre' },
  },
];

/**
 * LES NOMS D'AVANT, ET LA CLARTÉ QU'ILS AVAIENT. « dark » et « light » datent
 * du tout premier réglage ; les dix autres sont les palettes colorées retirées
 * par la refonte. La table ne s'allège pas : un navigateur resté fermé six mois
 * peut encore présenter l'un de ces noms.
 */
export const ANCIENS_THEMES: Readonly<Record<string, ThemeId>> = {
  dark: 'sombre',
  light: 'clair',
  sable: 'clair',
  'sable-sombre': 'sombre',
  ardoise: 'sombre',
  'ardoise-clair': 'clair',
  givre: 'clair',
  'givre-sombre': 'sombre',
  sapin: 'sombre',
  'sapin-clair': 'clair',
  contraste: 'clair',
  'contraste-sombre': 'sombre',
};

export function themeValide(valeur: unknown): ThemeId {
  if (typeof valeur !== 'string') return APPARENCE_PAR_DEFAUT;
  const nom = valeur.trim().toLowerCase();
  if (THEMES.some((theme) => theme.id === nom)) return nom as ThemeId;
  return ANCIENS_THEMES[nom] ?? APPARENCE_PAR_DEFAUT;
}

export function themeParId(valeur: unknown): Theme {
  const id = themeValide(valeur);
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Une seule ambiance : tout nom présenté, d'hier ou d'aujourd'hui, y mène. */
export function ambianceParId(_valeur?: unknown): Ambiance {
  return AMBIANCES[0];
}

export function themeDeLAmbiance(ambiance: unknown, clarte: ClarteTheme): ThemeId {
  return ambianceParId(ambiance).variantes[clarte];
}

export function estThemeSombre(valeur: unknown): boolean {
  return themeParId(valeur).clarte === 'sombre';
}

/**
 * LA COULEUR DU BANDEAU DU TÉLÉPHONE (`theme-color`), EN HEXADÉCIMAL : le fond de
 * page de la palette. Le catalogue l'écrit en `hsl(…)` à espaces, une syntaxe que
 * tous les navigateurs mobiles ne lisent pas dans `theme-color` ; l'hexadécimal,
 * si (recette ProjetE : fond normalisé avant d'être posé).
 */
export function couleurDeBandeau(valeur: unknown): string {
  return hslEnHexadecimal(themeParId(valeur).apercu[0]);
}

/** `hsl(0 0% 13%)` → `#212121`. Une valeur qui n'est pas un hsl est rendue telle quelle. */
export function hslEnHexadecimal(couleur: string): string {
  const m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(couleur.trim());
  if (!m) return couleur;
  const h = Number(m[1]) % 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const canal = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`;
}

/* ------------------------------------------------------------------ */
/* Le réglage enregistré : clarté manuelle, ou automatique            */
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

  /* « auto-<ambiance>-<clarté> » : l'ambiance d'un ancien réglage est lue puis
     oubliée, seule sa clarté de repli compte encore. */
  const automatique = /^auto-(origine|sable|ardoise|givre|sapin|contraste)-(clair|sombre)$/.exec(nom);
  if (automatique) {
    return { ambiance: 'origine', clarte: automatique[2] as ClarteTheme, automatique: true };
  }

  const ancien = ANCIENS_THEMES[nom] ?? nom;
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

export type SourceDeTheme = 'general';

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

/**
 * Les deux entrées d'où le thème peut venir. Il n'y a PLUS de thème propre à un
 * projet : le réglage général vaut pour tous les projets.
 */
export type EntreeDeTheme = {
  general?: unknown;
  systemeSombre?: boolean;
};

/** Le réglage général seul ; en automatique, c'est l'ordinateur qui choisit la clarté. */
export function themeAAppliquer(entree: EntreeDeTheme): ThemeApplique {
  const general = reglageApparenceValide(entree.general);
  const reglage = general ?? REGLAGE_APPARENCE_PAR_DEFAUT;
  const source: SourceDeTheme = 'general';
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

/** Laquelle des entrées a bougé entre deux calculs d'apparence. */
export type CauseDeBascule = 'general' | 'systeme';

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
  if (!memeReglage(avant.general, apres.general)) causes.push('general');
  const ecoute = themeAAppliquer(apres).ecouteLeSysteme || themeAAppliquer(avant).ecouteLeSysteme;
  if (ecoute && !!avant.systemeSombre !== !!apres.systemeSombre) causes.push('systeme');
  return causes;
}
