/**
 * LA RÉPARATION SILENCIEUSE D'UNE ÉTAPE DE PUBLICATION — les règles pures.
 *
 * Décision de l'utilisateur (cadrage du 2026-10-18) : une étape de déploiement
 * ou de mise en production qui tombe est réparée EN SILENCE par un agent, puis
 * rejouée dans la MÊME publication. Trois essais par étape ; seulement ensuite,
 * l'étape passe en échec et porte un ENCADRÉ D'ABANDON — ce qui bloque, en mots
 * simples, et la marche à suivre. Pendant la réparation : ni croix rouge, ni
 * alerte, ni notification. Une tâche du lot en conflit est réparée de même, et
 * part avec les autres.
 *
 * Restent HORS DU CHAMP (comportement inchangé) : un arrêt demandé, une coupure
 * par redémarrage, une machine saturée — appeler un agent sur une saturation l'a
 * DOUBLÉE le 08.09.2026 (`natureDePublication`).
 *
 * Le démon (`server/src/reparation-publication.ts`, `server/src/deploy.ts`)
 * lance l'agent, l'attend et rejoue ; ce fichier dit QUAND réparer, ce qu'on
 * demande à l'agent, et ce que l'encadré affiche quand il n'a rien pu rédiger.
 */

import { natureDePublication } from './mise-en-ligne.js';

/** Combien d'essais d'agent, au plus, pour relever UNE étape (ou une tâche en conflit). */
export const MAX_REPARATIONS_PAR_ETAPE = 3;

/** Ce qu'il faut faire d'une étape qui vient de tomber. */
export type DecisionDeReparation = 'reparer' | 'abandon' | 'hors-champ';

/**
 * L'ÉTAPE TOMBÉE SE RÉPARE-T-ELLE ? « hors-champ » pour un arrêt demandé ou une
 * machine saturée (l'étape tombe comme avant, sans agent) ; « abandon » quand
 * les trois essais sont déjà consommés ; sinon « reparer ».
 */
export function decisionDeReparation(input: { essais: number; motif: string; arrete?: boolean; cle?: string }): DecisionDeReparation {
  if (input.arrete) return 'hors-champ';
  if (natureDePublication({ etat: 'failed', etapeTombee: input.cle ?? 'etape', motif: input.motif }) === 'saturee') return 'hors-champ';
  return input.essais >= MAX_REPARATIONS_PAR_ETAPE ? 'abandon' : 'reparer';
}

/** Ce que l'encadré d'abandon affiche. */
export interface BlocageDEtape {
  explication: string;
  marcheASuivre?: string;
  agentId?: string;
  essais?: number;
}

/** L'ENCADRÉ QUAND AUCUN COMPTE N'A DE PLACE POUR FAIRE TRAVAILLER UN AGENT (DEC-039). */
export function blocageSansMoteur(etape: string, raison?: string): BlocageDEtape {
  const motif = raison?.trim();
  return {
    explication: `L’étape « ${etape} » a rencontré un problème, et aucun compte d’agent n’a de place libre pour le réparer en ce moment.${motif ? ` Dernier message : ${motif}` : ''}`,
    marcheASuivre: 'Attendez qu’un compte retrouve du quota, puis cliquez « Relancer ». Vous pouvez aussi cliquer « Résoudre le problème » pour qu’un agent s’en charge dès que possible.',
    essais: 0,
  };
}

/** L'ENCADRÉ QUAND L'AGENT A ÉPUISÉ SES ESSAIS SANS RIEN RÉDIGER. */
export function blocageApresLesEssais(input: { etape: string; essais: number; raison?: string; agentId?: string }): BlocageDEtape {
  const raison = input.raison?.trim();
  return {
    explication: `L’étape « ${input.etape} » retombe encore après ${input.essais} essai${input.essais > 1 ? 's' : ''} de réparation automatique.${raison ? ` Dernier message : ${raison}` : ''}`,
    marcheASuivre: input.agentId
      ? 'Ouvrez la conversation de l’agent pour voir ce qu’il a tenté, puis cliquez « Relancer » une fois le problème réglé.'
      : 'Cliquez « Résoudre le problème » pour qu’un agent cherche la cause, ou « Relancer » une fois le problème réglé.',
    agentId: input.agentId,
    essais: input.essais,
  };
}

/**
 * LA RAISON COURTE D'UN ÉCHEC, pour le message de la publication et sa
 * notification. La PREMIÈRE ligne du détail n'en est pas une : le détail de la
 * fusion commence par le récit (« dev : travaux en cours enregistrés »), et
 * c'est ce qui s'affichait comme cause (capture du 2026-10-18). On prend la
 * dernière phrase de conclusion — le dernier paragraphe — et sa première ligne.
 */
export function raisonCourteDeLEchec(texte: string): string {
  const paragraphes = texte
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const conclusion = paragraphes.length > 1 ? paragraphes[paragraphes.length - 1] : paragraphes[0] ?? '';
  return conclusion.split('\n').find((ligne) => ligne.trim())?.trim().slice(0, 200) ?? '';
}

/** Un heurt de fusion à régler sur place. */
export interface HeurtAReparer {
  branche: string;
  brancheDAccueil: string;
  titre: string;
  fichiers: string[];
}

