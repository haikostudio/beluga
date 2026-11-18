/**
 * TOUT AGENT SE SERT DE TOUS LES SERVICES, AVEC LES DROITS DE LA PERSONNE QUI
 * LUI PARLE (décision de l'utilisateur du 02/11/2026).
 *
 * Un agent n'a jamais plus que son INTERLOCUTEUR — le compte qui a écrit le
 * dernier message, cliqué « Lancer » ou répondu à sa question
 * (`server/src/interlocuteur.ts`). La règle ici est pure : à partir du rôle du
 * compte et de sa grille (`droits-d-acces.ts`), elle dit pour chaque service
 * « aucun », « lire » ou « agir ».
 *
 *  - Le propriétaire (administrateur) : tout.
 *  - Un accès tiers (membre, lecteur) : un service propre à un projet suit le
 *    niveau du projet (voir → lire ; travailler, déployer → agir) ; le
 *    coffre-fort suit EN PLUS sa ligne de service ; un service sans projet
 *    (les surveillances) lui reste fermé.
 *  - Un client de l'espace client ne pilote aucun agent : rien.
 *  - INTERLOCUTEUR INCONNU (tour lancé par le démon, ancienne conversation) :
 *    le droit le plus étroit — lire le seul projet de l'agent. Le démon ne
 *    tombe sur ce cas que quand des accès tiers existent : sans eux, le
 *    propriétaire est le seul interlocuteur possible.
 *
 * Les services réservés restent au propriétaire seul : aucun agent ne
 * les sert par cet outil.
 */
import type { RoleCompte } from './comptes-clients.js';
import { droitsDuCompte, niveauDuService, type DroitsDAcces } from './droits-d-acces.js';

export const SERVICES_DE_L_AGENT = [
  'messagerie',
  'surveillances',
  'backups',
  'statistiques',
  'medias',
  'recurrentes',
  'reseaux',
  'studio',
  'coffre',
  'memoire',
  'referencement',
] as const;
export type ServiceDeLAgent = (typeof SERVICES_DE_L_AGENT)[number];
export type AccesDeLAgent = 'aucun' | 'lire' | 'agir';

/** Les services qui ne vivent dans aucun projet : propriétaire seul. */
const SERVICES_SANS_PROJET: ReadonlySet<ServiceDeLAgent> = new Set(['surveillances']);
/**
 * Les services réservés au PROPRIÉTAIRE, même sur un projet ouvert à un accès tiers : l'audit SEO + GEO vit dans le
 * service Marketing, qui est à lui seul. Un tour lancé par le démon (interlocuteur inconnu) le LIT sur son projet.
 */
const SERVICES_DU_PROPRIETAIRE: ReadonlySet<ServiceDeLAgent> = new Set(['referencement']);

export const LIBELLE_DU_SERVICE_DE_L_AGENT: Readonly<Record<ServiceDeLAgent, string>> = {
  messagerie: 'Messagerie',
  surveillances: 'Surveillance',
  backups: 'Backup',
  statistiques: 'Statistiques',
  medias: 'Médias',
  recurrentes: 'Tâches récurrentes',
  reseaux: 'Réseaux sociaux',
  studio: 'Studio',
  coffre: 'Coffre-fort',
  memoire: 'Mémoire',
  referencement: 'Référencement SEO + GEO',
};

/** Ce que la règle lit d'un compte. */
export interface Interlocuteur {
  role: RoleCompte;
  projets: string[];
  droits?: DroitsDAcces;
}

const RANG: Record<AccesDeLAgent, number> = { aucun: 0, lire: 1, agir: 2 };

export function accesSuffit(acces: AccesDeLAgent, requis: Exclude<AccesDeLAgent, 'aucun'>): boolean {
  return RANG[acces] >= RANG[requis];
}

/**
 * L'ACCÈS DE L'AGENT À UN SERVICE, pour un projet donné. `projectId` absent :
 * le service pris globalement (une liste de tous les projets) — ouvert au seul
 * propriétaire.
 */
export function accesDeLAgent(entree: {
  interlocuteur: Interlocuteur | null;
  service: ServiceDeLAgent;
  projectId?: string | null;
  /** Le projet de l'agent : le seul lisible quand l'interlocuteur est inconnu. */
  projetDeLAgent?: string | null;
}): AccesDeLAgent {
  const { interlocuteur, service, projectId } = entree;
  if (!interlocuteur) {
    if (SERVICES_SANS_PROJET.has(service) || service === 'coffre') return 'aucun';
    return projectId && projectId === entree.projetDeLAgent ? 'lire' : 'aucun';
  }
  if (interlocuteur.role === 'admin') return 'agir';
  if (interlocuteur.role !== 'membre' && interlocuteur.role !== 'lecteur') return 'aucun';
  if (SERVICES_SANS_PROJET.has(service) || SERVICES_DU_PROPRIETAIRE.has(service) || !projectId) return 'aucun';
  const droits = droitsDuCompte({ role: interlocuteur.role, projets: interlocuteur.projets, droits: interlocuteur.droits });
  const niveau = droits.projets[projectId];
  if (!niveau) return 'aucun';
  const parLeProjet: AccesDeLAgent = niveau === 'voir' ? 'lire' : 'agir';
  if (service !== 'coffre') return parLeProjet;
  const coffre = niveauDuService(droits, 'coffre');
  if (coffre === 'aucun') return 'aucun';
  return coffre === 'voir' ? 'lire' : parLeProjet;
}

