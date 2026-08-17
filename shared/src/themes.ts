/**
 * LES QUATRE THÈMES DE L'APPLICATION — le catalogue, sans une couleur dedans.
 *
 * L'application n'avait que DEUX apparences, et la bascule était un simple
 * interrupteur « clair / sombre » caché dans le menu trois points du bandeau.
 * Elle en compte désormais QUATRE, choisies dans les réglages :
 *
 *  - « sombre » et « clair » : les deux thèmes d'origine, INCHANGÉS — c'est le
 *    contrat, on ajoute à côté, on ne retouche pas ce que l'utilisateur connaît ;
 *  - « sable » (clair) et « ardoise » (sombre) : deux thèmes FLAT DESIGN, où un
 *    bloc ne se délimite plus par un trait mais par un fond qui contraste
 *    LÉGÈREMENT avec celui qui l'entoure.
 *
 * Ce fichier ne connaît AUCUNE teinte de l'interface : les palettes vivent dans
 * `web/src/styles.css`, un bloc de jetons par thème, et rien d'autre ne les
 * écrit. Il ne garde ici qu'un APERÇU — les quatre pastilles montrées dans les
 * réglages pour reconnaître un thème sans l'appliquer. Un aperçu doit pouvoir
 * s'afficher pendant qu'un AUTRE thème est actif : ses couleurs ne peuvent donc
 * pas venir des jetons, qui ne valent que pour le thème en cours.
 */

/** Le nom retenu d'un thème. Il vit dans les réglages (`prefs.theme`). */
export type ThemeId = 'sombre' | 'clair' | 'sable' | 'ardoise';

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

/** Les quatre thèmes, dans l'ordre où ils s'affichent dans les réglages. */
export const THEMES: readonly Theme[] = [
  {
    id: 'sombre',
    libelle: 'Sombre',
    description: 'Le thème d’origine : noir et anthracite, blocs délimités par un trait.',
    clarte: 'sombre',
    plat: false,
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
