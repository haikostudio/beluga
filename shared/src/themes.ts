/**
 * LES SEPT THÈMES DE L'APPLICATION — le catalogue, sans une couleur dedans.
 *
 * L'application n'avait que DEUX apparences, et la bascule était un simple
 * interrupteur « clair / sombre » caché dans le menu trois points du bandeau.
 * Elle en compte désormais SEPT, choisies dans les réglages :
 *
 *  - « sombre » et « clair » : les deux thèmes d'origine — on ajoute à côté, on
 *    ne refait pas ce que l'utilisateur connaît (voir plus bas la seule
 *    exception, la bordure du sombre) ;
 *  - « sable » (clair, beiges chauds) et « ardoise » (sombre, gris bleutés) :
 *    deux premiers thèmes FLAT DESIGN, où un bloc ne se délimite plus par un
 *    trait mais par un fond qui contraste LÉGÈREMENT avec celui qui l'entoure ;
 *  - « givre » (clair, blancs bleutés — le froid qui manquait au sable, chaud),
 *    « sapin » (sombre, verts profonds — le chaud qui manquait à l'ardoise,
 *    froide) et « contraste » (clair, très marqué — pour lire en plein soleil ou
 *    les yeux fatigués) : trois thèmes de plus, MÊME parti pris flat design.
 *
 * Le 17.08.2026, le thème SOMBRE a rejoint les thèmes plats : il gardait seul un
 * trait gris franc là où les trois autres écrans s'étaient déjà débarrassés des
 * contours. Seuls sa bordure et le fond d'un bouton au repos ont changé — aucune
 * autre teinte. Le CLAIR, lui, garde ses traits : c'est le dernier thème à
 * bordures, et c'est voulu.
 *
 * Ce fichier ne connaît AUCUNE teinte de l'interface : les palettes vivent dans
 * `web/src/styles.css`, un bloc de jetons par thème, et rien d'autre ne les
 * écrit. Il ne garde ici qu'un APERÇU — les pastilles montrées dans les
 * réglages pour reconnaître un thème sans l'appliquer. Un aperçu doit pouvoir
 * s'afficher pendant qu'un AUTRE thème est actif : ses couleurs ne peuvent donc
 * pas venir des jetons, qui ne valent que pour le thème en cours.
 */

/**
 * Un thème RÉEL, celui qui finit posé sur l'écran. Il y en a sept, et un de
 * plus se CHOISIT sans en être un (voir `ThemeChoisi` : « systeme » n'a pas de
 * palette, il désigne l'un des sept selon le réglage de l'ordinateur).
 */
export type ThemeId = 'sombre' | 'clair' | 'sable' | 'ardoise' | 'givre' | 'sapin' | 'contraste';

/**
 * CE QU'ON CHOISIT n'est pas toujours un thème : « systeme » est une CONSIGNE —
 * suivre le réglage clair / sombre de l'ordinateur. Séparer les deux notions est
 * ce qui empêche d'aller chercher une palette « systeme » qui n'existe pas.
 */
export const THEME_SYSTEME = 'systeme';
export type ThemeChoisi = ThemeId | typeof THEME_SYSTEME;

/** Ce qu'un thème éclaire : cela décide de `color-scheme` et de la classe `dark`. */
export type ClarteTheme = 'clair' | 'sombre';

export type Theme = {
  id: ThemeId;
  /** Le nom lu à l'écran. */
  libelle: string;
  /** Une ligne qui dit à quoi il ressemble, pour un lecteur non technique. */
  description: string;
  clarte: ClarteTheme;
  /**
   * Vrai pour les thèmes FLAT DESIGN : les bordures y sont ramenées au niveau du
   * fond, la hiérarchie ne tenant plus qu'aux paliers de fond. Sert à le DIRE à
   * l'écran, et au contrôle qui vérifie que ces bordures s'effacent vraiment.
   */
  plat: boolean;
  /**
   * Quatre couleurs CSS pour la pastille d'aperçu, dans cet ordre : le fond de
   * page, le fond d'un bloc, le texte, la couleur d'un travail en cours. Ce sont
   * des COPIES d'aperçu, pas la source des jetons — le contrôle des thèmes
   * vérifie qu'elles ne s'en écartent pas.
   */
  apercu: [string, string, string, string];
};

/**
 * Le thème d'un premier lancement : celui d'avant, pour ne surprendre personne.
 *
 * Il ne s'appelle pas `THEME_PAR_DEFAUT` : ce nom est PRIS par les compétences
 * partagées (`shared/src/competences.ts`), où un « thème » désigne un SUJET de
 * fiche et non une apparence. Deux sens du même mot dans le même paquet.
 */
export const APPARENCE_PAR_DEFAUT: ThemeId = 'sombre';

