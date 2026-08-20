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
 *     l'agent : on lui rend le fichier entier, il l'a demandé — SAUF quand une
 *     CARTE dit le travail à faire et que le fichier est gros, auquel cas il est
 *     servi au poids de cette demande (voir le bas de ce module) ;
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
    } ici. ` +
    `Pour le sujet « ${sujet.libelle} » EN ENTIER, redemande project_memory avec exactement ` +
    `« ${sujet.id} entier ».)`
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

/* ------------------------------------------------------------------ */
/* UN SUJET NOMMÉ AU LANCEMENT D'UNE CARTE                             */
/* ------------------------------------------------------------------ */

/**
 * UN SUJET NOMMÉ EST SERVI AU POIDS DE LA DEMANDE DE LA CARTE, PAS DU FICHIER.
 *
 * La MÉTHODE imposée dit à l'agent d'ouvrir « le SUJET de sa tâche » dès son
 * premier tour — il NOMME donc un sujet, et un sujet nommé valait le fichier
 * ENTIER. Une carte à portée étroite (« le bouton d'arrêt ») recevait ainsi les
 * 36 000 signes de `docs/regles/cartes.md` pour trois invariants qui en pèsent
 * mille : le filtrage par la demande, déjà écrit pour les mots-clés, ne servait
 * jamais là où le volume part vraiment.
 *
 * Le choix de l'agent n'est pas trahi pour autant, il est simplement RANGÉ dans
 * l'ordre de sa demande : ce qui parle de la carte d'abord, ce qui est écarté
 * NOMMÉ, et le fichier entier à un mot de distance (« <sujet> entier »).
 *
 * Trois refus tiennent ce filtrage à sa place :
 *  — l'agent a écrit « entier » : c'est un choix explicite, on obéit ;
 *  — le sujet tient sous le plafond : rogner trois pages n'économise rien et
 *    fait perdre le fil ;
 *  — la demande ne porte pas assez de mots pour classer quoi que ce soit : on
 *    ne devine pas, on rend tout.
 */

/** Au-delà de ce poids, un sujet nommé se sert au poids de la demande. */
export const PLAFOND_SUJET_NOMME = 8000;

/** En dessous de tant de mots utiles, une demande ne classe rien : on rend tout. */
export const MOTS_MINIMUM_POUR_FILTRER = 3;

/** Les mots qui, en fin de demande, réclament le sujet ENTIER. */
const MARQUEURS_ENTIER = ['en entier', 'entier', 'entière', 'complet', 'complète', 'intégral', 'intégralité'];

/** Une demande de mémoire, une fois son marqueur « entier » retiré. */
export interface DemandeDeMemoire {
  /** La demande sans le marqueur — c'est elle qui nomme le sujet. */
  requete: string;
  /** L'agent réclame le sujet entier, sans filtrage. */
  entier: boolean;
}

/**
 * L'ÉCHAPPATOIRE, et elle est écrite dans chaque mention d'écart : « cartes
 * entier » rend le fichier entier, quoi qu'en dise la demande de la carte. Le
 * marqueur doit être en FIN de demande et laisser quelque chose derrière lui,
 * sinon « entier » tout seul deviendrait une demande de sujet.
 */
export function lireDemandeDeMemoire(requete: string): DemandeDeMemoire {
  const brut = requete.trim();
  const bas = brut.toLowerCase();
  for (const marqueur of MARQUEURS_ENTIER) {
    if (!bas.endsWith(` ${marqueur}`)) continue;
    const reste = brut.slice(0, brut.length - marqueur.length - 1).trim();
    if (reste) return { requete: reste, entier: true };
  }
  return { requete: brut, entier: false };
}

/**
 * Ce sujet nommé se sert-il au poids de la demande, ou en entier ? La demande
 * passée ici est celle de la CARTE — le travail réel à faire —, jamais le nom
 * du sujet : ce nom apparaît dans chacune de ses règles et ne classe rien.
 */
export function sujetNommeAFiltrer(
  { signes, demande, entier }: { signes: number; demande: string; entier: boolean },
  plafond = PLAFOND_SUJET_NOMME,
): boolean {
  if (entier) return false;
  if (signes <= plafond) return false;
  return motsDeLaRequete(demande).length >= MOTS_MINIMUM_POUR_FILTRER;
}

/* ------------------------------------------------------------------ */
/* LES CONTRÔLES SUIVENT LA MÊME RÈGLE QUE LES RÈGLES                  */
/* ------------------------------------------------------------------ */

/**
 * LA LISTE DES CONTRÔLES D'UN SUJET SE SERT AU POIDS DE LA DEMANDE, ELLE AUSSI.
 *
 * Les contrôles d'un sujet suivaient toujours l'extrait EN ENTIER, au motif
 * qu'une section pèse « quelques centaines de signes ». Ce n'est plus vrai :
 * celle du sujet « interface » en pèse 16 000 — trois fois l'extrait de règles
 * qu'elle accompagnait, et de loin la plus grosse part de ce qui partait. Or
 * une carte ne rejoue pas cinquante contrôles : elle rejoue ceux qui touchent
 * ce qu'elle a changé, exactement comme elle ne lit que les règles qui la
 * concernent.
 *
 * Chaque contrôle tient sur UNE ligne (« node scripts/verif-x.mjs # ce qu'il
 * vérifie ») : on garde donc les lignes qui parlent de la demande, on compte
 * les autres, et on le DIT.
 */

/** Au-delà de ce poids, la liste des contrôles d'un sujet se filtre. */
export const PLAFOND_CONTROLES_SIGNES = 3000;

/** Les lignes de COMMANDE d'une section de contrôles — ni titre, ni clôture de bloc. */
export function lignesDeControle(section: string): string[] {
  return section
    .split('\n')
    .map((ligne) => ligne.trimEnd())
    .filter((ligne) => ligne.trim() && !/^#{1,6} /.test(ligne) && !ligne.trim().startsWith('```'));
}

/**
 * Les contrôles d'un sujet qui touchent la demande, sous plafond. Comme pour les
 * règles, le premier passe toujours : rendre zéro contrôle sur un sujet qui en a
 * serait pire que d'en rendre un de trop.
 */
export function extraitDeControles(
  section: string,
  requete: string,
  plafond = PLAFOND_CONTROLES_SIGNES,
): ExtraitDeSujet {
  const lignes = lignesDeControle(section);
  if (!lignes.length) return { gardees: [], ecartees: 0 };

  const classees = classerRegles(lignes, requete);
  if (!classees.length) return { gardees: [], ecartees: 0 };

  const gardees: string[] = [];
  let signes = 0;
  for (const { texte } of classees) {
    if (gardees.length && signes + texte.length > plafond) break;
    gardees.push(texte);
    signes += texte.length;
  }
  return { gardees, ecartees: lignes.length - gardees.length };
}