/**
 * LE REFUS DIT CE QUI EST FERMÉ ET POUR QUI — jamais « je n'ai pas les
 * droits » : l'agent le redit tel quel à la personne.
 */
export function refusDuService(service: ServiceDeLAgent, requis: Exclude<AccesDeLAgent, 'aucun'>, nomDuProjet?: string | null): string {
  const ou = nomDuProjet ? ` du projet « ${nomDuProjet} »` : '';
  const geste = requis === 'agir' ? 'en modification' : 'en lecture';
  return `Le service « ${LIBELLE_DU_SERVICE_DE_L_AGENT[service]} »${ou} n’est pas ouvert ${geste} à la personne qui te parle : dis-le-lui simplement ; c’est le propriétaire de l’application qui ouvre un accès, dans la grille de cet accès.`;
}

/** Ce que chaque service permet, en une ligne : le cœur du guide. */
const CE_QUE_FAIT: Readonly<Record<ServiceDeLAgent, { lire: string; agir: string }>> = {
  messagerie: {
    lire: 'lire les demandes et fils des clients',
    agir: 'préparer une réponse : un bouton « Envoyer au client » dans ta conversation, jamais envoyée par toi',
  },
  surveillances: { lire: 'lire l’état et l’historique des sites surveillés', agir: 'relancer un contrôle' },
  backups: { lire: 'lire les sauvegardes et leurs points', agir: 'lancer une sauvegarde' },
  statistiques: { lire: 'lire les visites (outil « statistiques »)', agir: 'régler le suivi des visites' },
  medias: { lire: 'lister les images, vidéos et sons déjà fabriqués', agir: 'les réutiliser' },
  recurrentes: { lire: 'lire les tâches récurrentes (veilles) et leur dernier contrôle', agir: 'en poser une sur ta carte (« veille_poser »)' },
  reseaux: {
    lire: 'lire les comptes reliés et les publications',
    agir: 'proposer une publication datée (texte, vidéo du Studio) : un bouton « Programmer » que l’utilisateur seul clique',
  },
  studio: {
    lire: 'lire les créations et leurs exports',
    agir: 'lancer une vidéo : une création du Studio avec son directeur artistique, suivie dans ta conversation ; sur celle que tu as demandée, la lire, la réexporter, transmettre une retouche au directeur et récupérer le fichier fini dans ton fil',
  },
  coffre: { lire: 'lire les accès (outil « coffre_fort »)', agir: 'enregistrer un accès' },
  memoire: { lire: 'chercher dans la mémoire du projet (outil « memoire »)', agir: 'y proposer un fait' },
  referencement: {
    lire: 'lire l’audit SEO + GEO d’un projet : notes, passage en cours, historique',
    agir: 'lancer un audit SEO + GEO (action « auditer ») quand la personne le DEMANDE — jamais de toi-même',
  },
};

/**
 * LE GUIDE DES SERVICES remis à chaque agent, réduit à ce que son
 * interlocuteur ouvre sur SON projet. Calculé à l'ouverture de la session (la
 * consigne système ne change pas d'un tour à l'autre) et gardé court : il se
 * repaie à chaque tour.
 */
export function guideDesServices(acces: Readonly<Partial<Record<ServiceDeLAgent, AccesDeLAgent>>>): string {
  const lignes: string[] = [];
  for (const service of SERVICES_DE_L_AGENT) {
    const a = acces[service] ?? 'aucun';
    if (a === 'aucun') continue;
    const fait = CE_QUE_FAIT[service];
    lignes.push(`- ${LIBELLE_DU_SERVICE_DE_L_AGENT[service]} : ${a === 'agir' ? `${fait.lire} ; ${fait.agir}` : `${fait.lire} (lecture seule)`}.`);
  }
  if (!lignes.length) return '';
  const studio = acces.studio === 'agir';
  const reseaux = acces.reseaux === 'agir';
  const enchainements = [
    studio ? 'Une VIDÉO demandée se fait TOUJOURS dans le Studio (« services », service studio, action « video ») : jamais montée par toi ; son avancement et ses boutons à prix paraissent dans ta conversation, version gratuite d’abord.' : '',
    studio && reseaux ? 'Visuel ou vidéo → publication proposée (service reseaux, action « proposer », avec la création) → suivi des visites (statistiques).' : '',
    'Rien ne se paie, ne se publie, ne se programme ni ne part à un client sans le clic de l’utilisateur.',
  ].filter(Boolean);
  return [
    'LES SERVICES DE BELUGA (outil « services », champ « projet » facultatif) — ouverts avec les droits de la personne qui te parle :',
    ...lignes,
    ...enchainements,
  ].join('\n');
}
