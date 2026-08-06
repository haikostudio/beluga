import { COLUMN_LABELS, type ColumnKey } from './columns.js';

/**
 * Ce qu'il faut FAIRE pour déployer ce projet-là, écrit à la main.
 *
 * Le déploiement sur l'instance de dev se passe de tout réglage : il se
 * constate. La MISE EN PRODUCTION, elle, ne se devine pas — l'ORDRE des gestes,
 * ce qu'il faut contrôler avant, ce qu'il ne faut surtout pas faire n'a de place
 * nulle part ailleurs. Le projet porte donc une consigne en texte libre, celle
 * que l'agent de déploiement recevra.
 *
 * DEUX consignes, indépendantes l'une de l'autre, une par étape du parcours de
 * mise en ligne : celle de « À déployer » et celle de « En production ». Elles
 * sont rangées PAR COLONNE, parce que c'est la colonne qu'on a sous les yeux
 * quand on l'écrit.
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

/**
 * Les BASES de texte d'un projet, rangées par colonne, mêmes clés que les
 * consignes. La base est la procédure brute écrite par l'utilisateur, dans ses
 * propres mots ; c'est elle qu'un agent met en forme pour produire la consigne
 * finale. Une clé absente = pas de base saisie.
 */
export type BasesDeploiement = Partial<Record<ColonneConsigne, string>>;

/** Ce qu'un projet porte, vu d'ici. */
export type ProjetAvecConsignes = {
  /** L'adresse de l'instance de dev, contrôlée à la fin d'un déploiement. */
  devUrl?: string;
  consignesDeploiement?: ConsignesDeploiement;
  basesDeploiement?: BasesDeploiement;
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
 * indépendantes, régler la mise en production ne doit rien changer au
 * déploiement sur l'instance de dev.
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

/**
 * La BASE de texte écrite pour cette colonne, ou la chaîne vide.
 *
 * Point de lecture UNIQUE, comme `consigneDeploiement` : la base et la consigne
 * finale se rangent côte à côte, chacune dans son objet, et se relisent pareil.
 */
export function baseDeploiement(
  projet: ProjetAvecConsignes | undefined,
  colonne: ColonneConsigne,
): string {
  const texte = projet?.basesDeploiement?.[colonne];
  return typeof texte === 'string' ? texte.trim() : '';
}

/**
 * Écrit la base d'une colonne SANS toucher à l'autre — exactement la même règle
 * que `ecrireConsigneDeploiement` : un texte vide efface la clé, on borne à
 * `CONSIGNE_MAX`, on ne garde que les deux colonnes connues.
 */
export function ecrireBaseDeploiement(
  bases: BasesDeploiement | undefined,
  colonne: ColonneConsigne,
  texte: string,
): BasesDeploiement {
  const suite: BasesDeploiement = {};
  for (const cle of COLONNES_CONSIGNE) {
    const valeur = bases?.[cle]?.trim();
    if (valeur) suite[cle] = valeur.slice(0, CONSIGNE_MAX);
  }
  const propre = (texte ?? '').trim().slice(0, CONSIGNE_MAX);
  if (propre) suite[colonne] = propre;
  else delete suite[colonne];
  return suite;
}

/**
 * La CONSIGNE que l'agent générateur reçoit : sa base brute mise en forme,
 * avec ce que le projet connaît déjà de cette étape.
 *
 * Règle PURE : elle ne fait qu'assembler le texte. L'agent doit rendre le SEUL
 * texte de la consigne finale — pas de préambule, pas de sections, pas de
 * clôture — parce que sa dernière réponse EST la consigne retenue.
 */
export function promptGenerationConsigne(
  projet: ProjetAvecConsignes | undefined,
  colonne: ColonneConsigne,
  base: string,
): string {
  const etape = COLUMN_LABELS[colonne];
  const brute = (base ?? '').trim();
  return [
    `Tu rédiges la CONSIGNE DE DÉPLOIEMENT que l'agent de publication de ce projet suivra pour l'étape « ${etape} ».`,
    ``,
    rappelDeConsigne(projet),
    ``,
    `Voici la procédure brute, écrite à la main par l'utilisateur dans ses propres mots — c'est la BASE à mettre en forme :`,
    `<<<BASE`,
    brute,
    `BASE`,
    ``,
    `À partir de cette base et de ce que tu peux lire du projet, écris une consigne CLAIRE et sans ambiguïté :`,
    `- les gestes DANS L'ORDRE, un par ligne, en français simple ;`,
    `- ce qu'il faut contrôler avant et après ;`,
    `- ce qu'il ne faut SURTOUT PAS faire, si la base le dit ou si c'est évident.`,
    `Reste FIDÈLE à la base : tu la mets en forme et tu la précises, tu n'inventes pas d'étape qu'elle ne dit pas.`,
    ``,
    `Tu ne DÉPLOIES rien, tu n'exécutes aucune commande de publication, tu ne modifies aucun fichier : tu ne fais que RÉDIGER le texte.`,
    `Ta réponse doit être le SEUL texte de la consigne finale : aucune phrase d'introduction, aucun titre de section, aucun bloc de code autour, rien après. Reste sous ${CONSIGNE_MAX} signes.`,
  ].join('\n');
}

/**
 * Nettoie ce que l'agent a rendu avant d'en faire la consigne : on retire un
 * éventuel bloc de code qui l'entoure en entier (un moteur enveloppe parfois sa
 * réponse), on rogne les bords et on borne à `CONSIGNE_MAX`.
 */
export function nettoyerConsigneGeneree(texte: string): string {
  let propre = (texte ?? '').trim();
  const fence = propre.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) propre = fence[1].trim();
  return propre.slice(0, CONSIGNE_MAX);
}

/** Le titre de la fenêtre : la colonne qu'on règle, nommée comme à l'écran. */
export function titreDeConsigne(colonne: ColonneConsigne): string {
  return `Déploiement depuis « ${COLUMN_LABELS[colonne]} »`;
}

/**
 * Ce qui est DÉJÀ connu du projet, en une ligne, pour qu'on n'écrive pas à
 * l'aveugle : la seule chose réglée est l'adresse de l'instance de dev, celle
 * que HaikoDev contrôle à la fin d'un déploiement.
 *
 * On ne devine rien. Le déploiement se fait toujours depuis la branche
 * principale : il n'y a plus de branche ni d'environnement à choisir, donc rien
 * d'autre à rappeler.
 */
export function rappelDeConsigne(projet: ProjetAvecConsignes | undefined): string {
  if (!projet) return 'Projet inconnu.';
  const adresse = projet.devUrl?.trim();
  return adresse
    ? `Déploiement depuis la branche principale. Adresse de l’instance de dev : ${adresse}.`
    : 'Déploiement depuis la branche principale. Aucune adresse de dev n’est réglée pour ce projet.';
}

/** L'état d'une consigne, dit en une ligne sous l'entrée du menu. */
export function mentionConsigne(texte: string): string {
  const propre = texte.trim();
  if (!propre) return 'Aucune consigne : déroulé habituel.';
  const lignes = propre.split('\n').filter((ligne) => ligne.trim()).length;
  return `Consigne écrite : ${propre.length} signes, ${lignes} ligne${lignes > 1 ? 's' : ''}.`;
}
