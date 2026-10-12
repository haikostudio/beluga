/**
 * LES AGENTS DE CONFIGURATION DES DEUX ÉTAPES — le dialogue avec l'agent.
 *
 * Refonte du 22/09/2026, complétée le 29/09/2026. La MISE EN PRODUCTION part
 * d'une page blanche : tant que le projet n'a pas de PROCESSUS, rien ne peut
 * partir. Le DÉPLOIEMENT a le sien aussi, et depuis le 10/10/2026 il est
 * EXIGÉ de la même façon : un projet sans processus de déploiement ne déploie
 * pas — il passait pour prêt, et son déploiement sautait reconstruction et
 * redémarrage avant de se dire réussi. Seuls Beluga (son déroulé propre) et les
 * projets marqués `herite` (ils déployaient déjà par commande ou service,
 * migration 117) gardent le déroulé commun (`publication-simple.ts`) sans
 * initialisation. Pour chaque étape, un agent étudie le
 * projet, INTERROGE l'utilisateur (outil ask_user) puis rend le processus —
 * une suite d'étapes que le bouton déroulera ensuite telle quelle, sans agent.
 * Sa conversation vit dans la rubrique de son étape, dans les réglages du
 * projet ; le processus rendu s'y lit juste au-dessus (`processus-en-place.ts`).
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

import type { CiblePublication } from './etapes-publication.js';
import { agentSystemeTermine } from './cartes-systeme.js';
import { BANDE_GARDE_UN_FINI_MS } from './en-route.js';
import { agentTientSonTour } from './travail-en-cours.js';
import {
  aUnProcessus,
  lireProcessusRendu,
  processusEnTexte,
  type ProcessusDeProduction,
} from './publication-simple.js';

export type ProjetAvecProcedures = {
  isSelf?: boolean;
  miseEnProduction?: { processus?: ProcessusDeProduction; agentId?: string };
  deploiement?: { processus?: ProcessusDeProduction; agentId?: string; herite?: boolean };
};

/** Le projet a-t-il un processus de déploiement écrit par son agent ? */
export function aUnProcessusDeDeploiement(projet: ProjetAvecProcedures | undefined): boolean {
  return (projet?.deploiement?.processus?.etapes?.length ?? 0) > 0;
}

/**
 * L'étape est-elle prête à partir ? Chacune seulement quand son processus a
 * été écrit. Le déploiement garde deux exceptions : Beluga lui-même (son
 * déroulé propre), et un projet marqué `herite`, qui déployait déjà par
 * commande ou service avant cette règle. Jamais déduit de la commande ou du
 * service : le montage pré-remplit le service constaté.
 */
export function procedureEnPlace(projet: ProjetAvecProcedures | undefined, cible: CiblePublication): boolean {
  if (cible === 'production') return aUnProcessus(projet);
  return !!projet?.isSelf || aUnProcessusDeDeploiement(projet) || projet?.deploiement?.herite === true;
}

/**
 * LE BOUTON QUI MÈNE À L'AGENT DE CONFIGURATION. Il disait « Initialiser la
 * mise en production » ; il rouvre désormais la MÊME conversation, qu'elle
 * commence ou qu'elle reprenne : un seul libellé pour les deux.
 */
export function libelleInitier(_cible?: CiblePublication): string {
  return 'Configuration de la procédure';
}

/**
 * LE BOUTON D'EN-TÊTE DES RUBRIQUES « DÉPLOIEMENT » ET « MISE EN PRODUCTION »
 * (30/09/2026). Posé en haut à droite du titre, il ouvre le tiroir de l'agent
 * de configuration, et son libellé dit où l'on en est :
 *   - `question` : l'agent est arrêté sur sa question (ask_user) ;
 *   - `travail` : il tient son tour — une roue tourne à côté du libellé ;
 *   - `reconfigurer` : un processus est écrit et l'agent est au repos ;
 *   - `initialiser` : aucun processus encore.
 * La question passe avant le travail : un agent arrêté sur sa question n'est
 * en travail pour personne.
 */
