/**
 * LA MÉMOIRE EN ARBRE : UN PROJET HÉRITE DE CE QUE SAIT HAIKODEV.
 *
 * Jusqu'ici, la recherche d'un projet ne regardait que deux corpus : SA
 * documentation, et le POOL des compétences partagées. Tout ce que HaikoDev a
 * appris sur la PLATEFORME — comment une carte vit, ce qu'une publication
 * n'enfreint pas, comment on branche un sous-domaine — restait enfermé dans le
 * dépôt de HaikoDev. Un agent lancé sur un autre projet redécouvrait donc
 * chaque fois des règles déjà écrites, ou pire, les inventait.
 *
 * On ajoute donc une COUCHE AMONT : la documentation de HaikoDev, indexée UNE
 * SEULE FOIS sous son propre corpus, jointe au classement de tous les AUTRES
 * projets. Trois refus tiennent la couche à sa place, et ce sont eux qui
 * empêchent le prompt de gonfler :
 *
 *  1. AUCUN CODE. On ne joint que les DOCUMENTS de HaikoDev (règles, faits,
 *     contrôles, mécaniques). `server/src/passages.ts` d'HaikoDev n'a rien à
 *     apprendre à un agent qui travaille sur un site vitrine.
 *  2. UN RECUL, PAS UNE PRÉFÉRENCE. Un passage amont part avec un malus : à
 *     score voisin, la page du projet COURANT gagne toujours. L'amont ne
 *     remonte que quand il répond NETTEMENT mieux.
 *  3. UNE PART PLAFONNÉE. Comme le code et comme les compétences, l'amont a
 *     droit à sa place mais jamais à celle des règles du projet visé.
 *
 * C'est le « souvenir flou puis précisé » demandé : la recherche ne rapporte
 * qu'un ou deux passages amont, et l'agent qui veut le détail redemande le
 * sujet à `project_memory`, qui remonte alors d'un cran (`detailProjet`).
 *
 * Ce fichier ne connaît ni disque ni base : il ne porte que les règles, et il
 * se teste seul.
 */

/**
 * LE PRÉFIXE D'UNE SOURCE AMONT. Il rend le passage RECONNAISSABLE partout —
 * au classement, au plafond, et sous les yeux de l'agent, qui doit savoir qu'il
 * lit une page d'un AUTRE dépôt et ne pas la chercher chez lui.
 *
 * L'arobase est la même convention que celle du pool (`competences/`) et des
 * identifiants de corpus (`@competences`) : impossible de le confondre avec un
 * chemin réel du projet courant.
 */
export const PREFIXE_SOURCE_AMONT = '@haikodev/';

/** La source d'un fichier amont, telle qu'elle s'affiche : `@haikodev/docs/regles/cartes.md`. */
export function sourceAmont(relatif: string): string {
  return `${PREFIXE_SOURCE_AMONT}${relatif.replace(/^\/+/, '')}`;
}

/** Un passage vient-il de la couche amont ? Reconnu à sa SOURCE, jamais à sa priorité. */
export function estPassageAmont(source: string): boolean {
  return source.startsWith(PREFIXE_SOURCE_AMONT);
}

/** Le chemin réel derrière une source amont, relatif au dépôt de HaikoDev. */
export function cheminDepuisLAmont(source: string): string | undefined {
  if (!estPassageAmont(source)) return undefined;
  return source.slice(PREFIXE_SOURCE_AMONT.length) || undefined;
}

/**
 * LE RECUL APPLIQUÉ À UN PASSAGE AMONT.
 *
 * Volontairement du même ordre que le bonus de priorité d'un document
 * (`BONUS_PRIORITE`, 0,04) : il DÉPARTAGE deux passages proches, il ne renverse
 * pas un classement. Un passage amont qui répond franchement mieux que tout ce
 * que porte le projet courant passe quand même — c'est justement le cas qu'on
 * veut servir.
 *
 * Plus haut, la couche ne remonterait jamais et l'héritage serait décoratif ;
 * plus bas, une règle de plateforme viendrait doubler la page du projet qui dit
 * la même chose en mieux placé.
 */
export const MALUS_AMONT = 0.05;

/**
 * LE SEUIL PROPRE À L'AMONT, ET POURQUOI LE RECUL NE SUFFISAIT PAS.
 *
 * Le recul départage deux passages ; il ne dit rien de ce qui entre quand le
 * projet n'a RIEN à opposer. Or la documentation de HaikoDev est vaste : mesuré,
 * une question naturelle sans un seul mot du corpus du projet y trouvait quand
 * même une règle à 0,25 — bien au-dessus du plancher ordinaire (0,14). Le repli
 * sur l'index de la mémoire, que le projet défend depuis l'audit du 16/08/2026,
 * serait mort de la même mort : quand tout franchit le seuil, plus aucune
 * question ne peut rendre sa place à l'index.
 *
 * Un passage amont doit donc franchir une barre NETTEMENT plus haute que celle
 * d'une page du projet. Le facteur est calibré sur l'écart mesuré entre les deux
 * populations : une question hors vocabulaire ramène l'amont vers 0,25, une
 * question qui appelle vraiment une règle de plateforme la ramène vers 0,60.
 * 2,5 fois le plancher (0,35 par les mots) passe entre les deux.
 *
 * C'est un FACTEUR, pas un nombre absolu : les deux modes de recherche — le sens
 * réel, les mots exacts — n'ont pas la même échelle, et un seuil fixe serait
 * laxiste dans l'un et impitoyable dans l'autre (même raisonnement que
 * `MARGE_SEUIL_SUITE`).
 *
 * Il porte sur le PLANCHER ABSOLU, jamais sur la part du mieux placé : sur un
 * projet neuf, l'amont EST le mieux placé, et se comparer à soi-même
 * s'interdirait de répondre au moment où l'on sert le plus.
 */
