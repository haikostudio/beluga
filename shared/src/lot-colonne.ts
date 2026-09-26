/**
 * Le COMPTE RENDU d'un geste en lot, au pied d'une colonne.
 *
 * Un pied de colonne déplace les cartes cochées une par une. Certaines passent,
 * d'autres sont refusées par le serveur — la plus fréquente : « Tout lancer »
 * sur un projet où un agent travaille déjà, puisqu'une seule carte à la fois
 * peut tenir dans un dossier de travail (`porteDuDossier`). Sans compte rendu,
 * l'utilisateur voyait ses cartes partir puis revenir sans un mot.
 *
 * La règle est PURE : elle ne sait rien du réseau, elle met en mots un résultat
 * déjà connu. Trois principes tiennent tout :
 *   — on ne cache pas un refus : chaque carte refusée est NOMMÉE avec sa raison ;
 *   — on ne ment pas sur le compte : « 2 lancées, 1 en attente », jamais
 *     « lot terminé » ;
 *   — un DÉLAI DÉPASSÉ n'est pas un refus : la commande est partie, son issue
 *     n'est simplement pas encore connue (`gesteResteEnRoute`). L'annoncer en
 *     rouge — « Aucune carte lancée » pendant que les agents démarraient —
 *     contredisait ce qui se passait vraiment.
 */
import { RAISON_SANS_REPONSE } from './panne-serveur.js';

/** Une carte que le lot n'a pas pu déplacer, et pourquoi. */
export type RefusDeLot = {
  titre: string;
  /** Le message rendu par le serveur, tel quel. */
  raison?: string;
};

export type BilanDeLot = {
  niveau: 'info' | 'success' | 'warning' | 'error';
  texte: string;
};

/**
 * COMBIEN DE TEMPS LE PIED DE COLONNE GARDE LA MAIN.
 *
 * Un geste de masse envoie ses commandes puis attend leurs réponses pour faire
 * son compte. Tant qu'il attend, les deux boutons du bas sont éteints — la roue
 * tourne sur « Déployer (2) », « Annuler » ne répond plus. C'est tenable une
 * seconde ou deux ; ce ne l'est plus quand une réponse tarde, et c'était le cas
 * d'un lancement, qui ne répondait qu'à la FIN du tour (des minutes, parfois des
 * heures) : l'interface restait figée jusqu'au délai d'attente du navigateur.
 *
 * Passé ce plafond, le pied REND LA MAIN sans rien annuler : les commandes sont
 * parties, le serveur les traite, et la colonne se met à jour toute seule par
 * les événements. Six secondes laissent passer le cas normal (une réponse tient
 * en quelques dizaines de millisecondes) sans jamais bloquer l'écran.
 */
export const PLAFOND_ATTENTE_LOT_MS = 6000;

/** Ce qu'on dit quand le serveur refuse sans expliquer — cela ne devrait pas arriver. */
export const RAISON_SANS_MOT = 'refus sans explication';

/**
 * Certaines raisons ne sont pas « métier » : ce sont des messages TECHNIQUES du
 * navigateur (délai dépassé, lien coupé) qui ne disent pas à l'utilisateur ce
 * qui s'est passé ni quoi faire. On les traduit en une phrase claire. Toutes les
 * autres raisons — dossier occupé, plus de place, aucun compte disponible — sont
 * déjà claires : elles PASSENT telles quelles, on n'y touche pas.
 */
const RAISONS_TECHNIQUES: { motif: RegExp; clair: string }[] = [
  {
    motif: /non connecté/i,
    clair: 'l’application a perdu le lien avec le serveur ; réessayez une fois reconnecté.',
  },
  {
    motif: /^(commande|déplacement) refusé/i,
    clair: 'le serveur a refusé sans préciser ; regardez la carte, sa raison peut y être écrite.',
  },
];

/**
 * Met une raison de refus en français simple. Une raison technique connue est
 * remplacée par sa phrase claire ; tout le reste — déjà lisible — est rendu tel
 * quel. Une raison vide reste vide (l'appelant retombe sur `RAISON_SANS_MOT`).
 */
export function traduireRaison(raison?: string): string | undefined {
  const texte = raison?.trim();
  if (!texte) return texte;
  for (const { motif, clair } of RAISONS_TECHNIQUES) {
    if (motif.test(texte)) return clair;
  }
  return texte;
}

/**
 * Au plus trois raisons dans le message : au-delà, la bulle deviendrait un mur.
 * Les autres cartes gardent la leur, écrite sur elles (`waitingReason`).
 */
export const RAISONS_AFFICHEES = 3;

/**
 * UN DÉLAI DÉPASSÉ N'EST PAS UN REFUS.
 *
 * Quand le serveur n'a pas répondu à temps (`RAISON_SANS_REPONSE`), la commande
 * est partie : elle est arrivée, elle est peut-être même déjà exécutée — on ne
 * connaît simplement pas encore son issue. La compter comme un refus produisait
 * un message rouge qui contredisait ce qui se passait vraiment : « Aucune carte
 * lancée » alors que les agents démarraient.
 *
 * Ces cartes sont donc mises à part : EN ROUTE, ni faites ni refusées.
 */
