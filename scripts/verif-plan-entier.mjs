#!/usr/bin/env node
/*
 * UNE ITÉRATION DE MODE PLAN REND LE PLAN ENTIER — jamais une réponse.
 *
 * Le chef répondait parfois à une relance comme à une simple question : trois
 * pistes et « dites-moi laquelle intégrer au plan », affichées quand même en
 * « Plan proposé · version 3 » avec leurs boutons. L'utilisateur perdait le
 * plan qu'il avait, et « Valider » portait sur un fragment.
 *
 * Ce contrôle vérifie les trois pièces qui l'empêchent maintenant :
 *   — la RÈGLE : un texte n'est un plan que s'il annonce ses quatre parties ;
 *   — la CONSIGNE : une question se répond DANS le plan, un choix se pose après ;
 *   — le BRANCHEMENT : le démon juge le texte rendu, relance le chef une fois,
 *     et refuse le drapeau `plan` à ce qui reste incomplet.
 *
 * Lecture de code et règles pures : aucun navigateur, aucun moteur appelé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consigneDePlanEntier,
  jugerLePlan,
  PARTIES_DU_PLAN,
} from '../shared/dist/plan-complet.js';
import { consigneDeRepriseDuPlan, dernierPlanRedige, planEnAttente } from '../shared/dist/plan-conversation.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(RACINE, 'server/src/runtime.ts'), 'utf8');

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

/* ------------------------------------------------------------------ */
/* La règle : quatre parties, annoncées sous leurs titres              */
/* ------------------------------------------------------------------ */

const PLAN_ENTIER = [
  '## Faisabilité',
  'Réalisable sans toucher au tableau.',
  '',
  '## Chemin à suivre',
  'Trois étapes courtes, dans cet ordre.',
  '',
  '## Conséquences',
  'Le cadre du plan se relit seul.',
  '',
  '## Améliorations apportées',
  'Un seul texte à lire, toujours à jour.',
].join('\n');

/* Le cas réel qui a motivé la carte, recopié tel quel. */
const FRAGMENT = [
  'Trois pistes, par ordre de gain réel :',
  '',
  '**Le découpage avant le modèle.** La taille des passages décide de tout.',
  '',
  '**Pondérer par fraîcheur.** À pertinence égale, le plus récent remonte.',
  '',
  'Dites-moi laquelle intégrer au plan.',
].join('\n');

verifier('les quatre parties du plan sont nommées une fois pour toutes', PARTIES_DU_PLAN.length === 4);
verifier('un plan aux quatre titres est reconnu entier', jugerLePlan(PLAN_ENTIER).complet === true);
verifier(
  'trois pistes suivies d’une question ne sont PAS un plan',
  jugerLePlan(FRAGMENT).complet === false && jugerLePlan(FRAGMENT).manquantes.length === 4,
);
verifier(
  'une partie retirée est nommée, et elle seule',
  JSON.stringify(jugerLePlan(PLAN_ENTIER.split('\n## Conséquences')[0]).manquantes) ===
    JSON.stringify(['Conséquences', 'Améliorations apportées']),
);
verifier(
  'les mêmes mots en pleine phrase ne font pas un plan',
  jugerLePlan('Les conséquences sont faibles, les améliorations viendront ensuite.').complet === false,
);
verifier(
  'les titres en gras et les intitulés suivis de deux points comptent aussi',
  jugerLePlan(
    [
      '**Faisabilité.** Oui.',
      'CHEMIN À SUIVRE : deux étapes.',
      '**Conséquences** — rien ne bouge ailleurs.',
      '- Améliorations apportées : un texte de moins à recoller.',
    ].join('\n'),
  ).complet === true,
);

/* ------------------------------------------------------------------ */
/* La consigne : la question s'ajoute au plan, elle ne le remplace pas */
/* ------------------------------------------------------------------ */

const relance = consigneDePlanEntier(3, ['Conséquences']);
verifier('la relance nomme la version attendue', /VERSION 3/.test(relance));
verifier('la relance nomme la partie manquante', /Conséquences/.test(relance));
verifier('la relance range la question APRÈS les quatre parties', /APRÈS les quatre parties/.test(relance));

const reprise = consigneDeRepriseDuPlan({ index: 0, numero: 2, contenu: PLAN_ENTIER });
verifier(
  'la consigne de reprise prévient qu’une question ne remplace pas le plan',
  /MÊME SI LE MESSAGE CI-DESSOUS EST UNE QUESTION/.test(reprise),
);
verifier('la consigne de reprise recopie le plan précédent', reprise.includes('## Faisabilité'));

verifier(
  'la consigne du chef dit qu’une question se répond dans le plan',
  runtime.includes("UNE QUESTION DE L'UTILISATEUR SE RÉPOND DANS LE PLAN") &&
    runtime.includes('LE DÉMON VÉRIFIE'),
);

/* ------------------------------------------------------------------ */
/* Le fil : une version précédente existe même quand un message la suit */
/* ------------------------------------------------------------------ */

const fil = [
  { plan: true, content: 'version 1' },
  { plan: false, content: 'affine-le' },
  { plan: true, content: 'version 2' },
  { plan: false, content: 'et si on faisait autrement ?' },
];
verifier('le dernier plan écrit garde son numéro de version', dernierPlanRedige(fil)?.numero === 2);
verifier('ce plan n’attend plus de décision, mais il existe encore', planEnAttente(fil) === null);
verifier('un fil sans plan ne renvoie rien', dernierPlanRedige([{ plan: false, content: 'bonjour' }]) === null);

/* ------------------------------------------------------------------ */
/* Le branchement dans le démon                                        */
/* ------------------------------------------------------------------ */

verifier('la fin de tour juge le texte rendu', runtime.includes('jugerLePlan(finalText)'));
verifier(
  'le chef est relancé une fois, avec la consigne du plan entier',
  runtime.includes('rendreLePlanEntier(') && runtime.includes('consigneDePlanEntier('),
);
verifier(
  'la relance repart de la version précédente, retrouvée dans le fil',
  runtime.includes('dernierPlanRedige(store.listMessages(agent.id)'),
);
verifier(
  'la relance ne dispose d’aucun outil',
  runtime.includes('OUTILS_FERMES_POUR_LA_RELANCE') && runtime.includes("disallowedTools: OUTILS_FERMES_POUR_LA_RELANCE"),
);
verifier(
  'un texte encore incomplet perd le drapeau du plan',
  runtime.includes("...(failed || (agent.run.mode === 'plan' && !planRendu) ? { plan: false } : {})"),
);
verifier('le rattrapage laisse une étape visible dans la conversation', runtime.includes('ETAPE_PLAN_ID'));

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
