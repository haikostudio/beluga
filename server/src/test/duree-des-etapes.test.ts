import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUREE_ATTENDUE_MS,
  DeployRun,
  PERIODE_DE_VEILLE_MS,
  PLAFOND_TOUR_D_AGENT_MS,
  constatDeDuree,
  mentionEtapeQuiTraine,
  panneDeLenteur,
  recitDepassementNonResolu,
  recitTourCoupe,
  sortieDuDepassement,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Une étape qui traîne est une PANNE, pas un travail lent.             */
/* ------------------------------------------------------------------ */

const MINUTE = 60 * 1000;

test('les sept étapes ont une durée attendue, et aucune n’est ridicule', () => {
  for (const etape of ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'] as const) {
    const attendu = DUREE_ATTENDUE_MS[etape];
    assert.ok(attendu > 0, `« ${etape} » doit avoir une durée attendue`);
    // On ne cherche pas à mesurer une lenteur mais à reconnaître un blocage :
    // une étape doit pouvoir être deux fois plus lente que d'habitude sans un mot.
    assert.ok(attendu >= 5 * MINUTE, `« ${etape} » est trop serrée : ${attendu} ms`);
  }
  // La mise en ligne porte la mise en production CONFIÉE à un agent : c'est la
  // plus longue des sept, et de loin.
  assert.ok(DUREE_ATTENDUE_MS.publish > DUREE_ATTENDUE_MS.commit);
});

test('les quatre tours d’agent d’une publication sont TOUS bornés', () => {
  for (const motif of ['depannage', 'controles', 'construction', 'mise-en-ligne'] as const) {
    assert.ok(PLAFOND_TOUR_D_AGENT_MS[motif] > 0, `le tour « ${motif} » doit être borné`);
  }
  // Le dépannage est le plus court : sa consigne tient en quelques gestes sur
  // une panne déjà nommée.
  assert.ok(PLAFOND_TOUR_D_AGENT_MS.depannage <= PLAFOND_TOUR_D_AGENT_MS['mise-en-ligne']);
  // On revient constater bien plus souvent qu'on ne coupe.
  assert.ok(PERIODE_DE_VEILLE_MS < PLAFOND_TOUR_D_AGENT_MS.depannage);
});

test('une étape dans les temps n’a rien dépassé', () => {
  const debut = 1_000_000;
  const constat = constatDeDuree({
    etape: 'push',
    debutMs: debut,
    maintenantMs: debut + DUREE_ATTENDUE_MS.push - MINUTE,
  });
  assert.equal(constat.depasse, false);
  assert.equal(constat.attenduMs, DUREE_ATTENDUE_MS.push);
});

test('une étape qui dépasse sa durée attendue est constatée', () => {
  const debut = 1_000_000;
  const constat = constatDeDuree({
    etape: 'push',
    debutMs: debut,
    maintenantMs: debut + DUREE_ATTENDUE_MS.push + MINUTE,
  });
  assert.equal(constat.depasse, true);
  assert.equal(constat.ecouleMs, DUREE_ATTENDUE_MS.push + MINUTE);
});

test('LE TEMPS D’UN DÉPANNAGE NE COMPTE PAS : sinon un dépannage naîtrait du précédent', () => {
  const debut = 1_000_000;
  // Cinq minutes de travail, puis une heure entière passée à réparer : l'étape
  // n'a réellement travaillé que cinq minutes.
  const constat = constatDeDuree({
    etape: 'push',
    debutMs: debut,
    maintenantMs: debut + 5 * MINUTE + 60 * MINUTE,
    tempsDeDepannageMs: 60 * MINUTE,
  });
  assert.equal(constat.depasse, false, 'le temps du dépanneur ne doit pas être compté');
  assert.equal(constat.ecouleMs, 5 * MINUTE);
});

test('une étape sans instant de départ n’a rien dépassé : on ne devine pas', () => {
  const constat = constatDeDuree({ etape: 'build', maintenantMs: Date.now() });
  assert.equal(constat.depasse, false);
  assert.equal(constat.ecouleMs, 0);
  // Une publication relue d'AVANT cette règle passe par le même chemin.
  assert.equal(constatDeDuree({ etape: 'build', debutMs: 0, maintenantMs: Date.now() }).depasse, false);
});

