import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  COLONNE_DE_LA_RELANCE,
  COLUMN_KEYS,
  barreEnFinDeTache,
  cadrageRouvertApresRapport,
  colonneApresComprehensionDeRelance,
  colonneApresReponseSansCadrage,
  lotDeployableDepuisLaCarte,
  iterationAFermer,
  gestesDuParcours,
  demarrageAutomatiqueAutorise,
  gesteDuDepot,
  messageDeLaCarteVaAuCadrage,
  relanceRetenueAvantLancement,
  carteEnCadrage,
  chapitreDuParcours,
  comprehensionDepuisLaRelance,
  decisionDePlanOuverte,
  gesteDuParcours,
  messageVaAuCadrage,
  messagesDepuisLaRelance,
  planDeLaRelance,
  planRenduDepuisLaRelance,
  RAISONS_DU_GESTE,
  travailDeLaCarteDejaLance,
} from '@beluga/shared';
import { MIGRATIONS } from '../db.js';

/*
 * UNE CARTE PRÊTE À PUBLIER QUI REÇOIT UN MESSAGE ROUVRE SA DISCUSSION ET PASSE
 * AUSSITÔT EN « DEMANDE » — jamais un tour de tâche en réponse. Elle revient
 * dans « À déployer » si le cadrage n'a fait que répondre, et reste en
 * « Demande » s'il a cadré un nouveau travail (`shared/src/relance-apres-rapport.ts`).
 */

const SOURCE = (fichier: string) => readFileSync(new URL(`../../src/${fichier}`, import.meta.url), 'utf8');
const SOURCE_PARTAGEE = (fichier: string) =>
  readFileSync(new URL(`../../../shared/src/${fichier}`, import.meta.url), 'utf8');

const RAPPORT_A = 1_000;
const ROUVERT_A = 2_000;
const planV1 = { numero: 1, texte: '# v1', at: 500 } as any;
const planV2 = { numero: 2, texte: '# v2', at: 3_000 } as any;

/* La carte relancée est en « Demande » — la colonne où la relance la pose. */
function contexte(parcours: any, extra: Record<string, unknown> = {}) {
  return {
    colonne: 'planned' as const,
    roleAgent: 'cadrage',
    tourEnCours: false,
    messages: [{ role: 'user', content: 'Encore une chose', at: ROUVERT_A }],
    parcours,
    agentDeLaCarte: 'agent-tache',
    agentDuPlan: 'agent-cadrage',
    codeDejaEnregistre: true,
    ...extra,
  } as any;
}

test('seul « À déployer » envoie un message au cadrage', () => {
  for (const colonne of COLUMN_KEYS) {
    assert.equal(messageVaAuCadrage(colonne), colonne === 'to_deploy', `« ${colonne} »`);
  }
});

test('une carte relancée l’est par sa date de relance, en « Demande » ou en « À déployer »', () => {
  for (const colonne of COLUMN_KEYS) {
    const relancee = cadrageRouvertApresRapport({ column: colonne, parcours: { cadrageRouvertA: ROUVERT_A } });
    assert.equal(relancee, ['planned', 'to_deploy'].includes(colonne), `« ${colonne} »`);
  }
  assert.equal(cadrageRouvertApresRapport({ column: 'planned' }), false, 'une carte neuve n’est pas relancée');
  /* Le message d'une carte relancée va au cadrage, même une fois revenue en « Demande ». */
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'planned', parcours: { cadrageRouvertA: ROUVERT_A } }), true);
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'to_deploy' }), true);
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'planned' }), false);
  assert.equal(messageDeLaCarteVaAuCadrage({ column: 'running', parcours: { cadrageRouvertA: ROUVERT_A } }), false);
});

