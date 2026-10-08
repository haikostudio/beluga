/**
 * « RÉSOUDRE LE PROBLÈME » — LE DÉPANNAGE D'UNE PUBLICATION TOMBÉE, À LA MAIN.
 *
 * Une publication (déploiement ou mise en production) qui tombe s'arrête là :
 * rien ne la reprend toute seule. Le bouton « Résoudre le problème » du volet
 * ouvre un AGENT qui cherche la cause, la répare, puis relance lui-même la
 * publication par l'outil `relancer_publication` (`server/src/deploy.ts`).
 *
 * Ce fichier porte les règles SANS base ni disque :
 *   - quand le bouton s'offre (`publicationADepanner`) ;
 *   - quand l'agent compte encore comme vivant (`depanneurVivant`) — c'est ce
 *     qui fait du même bouton la porte de retour vers lui, et qui interdit d'en
 *     ouvrir un second ;
 *   - quelles vignettes « Tableaux de bord » montre (`depannagesDeLaBande`) ;
 *   - la demande envoyée à l'agent (`demandeDeDepannage`).
 */

import { agentSystemeTermine } from './cartes-systeme.js';
import { natureDePublication } from './mise-en-ligne.js';

/** Ce que la règle lit d'une publication. */
export interface PublicationPourLeDepannage {
  id: string;
  state: string;
  cible?: 'dev' | 'production';
  depannage?: { agentId: string; at: number; relanceDemandee?: number; automatique?: boolean };
  error?: string;
  steps?: readonly { key: string; state: string }[];
  /** Les dépanneurs automatiques déjà passés sur la chaîne de relances. */
  depannagesAuto?: number;
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
 * Combien de dépanneurs AUTOMATIQUES d'affilée, au plus, sur une chaîne de
 * relances : au-delà, l'humain reprend la main (le bouton reste offert).
 */
export const MAX_DEPANNAGES_AUTOMATIQUES = 2;

/**
 * LE DÉPANNEUR SE LANCE-T-IL TOUT SEUL À LA CHUTE DE LA PUBLICATION ?
 *
 * Oui seulement pour une publication CASSÉE (`natureDePublication`) : un arrêt
 * demandé, une coupure de redémarrage ou une machine saturée n'appellent jamais
 * d'agent (appeler un agent sur une saturation l'a DOUBLÉE le 08.09.2026). Il faut
 * aussi que ce soit la dernière du projet, qu'aucun dépanneur ne soit déjà lié,
 * et que la chaîne de relances n'ait pas épuisé son plafond.
 */
export function depannageAutomatiqueAPoser(
  run: PublicationPourLeDepannage | null | undefined,
  derniere: { id: string } | null | undefined,
): boolean {
  if (!run || !publicationADepanner(run, derniere)) return false;
  if (run.depannage) return false;
  const etapeTombee = run.steps?.find((step) => step.state === 'failed')?.key;
  const nature = natureDePublication({ etat: run.state as 'failed' | 'stopped', etapeTombee, motif: run.error });
  if (nature !== 'cassee') return false;
  return (run.depannagesAuto ?? 0) < MAX_DEPANNAGES_AUTOMATIQUES;
}

/** Le plafond de la chaîne est-il atteint sur une publication cassée ? (pour le DIRE) */
export function depannageAutomatiqueEpuise(run: PublicationPourLeDepannage | null | undefined): boolean {
  return !!run && (run.depannagesAuto ?? 0) >= MAX_DEPANNAGES_AUTOMATIQUES;
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
 * LES VIGNETTES « DÉPANNAGE » D'« ACTIFS » : chaque agent de dépannage vivant
 * (au travail ou arrêté sur sa question), le plus récent d'abord.
 */
export function depannagesDeLaBande<T extends AgentPourLeDepannage>(agents: readonly T[]): T[] {
  return agents
    .filter((agent) => !!agent.depannagePublication && depanneurVivant(agent))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * LES DÉPANNAGES FINIS DEPUIS MOINS DE 24 HEURES : leur vignette dans
 * « Archiver » (même règle que les agents sans carte, `agentSystemeTermine`),
 * la plus récente fin d'abord.
 */
export function depannagesTerminesDeLaBande<T extends AgentPourLeDepannage>(agents: readonly T[], maintenant: number): T[] {
  return agents
    .filter((agent) => !!agent.depannagePublication && !depanneurVivant(agent) && agentSystemeTermine(agent, maintenant))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
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
  agent: { id: string; depannagePublication?: { cible: 'dev' | 'production' } };
  /** L'agent de configuration retenu sur le projet (`miseEnProduction.agentId`). */
  configurationId?: string;
  /** La dernière publication du projet connue de l'écran. */
  derniere?: { agentId?: string; cible?: 'dev' | 'production' } | null;
}): VoletDeLAgent {
  const { agent, configurationId, derniere } = input;
  if (agent.depannagePublication) return agent.depannagePublication.cible;
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
    'Trouve la cause, répare-la, puis appelle « relancer_publication » : la même publication repartira à la fin de ton tour. Termine par une phrase simple qui dit ce qui bloquait, ce que tu as réparé, et si la relance est demandée.',
  ];
  return lignes.filter((ligne) => ligne !== null).join('\n');
}
