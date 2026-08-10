import type { ColumnKey } from './columns.js';

/**
 * « Un agent travaille sur cette carte, et pourtant elle est dans Planifié. »
 *
 * Le tableau range une carte d'après sa colonne enregistrée (`card.column`).
 * Cette colonne peut mentir un instant : le navigateur pose la colonne
 * optimiste au lancement, puis la RETIRE quand sa requête n'aboutit pas — alors
 * même que le serveur a bel et bien démarré le tour. La carte retombait donc
 * dans « Planifié » avec sa roue qui tourne, pendant que « En cours » affichait
 * zéro et que l'agent, lui, figurait bien dans « Agents en cours ».
 *
 * La vérité la plus fraîche, dans ce cas, n'est pas la colonne : c'est l'AGENT.
 * Un agent de tâche en train de travailler prouve que le travail a commencé.
 * On corrige donc l'AFFICHAGE — et rien d'autre : la colonne enregistrée n'est
 * pas touchée, aucune commande n'est envoyée, les règles de déplacement d'une
 * carte par son agent ne bougent pas. La correction se dit en toutes lettres
 * sur la carte, pour ne rien masquer.
 *
 * La correction ne vaut QUE pour les colonnes d'AVANT le travail (« Notes »,
 * « Planifié ») : une carte « Terminé » dont on relance l'agent pour discuter
 * du chiffrage doit rester en « Terminé » — c'est la règle, un tour de
 * discussion ne déplace pas une carte.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** Les colonnes d'où une carte au travail n'aurait jamais dû rester. */
export const COLONNES_AVANT_TRAVAIL: ColumnKey[] = ['notes', 'planned'];

/** Ce qu'il faut savoir d'une carte pour décider où la MONTRER. */
export interface CartePourAffichage {
  /** La colonne enregistrée, telle que le serveur l'a diffusée. */
  column: ColumnKey;
  /** Un agent de tâche travaille-t-il en ce moment sur cette carte ? */
  agentAuTravail?: boolean;
}

/**
 * La colonne où POSER la carte sur le tableau — jamais celle où l'enregistrer.
 *
 * Sans agent au travail, ou depuis une colonne d'après le travail, on rend la
 * colonne enregistrée telle quelle.
 */
export function colonneAffichee(carte: CartePourAffichage): ColumnKey {
  if (!carte.agentAuTravail) return carte.column;
  if (!COLONNES_AVANT_TRAVAIL.includes(carte.column)) return carte.column;
  return 'running';
}

/** La colonne montrée diffère-t-elle de la colonne enregistrée ? */
export function colonneCorrigee(carte: CartePourAffichage): boolean {
  return colonneAffichee(carte) !== carte.column;
}

/**
 * La phrase posée sur la carte quand l'affichage a été corrigé, ou `null`
 * quand il n'y a rien à dire. On ne masque pas l'anomalie : on l'écrit, dans
 * le même décroché discret que les autres états de la carte.
 */
export function mentionColonneCorrigee(carte: CartePourAffichage): string | null {
  if (!colonneCorrigee(carte)) return null;
  return 'un agent travaille : replacée dans « En cours »';
}
