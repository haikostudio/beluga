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
  /**
   * Ce que fait chaque agent compté ci-dessus, en une phrase courte (« une
   * carte « X » du projet « Y » », « le chef d'orchestre du projet « Y » »…) —
   * sans quoi le compte reste anonyme et personne ne peut vérifier ce qui
   * retient le redémarrage.
   */
  agentsDetail?: string[];
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

/** La liste des agents, telle qu'ajoutée à une phrase (« : X, Y. »), vide si rien à nommer. */
function listeDesAgents(detail: string[] | undefined, agents: number): string {
  const propres = (detail ?? []).filter((d) => d.trim());
  if (propres.length !== agents || propres.length === 0) return '';
  return ` (${propres.join(', ')})`;
}

/** Ce qu'on dit à l'utilisateur avant de demander le redémarrage. */
export function avertissementRedemarrage(etat: EtatDemon): string {
  const base =
    'Le serveur s’arrête et repart tout seul en quelques secondes. L’application se reconnecte d’elle-même.';
  const agents = etat.agentsEnCours ?? 0;
  if (!agents) return base;
  const liste = listeDesAgents(etat.agentsDetail, agents);
  return agents === 1
    ? `Un agent travaille en ce moment${liste} : le redémarrage attendra qu’il ait fini, pour ne pas le couper. ${base}`
    : `${agents} agents travaillent en ce moment${liste} : le redémarrage attendra qu’ils aient fini, pour ne pas les couper. ${base}`;
}

/*
 * NE JAMAIS REDÉMARRER PENDANT QU'UNE TÂCHE TOURNE.
 *
 * Un redémarrage du serveur coupe TOUT ce qui tourne dans le démon — les agents
 * au travail, mais aussi les publications des autres projets, que le démon
 * porte tous. Une tâche coupée en plein vol repart à zéro, une publication
 * coupée laisse un lot à moitié parti, marqué « Publication interrompue par un
 * redémarrage du serveur ». La règle vit ici, sans réseau ni base : on lui
 * donne l'état du monde et elle tranche — jamais de geste qui passerait outre.
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
  /** Ce que fait chaque agent compté ci-dessus, en une phrase courte. */
  agentsDetail?: string[];
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
    return { action: 'attendre', raison: raisonAgents(etat.agents, etat.agentsDetail) };
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
export function raisonAgents(agents: number, detail?: string[]): string {
  const liste = listeDesAgents(detail, agents);
  return agents === 1
    ? `Un agent travaille en ce moment${liste} : le redémarrage attend pour ne pas couper son travail.`
    : `${agents} agents travaillent en ce moment${liste} : le redémarrage attend pour ne pas couper leur travail.`;
}

/*
 * UN SIGNAL D'ARRÊT VENU DU DEHORS SUIT LA MÊME RÈGLE QUE LE BOUTON.
 *
 * Le bouton de redémarrage est bien gardé, mais ce n'est pas le seul chemin :
 * un `pkill -f "server/dist/main.js"` lancé par un agent pour faire le ménage
 * de ses propres essais frappe AUSSI le démon de production — c'est exactement
 * ce qui s'est produit le 14/08/2026, trois fois en cinq minutes, coupant
 * quatre tâches en plein vol. Le signal arrivait droit sur l'arrêt, sans que
 * personne ne regarde ce qui tournait. Désormais il passe par la MÊME règle :
 * si une publication ou un agent travaille, l'arrêt est RETENU, dit, et rejoué
 * tout seul dès le dernier travail fini.
 */

export interface DecisionSurSignal {
  /** On laisse le processus s'arrêter maintenant. */
  arreter: boolean;
  /** L'arrêt est retenu : il repartira dès le dernier travail terminé. */
  retenu: boolean;
  /** Pourquoi il est retenu, à écrire au journal et à montrer. */
  raison?: string;
}

/**
 * Que faire d'un signal d'arrêt (SIGTERM, SIGINT) reçu du dehors ? La même
 * règle que le bouton, sans exception : rien qui tourne, on s'arrête ; un
 * travail en vol, on retient.
 */