export function gesteResteEnRoute(raison?: string): boolean {
  return !!raison && new RegExp(RAISON_SANS_REPONSE, 'i').test(raison);
}

/** Les trois parts d'un lot : ce qui est passé, ce qui est refusé, ce qui est parti sans réponse. */
export type PartsDuLot = {
  faites: number;
  /** Les vrais refus : le serveur a répondu, et il a dit non. */
  refusees: RefusDeLot[];
  /** Les cartes dont on n'a pas encore l'issue. */
  enRoute: RefusDeLot[];
};

/** Trie ce que le lot a récolté ; la seule règle qui décide de la couleur du message. */
export function partsDuLot(faites: number, refusees: RefusDeLot[]): PartsDuLot {
  const tout = refusees ?? [];
  return {
    faites,
    refusees: tout.filter((r) => !gesteResteEnRoute(r.raison)),
    enRoute: tout.filter((r) => gesteResteEnRoute(r.raison)),
  };
}

const pluriel = (n: number) => (n > 1 ? 's' : '');

/** Ce qu'on dit d'un geste parti dont l'issue n'est pas encore connue. */
function phraseEnRoute(n: number): string {
  return `${n} carte${pluriel(n)} en route — le serveur n’a pas encore répondu ; la colonne se met à jour toute seule.`;
}

/**
 * LE MESSAGE DU PIED QUI REND LA MAIN.
 *
 * Au bout de `PLAFOND_ATTENTE_LOT_MS`, le pied de colonne cesse d'attendre et
 * réactive ses boutons. Rien n'est annulé — il le DIT, sans alarme : ce n'est
 * pas un échec, c'est un travail qui dure.
 */
export function bilanEnRoute(combien: number, projet?: string): BilanDeLot {
  const prefixe = projet?.trim() ? `Projet « ${projet.trim()} » — ` : '';
  return { niveau: 'info', texte: `${prefixe}${phraseEnRoute(combien)}` };
}

/**
 * Met en mots le résultat d'un lot.
 *
 * @param participe le participe passé FÉMININ du geste : « lancée », « validée »,
 *                  « déployée », « archivée » — il s'accorde avec « carte ».
 * @param faites    combien de cartes le serveur a acceptées.
 * @param refusees  les cartes refusées, dans l'ordre où elles ont été tentées.
 * @param projet    le NOM du projet, mis en tête quand il est connu : un message
 *                  d'échec doit dire de quel projet il parle.
 */
export function bilanDeLot(
  participe: string,
  faites: number,
  refusees: RefusDeLot[],
  projet?: string,
): BilanDeLot {
  const parts = partsDuLot(faites, refusees);
  const refus = parts.refusees;
  const enRoute = parts.enRoute.length;
  const prefixe = projet?.trim() ? `Projet « ${projet.trim()} » — ` : '';

  if (!refus.length) {
    // Rien de refusé : il reste au plus des cartes parties sans réponse, et
    // c'est une nouvelle neutre — jamais un échec.
    if (!faites && enRoute) return bilanEnRoute(enRoute, projet);
    const fait = faites ? `${faites} carte${pluriel(faites)} ${participe}${pluriel(faites)}.` : 'Aucune carte à traiter.';
    return {
      niveau: faites ? 'success' : 'info',
      texte: `${prefixe}${fait}${enRoute ? `\n• ${phraseEnRoute(enRoute)}` : ''}`,
    };
  }

  const tete = faites
    ? `${prefixe}${faites} carte${pluriel(faites)} ${participe}${pluriel(faites)}, ${refus.length} en attente :`
    : // « Aucune carte » reste au SINGULIER, quel que soit le nombre de refus.
      `${prefixe}Aucune carte ${participe} — ${refus.length} en attente :`;

  const lignes = refus
    .slice(0, RAISONS_AFFICHEES)
    .map((r) => `• « ${r.titre} » — ${traduireRaison(r.raison) || RAISON_SANS_MOT}`);

  const reste = refus.length - lignes.length;
  if (reste > 0) {
    lignes.push(`• et ${reste} autre${pluriel(reste)}, chacune avec sa raison écrite sur sa carte.`);
  }

  // Ce qui est parti sans réponse se dit à part, à la fin : ce n'est pas une
  // carte de plus « en attente », c'est une issue qu'on ne connaît pas encore.
  if (enRoute) lignes.push(`• ${phraseEnRoute(enRoute)}`);

  return {
    // Un refus reste un refus — mais tant qu'une carte est passée OU qu'une
    // autre est en route, ce n'est pas « rien n'est parti » : l'échec franc est
    // réservé au lot dont TOUT a été refusé.
    niveau: faites || enRoute ? 'warning' : 'error',
    texte: [tete, ...lignes].join('\n'),
  };
}
