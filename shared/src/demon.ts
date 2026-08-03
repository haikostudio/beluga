/**
 * Savoir si le démon tourne encore sur du code périmé.
 *
 * La publication remplace l'interface tout de suite, mais le SERVEUR continue
 * de tourner avec le code chargé à son démarrage. Tant qu'on ne le redémarre
 * pas, une correction côté serveur n'existe pas. Le repère est simple : si le
 * code construit est plus récent que le démarrage, il faut redémarrer.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatDemon {
  /** Instant du démarrage du démon. */
  demarreA: number;
  /** Dernière écriture du code serveur construit, si on a su la lire. */
  construitA?: number;
  /** Agents qui travaillent en ce moment : un redémarrage les interromprait. */
  agentsEnCours?: number;
}

/**
 * Une seconde de marge : la construction et le démarrage peuvent se suivre de
 * très près, et les horloges de fichiers n'ont pas la précision de la seconde
 * partout. Sans elle, un redémarrage venant juste après une construction se
 * redemanderait aussitôt lui-même.
 */
const MARGE_MS = 1000;

export function redemarrageNecessaire(etat: EtatDemon): boolean {
  if (!etat.construitA) return false;
  return etat.construitA > etat.demarreA + MARGE_MS;
}

/** Ce qu'on dit à l'utilisateur avant de couper. */
export function avertissementRedemarrage(etat: EtatDemon): string {
  const base =
    'Le serveur s’arrête et repart tout seul en quelques secondes. L’application se reconnecte d’elle-même.';
  const agents = etat.agentsEnCours ?? 0;
  if (!agents) return base;
  return agents === 1
    ? `Un agent travaille en ce moment : il sera interrompu. ${base}`
    : `${agents} agents travaillent en ce moment : ils seront interrompus. ${base}`;
}
