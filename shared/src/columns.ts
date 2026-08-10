import { z } from 'zod';

/**
 * Les clés techniques des colonnes. RÈGLE GRAVÉE (PLAN §30) : on change
 * l'étiquette affichée, JAMAIS la clé — sinon les tableaux déjà enregistrés
 * deviennent illisibles.
 */
export const COLUMN_KEYS = [
  'notes',
  // « Validé » puis « Planifié » ont disparu : TOUT ce qui précède le travail se
  // joue dans « À faire ». Valider y lance le chiffrage SUR PLACE, la carte y
  // reste avec ses chiffres, et elle part en « En cours » au clic ou à l'heure
  // dite. Deux étapes d'attente en moins sur le tableau.
  'todo',
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
export const MACHINE_ONLY_TARGETS: ColumnKey[] = ['running', 'done'];

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
        reason: `L'ordonnanceur ne promeut que vers « ${COLUMN_LABELS.running} » ou « ${COLUMN_LABELS.done} ».`,
      };
    }
    /*
     * « À faire » est désormais la SEULE colonne d'avant-travail : c'est de là
     * que l'ordonnanceur lance une carte déjà autorisée (heure dite, « dès que
     * possible », tour interrompu). Ce n'est donc plus une sortie interdite —
     * l'autorisation, elle, se juge dans `demarrageAutomatiqueAutorise`, pas ici.
     */
    return { allowed: true };
  }

  // Utilisateur : tout est permis, sauf remonter dans le pipeline sans repasser
  // par la validation (garde-fou doux, il peut toujours revenir en arrière).
  return { allowed: true };
}
