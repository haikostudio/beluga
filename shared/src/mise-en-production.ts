/**
 * LE PROMPT DE MISE EN PRODUCTION : un seul endroit, un seul texte.
 *
 * Deux mécanismes de consigne coexistaient sans se rejoindre. Celui que la
 * publication LISAIT vivait sur un environnement de publication et aucun champ
 * ne permettait de l'écrire. Celui qu'on pouvait ÉCRIRE — une fenêtre ouverte
 * depuis le menu d'une colonne, une base brute et une consigne par colonne —
 * n'était lu par personne. Les deux sont remplacés par CE réglage, rangé sur le
 * PROJET et lu par la publication.
 *
 * Deux textes, conservés côte à côte :
 *  - la BASE : le concept écrit par l'utilisateur dans ses mots — quel serveur,
 *    par quel chemin, quels contrôles ;
 *  - le PROMPT : ce que l'agent de mise en production reçoit. Un bouton le
 *    fabrique à partir de la base par un tour d'agent ; il reste MODIFIABLE et
 *    n'est retenu qu'à l'enregistrement.
 *
 * Un prompt VIDE est un état normal : la mise en production retombe alors sur
 * ce que HaikoDev CONSTATE du projet (service système, dossier servi…), et
 * quand il n'y a rien à constater, elle le dit au lieu de mentir. C'est pourquoi
 * l'écriture RETIRE la clé plutôt que de ranger une chaîne vide — deux façons de
 * dire la même chose finissent par diverger.
 *
 * Règles PURES : ni base, ni disque, ni date.
 */

/** Ce qu'on garde d'un prompt : au-delà, c'est de la documentation. */
export const PROMPT_PRODUCTION_MAX = 8000;

/** Le titre du bloc, dans les réglages du projet comme dans les messages. */
export const TITRE_MISE_EN_PRODUCTION = 'Mise en production';

/** Ce qu'un projet range pour sa mise en production. */
export type MiseEnProduction = {
  /** Le concept écrit à la main par l'utilisateur, dans ses mots. */
  base?: string;
  /** Le prompt donné à l'agent de mise en production. */
  prompt?: string;
};

/**
 * Ce qu'un projet porte, vu d'ici. Il n'y a plus d'environnement à viser : le
 * lot part toujours de la branche principale, et la seule adresse réglée est
 * celle de l'instance de dev.
 */
export type ProjetMisEnProduction = {
  devUrl?: string;
  miseEnProduction?: MiseEnProduction;
};

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/**
 * Le PROMPT de mise en production de ce projet, ou la chaîne vide.
 *
 * Point de lecture UNIQUE : le démon comme l'interface passent par lui, si bien
 * qu'un projet jamais réglé et un projet dont le prompt a été effacé se traitent
 * exactement pareil. Un prompt fait d'espaces n'est pas un prompt — on ne lance
 * pas un agent sans rien à lui dire.
 */
export function promptDeMiseEnProduction(projet: ProjetMisEnProduction | undefined): string {
  return texte(projet?.miseEnProduction?.prompt);
}

/** La BASE écrite à la main, ou la chaîne vide. Même règle de lecture. */
export function baseDeMiseEnProduction(projet: ProjetMisEnProduction | undefined): string {
  return texte(projet?.miseEnProduction?.base);
}

/**
 * Écrit la base et le prompt, l'un sans forcer l'autre.
 *
 * Un champ absent de `champs` garde sa valeur d'avant ; un champ vide (ou fait
 * d'espaces) EFFACE la clé au lieu d'en ranger une vide. Les deux textes vivent
 * côte à côte : on ré-édite la base et on relance la génération autant qu'on
 * veut sans perdre le prompt déjà retenu.
 */
export function ecrireMiseEnProduction(
  actuel: MiseEnProduction | undefined,
  champs: MiseEnProduction,
): MiseEnProduction {
  const suite: MiseEnProduction = {};
  for (const cle of ['base', 'prompt'] as const) {
    const valeur = cle in champs ? texte(champs[cle]) : texte(actuel?.[cle]);
    if (valeur) suite[cle] = valeur.slice(0, PROMPT_PRODUCTION_MAX);
  }
  return suite;
}

