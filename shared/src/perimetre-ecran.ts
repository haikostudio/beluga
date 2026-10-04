/**
 * LE PÉRIMÈTRE D'UN ÉCRAN — le DÉTAIL du travail d'un agent ne part que vers
 * l'écran qui le regarde.
 *
 * Le bus diffusait tout à tout le monde : chaque fragment de réponse, chaque
 * ligne de journal de chaque agent de chaque projet arrivait sur chaque écran
 * connecté, qui le rangeait et se redessinait — pour une conversation qu'il
 * n'affichait pas. Trois projets au travail, et un téléphone posé sur un
 * quatrième recevait tout.
 *
 * Deux familles d'événements :
 *   - le DÉTAIL (`EVENEMENTS_DE_DETAIL`) : le fil d'un agent qui s'écrit, sa
 *     file, le journal et le carnet de sa carte. Volumineux, fréquent, et
 *     lisible seulement dans une conversation ou une carte OUVERTE ;
 *   - tout le reste : cartes, états d'agent, décisions attendues, quotas,
 *     messages passagers… Léger, et c'est ce qui nourrit la colonne des
 *     projets, les pourcentages, le triangle et la cloche. Il part TOUJOURS.
 *
 * Un détail part si son projet est celui que l'écran affiche, ou si l'écran a
 * demandé cet agent ou cette carte (`agent.open`, `card.conversation`,
 * `card.journal`). Rien n'est perdu pour autant : ouvrir un projet, une carte
 * ou une conversation redemande déjà son état complet au serveur.
 *
 * DANS LE DOUTE, ON ENVOIE. Un événement qu'on ne sait pas situer (agent sans
 * projet, carte inconnue) part comme avant : mieux vaut un envoi de trop qu'un
 * fil qui ne s'écrit plus.
 */

/** Les événements volumineux et fréquents, lisibles seulement là où on regarde. */
export const EVENEMENTS_DE_DETAIL: ReadonlySet<string> = new Set([
  'message.upsert',
  'queue.etat',
  'journal.entree',
  'carnet.lignes',
]);

/** Ce qu'un écran regarde, tel que ses propres demandes l'ont dit au serveur. */
export interface PerimetreDEcran {
  /** Le projet affiché (le dernier `project.open`, ou celui du premier envoi). */
  projet: string | null;
  /** Les conversations demandées par cet écran. */
  agents: ReadonlySet<string>;
  /** Les cartes dont cet écran a demandé le fil ou le journal. */
  cartes: ReadonlySet<string>;
}

/** Où se passe un événement de détail, une fois résolu par le serveur. */
export interface LieuDEvenement {
  projectId?: string | null;
  agentId?: string | null;
  cardId?: string | null;
}

/** Ce que l'événement dit de lui-même, avant toute lecture de base. */
export function reperesDeLEvenement(event: { type: string } & Record<string, any>): LieuDEvenement | null {
  if (!EVENEMENTS_DE_DETAIL.has(event.type)) return null;
  switch (event.type) {
    case 'message.upsert':
      return { agentId: event.message?.agentId };
    case 'queue.etat':
      return { agentId: event.agentId };
    case 'journal.entree':
      return { cardId: event.entree?.cardId };
    case 'carnet.lignes':
      return { cardId: event.cardId };
    default:
      return null;
  }
}

/** Cet événement de détail concerne-t-il ce que cet écran regarde ? */
export function detailDansLePerimetre(lieu: LieuDEvenement, perimetre: PerimetreDEcran): boolean {
  if (lieu.agentId && perimetre.agents.has(lieu.agentId)) return true;
  if (lieu.cardId && perimetre.cartes.has(lieu.cardId)) return true;
  // Impossible à situer : on envoie, comme avant.
  if (!lieu.projectId) return true;
  // Un écran qui n'a encore rien ouvert n'a pas de périmètre à faire valoir.
  if (!perimetre.projet) return true;
  return lieu.projectId === perimetre.projet;
}

/**
 * LE NOMBRE DE CONVERSATIONS ET DE CARTES RETENUES PAR ÉCRAN. Un écran resté
 * ouvert des jours ne garde pas la trace de tout ce qu'il a visité : les plus
 * anciennes sortent, et se redemandent d'elles-mêmes à leur réouverture.
 */
export const PLAFOND_DU_PERIMETRE = 12;

/** Ajoute `id` en tête d'un ensemble borné (le plus récent en dernier). */
export function retenirDansLePerimetre(ensemble: Set<string>, id: string, plafond = PLAFOND_DU_PERIMETRE): void {
  ensemble.delete(id);
  ensemble.add(id);
  while (ensemble.size > plafond) {
    const plusAncien = ensemble.values().next().value as string | undefined;
    if (plusAncien === undefined) break;
    ensemble.delete(plusAncien);
  }
}
