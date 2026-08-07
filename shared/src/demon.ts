/**
 * Savoir si le démon tourne encore sur du code périmé.
 *
 * La publication remplace l'interface tout de suite, mais le SERVEUR continue
 * de tourner avec le code chargé à son démarrage. Tant qu'on ne le redémarre
 * pas, une correction côté serveur n'existe pas. Le repère est simple : si le
 * code construit est plus récent que le démarrage, il faut redémarrer.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatDemon {
  /** Instant du démarrage du démon. */
  demarreA: number;
  /** Dernière écriture du code serveur construit, si on a su la lire. */
  construitA?: number;
  /** Agents qui travaillent en ce moment : un redémarrage les interromprait. */
  agentsEnCours?: number;
  /** Noms des projets dont une publication tourne : un redémarrage la couperait. */
  publications?: string[];
  /** Un redémarrage est demandé mais attend la fin des publications. */
  redemarrageEnAttente?: boolean;
}

/**
 * Une seconde de marge : la construction et le démarrage peuvent se suivre de
 * très près, et les horloges de fichiers n'ont pas la précision de la seconde
 * partout. Sans elle, un redémarrage venant juste après une construction se
 * redemanderait aussitôt lui-même.
 */
const MARGE_MS = 1000;

export function redemarrageNecessaire(etat: EtatDemon): boolean {
  if (!etat.construitA) return false;
  return etat.construitA > etat.demarreA + MARGE_MS;
}

/** Ce qu'on dit à l'utilisateur avant de couper. */
export function avertissementRedemarrage(etat: EtatDemon): string {
  const base =
    'Le serveur s’arrête et repart tout seul en quelques secondes. L’application se reconnecte d’elle-même.';
  const agents = etat.agentsEnCours ?? 0;
  if (!agents) return base;
  return agents === 1
    ? `Un agent travaille en ce moment : il sera interrompu. ${base}`
    : `${agents} agents travaillent en ce moment : ils seront interrompus. ${base}`;
}

/*
 * NE JAMAIS REDÉMARRER PENDANT UNE PUBLICATION.
 *
 * Un redémarrage du serveur coupe TOUT ce qui tourne dans le démon — les agents,
 * mais aussi les publications des autres projets, que le démon porte tous. Une
 * publication coupée en plein vol laisse un lot à moitié parti, marqué
 * « Publication interrompue par un redémarrage du serveur ». La règle vit ici,
 * sans réseau ni base : on lui donne l'état du monde et elle tranche.
 */

export type ActionRedemarrage = 'redemarrer' | 'attendre' | 'rien';

export interface DecisionRedemarrage {
  action: ActionRedemarrage;
  /** Pourquoi on attend, à dire à l'utilisateur (absent si on redémarre ou rien). */
  raison?: string;
}

export interface EtatPourRedemarrage {
  /** Un redémarrage est-il demandé (bouton, ou fin d'une publication de HaikoDev) ? */
  demande: boolean;
  /** Noms des projets dont une publication tourne en ce moment. */
  publications: string[];
  /** Nombre d'agents au travail. */
  agents: number;
}

/**
 * Faut-il redémarrer maintenant, attendre, ou n'y a-t-il rien à faire ?
 *
 * Une publication en cours passe AVANT tout : on ne la coupe jamais, et le
 * message nomme le projet pour qu'on sache quoi attendre. Un agent au travail
 * fait attendre de même. Sans rien qui tourne, le redémarrage part.
 */
export function decisionDeRedemarrage(etat: EtatPourRedemarrage): DecisionRedemarrage {
  if (!etat.demande) return { action: 'rien' };
  const publications = etat.publications.filter((n) => n.trim());
  if (publications.length > 0) {
    return { action: 'attendre', raison: raisonPublications(publications) };
  }
  if (etat.agents > 0) {
    return { action: 'attendre', raison: raisonAgents(etat.agents) };
  }
  return { action: 'redemarrer' };
}

/** La phrase qui nomme la ou les publications qui retiennent le redémarrage. */
export function raisonPublications(noms: string[]): string {
  const propres = noms.filter((n) => n.trim());
  const fin = ' Le redémarrage partira tout seul dès la dernière terminée.';
  if (propres.length === 1) {
    return `Une publication est en cours (projet « ${propres[0]} ») : le redémarrage attend qu’elle finisse pour ne pas la couper.${fin}`;
  }
  if (propres.length > 1) {
    const liste = propres.map((n) => `« ${n} »`).join(', ');
    return `${propres.length} publications sont en cours (${liste}) : le redémarrage attend qu’elles finissent pour ne pas les couper.${fin}`;
  }
  return `Une publication est en cours : le redémarrage attend qu’elle finisse pour ne pas la couper.${fin}`;
}

/** La phrase qui nomme les agents au travail. */
export function raisonAgents(agents: number): string {
  return agents === 1
    ? 'Un agent travaille en ce moment : le redémarrage attend pour ne pas couper son travail.'
    : `${agents} agents travaillent en ce moment : le redémarrage attend pour ne pas couper leur travail.`;
}

export interface SuiteRedemarrage {
  /** On lance le redémarrage tout de suite. */
  redemarrer: boolean;
  /** Un redémarrage reste demandé, mais il attend. */
  enAttente: boolean;
  /** Pourquoi il attend, le cas échéant. */
  raison?: string;
}

/**
 * La transition d'état, pure et rejouable : à partir d'une demande en cours et
 * de l'état du monde, dit s'il faut redémarrer, rester en attente, ou rien. Elle
 * garantit le « une seule fois » : dès qu'on redémarre, la demande retombe
 * (`enAttente: false`), donc un second appel sans demande ne relance rien.
 */
export function suiteDuRedemarrage(demande: boolean, monde: { publications: string[]; agents: number }): SuiteRedemarrage {
  const decision = decisionDeRedemarrage({ demande, publications: monde.publications, agents: monde.agents });
  if (decision.action === 'redemarrer') return { redemarrer: true, enAttente: false };
  if (decision.action === 'attendre') return { redemarrer: false, enAttente: true, raison: decision.raison };
  return { redemarrer: false, enAttente: false };
}