export type EtatDuBoutonDeConfiguration = 'initialiser' | 'travail' | 'question' | 'reconfigurer';

export function etatDuBoutonDeConfiguration(entree: {
  processus: boolean;
  auTravail: boolean;
  question: boolean;
}): EtatDuBoutonDeConfiguration {
  if (entree.question) return 'question';
  if (entree.auTravail) return 'travail';
  return entree.processus ? 'reconfigurer' : 'initialiser';
}

export const LIBELLE_BOUTON_DE_CONFIGURATION: Record<EtatDuBoutonDeConfiguration, string> = {
  initialiser: 'Initialiser',
  travail: 'Agent au travail…',
  question: 'Répondre à l’agent',
  reconfigurer: 'Reconfigurer',
};

/* ------------------------------------------------------------------ */
/* OÙ EN EST UNE ÉTAPE : la phrase d'état et les trois repères          */
/* ------------------------------------------------------------------ */

/**
 * OÙ EN EST UNE ÉTAPE DE PUBLICATION (11/10/2026). Les rubriques
 * « Déploiement » et « Mise en production » s'ouvraient sur des champs, un
 * journal d'étude et un processus déplié : « on ne comprend rien, trop
 * d'informations ». Elles s'ouvrent désormais sur UNE phrase d'état et trois
 * repères, et cette règle dit laquelle :
 *   - `question` : l'agent de configuration attend une réponse (ask_user) ;
 *   - `etude` : il tient son tour — il étudie le projet, ou réécrit le processus ;
 *   - `a-configurer` : rien n'est en place, l'étape ne peut pas partir ;
 *   - `a-reverifier` : l'étape peut partir, mais un réglage qui décide du
 *     processus a changé depuis son écriture ;
 *   - `pret` : l'étape peut partir, et rien n'a bougé depuis.
 * Même ordre que le bouton (`etatDuBoutonDeConfiguration`) : la question passe
 * avant le travail, et l'agent au travail avant ce qui est déjà en place.
 *
 * Elle ne lit que ce que la rubrique sait déjà : aucune donnée neuve du serveur.
 */
export type EtatDeLEtapeDePublication = 'a-configurer' | 'etude' | 'question' | 'pret' | 'a-reverifier';

/** Ce que la rubrique sait de son étape, au moment où elle s'affiche. */
export type SituationDeLEtape = {
  /**
   * L'étape peut partir (`procedureEnPlace`) : son processus est écrit, ou le
   * déroulé commun la sert (Beluga, projet hérité). Jamais déduit d'un champ.
   */
  enPlace: boolean;
  /** L'agent de configuration tient son tour. */
  auTravail: boolean;
  /** L'agent de configuration est arrêté sur sa question. */
  question: boolean;
  /** Un réglage a changé depuis l'écriture du processus (`reglagesChangesDepuisLeProcessus`). */
  reglagesChanges: boolean;
};

export function etatDeLEtapeDePublication(situation: SituationDeLEtape): EtatDeLEtapeDePublication {
  if (situation.question) return 'question';
  if (situation.auTravail) return 'etude';
  if (!situation.enPlace) return 'a-configurer';
  return situation.reglagesChanges ? 'a-reverifier' : 'pret';
}

/**
 * LES TROIS REPÈRES D'AVANCEMENT, dans l'ordre : l'étude de l'agent, le
 * processus établi, puis l'étape prête. Le dernier ne dit « Essai réussi » que
 * sur PREUVE (`essaiReussiConnu`) ; sans elle il dit « Prêt à partir », qui est
 * vrai dans tous les cas — l'écran n'annonce jamais un essai qu'il n'a pas vu.
 */
export type RepereDAvancement = {
  cle: 'etude' | 'processus' | 'pret' | 'essai' | 'a-reverifier';
  etat: 'fait' | 'en-cours' | 'a-faire' | 'a-revoir';
};