test('la carte se cadre avant le travail, ou dans « À déployer » avec un cadrage rouvert', () => {
  assert.equal(carteEnCadrage({ column: 'planned' }), true);
  assert.equal(carteEnCadrage({ column: 'to_deploy' }), false);
  assert.equal(carteEnCadrage({ column: 'to_deploy', parcours: { cadrageRouvertA: ROUVERT_A } }), true);
  assert.equal(carteEnCadrage({ column: 'running', parcours: { cadrageRouvertA: ROUVERT_A } }), false);
  assert.equal(carteEnCadrage({ column: 'archived', parcours: { cadrageRouvertA: ROUVERT_A } }), false);
});

test('la relance repose la carte en « Demande », et elle n’en bouge plus jusqu’au lancement', () => {
  assert.equal(COLONNE_DE_LA_RELANCE, 'planned');
  /* Le cadrage — compréhension comme plan — se joue SUR PLACE : la carte reste
     en « Demande », et le seul dépôt qui dépense encore est le lancement. */
  assert.equal(gesteDuDepot('planned', 'running').effet, 'lancer');
});

test('une carte relancée ne part jamais toute seule', () => {
  const relancee: any = { column: 'planned', parcours: { cadrageRouvertA: ROUVERT_A }, scheduling: { attempts: 1 } };
  /* Ses essais passés suffiraient à l'ordonnanceur… */
  assert.equal(demarrageAutomatiqueAutorise({ attempts: 1, restarts: 0 }), true);
  /* …la relance la retient. */
  assert.equal(relanceRetenueAvantLancement(relancee), true);
  /* Un lancement demandé puis refusé par une porte qui se rouvre repart. */
  assert.equal(
    relanceRetenueAvantLancement({ ...relancee, scheduling: { reprendreDesQuePossible: true } as any }),
    false,
  );
  assert.equal(relanceRetenueAvantLancement({ column: 'planned', scheduling: { attempts: 1 } } as any), false);
});

test('la compréhension rendue sur une carte restée en « À déployer » la renvoie en « Demande » (filet)', () => {
  const relancee = { column: 'to_deploy', parcours: { cadrageRouvertA: ROUVERT_A } };
  assert.equal(colonneApresComprehensionDeRelance(relancee), 'planned');
  assert.equal(colonneApresComprehensionDeRelance({ column: 'to_deploy', parcours: {} }), null);
  /* Le message l'a déjà posée en « Demande » : le filet n'a rien à faire. */
  assert.equal(colonneApresComprehensionDeRelance({ ...relancee, column: 'planned' }), null);
  assert.equal(colonneApresComprehensionDeRelance({ ...relancee, column: 'running' }), null);
  assert.equal(colonneApresComprehensionDeRelance({ ...relancee, column: 'archived' }), null);
});

test('UNE RELANCE QUI N’ÉTAIT QU’UNE QUESTION RAMÈNE LA CARTE DANS « À DÉPLOYER »', () => {
  const relancee = { column: 'planned', parcours: { cadrageRouvertA: ROUVERT_A, plans: [] as { at: number }[] } };
  /* Le cadrage n'a fait que répondre : retour au lot. */
  assert.equal(colonneApresReponseSansCadrage(relancee), 'to_deploy');
  /* Une compréhension OU un plan rendus depuis la réouverture : un travail se prépare. */
  const cadree = { ...relancee, parcours: { ...relancee.parcours, comprehension: { texte: 'x', at: ROUVERT_A + 1 } } };
  assert.equal(colonneApresReponseSansCadrage(cadree), null);
  const planifiee = { ...relancee, parcours: { ...relancee.parcours, plans: [{ at: ROUVERT_A + 1 }] } };
  assert.equal(colonneApresReponseSansCadrage(planifiee), null);
  /* Un plan DEMANDÉ depuis la réouverture, même pas encore rendu : on reste. */
  assert.equal(
    colonneApresReponseSansCadrage({ ...relancee, parcours: { ...relancee.parcours, planDemandeA: ROUVERT_A + 1 } }),
    null,
  );
  /* Un incident de cadrage depuis la réouverture : l'agent n'a pas tranché, on reste. */
  const enIncident = { ...relancee, parcours: { ...relancee.parcours, incident: { at: ROUVERT_A + 1 } } };
  assert.equal(colonneApresReponseSansCadrage(enIncident), null);
  /* L'ancienne compréhension, l'ancien plan ne comptent pas. */
  const anciens = {
    ...relancee,
    parcours: { cadrageRouvertA: ROUVERT_A, plans: [{ at: 10 }], comprehension: { texte: 'x', at: 10 }, planDemandeA: 5 },
  };
  assert.equal(colonneApresReponseSansCadrage(anciens), 'to_deploy');
  /* Carte neuve, carte rangée à la main (repère effacé), carte ailleurs : rien. */
  assert.equal(colonneApresReponseSansCadrage({ column: 'planned', parcours: { plans: [] } }), null);
  assert.equal(colonneApresReponseSansCadrage({ ...relancee, column: 'to_deploy' }), null);
  assert.equal(colonneApresReponseSansCadrage({ ...relancee, column: 'running' }), null);
});

