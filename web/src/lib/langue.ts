import * as React from 'react';
import {
  LANGUE_DORIGINE,
  TRADUCTIONS,
  etiquetteDeLangue,
  langueValide,
  traduire,
  type LangueId,
  type ValeursDeTexte,
} from '@haikodev/shared';
import { usePref } from './prefs';

/**
 * LA LANGUE DE L'INTERFACE — un seul endroit qui la pose, une seule façon de
 * l'écrire.
 *
 * Le thème a montré la marche à suivre et on la reprend telle quelle : le
 * réglage vit EN BASE (`usePref`), donc il se retrouve sur le téléphone comme
 * sur l'ordinateur et vider un cache ne le perd pas ; il s'applique depuis la
 * RACINE de l'application, jamais depuis un panneau chargé à la demande ; et un
 * REPÈRE local, écrit à chaque pose réelle, évite le clignotement du tout
 * premier affichage. La source de vérité reste le serveur — le repère n'est
 * qu'une devinette du premier instant.
 *
 * `t` N'EST PAS UN CROCHET, ET C'EST VOULU. Un crochet aurait obligé chaque
 * fonction qui écrit un mot — une aide de survol, un message d'erreur du
 * client, une phrase du module de voix — à devenir un composant React. `t` lit
 * donc une variable de module, tenue à jour par la racine AVANT que ses enfants
 * ne s'affichent. Changer de langue rend la racine, donc rend tout l'arbre en
 * dessous : aucun écran ne garde un mot de l'ancienne langue. Aucun composant
 * n'est mémoïsé dans cette application, rien ne peut donc rester en arrière.
 */

/** Le repère local du premier affichage — jamais la source de vérité. */
const CLE_REPERE_LANGUE = 'haikodev-langue';

function repereEnregistre(): LangueId {
  try {
    return langueValide(window.localStorage.getItem(CLE_REPERE_LANGUE));
  } catch {
    return LANGUE_DORIGINE;
  }
}

/**
 * LA LANGUE QUE `t` EMPLOIE À CET INSTANT. Elle est posée par la racine, et
 * jamais ailleurs. Avant la réponse du serveur elle vaut le repère du dernier
 * affichage — soit, au tout premier lancement, le français.
 */
let langueCourante: LangueId = typeof window === 'undefined' ? LANGUE_DORIGINE : repereEnregistre();

/**
 * LE TEXTE À AFFICHER. On lui donne le texte FRANÇAIS, il rend la traduction —
 * et le français lui-même quand elle manque, jamais un vide ni un nom de clé.
 *
 * Les valeurs se glissent dans les trous nommés de la phrase :
 * `t('{n} agents travaillent', { n })`. C'est la phrase ENTIÈRE qui part au
 * dictionnaire, pour que chaque langue range ses mots comme elle l'entend.
 */
export function t(texte: string, valeurs?: ValeursDeTexte): string {
  return traduire(TRADUCTIONS, langueCourante, texte, valeurs);
}

/** La langue en vigueur, hors composant (le client, la voix, les erreurs). */
export function langueEnCours(): LangueId {
  return langueCourante;
}

/**
 * POSER LA LANGUE SUR LA PAGE. `lang` n'est pas décoratif : il commande la
 * coupure des mots, les guillemets du navigateur, le correcteur d'orthographe
 * du champ d'écriture et la voix de synthèse. Sans lui, un texte chinois se
 * coupe comme du français.
 */
export function appliquerLaLangue(langue: LangueId): LangueId {
  langueCourante = langue;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = etiquetteDeLangue(langue);
    document.documentElement.dataset.langue = langue;
  }
  try {
    window.localStorage.setItem(CLE_REPERE_LANGUE, langue);
  } catch {
    /* stockage local indisponible : le premier affichage clignote une fois,
       rien d'autre ne dépend de ce repère */
  }
  return langue;
}

/**
 * Le réglage GÉNÉRAL, et de quoi le changer. Il ne POSE rien : seul
 * `useLangueAppliquee`, appelé depuis la racine, pose.
 */
export function useLangueGenerale(): [LangueId, (langue: LangueId) => void] {
  const [brut, ecrire] = usePref<string>('langue', LANGUE_DORIGINE);
  return [langueValide(brut), ecrire as (langue: LangueId) => void];
}

/**
 * LA LANGUE RÉELLEMENT EN VIGUEUR — et c'est elle qui la POSE.
 *
 * À appeler UNE SEULE FOIS, depuis la racine. La variable de module est mise à
 * jour PENDANT le rendu, avant que le moindre enfant ne s'affiche : sans cela,
 * le premier rendu après un changement de langue écrirait encore l'ancienne, et
 * il faudrait un second rendu pour la rattraper. La pose sur la page, elle, est
 * un effet — on ne touche pas au document pendant un rendu.
 */
export function useLangueAppliquee(): LangueId {
  const [langue] = useLangueGenerale();
  langueCourante = langue;

  React.useEffect(() => {
    appliquerLaLangue(langue);
  }, [langue]);

  return langue;
}
