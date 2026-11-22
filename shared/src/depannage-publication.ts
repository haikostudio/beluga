/**
 * « RÉSOUDRE LE PROBLÈME » — LE DÉPANNAGE D'UNE PUBLICATION TOMBÉE, À LA MAIN.
 *
 * Depuis le 17/11/2026, une publication (déploiement ou mise en production) qui tombe OUVRE D'ELLE-MÊME un AGENT de
 * dépannage (deux fois au plus, `MAX_DEPANNAGES_AUTOMATIQUES`) ; le clic sur sa ligne ouvre son fil. À la fin de chacun
 * de ses tours, la MÊME publication reprend à l'étape tombée (`repriseApresLeTour`), sauf question en attente.
 *
 * Ce fichier porte les règles SANS base ni disque :
 *   - quand le bouton s'offre (`publicationADepanner`) ;
 *   - quand l'agent compte encore comme vivant (`depanneurVivant`) — c'est ce
 *     qui fait du même bouton la porte de retour vers lui, et qui interdit d'en
 *     ouvrir un second ;
 *   - quelles vignettes « Tableaux de bord » montre (`depannagesDeLaBande`) ;
 *   - la demande envoyée à l'agent (`demandeDeDepannage`).
 */


/** Ce que la règle lit d'une publication. */
export interface PublicationPourLeDepannage {
  id: string;
  state: string;
  cible?: 'dev' | 'production';
  depannage?: { agentId: string; at: number; relanceDemandee?: number; automatique?: boolean };
  error?: string;
  steps?: readonly { key: string; state: string }[];
}

/** Ce que la règle lit d'un agent. */
export interface AgentPourLeDepannage {
  id: string;
  status?: string;
  tourVivantDepuis?: number;
  attendReponse?: boolean;
  endedAt?: number;
  startedAt?: number;
  depannagePublication?: { runId: string; cible: 'dev' | 'production' };
}

/**
 * LE BOUTON NE S'OFFRE QUE SUR UNE PUBLICATION TOMBÉE OU ARRÊTÉE, et seulement
 * sur la DERNIÈRE du projet : relancer une publication passée depuis sa relecture
 * referait partir un lot que la suivante a déjà remplacé.
 */
export function publicationADepanner(
  run: PublicationPourLeDepannage | null | undefined,
  derniere: { id: string } | null | undefined,
): boolean {
  if (!run || !derniere || derniere.id !== run.id) return false;
  return run.state === 'failed' || run.state === 'stopped';
}

/**
 * LE PLAFOND DES DÉPANNAGES AUTOMATIQUES D'UNE PUBLICATION (décidé au cadrage, 17/11/2026) : après deux cycles
 * « dépanneur → reprise » qui retombent, plus rien ne repart seul — la ligne reste rouge et attend un clic.
 */
export const MAX_DEPANNAGES_AUTOMATIQUES = 2;

/** Une chute ouvre-t-elle d'elle-même un dépanneur ? Pas au-delà du plafond, ni sur une publication arrêtée. */
export function depannageAutomatiquePermis(run: { state: string; depannagesAuto?: number }): boolean {
  return run.state === 'failed' && (run.depannagesAuto ?? 0) < MAX_DEPANNAGES_AUTOMATIQUES;
}

/**
 * LE TOUR DU DÉPANNEUR EST FINI : faut-il reprendre la publication ? Oui, sauf s'il attend une réponse de l'utilisateur
 * (rien ne repart avant), s'il a des demandes en file (sans quota : il n'a pas travaillé), ou si la publication n'est
 * plus à dépanner (une autre est partie, ou elle a déjà repris).
 */
export function repriseApresLeTour(input: {
  agent: { status: string; tourVivantDepuis?: number; attendReponse?: boolean } | null | undefined;
  aDesDemandesEnFile: boolean;
  aDepanner: boolean;
}): 'attendre' | 'reprendre' | 'abandonner' {
  const { agent } = input;
  if (!agent || !input.aDepanner) return 'abandonner';
  if (agent.status === 'running' || agent.status === 'starting' || agent.tourVivantDepuis !== undefined) return 'attendre';
  if (agent.attendReponse) return 'attendre';
  if (input.aDesDemandesEnFile) return 'abandonner';
  return 'reprendre';
}

/**
 * L'AGENT DE DÉPANNAGE TRAVAILLE-T-IL ENCORE ? Un tour vivant, un démarrage, ou
 * une question posée qui attend la réponse : dans ces trois cas, le bouton le
 * ROUVRE au lieu d'en appeler un autre.
 */
export function depanneurVivant(agent: AgentPourLeDepannage | null | undefined): boolean {
  if (!agent) return false;
  if (agent.status === 'running' || agent.status === 'starting') return true;
  if (agent.tourVivantDepuis !== undefined) return true;
  return agent.attendReponse === true;
}

/**
 * « RELANCER » NE S'OFFRE PAS PENDANT QU'UN AGENT DÉPANNE (décision de l'utilisateur, 21/11/2026, « Dépannage de
 * publication discret » : « il y a quand même un bouton relancer alors que l'agent est déjà en train de le faire »).
 * Tant que le dépanneur tient son tour, démarre, ou attend la réponse à sa question, la publication reprendra d'elle-même
 * à la fin de son travail : le bouton se tait. Il revient dès que plus aucun dépanneur ne vit — dépannage fini sans
 * reprise, refusé faute de quota (`refusAuto`), plafond atteint (`enAttenteDeVous`), ou dépanneur introuvable : une
 * publication tombée n'est JAMAIS laissée sans issue.
 */