/** Les sept thèmes, dans l'ordre où ils s'affichent dans les réglages. */
export const THEMES: readonly Theme[] = [
  {
    id: 'sombre',
    libelle: 'Sombre',
    description: 'Le thème d’origine : noir et anthracite. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(0 0% 0%)', 'hsl(0 0% 8%)', 'hsl(0 0% 100%)', 'hsl(38 90% 62%)'],
  },
  {
    id: 'clair',
    libelle: 'Clair',
    description: 'Le thème d’origine en clair : blanc et gris, blocs délimités par un trait.',
    clarte: 'clair',
    plat: false,
    apercu: ['hsl(0 0% 100%)', 'hsl(0 0% 95%)', 'hsl(0 0% 0%)', 'hsl(32 90% 36%)'],
  },
  {
    id: 'sable',
    libelle: 'Sable',
    description: 'Clair et chaud, dans des beiges. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(40 27% 91%)', 'hsl(41 34% 96%)', 'hsl(35 22% 15%)', 'hsl(28 78% 40%)'],
  },
  {
    id: 'ardoise',
    libelle: 'Ardoise',
    description: 'Sombre et doux, dans des gris bleutés. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(220 14% 11%)', 'hsl(220 13% 16%)', 'hsl(215 20% 95%)', 'hsl(36 85% 62%)'],
  },
  {
    id: 'givre',
    libelle: 'Givre',
    description: 'Clair et froid, dans des blancs bleutés. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(210 30% 94%)', 'hsl(210 26% 88%)', 'hsl(215 35% 12%)', 'hsl(30 85% 38%)'],
  },
  {
    id: 'sapin',
    libelle: 'Sapin',
    description: 'Sombre et chaud, dans des verts profonds. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'sombre',
    plat: true,
    apercu: ['hsl(150 18% 9%)', 'hsl(150 15% 14%)', 'hsl(60 12% 90%)', 'hsl(36 80% 58%)'],
  },
  {
    id: 'contraste',
    libelle: 'Contraste',
    description: 'Très marqué, pour lire en plein soleil ou les yeux fatigués. Aucune bordure : les blocs se lisent au fond.',
    clarte: 'clair',
    plat: true,
    apercu: ['hsl(45 6% 92%)', 'hsl(45 6% 97%)', 'hsl(45 10% 4%)', 'hsl(28 100% 30%)'],
  },
];

/**
 * LES ANCIENS NOMS SONT REPRIS, JAMAIS PERDUS. Le réglage enregistré valait
 * « dark » ou « light » : un utilisateur qui avait choisi le clair ne doit pas
 * se réveiller en sombre parce qu'on a renommé les thèmes.
 */
const ANCIENS_NOMS: Record<string, ThemeId> = { dark: 'sombre', light: 'clair' };

/** Le thème désigné par une valeur enregistrée, ou le thème par défaut. */
export function themeValide(valeur: unknown): ThemeId {
  if (typeof valeur !== 'string') return APPARENCE_PAR_DEFAUT;
  const nom = valeur.trim().toLowerCase();
  if (THEMES.some((theme) => theme.id === nom)) return nom as ThemeId;
  return ANCIENS_NOMS[nom] ?? APPARENCE_PAR_DEFAUT;
}