test('UNE CARTE RELANCÉE NE MONTRE NI « DÉPLOYER » NI LES GESTES DE FIN DE TÂCHE', () => {
  /* Capture #35079, 04.10.2026 : la carte, encore dans « À déployer » pendant
     la réflexion du cadrage, gardait son bouton de fin de tâche. */
  const prete = { column: 'to_deploy', parcours: {} };
  const relancee = { column: 'to_deploy', parcours: { cadrageRouvertA: ROUVERT_A } };
  assert.equal(barreEnFinDeTache({ carte: prete, chapitre: 'rapport' }), true);
  assert.equal(barreEnFinDeTache({ carte: relancee, chapitre: 'cadrage' }), false);
  /* La colonne seule ne décide plus : le chapitre non plus, si la carte est relancée. */
  assert.equal(barreEnFinDeTache({ carte: relancee, chapitre: 'rapport' }), false);
  assert.equal(barreEnFinDeTache({ carte: { ...relancee, column: 'planned' }, chapitre: 'cadrage' }), false);
  /* Rien ne change ailleurs : rapport rendu en « Travail », carte archivée, carte neuve. */
  assert.equal(barreEnFinDeTache({ carte: { column: 'running' }, chapitre: 'rapport' }), true);
  assert.equal(barreEnFinDeTache({ carte: { column: 'running' }, chapitre: 'travail' }), false);
  assert.equal(barreEnFinDeTache({ carte: { column: 'archived', parcours: { cadrageRouvertA: ROUVERT_A } } }), true);
  assert.equal(barreEnFinDeTache({ carte: { column: 'planned' }, chapitre: 'cadrage' }), false);

  assert.equal(lotDeployableDepuisLaCarte(prete), true);
  assert.equal(lotDeployableDepuisLaCarte(relancee), false);
  assert.equal(lotDeployableDepuisLaCarte({ column: 'planned' }), false);

  const barre = readFileSync(new URL('../../../web/src/components/parcours-carte.tsx', import.meta.url), 'utf8');
  assert.match(barre, /const finDeTache = barreEnFinDeTache\(\{ carte, chapitre: principal\?\.chapitre \}\)/);
  assert.match(barre, /const deployerLeLot = lotDeployableDepuisLaCarte\(carte\)/);
});