export function relanceOfferte(
  run: { state: string } | null | undefined,
  depanneur: AgentPourLeDepannage | null | undefined,
): boolean {
  if (!run || (run.state !== 'failed' && run.state !== 'stopped')) return false;
  return !depanneurVivant(depanneur);
}

/**
 * LES VIGNETTES « DÉPANNAGE » D'« ACTIFS » : chaque agent de dépannage vivant
 * (au travail ou arrêté sur sa question), le plus récent d'abord.
 */
export function depannagesDeLaBande<T extends AgentPourLeDepannage>(agents: readonly T[]): T[] {
  return agents
    .filter((agent) => !!agent.depannagePublication && depanneurVivant(agent))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * OÙ S'OUVRE UN AGENT DE PUBLICATION (rôle `deploy`) — la règle UNIQUE de
 * `ouvrirAgent` (web/src/app.tsx), que suivent la vignette « Dépannage » des
 * Tableaux de bord, le menu Agents, la cloche et les notifications.
 *
 * Trois familles partagent ce rôle, et chacune a SON volet :
 *   - l'agent de CONFIGURATION de la production → le tiroir du bandeau, onglet
 *     « Conversation » (`configuration`) ;
 *   - le DÉPANNEUR d'une publication → le volet de SA cible, lue sur son
 *     marquage : `dev` = volet du déploiement, `production` = tiroir du bandeau ;
 *   - le CONDUCTEUR d'une publication → le volet de la cible de sa publication,
 *     quand elle est connue de l'écran ; sinon la production, comme avant.
 *
 * C'était la panne : tout agent `deploy` partait vers le tiroir de production,
 * et un dépanneur du DÉPLOIEMENT y ouvrait le mauvais volet — sur l'onglet
 * « Conversation » d'un projet sans procédure, ce qui lançait en plus l'agent
 * de configuration (DEC-256).
 */
export type VoletDeLAgent = 'configuration' | 'dev' | 'production';

export function voletDeLAgentDePublication(input: {
  agent: {
    id: string;
    depannagePublication?: { cible: 'dev' | 'production' };
    /** L'agent de réparation silencieuse d'une étape : le volet de SA cible, comme le dépanneur. */
    reparationPublication?: { cible: 'dev' | 'production' };
  };
  /** L'agent de configuration retenu sur le projet (`miseEnProduction.agentId`). */
  configurationId?: string;
  /** La dernière publication du projet connue de l'écran. */
  derniere?: { agentId?: string; cible?: 'dev' | 'production' } | null;
}): VoletDeLAgent {
  const { agent, configurationId, derniere } = input;
  if (agent.depannagePublication) return agent.depannagePublication.cible;
  if (agent.reparationPublication) return agent.reparationPublication.cible;
  if (configurationId && configurationId === agent.id) return 'configuration';
  if (derniere?.agentId === agent.id) return derniere.cible ?? 'dev';
  return 'production';
}

/** Le titre de l'agent, lisible dans la pile et sur sa vignette. */
export function titreDuDepanneur(cible: 'dev' | 'production' | undefined): string {
  return cible === 'production' ? 'Dépannage de la mise en production' : 'Dépannage du déploiement';
}

/** Ce que la demande nomme de la panne. */
export interface PanneAResoudre {
  projet: string;
  dossier: string;
  cible: 'dev' | 'production' | undefined;
  /** Le libellé de l'étape tombée, s'il y en a une. */
  etape?: string;
  /** Le message d'erreur de la publication. */
  erreur?: string;
  /** La fin du journal de l'étape tombée. */
  journal?: string;
  branche?: string;
  /** Qui a lancé le dépannage : le bouton (défaut) ou le démon, à la chute. */
  origine?: 'manuel' | 'automatique';
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT : ce qui est tombé, où, et ce qu'on attend de
 * lui. La consigne système (`CONSIGNE_DEPANNAGE_MANUEL`) porte les interdits ;
 * ici, seulement les faits de CETTE panne.
 */
export function demandeDeDepannage(panne: PanneAResoudre): string {
  const quoi = panne.cible === 'production' ? 'la mise en production' : 'le déploiement';
  const lignes = [
    panne.origine === 'automatique'
      ? `${quoi[0].toUpperCase()}${quoi.slice(1)} du projet « ${panne.projet} » est tombé${panne.cible === 'production' ? 'e' : ''} ; le dépannage a été lancé automatiquement.`
      : `L'utilisateur a cliqué « Résoudre le problème » : ${quoi} du projet « ${panne.projet} » est tombé${panne.cible === 'production' ? 'e' : ''}.`,
    `Dossier du projet : ${panne.dossier}`,
    panne.branche ? `Branche concernée : ${panne.branche}` : null,
    panne.etape ? `Étape tombée : « ${panne.etape} »` : "Étape tombée : inconnue (la publication s'est arrêtée sans en marquer une).",
    panne.erreur ? `Message de la publication : ${panne.erreur}` : null,
    panne.journal?.trim() ? `Fin du journal de l'étape :\n\`\`\`\n${panne.journal.trim()}\n\`\`\`` : null,
    '',
    'Trouve la cause et répare-la. À LA FIN DE TON TOUR, LA MÊME PUBLICATION REPART D’ELLE-MÊME à l’étape tombée (tu peux aussi appeler « relancer_publication ») — sauf si tu poses une question à l’utilisateur par « ask_user » : rien ne repart avant sa réponse. Pose-en une seulement si une décision lui revient vraiment. Termine par une phrase simple qui dit ce qui bloquait et ce que tu as réparé.',
  ];
  return lignes.filter((ligne) => ligne !== null).join('\n');
}