export const LIBELLE_REPERE_D_AVANCEMENT: Record<RepereDAvancement['cle'], string> = {
  etude: 'Étude',
  processus: 'Processus établi',
  pret: 'Prêt à partir',
  essai: 'Essai réussi',
  'a-reverifier': 'À revérifier',
};

export function reperesDAvancement(
  situation: SituationDeLEtape & {
    /** Un processus propre au projet est écrit (`processusDeLEtape`) : l'étude a donc abouti. */
    processus: boolean;
    /** Une publication réussie de cette étape est connue de l'écran (`essaiReussiConnu`). */
    essaiReussi: boolean;
  },
): RepereDAvancement[] {
  const etudie = situation.question || situation.auTravail;
  /* Le dernier repère tant que rien ne peut partir : le but à atteindre. */
  let dernier: RepereDAvancement = { cle: 'essai', etat: 'a-faire' };
  if (situation.enPlace) {
    if (situation.reglagesChanges) dernier = { cle: 'a-reverifier', etat: 'a-revoir' };
    else dernier = { cle: situation.essaiReussi ? 'essai' : 'pret', etat: 'fait' };
  }
  return [
    /* Une étude qui reprend sur un processus déjà écrit est bien EN COURS. */
    { cle: 'etude', etat: etudie ? 'en-cours' : situation.processus ? 'fait' : 'a-faire' },
    /* Le déroulé commun en service vaut un processus établi : c'est lui qui part. */
    { cle: 'processus', etat: situation.enPlace ? 'fait' : 'a-faire' },
    dernier,
  ];
}

/** Ce que l'écran garde de la dernière publication d'un projet (son magasin, `deploys`). */
export type DernierePublicationConnue = {
  state?: string;
  cible?: CiblePublication;
  startedAt?: number;
  endedAt?: number;
};

/**
 * UN ESSAI RÉUSSI EST-IL CONNU ? Deux preuves, l'une ou l'autre suffit :
 *
 *  - LA DERNIÈRE RÉUSSITE DE L'ÉTAPE, DITE PAR LE SERVEUR (`derniereReussite`,
 *    commande `deploy.reussites`). C'est elle qui rend le repère STABLE : elle
 *    ne dépend pas de la publication la plus récente du projet.
 *  - la dernière publication que l'écran garde du projet, quand elle est bien
 *    de CETTE étape (une publication sans étape est un déploiement, celui du
 *    lot de « À déployer ») et qu'elle a réussi. L'écran n'en garde qu'UNE par
 *    projet, toutes étapes confondues : seule, cette preuve retombait dès que
 *    l'autre étape publiait. Elle reste, pour l'instant où la publication vient
 *    de finir et où le serveur n'a pas encore été relu.
 *
 * Dans les deux cas la réussite ne compte que si elle n'est pas plus vieille
 * que le processus : un processus récrit depuis n'a pas encore fait ses
 * preuves. L'absence de preuve n'est jamais lue comme un échec — le repère dit
 * alors « Prêt à partir », rien de plus.
 */
export function essaiReussiConnu(
  publication: DernierePublicationConnue | undefined,
  cible: CiblePublication,
  processusEcritLe?: number,
  derniereReussite?: number | null,
): boolean {
  const assezRecente = (le: number) => !processusEcritLe || le >= processusEcritLe;
  if (derniereReussite && assezRecente(derniereReussite)) return true;
  if (!publication || publication.state !== 'success') return false;
  if ((publication.cible ?? 'dev') !== cible) return false;
  return assezRecente(publication.endedAt ?? publication.startedAt ?? 0);
}

/** Combien de phrases la rubrique garde pour dire pourquoi ce processus. */
export const PHRASES_DU_POURQUOI_MAX = 2;

/**
 * POURQUOI CE PROCESSUS, EN DEUX PHRASES AU PLUS. La rubrique montrait le récit
 * entier de l'agent (« Étude de l'agent ») : un journal de plusieurs écrans,
 * qui commence par ce qu'il était en train de vérifier. On garde le RÉSUMÉ que
 * l'agent rend avec son processus — il lui est demandé en deux phrases — et, à
 * défaut (processus sans résumé), le début de son explication. Les marques de
 * mise en forme sont retirées : ce texte se lit tel quel, sans rendu.
 */