test('la panne de lenteur est réparable, et ses gestes tiennent les deux interdits', () => {
  const constat = constatDeDuree({ etape: 'publish', debutMs: 0, maintenantMs: 1 });
  const panne = panneDeLenteur('Mise en ligne', { ...constat, ecouleMs: 90 * MINUTE, depasse: true });
  assert.equal(panne.reparable, true, 'une étape pendue est exactement le cas où un agent a de quoi regarder');
  assert.match(panne.nom, /ne rend pas la main/);
  assert.ok(panne.gestes.length > 0);
  assert.ok(
    panne.gestes.some((geste) => /démon HaikoDev/.test(geste)),
    'les gestes interdisent en toutes lettres de toucher au démon',
  );
  assert.ok(
    panne.gestes.some((geste) => /Ne mets RIEN en ligne/.test(geste)),
    'publier reste une décision de l’utilisateur',
  );
  assert.ok(
    panne.gestes.some((geste) => /n’efface aucune branche/.test(geste)),
    'aucun travail n’est perdu : les branches des cartes ne s’effacent pas',
  );
  assert.ok(
    panne.gestes.some((geste) => /CHERCHE D’ABORD/.test(geste)),
    'une étape pendue ne dit rien d’elle-même : il faut chercher avant de réparer',
  );
});

test('la sortie d’un dépassement dit les deux chiffres, faute de sortie réelle', () => {
  const constat = { depasse: true, ecouleMs: 50 * MINUTE, attenduMs: 40 * MINUTE };
  const coupe = sortieDuDepassement('Mise en ligne', constat, true);
  assert.match(coupe, /a dépassé sa durée attendue/);
  assert.match(coupe, /50 min/);
  assert.match(coupe, /40 min/);
  assert.match(coupe, /arrêté proprement/);
  // Une commande qui n'a pas rendu la main n'a coupé aucun agent : on ne le
  // raconte pas.
  assert.match(sortieDuDepassement('Envoi sur le dépôt', constat, false), /Aucun tour d’agent n’était en cause/);
});

test('la ligne de progression d’une étape en retard dit depuis quand et pour combien', () => {
  const mention = mentionEtapeQuiTraine('Construction', { depasse: true, ecouleMs: 40 * MINUTE, attenduMs: 25 * MINUTE });
  assert.match(mention, /Construction/);
  assert.match(mention, /40 min/);
  assert.match(mention, /25 min/);
  assert.match(mention, /surveille/);
});

test('un tour d’agent coupé le DIT, et dit que rien n’est perdu', () => {
  const recit = recitTourCoupe('mise-en-ligne', 45 * MINUTE);
  assert.match(recit, /mise en production/);
  assert.match(recit, /45 min/);
  assert.match(recit, /rien n’a été perdu/);
  assert.match(recitTourCoupe('depannage', MINUTE), /dépannage/);
  assert.match(recitTourCoupe('construction', MINUTE), /réparation/);
});

test('au bout des reprises, un blocage est RENDU TEL QUEL — jamais forcé', () => {
  const recit = recitDepassementNonResolu({ depasse: true, ecouleMs: 60 * MINUTE, attenduMs: 20 * MINUTE }, 2);
  assert.match(recit, /2 reprises/);
  assert.match(recit, /rendue telle quelle/);
  assert.match(recit, /rien n’a été forcé/);
});

test('une étape porte son retard dans le modèle, et une publication d’avant s’en passe', () => {
  const run = DeployRun.parse({
    id: 'r1',
    projectId: 'p1',
    state: 'running',
    startedAt: Date.now(),
    steps: [{ key: 'publish', state: 'running', log: '', enRetard: true }],
  });
  assert.equal(run.steps[0].enRetard, true);

  const ancien = DeployRun.parse({
    id: 'r0',
    projectId: 'p0',
    state: 'success',
    startedAt: Date.now(),
    steps: [{ key: 'publish', state: 'done', log: 'ok' }],
  });
  assert.equal(ancien.steps[0].enRetard, undefined, 'le champ reste optionnel : rien ne cesse de se relire');
});
