/**
 * « SI ELLE EST ENCORE EN COURS, QU'ELLE DISE CE QUI TOURNE. »
 *
 * Le pendant obligé de la règle qui ferme une carte dès que son rapport est
 * rendu (`issueDeFinDeTour`) : une carte qui RESTE dans « En cours » a désormais
 * forcément une raison — un agent y travaille, une question attend une réponse,
 * un tour est en train de se ranger. Cette raison doit se lire SUR la carte,
 * sans l'ouvrir, avec les trois choses qu'on vient chercher :
 *
 *   - QUELLE ÉTAPE : ce que l'agent est en train de faire, tel qu'il l'a nommé ;
 *   - DEPUIS COMBIEN DE TEMPS : le tour a commencé il y a 4 minutes, ou 3 heures ;
 *   - CE QU'ON ATTEND : la fin du tour, votre réponse, le rangement.
 *
 * Avant, la carte ne montrait qu'un chronomètre et un nom d'étape qui
 * alternaient dans une bande étroite, et rien du tout dès que l'agent avait
 * rendu la main : une carte pouvait avoir l'air finie et rester là sans un mot.
 *
 * La règle est PURE : elle ne connaît ni la base ni le navigateur. L'interface
 * lui passe ce qu'elle sait de la carte et de ses agents, elle rend une phrase.
 */

/** Ce qui retient la carte, en un mot — chacun a son icône et son ton. */
export type NatureDuRestant = 'question' | 'travaille' | 'relance' | 'rangement' | 'sans-agent';

/** Ce qu'il faut savoir de la carte et de son agent pour juger. */
export interface CarteEnCours {
  /** La colonne du tableau : seule « En cours » est concernée. */
  colonne: string;
  /** L'agent qui travaille en ce moment sur cette carte, s'il y en a un. */
  agentActif?: {
    /** L'étape que l'agent vient de nommer (`agent.etapeEnCours`). */
    etapeEnCours?: string;
    /** Quand son tour a démarré. */
    startedAt?: number;
    /** Sa liste de tâches, telle qu'elle voyage avec lui. */
    todos?: { done: number; total: number };
    /** Il est arrêté sur une question posée à l'utilisateur. */
    attendReponse?: boolean;
  };
  /** Une décision attend une réponse sur cette carte. */
  decisionEnAttente?: boolean;
  /** Un tour d'exécution tient encore la carte (marque `tourEnVolDepuis`). */
  tourEnVolDepuis?: number;
  /** Quand le dernier agent de la carte a rendu la main. */
  finDuDernierTour?: number;
  /**
   * La carte a été ARRÊTÉE À LA MAIN (`scheduling.suspendu`). Le bouton d'arrêt
   * d'une carte pose cette marque SANS changer la colonne : la carte reste donc
   * dans « En cours », et plus rien ne repartira sans un geste.
   */
  suspendu?: boolean;
  /**
   * Le dernier tour de SON agent s'est mal terminé — échec, ou arrêt à la main.
   * C'est le seul état où le balayage de l'ordonnanceur (`issueDeCarteOubliee`)
   * s'interdit de ranger la carte : elle doit rester là où on la relance.
   */
  dernierTourEnEchec?: boolean;
}

export interface TravailRestant {
  nature: NatureDuRestant;
  /** Ce qui se passe, en une poignée de mots. */
  etape: string;
  /** « depuis 4 min », ou `null` quand on ne sait pas depuis quand. */
  depuis: string | null;
  /** Ce qu'on attend pour que la carte se ferme. */
  attente: string;
}

/** Une minute, en millisecondes — l'unité de tout ce qui se compte ici. */
const MINUTE = 60 * 1000;

/**
 * Une durée écrite comme on la dit : « 40 s », « 12 min », « 3 h 05 »,
 * « 2 jours ». Jamais de décimale, jamais de « 0 h 00 » : sous la minute, on
 * compte en secondes.
 */