export function pourquoiCeProcessus(
  processus: Pick<ProcessusDeProduction, 'resume' | 'explication'> | undefined,
): string {
  const source = processus?.resume?.trim() || processus?.explication?.trim() || '';
  return premieresPhrases(sansMiseEnForme(source), PHRASES_DU_POURQUOI_MAX);
}

/** Un texte d'agent ramené à une ligne : ni titres, ni gras, ni puces. */
function sansMiseEnForme(texte: string): string {
  return texte
    .split('\n')
    .filter((ligne) => !/^\s*#{1,6}\s/.test(ligne))
    .map((ligne) => ligne.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Les `max` premières phrases d'un texte. Une phrase finit sur un point (ou
 * « ! », « ? », « … ») suivi d'une espace et d'une majuscule : le point d'une
 * adresse (« 46.224.231.253 », « kipou.app, ») ne coupe donc rien.
 */
function premieresPhrases(texte: string, max: number): string {
  const fin = /[.!?…]+["»”)]*(?=\s+[\p{Lu}«“"(]|\s*$)/gu;
  let compte = 0;
  for (let trouve = fin.exec(texte); trouve; trouve = fin.exec(texte)) {
    compte += 1;
    if (compte === max) return texte.slice(0, trouve.index + trouve[0].length).trim();
  }
  return texte;
}

/** L'agent de configuration retenu sur le projet pour cette étape, s'il y en a un. */
export function agentDeConfiguration(
  projet: ProjetAvecProcedures | undefined,
  cible: CiblePublication = 'production',
): string | undefined {
  return (cible === 'dev' ? projet?.deploiement?.agentId : projet?.miseEnProduction?.agentId) || undefined;
}

/** L'étape dont cet agent est l'agent de configuration, ou `null`. */
export function etapeDeLAgentDeConfiguration(
  projet: ProjetAvecProcedures | undefined,
  agentId: string | undefined,
): CiblePublication | null {
  if (!agentId) return null;
  if (projet?.miseEnProduction?.agentId === agentId) return 'production';
  if (projet?.deploiement?.agentId === agentId) return 'dev';
  return null;
}

/**
 * LE SUIVI DE L'INITIALISATION — ce que montrent le bandeau du bas et la
 * vignette spéciale de « En cours » pendant que l'agent de configuration
 * travaille (demande du 26/09/2026 : la zone droite du bandeau restait vide et
 * rien, au tableau, ne disait qu'un agent écrivait la procédure).
 *
 * L'agent n'a ni carte ni branche (DEC-256) : ce n'est PAS une carte, et la
 * vignette ne compte ni dans le compteur de la colonne ni dans son avancement.
 *   - `demarre` / `travail` : il tient son tour (`agentTientSonTour`) ;
 *   - `question` : il attend la réponse de l'utilisateur (ask_user) ;
 *   - `fini` : il vient de finir, depuis moins d'une minute (la même garde que
 *     la bande des agents sans carte) — le BANDEAU le dit, la vignette non ;
 *   - `null` : rien à suivre (pas d'agent retenu, ou agent au repos).
 */
export type EtatDeLInitialisation = 'demarre' | 'travail' | 'question' | 'fini';

export interface AgentPourLInitialisation {
  id: string;
  status?: string;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  endedAt?: number;
}

export function etatDeLInitialisation(
  projet: ProjetAvecProcedures | undefined,
  agent: AgentPourLInitialisation | null | undefined,
  maintenant: number,
  cible: CiblePublication = 'production',
): EtatDeLInitialisation | null {
  const retenu = agentDeConfiguration(projet, cible);
  if (!retenu || !agent || agent.id !== retenu) return null;
  if (agent.attendReponse === true) return 'question';
  if (agentTientSonTour(agent)) return agent.status === 'starting' ? 'demarre' : 'travail';
  if (agent.endedAt && maintenant - agent.endedAt < BANDE_GARDE_UN_FINI_MS) return 'fini';
  return null;
}

/** La vignette de « En cours » : seulement tant que l'agent travaille ou attend. */
export function vignetteDInitialisationVisible(etat: EtatDeLInitialisation | null): boolean {
  return etat === 'demarre' || etat === 'travail' || etat === 'question';
}

/**
 * L'ÉTAT DE LA VIGNETTE (la carte Système de l'agent de configuration), qui
 * n'est PAS celui du bandeau : le bandeau oublie « terminé » au bout d'une
 * minute (`etatDeLInitialisation`), la vignette, elle, dit « fini » pendant
 * 24 heures (`agentSystemeTermine`, 06/10/2026) — dans « Archiver » des
 * Tableaux de bord ; le tableau d'un projet ne la garde que tant qu'elle est
 * active (`vignetteDInitialisationVisible`). `null` : pas de vignette.
 */
export function etatDeLaVignetteDInitialisation(
  projet: ProjetAvecProcedures | undefined,
  agent: AgentPourLInitialisation | null | undefined,
  maintenant: number,
  cible: CiblePublication = 'production',
): EtatDeLInitialisation | null {
  const retenu = agentDeConfiguration(projet, cible);
  if (!retenu || !agent || agent.id !== retenu) return null;
  const etat = etatDeLInitialisation(projet, agent, maintenant, cible);
  if (vignetteDInitialisationVisible(etat)) return etat;
  return agentSystemeTermine(agent, maintenant) ? 'fini' : null;
}

/* ------------------------------------------------------------------ */
/* LE TOUR NE SE LIVRE PLUS PAR LA RÉPONSE D'UNE REQUÊTE                */
/* ------------------------------------------------------------------ */

/**
 * Un tour de ce tiroir dure une à deux MINUTES : l'agent lit tout le projet
 * avant de parler. Faire attendre la réponse d'une commande pendant tout ce
 * temps rendait le dialogue impossible à suivre et surtout impossible à
 * RATTRAPER — tiroir refermé, page rechargée, serveur redémarré, réseau qui
 * cligne : la question, déjà payée, était perdue sans un mot, et chaque
 * réouverture repayait un tour.
 *
 * Le dialogue vit donc SUR LE SERVEUR, et l'écran ne fait que le suivre. Les
 * règles qui suivent sont pures : elles disent quoi afficher et quand relancer,
 * sans base ni disque.
 */

/** Une bulle du dialogue : ce que l'agent a dit, ce qu'on lui a répondu. */
export type EchangeDeProcedure = { qui: 'agent' | 'moi'; texte: string };

/**
 * LA QUESTION QUE L'AGENT POSE AVEC SON OUTIL, portée jusqu'à sa conversation.
 *
 * Un agent ne finit pas un tour sur une question écrite en texte : la méthode
 * du projet lui impose l'outil `ask_user`, qui ARRÊTE son tour jusqu'à la
 * réponse. Cette question-là s'affichait donc dans la cloche du bandeau (avec
 * toutes les autres décisions attendues) mais NULLE PART dans le tiroir ouvert
 * juste dessous — celui-ci restait sur « L'agent travaille… », sans rien à
 * répondre, alors que c'est exactement l'endroit où on l'attend.
 *
 * L'état du dialogue la porte donc, avec de quoi y répondre sur place :
 * le message qui la tient et son identifiant, comme partout ailleurs.
 */
export type QuestionDeProcedure = {
  messageId: string;
  questionId: string;
  texte: string;
  /** Les choix proposés, quand l'agent en propose : un clic répond. */
  options: { id: string; label: string; description?: string }[];
};

/** Le dialogue d'une étape, tel que le serveur le garde et l'écran l'affiche. */
export type EtatDeProcedure = {
  projectId: string;
  cible: CiblePublication;
  /** L'agent qui mène le dialogue : la question et la réponse dans une session. */
  agentId?: string;
  /** Un tour tourne-t-il en ce moment ? C'est LUI qui allume le témoin. */
  enCours: boolean;
  echanges: EchangeDeProcedure[];
  /** La procédure écrite ET enregistrée, quand le dialogue aboutit. */
  procedure?: string;
  /** Ce qui a empêché le tour d'aboutir, dit en clair. */
  raison?: string;
  /**
   * L'instant où le DERNIER tour est parti : de quoi afficher sa durée pendant
   * qu'il tourne, et de quoi juger ensuite si sa question est encore fraîche.
   * Il n'est donc PAS effacé à la fin du tour — sinon toute question posée
   * tiroir fermé paraissait vieille et se repayait à la réouverture.
   */
  depuis?: number;
  /** La question posée par l'outil de l'agent, tant que personne n'y a répondu. */
  question?: QuestionDeProcedure;
  /**
   * DEPUIS QUAND L'AGENT EST ARRÊTÉ SUR SA QUESTION, lu dans le registre des
   * attentes du serveur — le même pour tous les agents, quelle que soit leur
   * origine (`shared/src/attente-question.ts`). Présent : le témoin dit
   * l'attente et son chronomètre se fige ici. Absent : l'agent travaille
   * vraiment, ou plus rien ne tourne.
   */
  attendDepuis?: number;
};

/**
 * Le témoin de travail : jamais un mot seul, toujours ce qui se passe et depuis
 * quand.
 *
 * …SAUF QUAND L'AGENT ATTEND UNE RÉPONSE. Son appel d'outil est arrêté sur la
 * question affichée juste au-dessus : il ne travaille plus, et l'étape que le
 * moteur avait annoncée en dernier (« Outil ask_user ») ne décrit plus rien.
 * Le témoin dit alors l'attente, et son chronomètre s'arrête à l'instant de la
 * question — le temps de RÉPONDRE n'est pas du temps de travail
 * (`instantDuTemoin`, `shared/src/attente-question.ts`).
 */
/** Le tour attendu n'existe plus : le dire, au lieu de tourner sans fin. */
export const RAISON_TOUR_PERDU =
  'L’agent ne travaille plus sur cette question (serveur redémarré, ou agent arrêté). Rien n’a été écrit : reposez la question.';

/** Ce qu'un tour d'agent a rendu : une question, le processus, ou un échec dit en clair. */
export type IssueDuTour =
  | { question: string }
  /** Le processus, et l'explication en mots simples qui le précédait. */
  | { processus: ProcessusDeProduction; resume?: string }
  | { raison: string };

/**
 * L'ISSUE D'UN TOUR, décidée en un seul endroit. Sans bloc de processus, le
 * texte rendu est une question — l'agent devrait passer par ask_user, mais un
 * texte n'est jamais perdu. Un bloc illisible est dit, pas avalé.
 */
export function issueDuTour(input: { contenu?: string; statut?: string; erreur?: string }): IssueDuTour {
  const erreur = (input.erreur ?? '').trim();
  if (erreur) return { raison: `Le tour de l’agent s’est arrêté : ${erreur}` };
  if (input.statut && input.statut !== 'done') {
    return { raison: `Le tour de l’agent s’est terminé en « ${input.statut} », sans réponse.` };
  }
  const contenu = (input.contenu ?? '').trim();
  if (!contenu) return { raison: 'L’agent n’a rien rendu : aucune question, aucun processus.' };
  const lu = lireProcessusRendu(contenu);
  /* L'explication écrite avant le bloc VOYAGE avec le processus : c'est elle
     que la rubrique de l'étape affiche. */
  if (lu.processus) {
    return {
      processus: lu.explication ? { ...lu.processus, explication: lu.explication } : lu.processus,
      resume: lu.explication,
    };
  }
  if (lu.erreur) return { raison: `Le processus rendu est inutilisable : ${lu.erreur}` };
  return { question: contenu };
}