/* ------------------------------------------------------------------ */
/* Ce que le projet connaît déjà                                        */
/* ------------------------------------------------------------------ */

/**
 * Ce qui est DÉJÀ connu du projet, en une ligne, pour qu'on n'écrive pas à
 * l'aveugle : la branche d'où part le lot — toujours la principale — et
 * l'adresse réglée pour le projet, quand il y en a une.
 */
export function rappelDeMiseEnProduction(projet: ProjetMisEnProduction | undefined): string {
  if (!projet) return 'Projet inconnu.';
  const adresse = projet.devUrl?.trim();
  return adresse
    ? `Mise en production depuis la branche principale. Adresse réglée pour ce projet : ${adresse}.`
    : 'Mise en production depuis la branche principale. Aucune adresse n’est réglée pour ce projet.';
}

/** L'état du réglage, dit en une ligne sous le bloc. */
export function mentionMiseEnProduction(prompt: string): string {
  const propre = prompt.trim();
  if (!propre) return 'Aucun prompt : HaikoDev se débrouille avec ce qu’il constate du projet.';
  const lignes = propre.split('\n').filter((ligne) => ligne.trim()).length;
  return `Prompt écrit : ${propre.length} signes, ${lignes} ligne${lignes > 1 ? 's' : ''}.`;
}

/* ------------------------------------------------------------------ */
/* Fabriquer le prompt par un agent                                     */
/* ------------------------------------------------------------------ */

/**
 * Ce que l'agent générateur reçoit : le concept brut de l'utilisateur, et ce
 * que le projet connaît déjà de sa production.
 *
 * Règle PURE : elle ne fait qu'assembler le texte. L'agent doit rendre le SEUL
 * texte du prompt final — pas de préambule, pas de clôture — parce que sa
 * dernière réponse EST le prompt proposé.
 */
export function promptGenerationMiseEnProduction(
  projet: ProjetMisEnProduction | undefined,
  base: string,
): string {
  return [
    `Tu rédiges le PROMPT que l’agent de mise en production de ce projet recevra, à chaque publication, pour mettre le code en ligne.`,
    ``,
    rappelDeMiseEnProduction(projet),
    ``,
    `Voici le concept, écrit à la main par l’utilisateur dans ses propres mots — c’est la BASE à mettre en forme :`,
    `<<<BASE`,
    (base ?? '').trim(),
    `BASE`,
    ``,
    `Va LIRE le projet (fichiers de configuration, scripts, service, documentation) pour préciser ce que la base laisse dans le flou : chemins réels, noms de commandes, nom du service.`,
    ``,
    `Écris ensuite un prompt CLAIR et sans ambiguïté :`,
    `- les gestes DANS L’ORDRE, un par ligne, en français simple ;`,
    `- ce qu’il faut contrôler avant, et à quoi on voit que la mise en ligne a réellement abouti ;`,
    `- ce qu’il ne faut SURTOUT PAS faire, si la base le dit ou si c’est évident.`,
    `Reste FIDÈLE à la base : tu la mets en forme et tu la précises, tu n’inventes pas d’étape qu’elle ne dit pas.`,
    ``,
    `Le code sera DÉJÀ fusionné, enregistré et envoyé sur le dépôt quand ce prompt servira : n’y mets aucune manœuvre git de fusion ou d’envoi, HaikoDev s’en charge.`,
    `Tu ne DÉPLOIES rien, tu n’exécutes aucune commande de publication, tu ne modifies aucun fichier : tu ne fais que RÉDIGER le texte.`,
    `Ta réponse doit être le SEUL texte du prompt final : aucune phrase d’introduction, aucun bloc de code autour, rien après. Reste sous ${PROMPT_PRODUCTION_MAX} signes.`,
  ].join('\n');
}

/**
 * Nettoie ce que l'agent a rendu avant d'en faire le prompt proposé : on retire
 * un éventuel bloc de code qui l'entoure en entier (un moteur enveloppe parfois
 * sa réponse), on rogne les bords et on borne à `PROMPT_PRODUCTION_MAX`.
 */
export function nettoyerPromptGenere(brut: string): string {
  let propre = (brut ?? '').trim();
  const fence = propre.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) propre = fence[1].trim();
  return propre.slice(0, PROMPT_PRODUCTION_MAX);
}
