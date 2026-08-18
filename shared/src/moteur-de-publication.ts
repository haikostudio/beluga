/**
 * QUEL MOTEUR MÈNE LA PUBLICATION — CELUI QUI A ENCORE DE LA PLACE, PAS CELUI
 * QUI EST ÉCRIT DANS LES RÉGLAGES.
 *
 * Les agents que la publication lance elle-même (mise en production confiée,
 * dépannage d'étape, réparation des contrôles ou de la construction, résolution
 * d'un conflit de fusion) partaient tous sur le moteur PAR DÉFAUT du projet.
 * Le compte, lui, était bien choisi à la place restante — mais À L'INTÉRIEUR de
 * ce seul moteur (`choix-de-compte.ts`). Quand tous les comptes de ce moteur
 * étaient saturés, le tour ne partait pas : l'agent recevait « Aucun compte n'a
 * de quota disponible », rendait la main SANS erreur, et la publication croyait
 * l'avoir fait travailler. D'où le blocage silencieux — pendant qu'un autre
 * moteur, installé et libre à côté, ne recevait rien.
 *
 * La règle ici élargit donc la comparaison à TOUS les moteurs installés : la
 * place restante (`placeRestante`, en fenêtres « Pro ») se compare d'un compte
 * à l'autre, donc aussi d'un moteur à l'autre. Deux garde-fous :
 *
 * 1. Le moteur PRÉFÉRÉ garde la main tant qu'il a assez de place. On ne change
 *    pas de moteur pour un gain de confort : une bascule repart d'un fil vide.
 * 2. Il faut de la place SUFFISANTE, pas « pas encore à 100 % » : une
 *    publication enchaîne plusieurs tours, un compte à 3 % de fenêtre libre la
 *    ferait tomber au milieu.
 *
 * Règle PURE : ni disque, ni base, ni réseau. Elle décide d'un CHOIX, jamais
 * d'une dépense, et ne met jamais rien en ligne.
 */

import { CompteAClasser, classerComptesParPlace, placeRestante } from './choix-de-compte.js';

/**
 * LA PLACE QU'IL FAUT POUR MENER UNE PUBLICATION, en fenêtres « Pro » (l'unité
 * de `placeRestante` : taille du plan × part libre de sa fenêtre).
 *
 * Une publication n'est pas un tour : c'est une suite de tours — vérification,
 * construction, mise en ligne, et un dépanneur à chaque étape qui tombe. Un
 * cinquième de fenêtre Pro est le minimum sous lequel on sait qu'elle
 * s'arrêterait en route ; au-dessus, on laisse faire plutôt que de refuser à
 * tort un compte qui aurait suffi.
 */
export const PLACE_MINIMALE_POUR_PUBLIER = 0.2;

/** Ce que la règle a besoin de savoir d'un compte candidat. Rien de plus. */
export interface CompteDePublication extends CompteAClasser {
  /** Le moteur auquel ce compte appartient : « claude », « codex », « cursor ». */
  engine: string;
  /** Le nom lisible du compte, pour la phrase rendue à l'écran. */
  label?: string;
  /**
   * Le moteur est-il installé sur ce serveur ? Un moteur absent ne peut rien
   * mener, même avec un compte au quota intact. Inconnu vaut installé : on
   * n'écarte pas un moteur sur une détection manquante.
   */
  installe?: boolean;
  /** Quand la fenêtre la plus proche se remet à zéro, si on le sait. */
  resetsAt?: number;
}

/**
 * Les comptes qui peuvent VRAIMENT mener une publication : moteur installé,
 * compte non coupé, et assez de place restante pour aller au bout.
 */
export function comptesQuiPeuventPublier<T extends CompteDePublication>(
  comptes: readonly T[],
  minimum = PLACE_MINIMALE_POUR_PUBLIER,
): T[] {
  const ouverts = comptes.filter(
    (compte) => compte.installe !== false && !compte.disabled && placeRestante(compte) >= minimum,
  );
  return classerComptesParPlace(ouverts);
}

/**
 * LE COMPTE — et donc le moteur — qui mène la publication.
 *
 * `prefere` est le moteur réglé sur le projet : il passe devant tant qu'il lui
 * reste de la place, même si un autre moteur en a davantage. On ne bascule que
 * lorsqu'il n'a plus de quoi finir.
 */
export function compteQuiMeneLaPublication<T extends CompteDePublication>(
  comptes: readonly T[],
  prefere?: string,
  minimum = PLACE_MINIMALE_POUR_PUBLIER,
): T | undefined {
  const possibles = comptesQuiPeuventPublier(comptes, minimum);
  if (!possibles.length) return undefined;
  if (prefere) {
    const surLePrefere = possibles.find((compte) => compte.engine === prefere);
    if (surLePrefere) return surLePrefere;
  }
  return possibles[0];
}

/** A-t-on dû quitter le moteur réglé sur le projet ? */
export function estUneBasculeDeMoteur(retenu: CompteDePublication, prefere?: string): boolean {
  return !!prefere && retenu.engine !== prefere;
}

/** La place restante d'un compte, arrondie pour être lue par un humain. */
export function placeLisible(compte: CompteDePublication): string {
  return `${Math.round(placeRestante(compte) * 100) / 100} fenêtre(s)`;
}

/**
 * CE QUI S'ÉCRIT QUAND LA PUBLICATION CHANGE DE MOTEUR. Une bascule n'est pas
 * un détail : le fil repart de zéro, et le compte rendu doit dire pourquoi.
 */
export function phraseDeBasculeDeMoteur(retenu: CompteDePublication, prefere?: string): string {
  const compte = retenu.label ?? retenu.id;
  if (!estUneBasculeDeMoteur(retenu, prefere)) {
    return `Moteur « ${retenu.engine} », compte « ${compte} » — ${placeLisible(retenu)} de place restante.`;
  }
  return (
    `Le moteur « ${prefere} » n’a plus assez de quota pour mener la publication : ` +
    `elle passe sur « ${retenu.engine} », compte « ${compte} » (${placeLisible(retenu)} de place restante).`
  );
}

/**
 * AUCUN MOTEUR LIBRE : ON LE DIT, EN NOMMANT CE QU'ON A REGARDÉ.
 *
 * C'est la moitié qui manquait le plus : un blocage silencieux ne se distingue
 * pas d'un travail lent. La phrase nomme chaque moteur, son compte le plus
 * dégagé et ce qu'il lui reste, pour qu'on voie d'un coup d'œil qu'il n'y avait
 * réellement rien à prendre.
 */
export function phraseAucunMoteurLibre(
  comptes: readonly CompteDePublication[],
  minimum = PLACE_MINIMALE_POUR_PUBLIER,
): string {
  const installes = comptes.filter((compte) => compte.installe !== false && !compte.disabled);
  if (!installes.length) {
    return 'Aucun compte n’est disponible pour mener la publication : aucun moteur installé ne porte de compte actif.';
  }
  const parMoteur = new Map<string, CompteDePublication>();
  for (const compte of classerComptesParPlace(installes)) {
    if (!parMoteur.has(compte.engine)) parMoteur.set(compte.engine, compte);
  }
  const detail = [...parMoteur.entries()]
    .map(([engine, compte]) => `${engine} : « ${compte.label ?? compte.id} », ${placeLisible(compte)}`)
    .join(' ; ');
  return (
    `Aucun moteur n’a le quota nécessaire pour mener la publication ` +
    `(il en faut au moins ${minimum} fenêtre(s)). Le plus dégagé de chaque moteur — ${detail}.`
  );
}