test('UNE SIMPLE QUESTION LAISSE « TERMINER LA TÂCHE » À LA PLACE DE « DÉPLOYER », JUSQU’AU CLIC', () => {
  const ouverte = { column: 'to_deploy' as const, parcours: { iterationOuverteA: ROUVERT_A } };
  assert.equal(iterationAFermer(ouverte), true);
  /* Carte prête sans question, carte d'avant : fermée. Relancée, ou ailleurs : non plus. */
  assert.equal(iterationAFermer({ column: 'to_deploy', parcours: {} }), false);
  assert.equal(iterationAFermer({ column: 'to_deploy', parcours: { iterationOuverteA: 1, cadrageRouvertA: 2 } }), false);
  assert.equal(iterationAFermer({ column: 'archived', parcours: { iterationOuverteA: 1 } }), false);
  /* La carte reste dans le lot. */
  assert.equal(lotDeployableDepuisLaCarte(ouverte), true);

  const ctx = (parcours: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ colonne: 'to_deploy', roleAgent: 'cadrage', tourEnCours: false, messages: [], parcours: { plans: [], ...parcours }, ...extra }) as any;
  assert.deepEqual(gestesDuParcours(ctx({ iterationOuverteA: ROUVERT_A })).map((g) => `${g.geste}:${g.possible}`), ['terminer:true']);
  assert.equal(gesteDuParcours(ctx({ iterationOuverteA: ROUVERT_A }, { tourEnCours: true })).possible, false);
  assert.equal(gesteDuParcours(ctx({ iterationOuverteA: ROUVERT_A }, { etatPerime: true })).possible, false);
  assert.deepEqual(gestesDuParcours(ctx({})), []);

  /* Le repère : posé au retour sans travail, effacé au clic, à la relance, au lancement et au déplacement. */
  assert.match(SOURCE('runtime.ts'), /cadrageRouvertA: undefined,\s*iterationOuverteA: Date\.now\(\)/);
  const ws = SOURCE('ws.ts');
  const finir = ws.slice(ws.indexOf("case 'card.finish'"), ws.indexOf("case 'plan.generer'"));
  assert.match(finir, /if \(iterationAFermer\(card\)\) \{[\s\S]*?iterationOuverteA: undefined[\s\S]*?return \{ card: refermee \};/);
  assert.match(SOURCE('cadrage.ts'), /iterationOuverteA: undefined/);
  assert.match(SOURCE('scheduler.ts'), /cadrageRouvertA: undefined, iterationOuverteA: undefined/);
  assert.match(SOURCE('deplacement-carte.ts'), /iterationOuverteA && target !== card\.column/);
  const barre = readFileSync(new URL('../../../web/src/components/parcours-carte.tsx', import.meta.url), 'utf8');
  assert.match(barre, /const deployerLeLot = lotDeployableDepuisLaCarte\(carte\) && !iterationAFermer\(carte\)/);
});

test('la fin de tâche n’a plus de liste : « Déployer » direct, « Lancer » dit modèle et niveau', () => {
  const barre = readFileSync(new URL('../../../web/src/components/parcours-carte.tsx', import.meta.url), 'utf8');
  /* Plus de tiroir « Actions de la tâche » : ni bouton, ni page, ni état. */
  assert.doesNotMatch(barre, /data-bouton-fin-de-tache|data-tiroir-fin-de-tache|adresse="fin-de-tache"|setTiroirFin/);
  /* Un clic sur « Déployer » ouvre la fenêtre de mise en ligne du lot. */
  assert.match(barre, /<span className="min-w-0 truncate">\{t\('Déployer'\)\}<\/span>/);
  assert.match(barre, /client\.demanderDeploiement\(\{ projectId, selection: true, surPlace: !estTelephone\(\) \}\)/);
  /* Le lancement d'une carte validée porte son modèle posé, puis son niveau. */
  assert.match(barre, /carte\.run\?\.model \? modeleQuiPart : undefined,\s+niveauQuiPart/);
});

