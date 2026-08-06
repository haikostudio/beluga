import { COLUMN_LABELS, type ColumnKey } from './columns.js';
import {
  environnementVise,
  environnementsDuProjet,
  libelleRole,
  type ProjetPublie,
} from './environnements-publication.js';

/**
 * Ce qu'il faut FAIRE pour déployer ce projet-là, écrit à la main.
 *
 * Un projet ne décrivait sa publication que par une commande et une adresse par
 * environnement : nulle part on ne pouvait dire l'ORDRE des gestes, ce qu'il
 * faut contrôler avant, ce qu'il ne faut surtout pas faire. Le projet porte
 * donc une consigne en texte libre — celle que l'agent de déploiement recevra.
 *
 * DEUX consignes, indépendantes l'une de l'autre, une par étape du parcours de
 * mise en ligne : celle de « À déployer » et celle de « En production ». Elles
 * sont rangées PAR COLONNE et non par cible, parce que c'est la colonne qu'on
 * a sous les yeux quand on l'écrit : selon qu'un projet a ou non un
 * environnement de dev, « À déployer » pousse vers le dev ou vers la
 * production, et une consigne qui changerait de sens sans qu'on y touche
 * serait un piège.
 *
 * Une consigne VIDE est un état normal, jamais un oubli : elle veut dire
 * « déroulé habituel ». C'est pourquoi l'écriture RETIRE la clé plutôt que de
 * ranger une chaîne vide — deux façons de dire la même chose finissent par
 * diverger.
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

/** Les deux colonnes qui portent une consigne, dans l'ordre du parcours. */
export const COLONNES_CONSIGNE = ['to_deploy', 'in_production'] as const;
export type ColonneConsigne = (typeof COLONNES_CONSIGNE)[number];

/** Ce qu'on garde d'une consigne : au-delà, c'est de la documentation. */
export const CONSIGNE_MAX = 4000;

/** Les consignes d'un projet, rangées par colonne. Une clé absente = vide. */
export type ConsignesDeploiement = Partial<Record<ColonneConsigne, string>>;

/** Ce qu'un projet porte, vu d'ici. */
export type ProjetAvecConsignes = ProjetPublie & {
  consignesDeploiement?: ConsignesDeploiement;
};

/** Cette colonne porte-t-elle une consigne de déploiement ? */
export function estColonneDeConsigne(colonne: ColumnKey): colonne is ColonneConsigne {
  return (COLONNES_CONSIGNE as readonly ColumnKey[]).includes(colonne);
}

/**
 * La consigne écrite pour cette colonne, ou la chaîne vide.
 *
 * Point de lecture UNIQUE : le démon comme l'interface passent par lui, si bien
 * qu'un projet jamais réglé et un projet dont la consigne a été effacée se
 * traitent exactement pareil.
 */
export function consigneDeploiement(
  projet: ProjetAvecConsignes | undefined,
  colonne: ColonneConsigne,
): string {
  const texte = projet?.consignesDeploiement?.[colonne];
  return typeof texte === 'string' ? texte.trim() : '';
}

/**
 * Écrit la consigne d'une colonne SANS toucher à l'autre : les deux étapes sont
 * indépendantes, régler la mise en production ne doit rien changer à la mise
 * sur l'environnement de dev.
 *
 * Un texte vide (ou fait d'espaces) EFFACE la consigne au lieu d'en ranger une
 * vide : la lecture ne rendra alors rien, ce qui veut dire « déroulé habituel ».
 */
export function ecrireConsigneDeploiement(
  consignes: ConsignesDeploiement | undefined,
  colonne: ColonneConsigne,
  texte: string,
): ConsignesDeploiement {
  const suite: ConsignesDeploiement = {};
  for (const cle of COLONNES_CONSIGNE) {
    const valeur = consignes?.[cle]?.trim();
    if (valeur) suite[cle] = valeur.slice(0, CONSIGNE_MAX);
  }
  const propre = (texte ?? '').trim().slice(0, CONSIGNE_MAX);
  if (propre) suite[colonne] = propre;
  else delete suite[colonne];
  return suite;
}

/** Le titre de la fenêtre : la colonne qu'on règle, nommée comme à l'écran. */
export function titreDeConsigne(colonne: ColonneConsigne): string {
  return `Déploiement depuis « ${COLUMN_LABELS[colonne]} »`;
}

/**
 * Ce qui est DÉJÀ connu du projet, en une ligne, pour qu'on n'écrive pas à
 * l'aveugle : l'environnement que cette étape vise par défaut et la branche
 * qu'il installe.
 *
 * On ne devine rien. L'environnement visé sans choix explicite est le PREMIER
 * de la liste — c'est exactement ce que fait la publication
 * (`environnementVise`) — et la branche vide veut dire la branche principale,
 * comme partout ailleurs. Quand le projet a plusieurs environnements, on le dit
 * plutôt que de laisser croire qu'il n'y en a qu'un.
 */
export function rappelDeConsigne(projet: ProjetAvecConsignes | undefined): string {
  if (!projet) return 'Projet inconnu.';
  const liste = environnementsDuProjet(projet);
  const vise = environnementVise(projet);
  const branche = vise.branche ? `branche « ${vise.branche} »` : 'branche principale';
  const autres =
    liste.length > 1
      ? ` — ${liste.length} environnements réglés, celui-ci est visé par défaut`
      : '';
  return `Environnement visé : ${vise.nom} (${libelleRole(vise.role)}), ${branche}${autres}.`;
}

/** L'état d'une consigne, dit en une ligne sous l'entrée du menu. */
export function mentionConsigne(texte: string): string {
  const propre = texte.trim();
  if (!propre) return 'Aucune consigne : déroulé habituel.';
  const lignes = propre.split('\n').filter((ligne) => ligne.trim()).length;
  return `Consigne écrite : ${propre.length} signes, ${lignes} ligne${lignes > 1 ? 's' : ''}.`;
}
