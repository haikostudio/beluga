/**
 * SERVIR LA MÉMOIRE AU POIDS DE LA DEMANDE, PAS AU POIDS DU FICHIER.
 *
 * `project_memory` rend les règles d'un sujet. Jusqu'ici, dès qu'un MOT du sujet
 * apparaissait dans la demande, le fichier ENTIER partait : « détail de carte »
 * emportait les 36 000 signes de `docs/regles/cartes.md`, « tiroir » les 31 000
 * de `interface.md` — 18 000 jetons pour deux invariants qui en pèsent 400. Sur
 * une tâche qui interroge la mémoire trois ou quatre fois, la mémoire coûtait
 * plus cher que tout le reste du contexte réuni.
 *
 * D'où la règle de ce module, qui ne connaît ni disque ni base :
 *
 *   — un sujet NOMMÉ (« publication », « cartes ») est un choix explicite de
 *     l'agent : on lui rend le fichier entier, il l'a demandé ;
 *   — des MOTS-CLÉS ne demandent pas un fichier, ils décrivent un besoin : on ne
 *     rend que les règles qui parlent de ces mots, les mieux placées d'abord,
 *     sous un plafond de signes.
 *
 * Et ce qui est ÉCARTÉ est NOMMÉ, avec la façon de l'obtenir en entier : un
 * plafond silencieux se lit comme une réponse complète, et l'agent conclurait
 * sur une règle qu'il n'a jamais vue.
 */

/** Ce qu'un sujet rend au plus quand la demande n'est faite que de mots-clés. */
export const PLAFOND_EXTRAIT_SIGNES = 6000;

/** Combien de sujets au plus s'ouvrent sur une demande en mots-clés. */
export const SUJETS_PAR_MOTS_MAX = 2;

/** Une règle retenue, avec ce qui l'a fait retenir. */
export interface RegleClassee {
  texte: string;
  /** Combien de mots de la demande apparaissent dans la règle. */
  touches: number;
}

/** Ce qu'un sujet rend : les règles gardées, et le compte de celles écartées. */
export interface ExtraitDeSujet {
  gardees: string[];
  ecartees: number;
}

/**
 * Les mots utiles d'une demande : au-delà de trois lettres, sans doublon. Les
 * mots courts (« de », « la », « un ») apparaissent partout et ne classent rien.
 */
export function motsDeLaRequete(requete: string): string[] {
  const mots = requete
    .trim()
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9/]+/i)
    .filter((mot) => mot.length > 3);
  return [...new Set(mots)];
}

/**
 * Les règles qui parlent d'au moins un mot de la demande, les mieux servies
 * d'abord. On ne trie PAS sur la longueur : une règle courte qui touche trois
 * mots vaut mieux qu'un pavé qui en touche un. À égalité, l'ordre du fichier est
 * gardé — c'est celui dans lequel les règles ont été écrites.
 */
export function classerRegles(regles: string[], requete: string): RegleClassee[] {
  const mots = motsDeLaRequete(requete);
  if (!mots.length) return [];
  return regles
    .map((texte, rang) => {
      const minuscule = texte.toLowerCase();
      return { texte, rang, touches: mots.filter((mot) => minuscule.includes(mot)).length };
    })
    .filter((regle) => regle.touches > 0)
    .sort((a, b) => b.touches - a.touches || a.rang - b.rang)
    .map(({ texte, touches }) => ({ texte, touches }));
}

/**
 * L'extrait d'un sujet pour une demande en mots-clés : les règles les mieux
 * placées, tant qu'on tient sous le plafond. La PREMIÈRE passe toujours, même
 * si elle dépasse à elle seule — rendre zéro règle sur un sujet qui répond
 * serait pire que dépasser d'un peu.
 */
export function extraitDeSujet(
  regles: string[],
  requete: string,
  plafond = PLAFOND_EXTRAIT_SIGNES,
): ExtraitDeSujet {
  const classees = classerRegles(regles, requete);
  if (!classees.length) return { gardees: [], ecartees: 0 };

  const gardees: string[] = [];
  let signes = 0;
  for (const regle of classees) {
    if (gardees.length && signes + regle.texte.length > plafond) break;
    gardees.push(regle.texte);
    signes += regle.texte.length;
  }
  return { gardees, ecartees: classees.length - gardees.length };
}

/**
 * La phrase qui dit ce qui n'a PAS été rendu, et comment l'obtenir. Rien à dire
 * quand rien n'a été écarté : on n'ajoute pas une ligne pour parler du vide.
 */
export function mentionDEcart(sujet: { id: string; libelle: string }, extrait: ExtraitDeSujet): string {
  if (!extrait.ecartees) return '';
  const nombre =
    extrait.ecartees === 1 ? '1 autre règle de ce sujet ne parle' : `${extrait.ecartees} autres règles de ce sujet ne parlent`;
  return (
    `(${nombre} pas de ta demande et n'${extrait.ecartees === 1 ? 'a' : 'ont'} pas été recopiée${
      extrait.ecartees === 1 ? '' : 's'
    } ici. ` + `Pour le sujet « ${sujet.libelle} » EN ENTIER, redemande project_memory avec exactement « ${sujet.id} ».)`
  );
}

/**
 * Les sujets réellement ouverts sur une demande en mots-clés, et ceux qu'on se
 * contente de NOMMER. Un sujet touché par un seul mot vague ne vaut pas
 * d'ouvrir un second fichier ; on le cite, l'agent le demandera s'il le veut.
 */
export function partagerSujets<T extends { id: string; libelle: string }>(
  sujets: T[],
  poids: (sujet: T) => number,
  max = SUJETS_PAR_MOTS_MAX,
): { ouverts: T[]; nommes: T[] } {
  const classes = [...sujets].sort((a, b) => poids(b) - poids(a));
  return { ouverts: classes.slice(0, max), nommes: classes.slice(max) };
}
