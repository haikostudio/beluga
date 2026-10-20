import type { MessageLlm } from './relais-llm.js';

/**
 * LE TITRE CLAIR D'UNE UNITÉ DE MÉMOIRE — pour la personne, pas pour l'agent.
 *
 * Chaque unité garde son titre technique (`titre`, écrit par et pour les
 * agents : il sert au dédoublonnage, à la recherche plein texte et au contexte
 * des moteurs — il ne bouge pas). Elle reçoit EN PLUS un titre en mots courants
 * (`titreHumain`), écrit une fois pour toutes, que l'écran affiche en premier
 * (décision de l'utilisateur, carte 79083bc5).
 *
 * Il vient de l'agent qui propose l'unité (champ facultatif « titre_humain »),
 * sinon d'un petit modèle, par lots, en tâche de fond
 * (`server/src/titres-humains.ts`). Ici : la règle de ce qu'on accepte, la
 * demande au modèle et la lecture TOLÉRANTE de sa réponse.
 */

export const TITRE_HUMAIN_MOTS_MIN = 2;
export const TITRE_HUMAIN_MOTS_MAX = 12;
export const TITRE_HUMAIN_MAX = 90;
/** Combien d'unités partent dans un même appel au modèle. */
export const LOT_DE_TITRES_HUMAINS = 50;

/** Ce qui trahit du code, pas des mots courants : un fichier, un symbole, une commande. */
const TRACES_DE_CODE: readonly RegExp[] = [
  /`/,
  /\b[\w-]+\.(ts|tsx|js|mjs|cjs|json|md|sh|py|sql|css|html|yml|yaml|env|db)\b/i,
  /\w_\w/,
  /\b(?!(?:iPhone|iPad|iOS|macOS|eSIM)\b)[A-Za-z]*[a-z][A-Z]/,
  /\(\)|=>|::|--|\{|\}|<|>/,
  /(^|\s)\/[\w.-]+\//,
];

/**
 * Un titre clair acceptable, nettoyé — ou `''` s'il n'en est pas un (trop
 * court, trop long, ou du code). Les guillemets d'encadrement et le point final
 * tombent ; la première lettre passe en capitale.
 */
export function titreHumainPropre(brut: unknown): string {
  let titre = String(brut ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«“\s]+|["'»”\s]+$/g, '')
    .replace(/[.;:,\s]+$/, '')
    .trim();
  if (!titre) return '';
  titre = titre.charAt(0).toLocaleUpperCase('fr') + titre.slice(1);
  const mots = titre.split(' ').filter(Boolean);
  if (mots.length < TITRE_HUMAIN_MOTS_MIN || mots.length > TITRE_HUMAIN_MOTS_MAX) return '';
  if (titre.length > TITRE_HUMAIN_MAX) return '';
  if (TRACES_DE_CODE.some((m) => m.test(titre))) return '';
  return titre;
}

export interface UniteATitrer {
  id: string;
  titre: string;
  resume: string;
}

/** La consigne : 4 à 9 mots, français courant, ce que ça fait pour l'utilisateur, aucun nom technique. */
export const CONSIGNE_TITRES_HUMAINS = [
  'Tu écris des titres pour une personne qui ne programme pas et parcourt la mémoire d’un logiciel.',
  'Pour chaque élément, écris UN titre de 4 à 9 mots, en français courant, qui dit ce que ça fait ou à quoi ça sert pour l’utilisateur du produit.',
  'Interdits : noms de fichiers, de fonctions, de variables, de commandes, de technologies ou de services techniques, sigles techniques, guillemets, point final.',
  'Commence par une majuscule. Pas de verbe à l’infinitif en tête si un nom suffit. Ne recopie pas le titre technique.',
  'Réponds UNIQUEMENT par un tableau JSON : [{"id": "MEM-0001", "titre": "…"}, …], un objet par élément, dans le même ordre.',
].join('\n');

/** La demande au modèle pour un lot d'unités (le résumé est coupé : le titre n'en dit pas plus). */
export function demandeDeTitresHumains(unites: readonly UniteATitrer[]): MessageLlm[] {
  const elements = unites.map((u) => ({ id: u.id, titre_technique: u.titre, resume: u.resume.slice(0, 320) }));
  return [
    { role: 'system', content: CONSIGNE_TITRES_HUMAINS },
    { role: 'user', content: JSON.stringify(elements) },
  ];
}

/**
 * Lit la réponse du modèle : le tableau JSON entre le premier « [ » et le
 * dernier « ] », chaque titre passé au crible de `titreHumainPropre`. Un id
 * inconnu ou un titre refusé est simplement absent du résultat.
 */
export function lireTitresHumains(texte: string, idsAttendus: ReadonlySet<string>): Map<string, string> {
  const resultat = new Map<string, string>();
  const debut = texte.indexOf('[');
  const fin = texte.lastIndexOf(']');
  if (debut < 0 || fin <= debut) return resultat;
  let brut: unknown;
  try {
    brut = JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return resultat;
  }
  if (!Array.isArray(brut)) return resultat;
  for (const entree of brut) {
    if (!entree || typeof entree !== 'object') continue;
    const id = String((entree as Record<string, unknown>).id ?? '').trim().toUpperCase();
    if (!idsAttendus.has(id) || resultat.has(id)) continue;
    const titre = titreHumainPropre((entree as Record<string, unknown>).titre);
    if (titre) resultat.set(id, titre);
  }
  return resultat;
}

/** Le titre à montrer à une personne : le clair s'il existe, sinon le technique. */
export function titreAffiche(u: { titre: string; titreHumain?: string | null }): string {
  return u.titreHumain?.trim() || u.titre;
}
