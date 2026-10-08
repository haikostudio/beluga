import type { AgentRole } from './models.js';
import { MOTIFS_DE_DEPANNAGE, type MotifDAppel } from './accueil-agent.js';

/**
 * QUEL EFFORT DE RÉFLEXION MÉRITE UN AGENT QUE PERSONNE N'A RÉGLÉ.
 *
 * Une carte porte son modèle et son cran : ils sont INTANGIBLES, et rien ici ne
 * les touche. Mais les agents que le démon lance TOUT SEUL — un dépannage de
 * publication, une mise en ligne, le rendez-vous d'analyse de la nuit, la
 * relecture des cartes mûres, l'assistant qui configure un site — sont créés
 * avec leur seul moteur (`createAgent({ role, title })`, sans `run.thinking`).
 * Aucun `--effort` ne partait donc à la ligne de commande, et le moteur
 * appliquait le sien : le même pour un conflit de fusion de trois minutes que
 * pour un chantier d'architecture.
 *
 * Le cran suit ce que le tour DEMANDE VRAIMENT :
 *
 *   • un DÉPANNAGE répare une chose nommée, avec les gestes donnés dans l'ordre
 *     — il n'y a rien à chercher, seulement à faire : `low` ;
 *   • l'ASSISTANT D'UN SITE À SAUVEGARDER lit une page, pose ses questions et
 *     enregistre une fiche : `low` ;
 *   • une PUBLICATION exécute des étapes et rend compte de ce qui est en ligne —
 *     du jugement, pas de la recherche : `medium` ;
 *   • une ANALYSE doit comprendre le projet avant de proposer : `medium`.
 *
 * Tout le reste — un agent de tâche, un cadrage — rend `undefined` : leur cran
 * vient de la carte ou des réglages du projet, et un défaut posé ici le
 * masquerait. Aucune base, aucun disque : la règle se rejoue seule.
 */

/** Les crans que la ligne de commande accepte. « none » n'en est pas un : on n'envoie rien. */
export type EffortAgent = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Le cran à appliquer quand l'agent n'en porte aucun, ou `undefined` pour
 * laisser le réglage venir d'ailleurs.
 */
export function effortParDefaut(input: { role: AgentRole; motif?: MotifDAppel }): EffortAgent | undefined {
  if (input.motif === 'configuration-backup' || input.motif === 'configuration-surveillance') return 'low';
  // Rédiger pour vendre demande un peu de jugement : un cran au-dessus des assistants de configuration.
  if (input.motif === 'configuration-marketing') return 'medium';
  // Lire un site inconnu et en tirer une recette, ou rédiger des textes : du jugement, sans plus.
  if (input.motif === 'bibliotheque-styles') return 'medium';
  // Dessiner en code, regarder son aperçu, corriger : le studio veut le cran haut.
  if (input.motif === 'studio') return 'high';
  // « Résoudre le problème » cherche une cause INCONNUE : du jugement, pas un geste dicté.
  if (input.motif === 'depannage-manuel') return 'medium';
  if (input.motif && MOTIFS_DE_DEPANNAGE.includes(input.motif)) return 'low';
  if (input.role === 'deploy') return 'medium';
  // Un agent d'analyse PORTEUR d'une carte est un chiffrage commandé : son cran
  // est celui de sa carte, comme pour un agent de tâche. Sans carte, c'est le
  // rendez-vous de la nuit ou la relecture des cartes mûres.
  if (input.role === 'analysis') return 'medium';
  return undefined;
}

/**
 * LE CRAN RÉELLEMENT ENVOYÉ CE TOUR-CI : celui de l'agent s'il en a un, sinon
 * celui de sa famille. Un cran réglé — même « none », qui veut dire « ne rien
 * passer » — l'emporte toujours : c'est le choix de l'utilisateur.
 */
export function effortDuTour(
  regle: string | undefined,
  famille: { role: AgentRole; motif?: MotifDAppel; porteUneCarte?: boolean },
): string | undefined {
  if (regle) return regle;
  if (famille.porteUneCarte) return undefined;
  return effortParDefaut(famille);
}
