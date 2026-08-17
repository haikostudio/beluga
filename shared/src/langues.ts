/**
 * LES CINQ LANGUES DE L'APPLICATION — le catalogue, sans une phrase dedans.
 *
 * L'interface n'existait qu'en FRANÇAIS, écrit à même les écrans. On ne pouvait
 * donc pas montrer HaikoDev à quelqu'un qui ne le parle pas : la moitié de
 * l'écran serait restée illisible. Cinq langues sont désormais offertes — le
 * FRANÇAIS, qui reste la langue d'ORIGINE et la source de tous les textes, plus
 * l'ANGLAIS, l'ESPAGNOL, l'ALLEMAND et le CHINOIS.
 *
 * Ce fichier ne connaît AUCUN texte traduit : les dictionnaires vivent dans
 * `shared/src/traductions.ts`, un bloc par langue, et rien d'autre ne les écrit.
 * Il ne garde ici que l'IDENTITÉ d'une langue — son nom DANS ELLE-MÊME, son code
 * pour l'attribut `lang` de la page, et le sens de son écriture.
 *
 * DEUX PARTIS PRIS, tenus par le contrôle `scripts/verif-langues.mjs` :
 *
 *  1. UNE LANGUE SE NOMME DANS SA PROPRE LANGUE (« Deutsch », « 中文 »), jamais
 *     traduite. C'est la seule façon qu'un menu reste utilisable par quelqu'un
 *     qui ne lit PAS la langue affichée : un germanophone tombé sur une
 *     interface en chinois doit pouvoir retrouver « Deutsch » du regard. Le
 *     libellé d'une langue ne passe donc jamais par le dictionnaire.
 *
 *  2. ON TRADUIT CE QUE L'APPLICATION ÉCRIT, JAMAIS CE QUE LES AGENTS
 *     PRODUISENT. Les réponses d'un agent, les titres et descriptions de cartes,
 *     la mémoire du projet et les documents restent dans la langue où ils ont
 *     été écrits : ce sont des MATIÈRES DE TRAVAIL, les traduire les
 *     dénaturerait. La frontière est mécanique — seul ce qui passe par
 *     `traduire()` change de langue, et rien de ce qui vient de la base ou du
 *     moteur n'y passe.
 */

/** Une langue offerte par l'application. Le français en est la source. */
export type LangueId = 'fr' | 'en' | 'es' | 'de' | 'zh';

/**
 * La langue dans laquelle TOUS les textes de l'application sont ÉCRITS. C'est
 * elle qui sert de CLÉ au dictionnaire : une traduction manquante retombe donc
 * sur du français lisible, jamais sur un vide ni sur un nom de clé.
 */
export const LANGUE_DORIGINE: LangueId = 'fr';

export type Langue = {
  id: LangueId;
  /** Le nom de la langue DANS ELLE-MÊME — jamais traduit (voir en tête). */
  libelle: string;
  /**
   * Le code posé sur `<html lang="…">`. Il commande la coupure des mots, les
   * guillemets du navigateur, la voix de synthèse et les correcteurs
   * d'orthographe : sans lui, un texte chinois se coupe comme du français.
   */
  etiquette: string;
  /**
   * Vrai quand la langue s'écrit SANS espaces entre les mots (le chinois). Les
   * écrans s'en servent pour laisser le navigateur couper n'importe où au lieu
   * d'attendre une espace qui ne viendra jamais.
   */
  sansEspaces: boolean;
  /**
   * LE FORMAT DES DATES, DES HEURES ET DES NOMBRES. Traduire les mots sans
   * traduire les chiffres laisse « 17.08.2026 » au milieu d'une page anglaise,
   * là où on attend « 17/08/2026 ». La RÉGION compte autant que la langue :
   * le français d'ici est SUISSE (`fr-CH`, virgule décimale, date en points),
   * pas celui de France — c'est le format que l'application employait déjà
   * partout, et il ne bouge pas d'un cheveu pour qui reste en français.
   */
  formatRegional: string;
};

/** Les cinq langues, dans l'ordre où elles s'affichent dans le menu. */
export const LANGUES: readonly Langue[] = [
  { id: 'fr', libelle: 'Français', etiquette: 'fr', sansEspaces: false, formatRegional: 'fr-CH' },
  { id: 'en', libelle: 'English', etiquette: 'en', sansEspaces: false, formatRegional: 'en-GB' },
  { id: 'es', libelle: 'Español', etiquette: 'es', sansEspaces: false, formatRegional: 'es-ES' },
  { id: 'de', libelle: 'Deutsch', etiquette: 'de', sansEspaces: false, formatRegional: 'de-CH' },
  { id: 'zh', libelle: '中文', etiquette: 'zh-Hans', sansEspaces: true, formatRegional: 'zh-CN' },
];

/**
 * La langue désignée par une valeur enregistrée, ou la langue d'origine.
 *
 * Elle tolère un code RÉGIONAL (« en-US », « zh-CN », « de-CH ») et n'en garde
 * que la racine : un réglage écrit ainsi ne doit pas retomber en français par
 * surprise. Une valeur inconnue rend le français — jamais un vide.
 *
 * ELLE NE DEVINE RIEN À PARTIR DU NAVIGATEUR, et c'est voulu : le choix de
 * langue suit l'utilisateur comme le thème — il est RETENU, partagé entre le
 * téléphone et l'ordinateur, et ne change JAMAIS tout seul. Sans réglage, c'est
 * le français, la langue d'origine, exactement comme le thème sans réglage est
 * le sombre.
 */
export function langueValide(valeur: unknown): LangueId {
  if (typeof valeur !== 'string') return LANGUE_DORIGINE;
  const brut = valeur.trim().toLowerCase();
  if (!brut) return LANGUE_DORIGINE;
  const racine = brut.split(/[-_]/)[0];
  return LANGUES.some((langue) => langue.id === racine) ? (racine as LangueId) : LANGUE_DORIGINE;
}

/** La fiche d'une langue, jamais `undefined` : une valeur inconnue rend le français. */
export function langueParId(valeur: unknown): Langue {
  const id = langueValide(valeur);
  return LANGUES.find((langue) => langue.id === id) ?? LANGUES[0];
}

/** Le code de l'attribut `lang` de la page, pour la langue en vigueur. */
export function etiquetteDeLangue(valeur: unknown): string {
  return langueParId(valeur).etiquette;
}

/** Le format à donner à `toLocaleDateString` et compagnie, pour cette langue. */
export function formatDeLangue(valeur: unknown): string {
  return langueParId(valeur).formatRegional;
}
