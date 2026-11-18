/**
 * LA ZONE « EN COURS » DE LA COLONNE DE GAUCHE (demande du 01/11/2026), entre « Nouvel
 * agent » et le groupe « Local » : d'un coup d'œil, tout ce qui tourne, tous projets
 * confondus.
 *
 * « Qui tourne » = une tâche PAS ENCORE ARCHIVÉE qui a BOUGÉ DANS LES DERNIÈRES 24 H (`updatedAt`)
 * — décision du 13/11/2026, carte « Ressources : volet, modales et sources » : « il faut masquer
 * les tâches qui sont inactives depuis 24 heures ». Elle remplace la règle « toute tâche non
 * archivée, quelle que soit sa date » (#cc1e). Une tâche endormie reste dans le groupe de son
 * projet ; elle quitte seulement cette zone. Restent TOUJOURS, quel que soit leur âge : une tâche
 * où un agent travaille ou attend (`agentActif`, rangée comprise), et une tâche qui attend une
 * réponse ou une décision de l'utilisateur (`decisionOuverte`). S'y ajoute une tâche DÉPLOYÉE pas
 * encore ouverte depuis, en gras (`deployeeNonVue`) : elle y reste TANT QU'ELLE N'A PAS ÉTÉ OUVERTE
 * (décision du 15/11/2026, carte « Retouches colonne, fil et questions » : « sinon elles disparaissent
 * dans Archivé et on ne sait plus ce qui a été terminé ») — plus de borne de 24 h, seulement un filet
 * de 30 jours qui garde la lecture du démon légère. L'ouvrir (qui pose `lastReadAt`) l'en retire.
 *
 * Règle PURE : l'écran la tranche ; la lecture `tachesDeLaColonne` du démon en rend un
 * sur-ensemble (toutes les cartes non rangées, que les autres listes servent aussi).
 */
import type { Card } from './models.js';

/** Sans activité depuis 24 h, une tâche quitte la zone (sauf déployée non vue, qui attend son ouverture). */
export const DUREE_D_INACTIVITE_EN_COURS_MS = 24 * 60 * 60 * 1000;
/** Ancien nom, gardé pour les appelants : c'est désormais la même borne de 24 h. */
export const DUREE_DES_TACHES_EN_COURS_MS = DUREE_D_INACTIVITE_EN_COURS_MS;

type CarteDeLaZone = Pick<Card, 'column' | 'updatedAt'> & Partial<Pick<Card, 'renduA' | 'lastReadAt' | 'deployedAt'>>;

/** Le filet d'une tâche déployée jamais ouverte : au-delà de 30 jours, elle quitte la zone (et la lecture du démon). */
export const DUREE_D_UNE_DEPLOYEE_A_OUVRIR_MS = 30 * 24 * 60 * 60 * 1000;

/** Déployée et pas ouverte depuis : elle reste dans la zone, en gras, jusqu'à sa première ouverture. */
export function deployeeNonVue(carte: CarteDeLaZone, maintenant = Date.now()): boolean {
  const deployee = carte.deployedAt;
  if (carte.column !== 'archived' || !deployee) return false;
  return deployee > (carte.lastReadAt ?? 0) && deployee >= maintenant - DUREE_D_UNE_DEPLOYEE_A_OUVRIR_MS;
}

/**
 * La tâche a-t-elle sa place dans la zone « En cours » ? `agentActif` : un agent y travaille
 * ou y attend. `decisionOuverte` : elle attend une réponse ou une décision de l'utilisateur.
 * Sinon, non archivée ET active dans les dernières 24 h.
 */
export function estTacheEnCours(carte: CarteDeLaZone, agentActif = false, maintenant = Date.now(), decisionOuverte = false): boolean {
  if (deployeeNonVue(carte, maintenant)) return true;
  if (agentActif) return true;
  if (carte.column === 'archived') return false;
  if (decisionOuverte) return true;
  return carte.updatedAt >= maintenant - DUREE_D_INACTIVITE_EN_COURS_MS;
}

/**
 * Les tâches de la zone, de la plus récente à la plus ancienne PAR `updatedAt` — la date que
 * chaque ligne affiche et que toutes les listes d'agents suivent (`trierParDate`) : jamais
 * deux dates différentes entre l'ordre et l'âge lu.
 */
export function tachesEnCours<C extends CarteDeLaZone & { id: string }>(
  cartes: Iterable<C>,
  agentsActifs: ReadonlySet<string> = new Set(),
  maintenant = Date.now(),
  decisionsOuvertes: ReadonlySet<string> = new Set(),
): C[] {
  return [...cartes]
    .filter((carte) => estTacheEnCours(carte, agentsActifs.has(carte.id), maintenant, decisionsOuvertes.has(carte.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
}
