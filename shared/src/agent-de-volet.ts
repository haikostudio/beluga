/**
 * LES AGENTS DE VOLET : ceux qui vivent dans leur PROPRE écran, pas sur le
 * tableau — le Studio, l'atelier Marketing, l'agent d'une surveillance de site,
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
 * l'étiquette marketing, une création du Studio peut partir en vraie tâche.
 */
import { LABEL_BACKUP } from './backups-agent.js';
import { LABEL_MARKETING } from './marketing.js';
import { LABEL_STUDIO } from './studio.js';
import { LABEL_BIBLIOTHEQUE } from './studio-sources.js';
import { LABEL_SURVEILLANCE } from './surveillance.js';

/** Les étiquettes que pose la naissance d'un agent de volet sur sa carte. */
export const LABELS_DE_VOLET: readonly string[] = [LABEL_STUDIO, LABEL_MARKETING, LABEL_SURVEILLANCE, LABEL_BACKUP, LABEL_BIBLIOTHEQUE];

export function estAgentDeVolet(
  agent: { role?: string; workdir?: string | null } | null | undefined,
  carte: { labels?: readonly string[] | null } | null | undefined,
): boolean {
  if (!agent || !carte) return false;
  if (agent.role === 'cadrage' || agent.workdir) return false;
  return (carte.labels ?? []).some((label) => LABELS_DE_VOLET.includes(label));
}