export const FACTEUR_SEUIL_AMONT = 2.5;

/** Le score qu'un passage amont doit atteindre, connaissant le plancher absolu. */
export function seuilDeLAmont(plancherAbsolu: number): number {
  return plancherAbsolu * FACTEUR_SEUIL_AMONT;
}

/**
 * LA PART DU BUDGET QUE L'AMONT A LE DROIT DE PRENDRE.
 *
 * Même mécanique que `PART_MAX_DU_CODE` et `PART_MAX_DES_COMPETENCES` : une part
 * RÉSERVÉE — l'héritage a droit à sa place — mais PLAFONNÉE. Un cinquième : la
 * couche amont est un RAPPEL, pas la documentation du projet.
 *
 * Comme pour le code et les compétences, le PREMIER passage amont échappe à la
 * part : une demande qui entre pile dans une règle de plateforme doit la
 * recevoir en entier, même si elle est grosse.
 */
export const PART_MAX_DE_L_AMONT = 0.2;

/** Ce que l'amont a le droit de peser, en jetons, sous un plafond donné. */
export function plafondDeLAmont(plafond: number): number {
  return Math.floor(Math.max(0, plafond) * PART_MAX_DE_L_AMONT);
}

/**
 * LA COUCHE AMONT S'APPLIQUE-T-ELLE ?
 *
 * Deux refus, et un seul oui :
 *  — sur HAIKODEV LUI-MÊME, jamais : sa documentation est déjà son corpus, la
 *    joindre une seconde fois doublerait chaque passage et ferait remonter deux
 *    fois la même règle sous deux noms ;
 *  — sans dépôt amont lisible, jamais non plus : la recherche continue
 *    exactement comme avant, sans rien casser.
 */
export function amontApplicable(options: {
  /** Le chemin du projet visé. */
  projet: string;
  /** Le chemin du dépôt HaikoDev, quand il est connu. */
  amont?: string;
}): boolean {
  const projet = normaliserChemin(options.projet);
  const amont = normaliserChemin(options.amont ?? '');
  if (!projet || !amont) return false;
  return projet !== amont;
}

/** Un chemin comparable : sans barre finale, sans espaces autour. */
function normaliserChemin(chemin: string): string {
  return chemin.trim().replace(/\/+$/, '');
}

/**
 * LE RECUL, APPLIQUÉ AU CLASSEMENT. Le tri est refait : `choisirPassages` prend
 * les passages dans l'ordre où on les lui donne.
 *
 * Rend le tableau tel quel quand aucun passage n'est amont : pas de copie, pas
 * de tri inutile sur les projets qui n'héritent de rien.
 */
export function reculerLAmont<T extends { source: string; score: number }>(classes: T[]): T[] {
  if (!classes.some((passage) => estPassageAmont(passage.source))) return classes;
  return classes
    .map((passage) =>
      estPassageAmont(passage.source) ? { ...passage, score: passage.score - MALUS_AMONT } : passage,
    )
    .sort((a, b) => b.score - a.score);
}

/**
 * LE RAPPEL DE PREMIER NIVEAU, posé sous les passages quand l'amont a servi.
 *
 * Une ligne, pas un sommaire : elle dit d'où viennent ces passages et comment en
 * demander plus. Sans elle, l'agent lirait un chemin `@haikodev/…` qu'il ne
 * trouverait pas dans son dossier et le prendrait pour une erreur.
 *
 * Elle ne part QUE si un passage amont a réellement été retenu : un projet dont
 * la recherche n'a rien remonté d'amont ne paie pas cette ligne.
 */
export function rappelDeLAmont(passages: { source: string }[]): string {
  const sources = new Set(
    passages.map((p) => cheminDepuisLAmont(p.source)).filter((c): c is string => Boolean(c)),
  );
  if (!sources.size) return '';
  return (
    `Les passages marqués « ${PREFIXE_SOURCE_AMONT} » ne sont PAS dans ce dépôt : ils viennent de HaikoDev, ` +
    `la plateforme qui héberge ce projet, et valent pour tous ses projets. ` +
    `Ce sont des RAPPELS, pas le détail : demande le sujet à « project_memory » si tu as besoin de la règle entière.`
  );
}
