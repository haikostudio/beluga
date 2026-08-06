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
 * déjà connu. Deux principes tiennent tout :
 *   — on ne cache pas un refus : chaque carte refusée est NOMMÉE avec sa raison ;
 *   — on ne ment pas sur le compte : « 2 lancées, 1 en attente », jamais
 *     « lot terminé ».
 */

/** Une carte que le lot n'a pas pu déplacer, et pourquoi. */
export type RefusDeLot = {
  titre: string;
  /** Le message rendu par le serveur, tel quel. */
  raison?: string;
};

export type BilanDeLot = {
  niveau: 'success' | 'warning' | 'error';
  texte: string;
};

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
    motif: /le serveur ne répond pas/i,
    clair: 'le serveur n’a pas répondu à temps ; la carte n’a peut-être pas démarré — vérifiez la colonne.',
  },
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

const pluriel = (n: number) => (n > 1 ? 's' : '');

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
  const refus = refusees ?? [];
  const prefixe = projet?.trim() ? `Projet « ${projet.trim()} » — ` : '';

  if (!refus.length) {
    return {
      niveau: 'success',
      texte: faites
        ? `${prefixe}${faites} carte${pluriel(faites)} ${participe}${pluriel(faites)}.`
        : `${prefixe}Aucune carte à traiter.`,
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

  return {
    // Rien n'est passé : c'est un échec franc. Un lot partiel est un avertissement.
    niveau: faites ? 'warning' : 'error',
    texte: [tete, ...lignes].join('\n'),
  };
}
