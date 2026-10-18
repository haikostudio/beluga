/**
 * LA RELANCE DU RAPPORT, ET LES TÂCHES DE FOND QU'ELLE NOMME.
 *
 * Constat qui a produit ce fichier : une carte s'est refermée sur deux
 * paragraphes où l'agent disait attendre le résultat de ses contrôles — lancés
 * en tâche de fond, encore vivants au moment où il rendait la main. Le démon ne
 * suivait pas ces tâches : aucune ligne ne lisait `run_in_background`, et le
 * message d'attente passait le contrôle de forme (`rapportAuPlancher`).
 *
 * Deux règles, sans base ni disque :
 *
 *  - `tachesDeFondVivantes` relit les étapes d'un tour et rend les commandes
 *    lancées en tâche de fond dont aucun résultat final n'a été lu, et qu'aucun
 *    arrêt n'a coupées ;
 *  - `relanceDuRapport` dit si le tour mérite UNE relance, et avec quelle
 *    consigne. Jamais deux : une relance qui rate laisse le message tel
 *    quel, sans nouvel essai.
 *
 * DEPUIS LE 17/10/2026, LE COMPTE RENDU EST UN MESSAGE DE MESSAGERIE
 * (`shared/src/message-court.ts`) : plus de titres à exiger. La relance vise
 * deux cas : un message trop long, qui se RACCOURCIT, et un tour d'exécution
 * qui rend la main avec des tâches de fond encore vivantes, qui ATTEND leur
 * résultat avant d'écrire son message de fin. Elle vaut pour tout tour en forme
 * de message (travail, assistant général), pas seulement pour les cartes.
 *
 * Se rejoue seule : `server/src/test/relance-du-rapport.test.ts`.
 * Contrôle navigateur bout-en-bout, avec un faux moteur qui parle le format de
 * Claude Code : `node scripts/verif-relance-du-rapport.mjs`.
 */

import { FORME_D_UN_MESSAGE, consigneDeRaccourci } from './message-court.js';

/** Une étape d'outil, telle que le démon la garde pendant le tour. */
export interface EtapeDOutil {
  /** La clé de l'appel (identifiant de l'outil chez le moteur). */
  cle: string;
  outil: string;
  entree?: Record<string, unknown>;
  /** Le texte rendu par l'outil, quand il est arrivé. */
  resultat?: string;
  etat?: string;
}

/** Une tâche de fond encore vivante à la fin du tour. */
export interface TacheDeFond {
  cle: string;
  outil: string;
  /** L'identifiant annoncé par l'outil (« ID: b1a2c3 »), quand on l'a lu. */
  id?: string;
  /** La commande lancée, ou la description de l'agent lancé, coupée net. */
  commande: string;
}

/**
 * LE TEMPS LAISSÉ À UNE RELANCE QUI DOIT ATTENDRE DES TÂCHES DE FOND. Une
 * relance de pure forme garde le plafond court des appels d'après réponse ;
 * celle qui attend une construction et des contrôles a besoin de minutes.
 */
export const PLAFOND_RELANCE_AVEC_TACHES_MS = 20 * 60 * 1000;

/** Les outils qui LANCENT quelque chose en tâche de fond. */
const LANCEURS = new Set(['Bash', 'Agent', 'Task']);
/** Les outils qui COUPENT une tâche de fond. */
const ARRETS = new Set(['KillShell', 'KillBash', 'TaskStop']);
/** Les outils qui LISENT la sortie d'une tâche de fond. */
const LECTURES = new Set(['BashOutput', 'TaskOutput']);

/** Au-delà, une commande se coupe : la consigne n'a pas à recopier un script. */
const LONGUEUR_DE_COMMANDE = 160;

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : '';
}

/** L'identifiant qu'un lancement en tâche de fond annonce dans son résultat. */
export function idDeTacheDeFond(resultat: string | undefined): string | undefined {
  const trouve = (resultat ?? '').match(/\bID\s*:\s*([A-Za-z0-9_-]+)/i);
  return trouve?.[1];
}

/** L'identifiant qu'un appel de lecture ou d'arrêt vise. */
function idVise(entree: Record<string, unknown> | undefined): string | undefined {
  const brut = entree?.bash_id ?? entree?.shell_id ?? entree?.task_id ?? entree?.id;
  return typeof brut === 'string' && brut ? brut : undefined;
}

/** Une lecture de sortie qui dit que la tâche a FINI — réussie, ratée ou coupée. */
function sortieFinale(resultat: string | undefined): boolean {
  return /<status>\s*(completed|failed|killed|exited)|status\s*:\s*(completed|failed|killed|exited)|<exit_code>/i.test(
    resultat ?? '',
  );
}