export function dureeDite(millisecondes: number): string {
  const secondes = Math.max(0, Math.round(millisecondes / 1000));
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h ${String(minutes % 60).padStart(2, '0')}`;
  const jours = Math.floor(heures / 24);
  return `${jours} ${jours > 1 ? 'jours' : 'jour'}`;
}

/** « depuis 4 min », ou `null` quand l'instant de départ est inconnu. */
function depuisQuand(instant: number | undefined, maintenant: number): string | null {
  if (!instant) return null;
  return `depuis ${dureeDite(maintenant - instant)}`;
}

/** « il reste 2 étapes », quand la liste de tâches en dit assez pour le savoir. */
function resteDesEtapes(todos?: { done: number; total: number }): string | null {
  if (!todos || todos.total <= 0) return null;
  const reste = Math.max(0, todos.total - todos.done);
  if (reste === 0) return null;
  return `il reste ${reste} étape${reste > 1 ? 's' : ''} sur ${todos.total}`;
}

/**
 * CE QUI TOURNE ENCORE, ou `null` quand il n'y a rien à dire — la carte n'est
 * pas en « En cours », et sa colonne dit alors déjà où elle en est.
 *
 * Quatre situations, dans cet ordre de priorité :
 *
 *  1. UNE QUESTION ATTEND. C'est le seul cas où la carte attend l'UTILISATEUR :
 *     il passe donc devant tout le reste, y compris devant l'étape en cours —
 *     l'agent est arrêté net tant qu'on n'a pas répondu.
 *  2. UN AGENT TRAVAILLE. On dit son étape, depuis quand, et ce qui reste de sa
 *     liste de tâches.
 *  3. LA CARTE ATTEND VOTRE RELANCE. Le tour s'est arrêté — en échec, ou coupé
 *     par le bouton d'arrêt — et la carte est RESTÉE dans « En cours » : c'est
 *     la règle, on doit pouvoir la relire et la corriger là où on la relance.
 *     Mais alors le balayage de l'ordonnanceur s'interdit d'y toucher
 *     (`issueDeCarteOubliee`, refus « dernier tour en échec ») : promettre un
 *     « rangement automatique sous quinze secondes » serait un mensonge, et
 *     c'est précisément ce que la carte disait. Elle nomme donc le seul geste
 *     qui la fera bouger : le vôtre.
 *  4. UN TOUR SE RANGE. Le moteur a rendu la main, mais le tour tient encore la
 *     carte (fusion de la branche, compression du fil) : quelques secondes, qui
 *     ne doivent pas ressembler à un blocage.
 *  5. PLUS PERSONNE. Le tour est fini et la carte est restée là : depuis la
 *     nouvelle règle, c'est une anomalie que le balayage de l'ordonnanceur
 *     corrige en quinze secondes — on l'écrit quand même, plutôt que de laisser
 *     une carte muette.
 */
export function travailRestant(carte: CarteEnCours, maintenant: number): TravailRestant | null {
  if (carte.colonne !== 'running') return null;

  const agent = carte.agentActif;
  if (agent && (agent.attendReponse || carte.decisionEnAttente)) {
    return {
      nature: 'question',
      etape: agent.etapeEnCours ?? 'Question posée',
      depuis: depuisQuand(agent.startedAt, maintenant),
      attente: 'votre réponse : l’agent est arrêté tant qu’elle ne vient pas',
    };
  }

  if (agent) {
    return {
      nature: 'travaille',
      etape: agent.etapeEnCours ?? 'Réflexion en cours…',
      depuis: depuisQuand(agent.startedAt, maintenant),
      attente: resteDesEtapes(agent.todos) ?? 'la fin du tour',
    };
  }

  if (carte.decisionEnAttente) {
    return {
      nature: 'question',
      etape: 'Question posée',
      depuis: depuisQuand(carte.finDuDernierTour, maintenant),
      attente: 'votre réponse : la carte ne se fermera pas avant',
    };
  }

  /*
   * ELLE NE SE RANGERA PAS TOUTE SEULE, ET ELLE LE DIT. Deux marques, un même
   * verdict : la carte est arrêtée, et le balayage de l'ordonnanceur ne la
   * touchera pas. Ce cas passe devant le rangement ET devant « plus personne » —
   * tous deux annoncent une suite automatique qui, ici, ne viendra jamais.
   */
  if (carte.suspendu || carte.dernierTourEnEchec) {
    return {
      nature: 'relance',
      etape: carte.suspendu ? 'Tâche arrêtée à la main' : 'Le tour s’est arrêté sans aboutir',
      depuis: depuisQuand(carte.finDuDernierTour ?? carte.tourEnVolDepuis, maintenant),
      attente: 'votre relance : la carte reste ici, rien ne repartira tout seul',
    };
  }

  if (carte.tourEnVolDepuis) {
    return {
      nature: 'rangement',
      etape: 'Tour en cours de rangement',
      depuis: depuisQuand(carte.tourEnVolDepuis, maintenant),
      attente: 'la fusion de la branche et la clôture de la carte',
    };
  }

  return {
    nature: 'sans-agent',
    etape: 'Aucun agent ne travaille',
    depuis: depuisQuand(carte.finDuDernierTour, maintenant),
    attente: 'le rangement automatique de la carte, sous quinze secondes',
  };
}

/**
 * La phrase d'une ligne, telle qu'elle se lit sur la carte :
 * « Analyse des fichiers · depuis 4 min · il reste 2 étapes sur 5 ».
 *
 * Les morceaux absents disparaissent avec leur séparateur : une carte dont on
 * ignore l'instant de départ ne dit pas « depuis ».
 */
export function phraseDuTravailRestant(restant: TravailRestant): string {
  return [restant.etape, restant.depuis, restant.attente].filter(Boolean).join(' · ');
}