test('le chapitre d’une carte relancée est le cadrage, puis le plan', () => {
  /* Dans « À déployer » sans relance, le rapport reste le rapport. */
  assert.equal(chapitreDuParcours(contexte({ plans: [] }, { colonne: 'to_deploy' })), 'rapport');
  assert.equal(chapitreDuParcours(contexte({ plans: [planV1] }, { colonne: 'to_deploy' })), 'rapport');
  /* En « Demande », l'agent de tâche de la carte n'en fait pas une carte au travail. */
  assert.equal(chapitreDuParcours(contexte({ plans: [planV1], cadrageRouvertA: ROUVERT_A }, { roleAgent: 'execution' })), 'plan');
  /* Une carte encore dans « À déployer », discussion rouverte, se lit pareil. */
  assert.equal(chapitreDuParcours(contexte({ plans: [], cadrageRouvertA: ROUVERT_A }, { colonne: 'to_deploy' })), 'cadrage');
  assert.equal(chapitreDuParcours(contexte({ plans: [], cadrageRouvertA: ROUVERT_A })), 'cadrage');
  assert.equal(chapitreDuParcours(contexte({ plans: [planV1], cadrageRouvertA: ROUVERT_A })), 'plan');
});

test('la décision attend la compréhension DE LA RELANCE, pas celle d’origine', () => {
  const ancienne = { texte: 'compris avant', at: RAPPORT_A - 400 };
  const neuve = { texte: 'compris après', at: ROUVERT_A + 100 };

  const avant = gesteDuParcours(contexte({ plans: [planV1], comprehension: ancienne, cadrageRouvertA: ROUVERT_A }));
  assert.equal(avant.geste, 'valider-et-lancer');
  assert.equal(avant.possible, false);
  assert.equal(avant.raison, RAISONS_DU_GESTE.comprehensionAttendue);

  const pendant = gesteDuParcours(
    contexte({ plans: [planV1], comprehension: neuve, cadrageRouvertA: ROUVERT_A }, { tourEnCours: true }),
  );
  /* Le tour tourne : le grand bouton suspend l'agent, il ne montre plus un lancement éteint. */
  assert.equal(pendant.geste, 'arreter');
  assert.equal(pendant.possible, true);

  const pret = gesteDuParcours(contexte({ plans: [planV1], comprehension: neuve, cadrageRouvertA: ROUVERT_A }));
  assert.deepEqual([pret.geste, pret.possible], ['valider-et-lancer', true]);

  /* Carte jamais planifiée (aucun plan d'origine) : même porte. */
  const sansPlan = gesteDuParcours(contexte({ plans: [], comprehension: ancienne, cadrageRouvertA: ROUVERT_A }));
  assert.deepEqual([sansPlan.geste, sansPlan.possible], ['valider-et-lancer', false]);
  const sansPlanPret = gesteDuParcours(contexte({ plans: [], comprehension: neuve, cadrageRouvertA: ROUVERT_A }));
  assert.deepEqual([sansPlanPret.geste, sansPlanPret.possible], ['valider-et-lancer', true]);
});

test('le plan de la relance se valide, malgré le travail déjà livré', () => {
  const parcours = {
    plans: [planV1, planV2],
    comprehension: { texte: 'compris après', at: ROUVERT_A + 100 },
    cadrageRouvertA: ROUVERT_A,
  };
  const geste = gesteDuParcours(contexte(parcours));
  assert.equal(geste.geste, 'valider-et-lancer');
  assert.equal(geste.possible, true);
  assert.equal(geste.versionDuPlan, 2);

  const etat = { colonne: 'planned', cadrageRouvertA: ROUVERT_A, agentDeLaCarte: 'agent-tache', agentDuPlan: 'agent-cadrage', codeDejaEnregistre: true };
  assert.equal(planDeLaRelance({ ...etat, planRenduA: planV2.at }), true);
  assert.equal(travailDeLaCarteDejaLance({ ...etat, planRenduA: planV2.at }), false);
  assert.equal(decisionDePlanOuverte({ estCourant: true, ...etat, planRenduA: planV2.at }), true);
  /* L'ancien plan, lui, reste un plan exécuté : aucune décision dessus. */
  assert.equal(travailDeLaCarteDejaLance({ ...etat, planRenduA: planV1.at }), true);
  /* Même règle pour une carte restée dans « À déployer », discussion rouverte. */
  assert.equal(planDeLaRelance({ ...etat, colonne: 'to_deploy', planRenduA: planV2.at }), true);
  /* Remise au travail, la relance ne s'applique plus. */
  assert.equal(planDeLaRelance({ ...etat, colonne: 'running', planRenduA: planV2.at }), false);
  /* Et le plan validé ne rouvre plus rien : le lancement lit la validation. */
  const valide = gesteDuParcours(contexte({ ...parcours, planValide: { version: 2, at: 4_000 } }));
  assert.equal(valide.geste, 'lancer');
});

