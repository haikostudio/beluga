import { z } from 'zod';

/**
 * Les clés techniques des colonnes. RÈGLE GRAVÉE (PLAN §30) : on change
 * l'étiquette affichée, JAMAIS la clé — sinon les tableaux déjà enregistrés
 * deviennent illisibles.
 */
export const COLUMN_KEYS = [
  'notes',
  // « Validé » puis « À faire » ont disparu : une carte NAÎT dans « Planifié ».
  // Son chiffrage se lance SUR PLACE (drapeau `analyseDemandee`) et la carte n'en
  // bouge pas ; seul le geste de lancement la fait entrer en « En cours ». Deux
  // étapes d'attente en moins sur le tableau, aucune dépense de plus.
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
  planned: 'Planifié',
  running: 'En cours',
  done: 'Terminé',
  to_deploy: 'À déployer',
  in_production: 'En production',
  archived: 'Archivé',
};

/**
 * Les deux seules colonnes ouvertes aux agents (PLAN §4). « À faire » n'existant
 * plus, c'est « Planifié » — la colonne où NAÎT une carte — qui prend sa place :
 * un agent range une carte en note ou la remet dans la file d'attente, et rien
 * de plus. Y poser une carte ne la lance pas : le départ reste un geste humain
 * (voir `demarrageAutomatiqueAutorise`, `suivi-colonne.ts`).
 */
export const AGENT_MOVABLE_COLUMNS: ColumnKey[] = ['notes', 'planned'];

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
        reason: `Un agent ne peut déplacer une carte que vers « ${COLUMN_LABELS.notes} » ou « ${COLUMN_LABELS.planned} ». Cible refusée : « ${COLUMN_LABELS[to]} ».`,
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
    if (!MACHINE_ONLY_TARGETS.includes(to) && to !== 'archived') {
      return {
        allowed: false,
        reason: `L'ordonnanceur ne promeut que vers « ${COLUMN_LABELS.planned} » ou « ${COLUMN_LABELS.running} ».`,
      };
    }
    /*
     * Il n'y a plus de colonne d'attente AVANT « Planifié » : c'est là qu'une
     * carte naît, chiffrée ou non. Ce qui protégeait la dépense n'est donc plus
     * une colonne interdite à l'ordonnanceur, c'est la règle de pause
     * (`demarrageAutomatiqueAutorise`) : sans geste humain — « Lancer
     * maintenant », « Dès que possible », dépôt dans « En cours » —, aucune
     * carte de « Planifié » ne part d'elle-même.
     */
    return { allowed: true };
  }

  // Utilisateur : tout est permis, sauf remonter dans le pipeline sans repasser
  // par la validation (garde-fou doux, il peut toujours revenir en arrière).
  return { allowed: true };
}
