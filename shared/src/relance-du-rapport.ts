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
 *    consigne. Jamais deux : une relance qui rate garde la note « Réponse hors
 *    format », sans nouvel essai.
 *
 * Se rejoue seule : `server/src/test/relance-du-rapport.test.ts`.
 * Contrôle navigateur bout-en-bout, avec un faux moteur qui parle le format de
 * Claude Code : `node scripts/verif-relance-du-rapport.mjs`.
 */

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
  /** Le tour est-il sous le plancher du rapport (`rapportAuPlancher`) ? */
  plancher: boolean;
  /** Le contrôle de forme est-il tenu ? */
  formeTenue: boolean;
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
 * FAUT-IL RELANCER LE RAPPORT ? Seulement un tour d'exécution de carte, fini
 * sans panne ni arrêt, qui a rendu un texte hors gabarit. Un tour arrêté à la
 * main, coupé par un quota ou tombé ne se relance JAMAIS : sa propre route
 * (reprise, décision) existe déjà.
 */
export function relanceDuRapport(tour: FinDeTourAJuger): boolean {
  if (!tour.plancher || tour.formeTenue) return false;
  if (tour.echec || tour.arrete || tour.questionPosee) return false;
  return tour.texte.trim().length > 0;
}

/** Les titres du compte rendu, rappelés dans la consigne de relance. */
const TITRES_DU_RAPPORT = ['Analyse', 'Ce qui est fait', 'Conséquences', 'Impact', 'Évolutions possibles', 'Coûts'];

/** La ligne qui nomme une tâche de fond, dans la consigne et dans le journal. */
export function nomDeTacheDeFond(tache: TacheDeFond): string {
  return tache.id ? `${tache.commande} (ID ${tache.id})` : tache.commande;
}

/**
 * LA CONSIGNE DE LA RELANCE. Elle dit ce qui manque, nomme les tâches de fond
 * encore vivantes, demande d'attendre leur résultat, puis de rendre le compte
 * rendu ENTIER — c'est ce texte-là qui fermera la carte.
 */
export function consigneDeRelanceDuRapport(input: { manquantes: readonly string[]; taches: readonly TacheDeFond[] }): string {
  const lignes: string[] = [
    'TON TOUR S’EST TERMINÉ SUR UN MESSAGE QUI N’EST PAS LE COMPTE RENDU DE LA CARTE.',
    input.manquantes.length
      ? `Sections absentes : ${input.manquantes.join(', ')}.`
      : 'Le texte rendu ne tient pas la forme imposée.',
  ];
  if (input.taches.length) {
    lignes.push(
      '',
      'Ces commandes lancées en tâche de fond n’ont pas rendu de résultat final lu dans ce tour :',
      ...input.taches.map((tache) => `- ${nomDeTacheDeFond(tache)}`),
      '',
      'Attends leur résultat (lis leur sortie jusqu’à la fin), puis cite chacune dans « Ce qui est fait » : la commande et son résultat, même en échec.',
    );
  }
  lignes.push(
    '',
    `Rends MAINTENANT le compte rendu final, avec exactement ces titres numérotés : « ${TITRES_DU_RAPPORT.join(' », « ')} ».`,
    'Ne refais pas le travail, ne pose pas de question : ce texte ferme la carte.',
  );
  return lignes.join('\n');
}
