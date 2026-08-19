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
 * La correction vaut désormais pour TOUTE colonne, pas seulement celles
 * d'AVANT le travail : une carte « Terminé », « À déployer » ou même
 * « Archivé » dont un agent travaille encore doit se montrer en « En cours »,
 * le temps que ce travail dure — sinon elle reste invisible dans la colonne où
 * personne ne la cherche pendant qu'un agent la modifie.
 *
 * La correction reste MUETTE : elle ne pose plus de mention sur la carte
 * (l'encart jaune « un agent travaille : replacée dans En cours » ne disait
 * rien d'utile et se lisait tronqué). L'avancement de l'agent
 * (`mentionProgressionTaches`, `progression-taches.ts`) prend cette place.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

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
 * Sans agent au travail, on rend la colonne enregistrée telle quelle. Avec un
 * agent au travail, la carte se montre TOUJOURS en « En cours », quelle que
 * soit sa colonne enregistrée.
 */
export function colonneAffichee(carte: CartePourAffichage): ColumnKey {
  if (!carte.agentAuTravail) return carte.column;
  return 'running';
}
