/**
 * Le voyant d'une carte, au bout de son titre.
 *
 * Une carte reste dans « En cours » même quand son agent a fini : la clôture
 * est un geste de l'utilisateur. Un simple point gris ne disait donc pas la
 * différence entre « personne n'y touche » et « c'est fait, venez voir ». La
 * coche verte dit ce moment-là, et une relance repasse à la roue qui tourne.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export interface EtatVisuelEntree {
  /** Statut de l'agent de la carte, s'il y en a un. */
  agentStatut?: 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'done';
  /** Une analyse tourne en ce moment pour cette carte. */
  analyseEnCours?: boolean;
  /** La carte est validée mais pas encore chiffrée : le travail est déjà lancé. */
  chiffrageEnCours?: boolean;
  /** La carte attend quelque chose (heure creuse, place libre, réponse). */
  enAttente?: boolean;
  /** L'analyse s'est terminée sans chiffres exploitables. */
  estimationEchouee?: boolean;
  /** La carte est en ligne. */
  enLigne?: boolean;
}

export type EtatVisuelCarte = 'travaille' | 'echec' | 'attente' | 'termine' | 'enligne' | 'repos';

export function etatVisuelCarte(entree: EtatVisuelEntree): EtatVisuelCarte {
  // Ce qui tourne prime sur tout : c'est l'information la plus fraîche.
  if (entree.agentStatut === 'running' || entree.agentStatut === 'starting') return 'travaille';
  if (entree.analyseEnCours || entree.chiffrageEnCours) return 'travaille';

  if (entree.agentStatut === 'failed' || entree.estimationEchouee) return 'echec';
  if (entree.enAttente) return 'attente';

  // L'agent a rendu son résultat : la carte attend votre clôture.
  if (entree.agentStatut === 'done') return 'termine';

  if (entree.enLigne) return 'enligne';
  // « stopped » et « idle » ne sont pas des fins : rien n'a été rendu.
  return 'repos';
}
