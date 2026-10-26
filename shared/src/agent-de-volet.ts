/**
 * LES AGENTS DE VOLET : ceux qui vivent dans leur PROPRE écran, pas sur le
 * tableau — l'atelier Marketing, l'agent d'une surveillance de site,
 * celui des sauvegardes (configuration, analyse, réparation). Ils ne livrent
 * aucun code : leur carte (`ouvrirCarteDAgent`) n'a ni branche ni copie de
 * travail, et elle ne sert qu'à les montrer au tableau pendant qu'ils tournent.
 *
 * CE QU'ON LEUR ÉCRIT LEUR ARRIVE, TOUJOURS. Un message tapé dans le volet de
 * surveillance d'InVia ouvrait une carte de cadrage sur le tableau, parce que la
 * carte de l'agent avait été emportée par une publication et passait donc pour
 * « déjà en ligne » (incident du 06.10.2026, carte 43a2796b). Un agent de volet
 * ne crée jamais de carte et ne rouvre jamais de cadrage à sa place : il répond
 * dans son volet.
 *
 * Le prédicat est pur pour servir les DEUX côtés : le démon (routage du
 * message, colonne de fin de tour, lot de publication) et le champ d'écriture
 * (qui n'annonce plus « ouvrira une nouvelle carte » dans un volet).
 *
 * Un cadrage ou un agent de tâche dans une copie de travail n'en est JAMAIS
 * un, même sous la même étiquette : la carte « Installer le suivi » porte
 * l'étiquette marketing.
 */
import { LABEL_BACKUP } from './backups-agent.js';
import { LABEL_MARKETING } from './marketing.js';
import { LABEL_SURVEILLANCE } from './surveillance.js';

/** Les étiquettes que pose la naissance d'un agent de volet sur sa carte. */
export const LABELS_DE_VOLET: readonly string[] = [LABEL_MARKETING, LABEL_SURVEILLANCE, LABEL_BACKUP];

export function estAgentDeVolet(
  agent: { role?: string; workdir?: string | null } | null | undefined,
  carte: { labels?: readonly string[] | null } | null | undefined,
): boolean {
  if (!agent || !carte) return false;
  if (agent.role === 'cadrage' || agent.workdir) return false;
  return (carte.labels ?? []).some((label) => LABELS_DE_VOLET.includes(label));
}

/**
 * LE SERVICE D'OÙ VIENT LA CARTE D'UN AGENT DE VOLET. Un clic sur cette carte
 * ramène l'utilisateur dans le service, sur la conversation de l'agent, et non
 * dans le volet de la carte : « sinon je ne sais plus exactement à quoi ça
 * correspond ». Le badge et le cadre jaune de la carte lisent la même règle.
 *
 * Un agent de configuration (déploiement, mise en production : rôle `deploy`)
 * n'est JAMAIS un agent de volet : il garde sa carte Système violette, qui ouvre
 * déjà son tiroir.
 */
export type ServiceDeCarte = 'marketing' | 'surveillance' | 'backups';

/** Le service de chaque étiquette de volet. */
const SERVICE_PAR_ETIQUETTE: ReadonlyArray<readonly [string, ServiceDeCarte]> = [
  [LABEL_MARKETING, 'marketing'],
  [LABEL_SURVEILLANCE, 'surveillance'],
  [LABEL_BACKUP, 'backups'],
];

/** Le service de la carte d'un agent de volet, ou `null` pour toute autre carte. */
export function serviceDeLaCarte(
  agent: { role?: string; workdir?: string | null } | null | undefined,
  carte: { labels?: readonly string[] | null } | null | undefined,
): ServiceDeCarte | null {
  if (!estAgentDeVolet(agent, carte)) return null;
  const etiquettes = carte?.labels ?? [];
  return SERVICE_PAR_ETIQUETTE.find(([etiquette]) => etiquettes.includes(etiquette))?.[1] ?? null;
}

/** Le nom du service sur le badge de la carte (le dictionnaire le traduit à l'affichage). */
export const NOM_DU_SERVICE: Readonly<Record<ServiceDeCarte, string>> = {
  marketing: 'Marketing',
  surveillance: 'Surveillance',
  backups: 'Sauvegardes',
};

/**
 * OÙ MÈNE LE CLIC : la vue du service et l'élément qu'elle ouvre (le projet
 * d'un atelier, un site).
 */
export type LieuDeService = {
  vue: 'marketing' | 'surveillance' | 'backups';
  elementId: string;
};

/** Un service dont la conversation de l'agent se lit dans son propre écran (tous, depuis le retrait du Studio et de sa bibliothèque). */
export function serviceAUneConversation(_service: ServiceDeCarte): boolean {
  return true;
}