/** La fiche d'un thème, jamais `undefined` : une valeur inconnue rend le défaut. */
export function themeParId(valeur: unknown): Theme {
  const id = themeValide(valeur);
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Ce thème est-il sombre ? C'est ce qui pose la classe `dark` et `color-scheme`. */
export function estThemeSombre(valeur: unknown): boolean {
  return themeParId(valeur).clarte === 'sombre';
}

/**
 * La couleur du bandeau du système sur téléphone (`<meta name="theme-color">`) :
 * le fond de page du thème, sinon la barre d'état du téléphone reste noire
 * au-dessus d'une application beige.
 */
export function couleurDeBandeau(valeur: unknown): string {
  return themeParId(valeur).apercu[0];
}

/* ------------------------------------------------------------------ */
/* « SYSTÈME » : suivre le réglage clair / sombre de l'ordinateur      */
/* ------------------------------------------------------------------ */

/**
 * Les DEUX thèmes que « systeme » désigne : les thèmes d'ORIGINE. C'est ce qu'on
 * attend d'un réglage qui dit « clair » ou « sombre » — pas un beige surprise.
 */
export const THEMES_DU_SYSTEME: { sombre: ThemeId; clair: ThemeId } = { sombre: 'sombre', clair: 'clair' };

/**
 * La fiche du choix « Système », affichée à côté des sept thèmes. Elle n'a pas
 * de palette : son aperçu emprunte une moitié à chacun des deux thèmes qu'elle
 * désigne, ce qui dit à l'œil qu'elle bascule.
 */
export const CHOIX_SYSTEME = {
  id: THEME_SYSTEME,
  libelle: 'Système',
  description: 'Suit le réglage clair / sombre de votre ordinateur : « Sombre » la nuit, « Clair » le jour.',
  apercu: ['hsl(0 0% 0%)', 'hsl(0 0% 100%)', 'hsl(0 0% 8%)', 'hsl(38 90% 62%)'] as [string, string, string, string],
} as const;

/** Tout ce qu'un menu de thème propose : les sept thèmes, puis « Système ». */
export const CHOIX_DE_THEME: readonly {
  id: ThemeChoisi;
  libelle: string;
  description: string;
  apercu: [string, string, string, string];
  /** La clarté du thème désigné, absente pour « Système » qui n'en a pas de fixe. */
  clarte?: ClarteTheme;
}[] = [
  ...THEMES.map((theme) => ({
    id: theme.id as ThemeChoisi,
    libelle: theme.libelle,
    description: theme.description,
    apercu: theme.apercu,
    clarte: theme.clarte,
  })),
  { id: CHOIX_SYSTEME.id, libelle: CHOIX_SYSTEME.libelle, description: CHOIX_SYSTEME.description, apercu: CHOIX_SYSTEME.apercu },
];

/**
 * Un choix enregistré, ramené à quelque chose de connu. Rend `null` — et non le
 * défaut — quand il n'y a RIEN de choisi : c'est ce qui distingue « ce projet
 * n'impose aucun thème » de « ce projet impose le thème sombre ».
 */
export function themeChoisiValide(valeur: unknown): ThemeChoisi | null {
  if (typeof valeur !== 'string') return null;
  const nom = valeur.trim().toLowerCase();
  if (nom === THEME_SYSTEME) return THEME_SYSTEME;
  if (THEMES.some((theme) => theme.id === nom)) return nom as ThemeId;
  return ANCIENS_NOMS[nom] ?? null;
}

/** La fiche d'un choix (thème ou « Système »), pour l'afficher. */
export function choixParId(valeur: unknown): (typeof CHOIX_DE_THEME)[number] | null {
  const id = themeChoisiValide(valeur);
  return id ? CHOIX_DE_THEME.find((choix) => choix.id === id) ?? null : null;
}

/** Le thème que « systeme » désigne, une fois le réglage de l'ordinateur connu. */
export function themeDuSysteme(systemeSombre: boolean): ThemeId {
  return systemeSombre ? THEMES_DU_SYSTEME.sombre : THEMES_DU_SYSTEME.clair;
}

/** D'où vient le thème posé à l'écran — ce qui s'affiche pour l'expliquer. */
export type SourceDeTheme = 'projet' | 'general';

export type ThemeApplique = {
  /** Le thème RÉEL, toujours l'un des sept. */
  theme: ThemeId;
  /** Le PROJET ouvert impose-t-il son thème, ou est-ce le réglage général ? */
  source: SourceDeTheme;
  /** Le choix retenu, tel qu'il a été fait : « systeme » se voit encore ici. */
  choisi: ThemeChoisi;
  /** Vrai quand c'est l'ordinateur qui a tranché entre clair et sombre. */
  parLeSysteme: boolean;
};

/**
 * QUEL THÈME S'APPLIQUE, ET POURQUOI — la seule règle qui en décide.
 *
 * Trois entrées, dans cet ordre de priorité :
 *  1. le thème du PROJET OUVERT, s'il en impose un. C'est tout l'intérêt : on
 *     reconnaît d'un coup d'œil dans quel projet on travaille, et TOUTE
 *     l'interface change, pas seulement la colonne du milieu ;
 *  2. sinon le réglage GÉNÉRAL de l'application ;
 *  3. et si l'un ou l'autre vaut « systeme », le réglage clair / sombre de
 *     l'ordinateur tranche.
 * Un projet sans thème, un réglage général absent : on retombe sur le défaut,
 * jamais sur un vide.
 */
export function themeAAppliquer(entree: {
  duProjet?: unknown;
  general?: unknown;
  systemeSombre?: boolean;
}): ThemeApplique {
  const duProjet = themeChoisiValide(entree.duProjet);
  const general = themeChoisiValide(entree.general);
  const choisi = duProjet ?? general ?? APPARENCE_PAR_DEFAUT;
  const source: SourceDeTheme = duProjet ? 'projet' : 'general';
  if (choisi === THEME_SYSTEME) {
    return { theme: themeDuSysteme(!!entree.systemeSombre), source, choisi, parLeSysteme: true };
  }
  return { theme: choisi, source, choisi, parLeSysteme: false };
}
