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
  /**
   * LE FORÇAGE : passer outre l'attente, en connaissance de cause.
   *
   * L'attente est la bonne règle par défaut — on ne coupe pas un travail qui
   * avance. Mais elle suppose que ce travail AVANCE, et c'est justement ce qui
   * est faux le jour où l'on a besoin du bouton : un agent pendu retient le
   * redémarrage pour toujours, et il faut alors ouvrir un terminal pour reprendre
   * la main. Le forçage n'est jamais automatique : il ne vient que d'un second
   * bouton, cliqué après avoir lu ce qui va être interrompu.
   */
  force?: boolean;
}

/**
 * Faut-il redémarrer maintenant, attendre, ou n'y a-t-il rien à faire ?
 *
 * Une publication en cours passe AVANT tout : on ne la coupe jamais, et le
 * message nomme le projet pour qu'on sache quoi attendre. Un agent au travail
 * fait attendre de même. Sans rien qui tourne, le redémarrage part.
 *
 * Un forçage EXPLICITE, lui, part toujours : c'est un geste humain pris après
 * lecture de ce qui sera interrompu (`resumeDeCeQuiSeraInterrompu`), et il n'a
 * de sens que quand plus rien n'avance.
 */
export function decisionDeRedemarrage(etat: EtatPourRedemarrage): DecisionRedemarrage {
  if (!etat.demande) return { action: 'rien' };
  if (etat.force) return { action: 'redemarrer' };
  const publications = etat.publications.filter((n) => n.trim());
  if (publications.length > 0) {
    return { action: 'attendre', raison: raisonPublications(publications) };
  }
  if (etat.agents > 0) {
    return { action: 'attendre', raison: raisonAgents(etat.agents, etat.agentsDetail) };
  }
  return { action: 'redemarrer' };
}

/**
 * CE QUI SERA INTERROMPU, ÉCRIT AVANT DE CONFIRMER.
 *
 * Forcer se fait les yeux ouverts : la fenêtre doit nommer ce qu'on s'apprête à
 * couper — les agents, un par un quand on sait ce qu'ils font, et les
 * publications, qui sont le cas le plus coûteux. Rien qui tourne : on le dit
 * aussi, et le forçage n'a alors rien de particulier.
 */
export function resumeDeCeQuiSeraInterrompu(etat: EtatDemon): string {
  const agents = etat.agentsEnCours ?? 0;
  const publications = (etat.publications ?? []).filter((n) => n.trim());
  if (!agents && !publications.length) {
    return 'Rien ne tourne en ce moment : le redémarrage n’interrompt aucun travail.';
  }

  const morceaux: string[] = [];
  if (agents) {
    const liste = listeDesAgents(etat.agentsDetail, agents);
    morceaux.push(agents === 1 ? `un agent au travail${liste}` : `${agents} agents au travail${liste}`);
  }
  if (publications.length) {
    const noms = publications.map((n) => `« ${n} »`).join(', ');
    morceaux.push(
      publications.length === 1
        ? `une publication en cours (projet ${noms})`
        : `${publications.length} publications en cours (${noms})`,
    );
  }

  return `Seront interrompus sur-le-champ : ${morceaux.join(' et ')}. Le travail déjà écrit est enregistré sur la branche de sa carte avant la coupure ; une publication coupée, elle, devra être relancée.`;
}

/** Ce qui est dit une fois le forçage parti — il ne se confond pas avec une attente. */
export const MESSAGE_REDEMARRAGE_FORCE =
  'Redémarrage forcé : tout ce qui tournait a été coupé, le serveur repart dans quelques secondes.';

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
  monde: { publications: string[]; agents: number; agentsDetail?: string[]; force?: boolean },
): SuiteRedemarrage {
  const decision = decisionDeRedemarrage({
    demande,
    publications: monde.publications,
    agents: monde.agents,
    agentsDetail: monde.agentsDetail,
    force: monde.force,
  });
  if (decision.action === 'redemarrer') return { redemarrer: true, enAttente: false };
  if (decision.action === 'attendre') return { redemarrer: false, enAttente: true, raison: decision.raison };
  return { redemarrer: false, enAttente: false };
}

/* ------------------------------------------------------------------ */
/* L'ÉTAPE « REDÉMARRAGE » D'UNE PUBLICATION DE HAIKODEV               */
/* ------------------------------------------------------------------ */