export function tachesDeFondVivantes(etapes: readonly EtapeDOutil[]): TacheDeFond[] {
  const vivantes: TacheDeFond[] = [];
  for (const etape of etapes) {
    const entree = etape.entree;
    if (LANCEURS.has(etape.outil) && entree?.run_in_background === true) {
      // Un lancement refusé n'a rien laissé tourner.
      if (etape.etat === 'failed') continue;
      const commande = (texte(entree.command) || texte(entree.description) || texte(entree.prompt) || etape.outil)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LONGUEUR_DE_COMMANDE);
      vivantes.push({ cle: etape.cle, outil: etape.outil, id: idDeTacheDeFond(etape.resultat), commande });
      continue;
    }
    const vise = idVise(entree);
    if (!vise) continue;
    const close =
      (ARRETS.has(etape.outil) && etape.etat !== 'failed') || (LECTURES.has(etape.outil) && sortieFinale(etape.resultat));
    if (!close) continue;
    const index = vivantes.findIndex((tache) => tache.id === vise);
    if (index >= 0) vivantes.splice(index, 1);
  }
  return vivantes;
}

/** Ce que la fin de tour sait au moment de décider. */
export interface FinDeTourAJuger {
  /** Le tour est-il le tour d'exécution d'une carte (`rapportAuPlancher`) ? */
  plancher: boolean;
  /** Le contrôle de forme est-il tenu ? */
  formeTenue: boolean;
  /** Le tour répond-il en message de messagerie (`gabaritEnMessage`) ? Un message trop long se raccourcit. */
  messagerie?: boolean;
  /** Les tâches de fond encore vivantes d'un tour d'exécution : il les attend avant son message de fin. */
  tachesVivantes?: number;
  /** Le tour a-t-il rendu un texte ? */
  texte: string;
  /** Le tour est-il tombé — panne, quota, erreur vue en route ? */
  echec: boolean;
  /** Un arrêt à la main, ou une fermeture d'autorité ? */
  arrete: boolean;
  /** Une question attend-elle une réponse ? L'agent attend, il n'a pas fini. */
  questionPosee?: boolean;
}

/**
 * FAUT-IL RELANCER LE RAPPORT ? Un tour fini sans panne, sans arrêt ni question
 * ouverte, qui a rendu un texte : relancé UNE fois si sa forme n'est pas tenue
 * (message trop long, ou gabarit structuré d'un tour d'exécution), ou si c'est
 * le tour d'exécution d'une carte et qu'il laisse des tâches de fond vivantes.
 * Un tour arrêté à la main, coupé par un quota ou tombé ne se relance JAMAIS :
 * sa propre route (reprise, décision) existe déjà.
 */
export function relanceDuRapport(tour: FinDeTourAJuger): boolean {
  if (tour.echec || tour.arrete || tour.questionPosee) return false;
  if (!tour.texte.trim().length) return false;
  if (!tour.formeTenue) return tour.plancher || !!tour.messagerie;
  return tour.plancher && (tour.tachesVivantes ?? 0) > 0;
}

/** La ligne qui nomme une tâche de fond, dans la consigne et dans le journal. */
export function nomDeTacheDeFond(tache: TacheDeFond): string {
  return tache.id ? `${tache.commande} (ID ${tache.id})` : tache.commande;
}

/**
 * LA CONSIGNE DE LA RELANCE. Elle nomme les tâches de fond encore vivantes et
 * demande d'attendre leur résultat, puis de rendre le message final — raccourci
 * s'il dépassait le plafond. C'est ce texte-là qui fermera la carte.
 */
export function consigneDeRelanceDuRapport(input: {
  /** Le message rendu, quand il est trop long : la consigne demande de le raccourcir. */
  tropLong?: string;
  taches: readonly TacheDeFond[];
}): string {
  const lignes: string[] = [];
  if (input.tropLong) lignes.push(consigneDeRaccourci(input.tropLong));
  if (input.taches.length) {
    lignes.push(
      ...(lignes.length ? [''] : []),
      'TON TOUR S’EST TERMINÉ AVANT LA FIN DE CES COMMANDES, LANCÉES EN TÂCHE DE FOND, DONT AUCUN RÉSULTAT FINAL N’A ÉTÉ LU :',
      ...input.taches.map((tache) => `- ${nomDeTacheDeFond(tache)}`),
      '',
      'Attends leur résultat (lis leur sortie jusqu’à la fin), puis dis dans ton message ce qu’elles ont donné, même en échec.',
    );
  }
  lignes.push(
    '',
    `Rends MAINTENANT ton message final, en ${FORME_D_UN_MESSAGE}.`,
    'Ne refais pas le travail, ne pose pas de question : ce texte ferme la carte.',
  );
  return lignes.join('\n').trim();
}