/** Ce que la demande nomme de la panne. */
export interface EtapeAReparer {
  projet: string;
  dossier: string;
  cible: 'dev' | 'production' | undefined;
  etape: string;
  essai: number;
  /** Le détail de l'échec (fin du journal de l'étape). */
  journal: string;
  heurt?: HeurtAReparer;
}

const CONSIGNE_DE_VERDICT =
  'Quand tu as fini, appelle l’outil « rendre_reparation » : « issue » = « reparee » si tu as réparé, ou « abandon » si le problème te dépasse (un accès, un choix de l’utilisateur, une panne extérieure). Remplis toujours « explication » (ce qui bloquait, en une ou deux phrases simples pour quelqu’un qui ne programme pas) et, pour un abandon, « marche_a_suivre » (ce que l’utilisateur doit faire, concrètement). Puis termine ta réponse en une phrase.';

/** LA DEMANDE ENVOYÉE À L'AGENT DE RÉPARATION, pour UN essai. */
export function demandeDeReparation(panne: EtapeAReparer): string {
  const quoi = panne.cible === 'production' ? 'La mise en production' : 'Le déploiement';
  const dernier = panne.essai >= MAX_REPARATIONS_PAR_ETAPE;
  const entete = `${quoi} du projet « ${panne.projet} » est EN COURS et attend ta réparation. Essai ${panne.essai} sur ${MAX_REPARATIONS_PAR_ETAPE}${dernier ? ' — le DERNIER : si tu n’es pas sûr que l’étape passera, rends « abandon » avec la marche à suivre' : ''}.`;
  if (panne.heurt) {
    const liste = panne.heurt.fichiers.length ? panne.heurt.fichiers.map((f) => `- ${f}`).join('\n') : '- (fichiers non identifiés)';
    return [
      entete,
      `Dossier du dépôt : ${panne.dossier}`,
      `La fusion de la tâche « ${panne.heurt.titre} » (branche \`${panne.heurt.branche}\`) dans \`${panne.heurt.brancheDAccueil}\` est en conflit, et le dossier est resté EN PLEINE FUSION sur \`${panne.heurt.brancheDAccueil}\`.`,
      '',
      'Fichiers en conflit :',
      liste,
      '',
      'Fais exactement ceci, et rien d’autre :',
      '1. Reste sur la branche actuelle : ne change pas de branche, n’annule pas la fusion.',
      '2. Résous chaque conflit en GARDANT LES DEUX INTENTIONS : ce qui est déjà en ligne ET l’apport de la tâche. Ne supprime jamais le travail de l’un pour faire passer l’autre ; aucun marqueur de conflit ne doit rester.',
      '3. `git add` sur CHAQUE fichier résolu, nommé un par un (jamais `git add -A`), puis `git commit --no-edit`.',
      '4. Si un contrôle rapide du projet existe (compilation), vérifie que ça passe encore.',
      '',
      CONSIGNE_DE_VERDICT,
    ].join('\n');
  }
  return [
    entete,
    `Dossier du projet : ${panne.dossier}`,
    `Étape tombée : « ${panne.etape} »`,
    `Fin du journal de l'étape :\n\`\`\`\n${panne.journal.trim() || '(vide)'}\n\`\`\``,
    '',
    'Trouve la cause et répare-la dans le dossier du projet. Si tu changes du code, enregistre-le (`git add` nommé fichier par fichier, puis `git commit`) sur la branche où se trouve le dossier, sans en changer. L’étape sera REJOUÉE automatiquement dès la fin de ton tour : ne la rejoue pas toi-même si elle publie, ne publie rien, ne redémarre rien.',
    '',
    CONSIGNE_DE_VERDICT,
  ].join('\n');
}

/**
 * LA DERNIÈRE DEMANDE, quand l'étape retombe après le dernier essai : l'agent
 * ne répare plus, il RÉDIGE l'encadré que l'utilisateur va lire.
 */
export function demandeDEncadre(input: { etape: string; journal: string }): string {
  return [
    `L’étape « ${input.etape} » retombe encore après ton dernier essai. Ne répare plus rien.`,
    `Fin du journal :\n\`\`\`\n${input.journal.trim() || '(vide)'}\n\`\`\``,
    '',
    'Appelle maintenant l’outil « rendre_reparation » avec « issue » = « abandon » : « explication » dit ce qui bloque, en mots simples pour quelqu’un qui ne programme pas ; « marche_a_suivre » dit ce que l’utilisateur doit faire pour s’en sortir. Puis termine en une phrase.',
  ].join('\n');
}

/** Ce qu'une ligne du fil technique de l'étape raconte d'un essai. */
export function recitDeLEssai(input: { essai: number; heurt?: string }): string {
  return input.heurt
    ? `Heurt de fusion sur « ${input.heurt} » : réparation ${input.essai}/${MAX_REPARATIONS_PAR_ETAPE} confiée à un agent.`
    : `Réparation ${input.essai}/${MAX_REPARATIONS_PAR_ETAPE} confiée à un agent, puis l’étape est rejouée.`;
}

/** Le texte qui accompagne l'étape pendant la réparation : neutre, jamais alarmant. */
export const PROGRESSION_PENDANT_LA_REPARATION = 'Ajustement en cours…';
