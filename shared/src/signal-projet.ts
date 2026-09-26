/**
 * « Cette ligne de la colonne de gauche doit-elle se signaler ? »
 *
 * Deux choses très différentes réclament l'œil sur un projet, et l'une était
 * muette :
 *
 *  - une DÉCISION attendue — question d'agent, carte à valider (`attention`) ;
 *  - un TRAVAIL RENDU pas encore consulté (`rendus`), jusqu'ici visible
 *    seulement par une pastille immobile, que rien ne venait montrer du doigt.
 *
 * Les deux comptent pour la secousse : ce qui arrive de nouveau se voit, quelle
 * qu'en soit la nature. Ils restent pourtant SÉPARÉS, parce qu'ils ne
 * s'affichent pas pareil — triangle d'un côté, badge bleu de l'autre — et
 * surtout parce qu'une demande réglée au moment même où un travail est rendu ne
 * doit pas s'annuler dans un total.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */
import { attentionDuGroupe } from './attention.js';
import { rendusDuGroupe } from './travail-rendu.js';

/** Ce qu'un projet (ou un groupe replié) a de nouveau à dire. */
export interface SignalProjet {
  /** Décisions attendues de l'utilisateur. */
  attention?: number;
  /** Réponses rendues par un agent, pas encore consultées. */
  rendus?: number;
}

/** Le seul repère qu'une ligne montre, ou rien du tout. */
export type RepereLigne = 'attention' | 'rendus' | null;

/**
 * QUEL repère s'affiche — un seul à la fois.
 *
 * Les deux comptes continuent de vivre côte à côte (voir `doitSecouerLigne`) :
 * c'est l'AFFICHAGE qu'on tranche ici. Deux pastilles côte à côte sur une
 * ligne de quelques centimètres ne se lisent plus, surtout sur téléphone, et
 * elles ne demandent pas la même chose.
 *
 * L'ordre d'urgence est celui de l'effort demandé : une DÉCISION attendue
 * bloque le travail, un travail rendu attend seulement d'être lu. Le triangle
 * l'emporte donc toujours sur le point bleu ; quand la décision est prise, le
 * point bleu reparaît de lui-même si du travail reste à consulter.
 */
export function repereVisible(signal: SignalProjet): RepereLigne {
  if ((signal.attention ?? 0) > 0) return 'attention';
  /* La colonne de gauche ne passe plus que l'attention : le travail rendu y a
     son COMPTEUR sur l'icône du projet. L'onglet d'une colonne, sur
     téléphone, garde ce repère en second. */
  if ((signal.rendus ?? 0) > 0) return 'rendus';
  return null;
}

/**
 * Faut-il secouer cette ligne ?
 *
 * Le signal sert à ce qu'on NE VOIT PAS : le projet déjà ouvert et regardé ne
 * bouge pas, et ce qui a déjà été signalé ne se rappelle pas à l'ordre — seule
 * une NOUVELLE demande, ou un travail qui vient d'être rendu, secoue.
 *
 * Les deux comptes sont comparés SÉPARÉMENT : une question qu'on vient de
 * régler pendant qu'un agent rendait son travail laisserait un total inchangé,
 * et le travail rendu passerait inaperçu.
 */
export function doitSecouerLigne(options: {
  avant: SignalProjet;
  maintenant: SignalProjet;
  /** La ligne est-elle déjà sous les yeux de l'utilisateur ? */
  regarde?: boolean;
}): boolean {
  if (options.regarde) return false;
  const monte = (cle: keyof SignalProjet) =>
    (options.maintenant[cle] ?? 0) > (options.avant[cle] ?? 0);
  return monte('attention') || monte('rendus');
}

/**
 * Le signal d'un groupe replié : la somme de ses projets, signal par signal.
 * Refermer un groupe ne doit jamais cacher ce qui s'y est passé.
 */
export function signalDuGroupe(
  membres: string[],
  attention: Record<string, number>,
  rendus: Record<string, number>,
): SignalProjet {
  return {
    attention: attentionDuGroupe(membres, attention),
    rendus: rendusDuGroupe(membres, rendus),
  };
}
