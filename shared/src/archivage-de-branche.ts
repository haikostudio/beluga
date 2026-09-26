/**
 * CE QUE L'ARCHIVAGE FAIT DE LA BRANCHE D'UNE CARTE — ET DE RIEN D'AUTRE.
 *
 * Constat, sur le dépôt principal de Beluga Build (septembre 2026) : 782
 * branches « tache/… » vivantes, 640 références « archive/… », et jusqu'à
 * NEUF « archive/ » empilés sur une même branche (`archive/archive/archive/…`).
 * Trois causes, toutes ici :
 *
 *  1. l'archivage renommait ce qu'il trouvait sur `card.github.branch`, y
 *     compris « main » ou « dev » quand la carte venait d'un travail hors
 *     tâche — la porte `brancheRefermableALArchivage` l'a fermé pour les
 *     branches déjà « archive/ » et les branches qui ne sont pas « tache/ »,
 *     mais RIEN ne protégeait la branche de DÉPLOIEMENT choisie dans les
 *     réglages, ni « master » ;
 *  2. le nouveau nom n'était jamais écrit sur la carte : rouverte puis
 *     réarchivée, elle présentait l'ANCIEN nom, git renommait donc une
 *     branche déjà renommée — ou une homonyme recréée entre-temps ;
 *  3. une branche FUSIONNÉE dans la branche de déploiement était archivée
 *     comme les autres. Or son travail vit dans l'histoire de « dev » : la
 *     garder sous un autre nom n'apporte rien, et 640 refs de plus ralentissent
 *     chaque `git fetch`, chaque `worktree add`, chaque relevé.
 *
 * La règle tient en une décision PURE, rejouable sans dépôt :
 *
 *  - pas de branche, une branche protégée (principale, « dev », « main »,
 *    « master », la branche de déploiement ou de production du projet), une
 *    branche qui n'est pas « tache/… » ou une branche déjà « archive/… » :
 *    on LAISSE, en disant pourquoi ;
 *  - une branche de carte FUSIONNÉE dans la branche de déploiement : on la
 *    SUPPRIME localement (`git branch -d`, jamais `-D` — git lui-même refuse
 *    ce qui n'est pas fusionné, c'est le filet) ;
 *  - une branche de carte NON fusionnée : on la RENOMME en « archive/tache/… »
 *    — une seule fois, jamais empilée.
 *
 * Le démon (`archiverLaBrancheDeCarte`, `server/src/dossier-de-carte.ts`)
 * applique la décision et écrit le nom obtenu sur la carte.
 */

import { brancheRefermableALArchivage } from './branche-de-carte.js';

/** Le préfixe posé devant une branche de carte archivée. */
export const PREFIXE_ARCHIVE = 'archive/';

/** Le préfixe complet d'une branche de carte archivée : « archive/tache/… ». */
export const PREFIXE_BRANCHE_ARCHIVEE = `${PREFIXE_ARCHIVE}tache/`;

/**
 * Les branches qu'AUCUN archivage ne touche, quel que soit le projet : les deux
 * noms de la règle d'or et le vieux « master ». Les branches réglées sur le
 * projet s'y ajoutent par l'appelant.
 */
export const BRANCHES_TOUJOURS_PROTEGEES: readonly string[] = ['main', 'dev', 'master'];

export type GesteDArchivage = 'supprimer' | 'renommer' | 'laisser';

export interface DecisionDArchivage {
  geste: GesteDArchivage;
  /** La branche telle qu'elle s'appellera APRÈS le geste (inchangée pour « laisser », absente pour « supprimer »). */
  branche?: string;
  /** Pourquoi ce geste et pas un autre, en français, pour le journal. */
  raison: string;
}

export interface EntreeDArchivage {
  /** La branche portée par la carte (`card.github.branch`), si elle en a une. */
  branche: string | undefined | null;
  /** La branche de déploiement du projet : ce qui est fusionné dedans est livré. */
  brancheDeDeploiement: string;
  /** La branche est-elle déjà contenue dans la branche de déploiement ? */
  fusionnee: boolean;
  /** Les branches à ne jamais toucher, en plus des trois fixes : principale, production réglée… */
  protegees?: readonly string[];
}

/** Une branche déjà passée sous « archive/ » ne se re-préfixe jamais. */
export function estDejaArchivee(branche: string | undefined | null): boolean {
  return (branche ?? '').trim().startsWith(PREFIXE_ARCHIVE);
}

/** Le nom qu'une branche de carte prend à l'archivage : un seul « archive/ », jamais deux. */
export function nomDeBrancheArchivee(branche: string): string {
  const nom = branche.trim();
  return estDejaArchivee(nom) ? nom : `${PREFIXE_ARCHIVE}${nom}`;
}

export function decisionDArchivage(entree: EntreeDArchivage): DecisionDArchivage {
  const branche = (entree.branche ?? '').trim();
  if (!branche) return { geste: 'laisser', raison: 'la carte ne porte aucune branche' };

  const protegees = new Set(
    [...BRANCHES_TOUJOURS_PROTEGEES, entree.brancheDeDeploiement, ...(entree.protegees ?? [])]
      .map((nom) => (nom ?? '').trim())
      .filter(Boolean),
  );
  if (protegees.has(branche)) {
    return {
      geste: 'laisser',
      branche,
      raison: `« ${branche} » est une branche du projet, pas celle d’une carte : elle n’est ni renommée ni supprimée`,
    };
  }
  if (estDejaArchivee(branche)) {
    return { geste: 'laisser', branche, raison: `« ${branche} » est déjà archivée : on n’empile pas un second « archive/ »` };
  }
  if (!brancheRefermableALArchivage(branche)) {
    return { geste: 'laisser', branche, raison: `« ${branche} » n’est pas une branche de carte (« tache/… ») : elle reste en place` };
  }
  if (entree.fusionnee) {
    return {
      geste: 'supprimer',
      raison: `« ${branche} » est déjà fusionnée dans « ${entree.brancheDeDeploiement} » : son travail vit dans l’histoire, la branche est supprimée`,
    };
  }
  return {
    geste: 'renommer',
    branche: nomDeBrancheArchivee(branche),
    raison: `« ${branche} » n’est pas fusionnée dans « ${entree.brancheDeDeploiement} » : elle est gardée sous « ${nomDeBrancheArchivee(branche)} »`,
  };
}