export function decisionSurSignalDArret(monde: {
  publications: string[];
  agents: number;
  agentsDetail?: string[];
}): DecisionSurSignal {
  const suite = suiteDuRedemarrage(true, monde);
  if (suite.redemarrer) return { arreter: true, retenu: false };
  return { arreter: false, retenu: true, raison: suite.raison };
}

/** La phrase écrite au journal quand un signal d'arrêt est retenu. */
export function raisonSignalRetenu(signal: string, raison?: string): string {
  const fin = raison ? ` ${raison}` : '';
  return `arrêt (${signal}) RETENU : du travail tourne encore, le serveur ne se coupe pas.${fin}`;
}

/**
 * Le nom que le processus se donne. Un `pkill -f` visant le chemin du fichier
 * construit (« server/dist/main.js ») ne doit plus rencontrer le démon : c'est
 * le second verrou, celui qui tient même face à un signal impossible à retenir
 * (`kill -9`). Le nom garde « haikodev » pour rester reconnaissable dans `ps`.
 */
export const TITRE_DU_PROCESSUS = 'haikodev-serveur';

/*
 * UN SERVEUR D'ESSAI NE PORTE PLUS LE NOM DU DÉMON.
 *
 * Le nom unique s'est retourné contre lui-même le 14/08/2026 : les scripts de
 * vérification lancent le VRAI `server/dist/main.js` sur un port et une base à
 * eux, donc ces serveurs d'essai s'appelaient eux aussi « haikodev-serveur ».
 * Dans `ps` et `ss`, le noyau tronque à quinze signes : essais et démon
 * s'affichaient tous « haikodev-serveu », impossibles à distinguer. Un agent
 * qui faisait le ménage de SES essais a visé ce nom commun avec un `pkill -9`
 * — et a abattu le démon de production avec onze étapes de travail en vol.
 *
 * Le nom dit donc maintenant QUI on est : seul le serveur qui sert la VRAIE
 * base de données est le démon ; tout autre est un essai, nommé comme tel et
 * visable sans danger. La troncature à quinze signes garde le mot qui sépare
 * (« haikodev-essai- »).
 */
export const TITRE_DU_SERVEUR_D_ESSAI = 'haikodev-essai';

/** Un chemin comparable : sans espaces autour, sans barre oblique finale. */
function cheminNormalise(chemin: string): string {
  const propre = chemin.trim().replace(/\/+$/, '');
  return propre;
}

export interface MondeDuTitre {
  /** Le dossier de données que CE serveur sert réellement. */
  dossierDeDonnees: string;
  /** Le dossier de données du démon : `<racine du dépôt>/data`. */
  dossierDeDonneesDuDemon: string;
  /** Le port écouté, pour reconnaître un essai parmi d'autres. */
  port?: number | string;
  /** Un essai peut aussi se déclarer lui-même, sans rien deviner. */
  essaiDeclare?: boolean;
}

/**
 * Le nom que ce processus doit porter. Le démon sert la base du dépôt ; un
 * serveur monté pour un contrôle sert une base à lui, et porte alors un nom
 * d'essai — que ses propres scripts peuvent viser sans risquer le démon.
 */
export function titreDuProcessus(monde: MondeDuTitre): string {
  const sien = cheminNormalise(monde.dossierDeDonnees);
  const celuiDuDemon = cheminNormalise(monde.dossierDeDonneesDuDemon);
  const essai = Boolean(monde.essaiDeclare) || sien !== celuiDuDemon;
  if (!essai) return TITRE_DU_PROCESSUS;
  const port = String(monde.port ?? '').trim();
  return port ? `${TITRE_DU_SERVEUR_D_ESSAI}-${port}` : TITRE_DU_SERVEUR_D_ESSAI;
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
export function suiteDuRedemarrage(
  demande: boolean,
  monde: { publications: string[]; agents: number; agentsDetail?: string[] },
): SuiteRedemarrage {
  const decision = decisionDeRedemarrage({
    demande,
    publications: monde.publications,
    agents: monde.agents,
    agentsDetail: monde.agentsDetail,
  });
  if (decision.action === 'redemarrer') return { redemarrer: true, enAttente: false };
  if (decision.action === 'attendre') return { redemarrer: false, enAttente: true, raison: decision.raison };
  return { redemarrer: false, enAttente: false };
}
