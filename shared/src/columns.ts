import { z } from 'zod';

/**
 * Les clés techniques des colonnes. RÈGLE GRAVÉE (PLAN §30) : on change
 * l'étiquette affichée, JAMAIS la clé — sinon les tableaux déjà enregistrés
 * deviennent illisibles.
 */
export const COLUMN_KEYS = [
  'notes',
  'todo',
  // « Validé » a disparu : valider une carte de « À faire » lance son analyse
  // SUR PLACE, et la carte n'apparaît en « Planifié » qu'une fois le chiffrage
  // rendu. Une étape d'attente en moins sur le tableau.
  'planned',
  'running',
  'done',
  'to_deploy',
  'in_production',
  'archived',
] as const;

export const ColumnKey = z.enum(COLUMN_KEYS);
export type ColumnKey = z.infer<typeof ColumnKey>;

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  notes: 'Notes',
  todo: 'À faire',
  planned: 'Planifié',
  running: 'En cours',
  done: 'Terminé',
  to_deploy: 'À déployer',
  in_production: 'En production',
  archived: 'Archivé',
};

/** Les deux seules colonnes ouvertes aux agents (PLAN §4). */
export const AGENT_MOVABLE_COLUMNS: ColumnKey[] = ['notes', 'todo'];

/**
 * Colonnes que seul l'utilisateur peut atteindre. « Terminé » n'en fait plus
 * partie : la carte y va d'elle-même quand son agent a rendu.
 */
export const USER_ONLY_TARGETS: ColumnKey[] = ['to_deploy', 'in_production'];

/**
 * Colonnes que seule la machine peut attribuer. « Terminé » en fait partie
 * depuis que la carte suit l'état de son agent : elle y va d'elle-même quand
 * le travail est rendu (voir `suivi-colonne.ts`).
 */
export const MACHINE_ONLY_TARGETS: ColumnKey[] = ['planned', 'running', 'done'];

export type Actor = 'user' | 'agent' | 'machine';

export interface MoveDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Le cœur du modèle : qui a le droit de déplacer quoi (PLAN §4).
 * Appliqué au niveau de l'outil, pas de la consigne.
 */
export function canMove(actor: Actor, from: ColumnKey, to: ColumnKey): MoveDecision {
  if (from === to) return { allowed: true };

  if (actor === 'agent') {
    if (!AGENT_MOVABLE_COLUMNS.includes(to)) {
      return {
        allowed: false,
        reason: `Un agent ne peut déplacer une carte que vers « ${COLUMN_LABELS.notes} » ou « ${COLUMN_LABELS.todo} ». Cible refusée : « ${COLUMN_LABELS[to]} ».`,
      };
    }
    if (!AGENT_MOVABLE_COLUMNS.includes(from)) {
      return {
        allowed: false,
        reason: `Un agent ne peut pas sortir une carte de « ${COLUMN_LABELS[from]} » : cette colonne appartient au pipeline d'exécution.`,
      };
    }
    return { allowed: true };
  }

  if (actor === 'machine') {
    if (!MACHINE_ONLY_TARGETS.includes(to) && to !== 'archived' && to !== 'todo') {
      return {
        allowed: false,
        reason: `L'ordonnanceur ne promeut que vers « ${COLUMN_LABELS.planned} » ou « ${COLUMN_LABELS.running} ».`,
      };
    }
    if (from === 'todo') {
      return {
        allowed: false,
        reason: "L'ordonnanceur ne touche jamais une carte de « À faire » : la validation humaine manque.",
      };
    }
    return { allowed: true };
  }

  // Utilisateur : tout est permis, sauf remonter dans le pipeline sans repasser
  // par la validation (garde-fou doux, il peut toujours revenir en arrière).
  return { allowed: true };
}