/**
 * UNE PUBLICATION QUI NE PEUT PAS REDÉMARRER MAINTENANT LE RETIENT POUR PLUS
 * TARD — ELLE NE L'OUBLIE PAS.
 *
 * Publier HaikoDev écrit le nouveau code sur le disque, mais le démon en marche
 * garde celui qu'il a chargé à son lancement : tant qu'il n'a pas redémarré, la
 * correction n'existe pas. L'étape « redémarrage » de la publication le sait, et
 * elle refuse à juste titre de couper un agent au travail ou une autre
 * publication.
 *
 * LE PIÈGE ÉTAIT LÀ : ces deux refus n'étaient pas traités pareil. Une AUTRE
 * PUBLICATION en cours faisait RETENIR le redémarrage (il repartait tout seul à
 * la fin) ; un AGENT AU TRAVAIL, lui, faisait simplement sauter l'étape, sans
 * rien retenir — le message renvoyant l'utilisateur à un clic manuel qu'il n'a
 * aucune raison de remarquer. Or un agent travaille presque toujours au moment
 * où l'on publie : c'est justement la fin de son travail qui remplit le lot.
 *
 * Constaté le 20 août 2026 : la publication de 07:30 portait le correctif
 * « une carte ne passe en Terminé que quand son tour a fini de ranger », son
 * étape de redémarrage a été sautée sur « 1 agent(s) travaillent encore », et le
 * démon a continué des heures sur l'ancien code. À 07:48, trois cartes de trois
 * projets ont été rangées d'office en « Terminé » par le balayage — exactement le
 * bogue que le correctif interdisait — et l'une d'elles a été déployée
 * automatiquement à 07:49, vingt minutes avant que son agent n'ait fini.
 *
 * UN CORRECTIF QUI DORT SUR LE DISQUE N'EN EST PAS UN. La règle rend donc
 * `retenir` dans les DEUX cas d'attente, et c'est cette demande retenue que le
 * filet de veille rejoue toutes les quinze secondes.
 */
export interface MondeEtapeRedemarrage {
  /** Le code construit est-il plus récent que le démon en marche ? */
  redemarrageNecessaire: boolean;
  /** Agents au travail, TOUS PROJETS : le démon les porte tous. */
  agents: number;
  /** Ce que fait chacun, en une phrase courte. */
  agentsDetail?: string[];
  /** Les AUTRES publications en cours — jamais celle qui pose la question. */
  autresPublications: string[];
}

export interface EtapeRedemarrage {
  /** « done » : le redémarrage part. « skipped » : il ne part pas maintenant. */
  etat: 'done' | 'skipped';
  /**
   * Le redémarrage doit-il être DEMANDÉ à la fin de la publication ? Vrai aussi
   * bien quand il peut partir tout de suite que quand il devra attendre : c'est
   * `demanderRedemarrage` qui tranche, et qui le RETIENT jusqu'à ce que la voie
   * soit libre.
   */
  retenir: boolean;
  /** Ce qui s'écrit dans l'étape, lisible par qui relit la publication. */
  message: string;
}

/**
 * La phrase de l'étape quand des agents retiennent le redémarrage. Elle promet
 * un départ AUTOMATIQUE : plus aucun renvoi vers un geste à la main, que
 * personne n'a de raison de venir faire.
 */
function attenteDesAgents(agents: number, detail?: string[]): string {
  const liste = listeDesAgents(detail, agents);
  const qui =
    agents === 1
      ? `Un agent travaille encore${liste} : le redémarrage est RETENU pour ne pas couper son travail.`
      : `${agents} agents travaillent encore${liste} : le redémarrage est RETENU pour ne pas couper leur travail.`;
  return `${qui} Il partira tout seul dès le dernier travail fini.`;
}

/**
 * Ce que l'étape « redémarrage » d'une publication de HaikoDev doit faire.
 *
 * Quatre situations, et une seule ne retient rien : celle où il n'y a rien à
 * recharger (seule l'interface a changé). Les deux attentes retiennent, la voie
 * libre part.
 */
export function etapeDeRedemarrageDePublication(monde: MondeEtapeRedemarrage): EtapeRedemarrage {
  if (!monde.redemarrageNecessaire) {
    return {
      etat: 'skipped',
      retenir: false,
      message: 'Seule l’interface a changé : le serveur en place sert déjà le bon code.',
    };
  }

  const autres = monde.autresPublications.filter((n) => n.trim());
  if (monde.agents > 0) {
    return {
      etat: 'skipped',
      retenir: true,
      message: attenteDesAgents(monde.agents, monde.agentsDetail),
    };
  }
  if (autres.length > 0) {
    const noms = autres.map((n) => `« ${n} »`).join(', ');
    return {
      etat: 'skipped',
      retenir: true,
      message: `${autres.length} autre(s) publication(s) en cours (${noms}) : le redémarrage est RETENU pour ne pas les couper. Il partira tout seul dès la dernière terminée.`,
    };
  }
  return {
    etat: 'done',
    retenir: true,
    message: 'Le serveur redémarre : il repart avec le nouveau code en quelques secondes.',
  };
}
