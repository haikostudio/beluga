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
 * ET LE FOND, depuis : quatre titres remplis d'une phrase chacun ne font pas un
 * plan réfléchi. La matière se compte (analyse, étapes, sous-titres, liste
 * d'améliorations), le pavé aussi, et le chef est relancé une fois de plus —
 * sans jamais perdre le cadre d'un plan par ailleurs entier.
 *
 * Lecture de code et règles pures : aucun navigateur, aucun moteur appelé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consigneDePlanEntier,
  consigneDePlanPlusFouille,
  corpsDesParties,
  jugerLeFond,
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
/*
 * Le drapeau ne se RETIRE plus : il ne se POSE qu'à la fin du tour, et
 * seulement sur un plan entier. `planRendu` porte les trois conditions —
 * mode plan, tour allé au bout, texte jugé complet.
 */
verifier('le drapeau du plan ne se pose qu’à la fin du tour', runtime.includes('plan: planRendu,'));
verifier(
  'le message naît sans drapeau de plan, avant tout texte',
  runtime.includes('streaming: true,') && /streaming: true,[\s\S]{0,900}?plan: false,/.test(runtime),
);
verifier(
  'un texte encore incomplet n’obtient pas le drapeau du plan',
  runtime.includes("let planRendu = agent.run.mode === 'plan' && !failed;") &&
    runtime.includes('planRendu = false;'),
);
verifier('le rattrapage laisse une étape visible dans la conversation', runtime.includes('ETAPE_PLAN_ID'));

/* ------------------------------------------------------------------ */
/* LE FOND : la matière du plan, comptée                               */
/* ------------------------------------------------------------------ */

const PLAN_FOUILLE = [
  '## Faisabilité',
  '',
  "**Ce qui existe aujourd'hui.** Le cadre du plan pose son entête, ses versions précédentes",
  'et ses deux boutons ; le démon ne juge que la présence des quatre titres, jamais ce',
  'qu’il y a dessous. Une phrase par partie suffisait donc à passer.',
  '',
  '**Ce que la demande veut.** Une analyse constatée, des parties découpées et hiérarchisées,',
  'et un fond gris clair qui distingue le cadre dans le fil de la conversation.',
  '',
  "**L'écart.** Il manque une règle qui compte la matière et un jeton de couleur à part.",
  '',
  '**Ce dont je ne suis pas sûr.** Le seuil du pavé reste un choix, pas une mesure.',
  '',
  '## Chemin à suivre',
  '',
  '1. **Compter la matière.** Une règle partagée juge le fond du plan.',
  '2. **Poser le fond gris.** Un jeton décliné pour les deux thèmes.',
  '3. **Rendre les améliorations cliquables.** La mécanique des évolutions, réemployée.',
  '',
  '## Conséquences',
  '',
  'Le chef est relancé une fois quand son plan est mince, et le cadre se repère sans être lu.',
  '',
  '## Améliorations apportées',
  '',
  '- Ajoute un aperçu du plan dans la colonne de gauche.',
  '- Chiffre chaque étape du chemin en minutes.',
  '- Dis ce qui peut casser et comment revenir en arrière.',
].join('\n');

verifier('un plan vraiment fouillé passe la seconde vérification', jugerLeFond(PLAN_FOUILLE).assezFouille === true);

const fondMaigre = jugerLeFond(PLAN_ENTIER);
const idsMaigres = fondMaigre.reproches.map((r) => r.id);
verifier('quatre titres et une phrase chacun ne suffisent plus', fondMaigre.assezFouille === false);
verifier('l’analyse trop mince est nommée', idsMaigres.includes('analyse-mince'));
verifier('le chemin sans étapes numérotées est nommé', idsMaigres.includes('chemin-sans-etapes'));
verifier('le plan sans aucun sous-titre est nommé', idsMaigres.includes('sans-hierarchie'));
verifier(
  'des améliorations qui ne sont pas une liste sont nommées',
  idsMaigres.includes('ameliorations-non-listees'),
);
verifier(
  'le pavé est refusé autant que la maigreur',
  jugerLeFond(`${PLAN_FOUILLE}\n\n${'Une phrase de trop. '.repeat(120)}`).reproches.some((r) => r.id === 'pave'),
);

/* Le découpage doit tenir : une étape nommée « Rendre les améliorations
   cliquables » ne doit PAS ouvrir la quatrième partie au milieu du chemin. */
const parties = corpsDesParties(PLAN_FOUILLE);
verifier(
  'chaque partie est découpée sur son propre titre, pas sur un mot du texte',
  (parties.get('Chemin à suivre') ?? '').includes('Rendre les améliorations cliquables') &&
    !(parties.get('Améliorations apportées') ?? '').includes('Compter la matière'),
);

const relanceFond = consigneDePlanPlusFouille(4, fondMaigre.reproches);
verifier('la relance de fond nomme la version attendue', /VERSION 4/.test(relanceFond));
verifier('la relance de fond dit ce qui manque', /PAS SA MATIÈRE/.test(relanceFond));
verifier('la relance de fond interdit le pavé', /jamais un pavé/.test(relanceFond));

verifier(
  'la consigne du chef exige une analyse constatée et des étapes numérotées',
  runtime.includes('la VRAIE ANALYSE') &&
    runtime.includes("ce que le projet fait AUJOURD'HUI") &&
    runtime.includes('étapes NUMÉROTÉES'),
);
verifier(
  'la consigne du chef fait des « Améliorations apportées » une liste cliquable',
  runtime.includes('AMÉLIORATIONS APPORTÉES : une LISTE À PUCES') && runtime.includes('idées à AJOUTER au plan'),
);
verifier('la consigne du chef annonce la seconde vérification', runtime.includes('LE DÉMON VÉRIFIE, DEUX FOIS'));
verifier(
  'le démon juge le fond et relance le chef une fois de plus',
  runtime.includes('jugerLeFond(finalText)') && runtime.includes('consigneDePlanPlusFouille('),
);
verifier(
  'un plan mince mais entier garde son cadre : le fond ne retire jamais le drapeau',
  !/fond\.assezFouille[\s\S]{0,400}planRendu = false/.test(runtime),
);
verifier('la reprise en profondeur laisse une étape visible', runtime.includes('ETAPE_FOND_ID'));

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