test('les dates de la relance se lisent sur la carte', () => {
  const parcours = { cadrageRouvertA: ROUVERT_A, plans: [planV1], comprehension: { texte: 'x', at: ROUVERT_A } };
  assert.equal(planRenduDepuisLaRelance(parcours), false);
  assert.equal(planRenduDepuisLaRelance({ ...parcours, plans: [planV1, planV2] }), true);
  assert.equal(comprehensionDepuisLaRelance(parcours), true);
  assert.equal(comprehensionDepuisLaRelance({ ...parcours, cadrageRouvertA: undefined }), false);
  const messages = [{ createdAt: 10 }, { createdAt: ROUVERT_A }, {}];
  assert.equal(messagesDepuisLaRelance(messages, ROUVERT_A).length, 2);
  assert.equal(messagesDepuisLaRelance(messages).length, 3);
});

test('le démon route le message, accepte le plan et relance sur la même carte', () => {
  const ws = SOURCE('ws.ts');
  const prompt = ws.split("case 'agent.prompt': {")[1].split('const enAttente')[0];
  assert.match(prompt, /messageDeLaCarteVaAuCadrage\(carteDuFil\)/, 'le message part au cadrage');
  assert.match(prompt, /rouvrirLeCadrage\(/);

  const cadrage = SOURCE('cadrage.ts').split('export async function rouvrirLeCadrage(')[1].split('\n}')[0];
  assert.match(cadrage, /column: COLONNE_DE_LA_RELANCE/, 'le message pose aussitôt la carte en « Demande »');
  assert.match(cadrage, /messageVaAuCadrage\(fraiche\.column\)/, 'depuis « À déployer » seulement');
  assert.match(cadrage, /cadrageRouvertA: fraiche\.parcours\?\.cadrageRouvertA \?\? Date\.now\(\)/, 'et date la relance, une fois');

  const outils = SOURCE('tools.ts').split("case 'rendre_comprehension': {")[1].split("case 'rendre_plan'")[0];
  assert.match(
    outils,
    /colonneApresComprehensionDeRelance/,
    'une compréhension rendue garde son filet vers « Demande »',
  );

  const runtime = SOURCE('runtime.ts');
  const retour = runtime.split("UNE RELANCE QUI N'ÉTAIT QU'UNE QUESTION RENVOIE LA CARTE AU LOT")[1]?.split('\n  }\n')[0] ?? '';
  assert.match(retour, /colonneApresReponseSansCadrage\(carteRelancee\)/, 'la fin du tour de cadrage applique la règle');
  assert.match(retour, /const tourAbouti = !failed && !reprise && !panneDefinitive && !runState\.stopping;/);
  assert.match(retour, /tourAbouti && !questionOuverteDuTour && !demandeEnFile/, 'ni question ouverte, ni demande en file');
  assert.match(retour, /cadrageRouvertA: undefined/, 'le retour referme la relance');
  assert.match(retour, /retourSansTravail: true/, 'et ne dit pas « terminé » aux clients');

  const plan = ws.split('async function demanderLePlan(')[1].split('\n}')[0];
  assert.match(plan, /carteEnCadrage\(card\)/, 'le plan se demande depuis une carte à la discussion rouverte');

  const scheduler = SOURCE('scheduler.ts');
  const valider = scheduler.split('export function validerLaComprehension(')[1].split('\n}')[0];
  assert.match(valider, /carteEnCadrage\(card\)/);
  const lancer = scheduler.split('async function lancerLaCarte(')[1];
  assert.match(lancer, /cadrageRouvertA: undefined/, 'le lancement referme la relance');
  assert.match(
    lancer,
    /const relance = cadrageRouvertApresRapport\(\{ column: colonneAvant/,
    'le lancement reconnaît la relance depuis « Demande » ou « Plan »',
  );
  /* La boucle passe par la règle réunie, qui porte le refus de la relance. */
  assert.match(scheduler, /if \(!carteLibreDePartirSeule\(card, !!agentDeCadrage\(card\.id\)\)\) continue;/, 'l’ordonnanceur retient la relance');
  assert.match(
    SOURCE_PARTAGEE('parcours-carte.ts').split('export function carteLibreDePartirSeule(')[1].split('\n}')[0],
    /if \(relanceRetenueAvantLancement\(carte, maintenant\)\) return false;/,
  );

  const deplacement = SOURCE('deplacement-carte.ts');
  assert.match(
    deplacement,
    /!COLONNES_AVANT_LE_TRAVAIL\.includes\(target\)/,
    'ranger à la main vers une colonne de cadrage garde la relance',
  );

  const auto = SOURCE('deploiement-automatique.ts');
  assert.match(auto, /cadrageRouvertApresRapport\(card\)/, 'une carte en discussion ne part pas au lot');
  assert.doesNotMatch(auto, /pousserLesCartesTerminees/, 'l’interrupteur ne pousse plus aucune carte');
});

test('les cartes déjà restées relancées sans suite sont rendues au lot par la reprise de base', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE cards (id TEXT PRIMARY KEY, column_key TEXT NOT NULL, data TEXT NOT NULL);');
  const poser = (id: string, colonne: string, parcours: Record<string, unknown>) =>
    db.prepare('INSERT INTO cards (id, column_key, data) VALUES (?, ?, ?)').run(id, colonne, JSON.stringify({ id, parcours }));
  poser('question', 'to_deploy', { cadrageRouvertA: ROUVERT_A, plans: [{ at: 10 }], comprehension: { texte: 'x', at: 10 } });
  poser('cadree', 'to_deploy', { cadrageRouvertA: ROUVERT_A, plans: [], comprehension: { texte: 'x', at: ROUVERT_A + 1 } });
  poser('planifiee', 'to_deploy', { cadrageRouvertA: ROUVERT_A, plans: [{ at: ROUVERT_A + 1 }] });
  poser('plan-demande', 'to_deploy', { cadrageRouvertA: ROUVERT_A, plans: [], planDemandeA: ROUVERT_A + 1 });
  poser('incident', 'to_deploy', { cadrageRouvertA: ROUVERT_A, plans: [], incident: { texte: 'x', at: ROUVERT_A + 1 } });
  poser('en-demande', 'planned', { cadrageRouvertA: ROUVERT_A, plans: [] });
  poser('jamais', 'to_deploy', { plans: [] });

  const migration = MIGRATIONS.find((item) => item.name === 'relances-sans-suite-rendues-au-lot');
  assert.ok(migration);
  db.exec(migration.sql);
  db.exec(migration.sql);
  const repere = (id: string) =>
    JSON.parse((db.prepare('SELECT data FROM cards WHERE id = ?').get(id) as { data: string }).data).parcours.cadrageRouvertA;
  assert.equal(repere('question'), undefined, 'une relance sans suite perd son repère');
  for (const id of ['cadree', 'planifiee', 'plan-demande', 'incident', 'en-demande']) {
    assert.equal(repere(id), ROUVERT_A, `« ${id} » garde le sien`);
  }
  assert.equal(repere('jamais'), undefined);
  db.close();
});

test('un message écrit pendant le travail repasse par le cadrage quand le tour de tâche aboutit (06/11/2026)', async () => {
  const { demandesARemettreAuCadrage } = await import('@beluga/shared');
  const tour = { roleDeLAgent: 'task', porteUneCarte: true, agentAttitre: false, abouti: true, questionOuverte: false };
  const file = [
    { id: 'h1', text: 'Et aussi la marge.' },
    { id: 'interne', silencieuse: true },
    { id: 'poursuite', poursuite: true },
    { id: 'reprise', repriseDe: 'm-1' },
    { id: 'quota', messageId: 'm-2' },
    { id: 'h2', text: 'Et le titre.' },
  ];
  assert.deepEqual(demandesARemettreAuCadrage(file, tour).map((d) => d.id), ['h1', 'h2'], 'seuls les messages humains sans bulle partent');
  assert.deepEqual(demandesARemettreAuCadrage(file, { ...tour, abouti: false }), [], 'un tour tombé ou arrêté garde sa file');
  assert.deepEqual(demandesARemettreAuCadrage(file, { ...tour, questionOuverte: true }), [], 'une question ouverte garde la file');
  assert.deepEqual(demandesARemettreAuCadrage(file, { ...tour, roleDeLAgent: 'cadrage' }), [], 'le cadrage reçoit déjà ses messages');
  assert.deepEqual(demandesARemettreAuCadrage(file, { ...tour, agentAttitre: true }), [], 'un agent de volet garde ses messages');
  assert.deepEqual(demandesARemettreAuCadrage(file, { ...tour, porteUneCarte: false }), [], 'sans carte, rien à cadrer');
  assert.deepEqual(demandesARemettreAuCadrage([...file, { id: 'h3', enEditionDepuis: 5 }], tour), [], 'un texte en cours de modification ne se déplace pas');
});

test('un message écrit pendant le rangement de fin de tour repart aussi au cadrage, sauf derrière une demande interne', async () => {
  const { demandesArriveesPendantLeRangement } = await import('@beluga/shared');
  const tour = { roleDeLAgent: 'task', porteUneCarte: true, agentAttitre: false, abouti: true, questionOuverte: false };
  const humains = [{ id: 'h1', text: 'Vire la barre du haut.' }];
  assert.deepEqual(demandesArriveesPendantLeRangement(humains, tour).map((d) => d.id), ['h1'], 'arrivé pendant la porte de la charte : part au cadrage');
  assert.deepEqual(demandesArriveesPendantLeRangement([{ id: 'r', text: 'corrige', silencieuse: true }, ...humains], tour), [], 'derrière le renvoi de la charte, le message attend chez l’agent');
  assert.deepEqual(demandesArriveesPendantLeRangement([{ id: 'p', text: 'suite', poursuite: true }, ...humains], tour), [], 'derrière une poursuite aussi');
  assert.deepEqual(demandesArriveesPendantLeRangement(humains, { ...tour, abouti: false }), [], 'un tour tombé garde sa file');
  assert.deepEqual(demandesArriveesPendantLeRangement(humains, { ...tour, questionOuverte: true }), [], 'une question ouverte garde sa file');
});

test('la fin de tour relève la file à chaque étape du rangement', () => {
  const source = readFileSync(new URL('../../src/runtime.ts', import.meta.url), 'utf8');
  const debut = source.indexOf('const releverLaFile = () =>');
  assert.ok(debut > 0, 'le relevé existe');
  const suite = source.slice(debut);
  assert.ok(suite.indexOf('releverLaFile();\n  const fileEnAttente') > 0, 'avant de décider si la carte reste ouverte');
  assert.ok(suite.indexOf('fileEnAttente: (releverLaFile(),') > 0, 'avant de ranger la carte');
  assert.ok(/releverLaFile\(\);\n\s*if \(versLeCadrage\.length && agent\.cardId\) remettreAuCadrage/.test(suite), 'juste avant le renvoi au cadrage');
});
