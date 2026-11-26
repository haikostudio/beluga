/**
 * LES TRAVAUX DES SERVICES DANS LA COLONNE — les règles pures (`shared/src/travaux-des-services.ts`).
 *
 * Ce que ces essais verrouillent : un travail qui ne tourne plus est jugé à sa source — fini, il reste (gras) ; tombé,
 * il sort, jamais « fini » à tort ; un fini vu par un compte disparaît pour CE compte seulement ; ouvrir l'écran du
 * service (ou l'une de ses pages) marque vu ; un agent qui répond et le travail du même écran font UNE ligne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUREE_MAX_D_UN_TRAVAIL_FINI,
  avancementDuTravail,
  ecranDuTravail,
  lignesDesServices,
  marquerLesTravauxVus,
  sansLesTravauxRecurrents,
  signatureDesTravaux,
  suivreLesTravaux,
  travauxDuCompte,
  travauxVusALEcran,
  type TravailDeService,
} from '@beluga/shared';

const etude: TravailDeService = { id: 'marketing:m1', service: 'marketing', projectId: 'p1', nature: 'etude', adresse: 'marketing/d1', faits: 3, total: 10, etat: 'en-cours', debut: 1000 };
const video: TravailDeService = { id: 'studio:e1', service: 'studio', projectId: 'p2', nature: 'video', adresse: 'studio/c1', pourcent: 42, etat: 'en-cours', debut: 2000 };

test('un travail qui ne tourne plus : fini il reste en gras, tombé il sort', () => {
  const suivis = suivreLesTravaux([], [etude, video], () => 'tombe', 3000);
  assert.equal(suivis.length, 2);
  const apres = suivreLesTravaux(suivis, [], (t) => (t.id === etude.id ? 'termine' : 'tombe'), 5000);
  assert.deepEqual(apres.map((t) => [t.id, t.etat, t.fin]), [['marketing:m1', 'termine', 5000]]);
  /* Un fini reste au relevé suivant, puis sort après une semaine. */
  assert.equal(suivreLesTravaux(apres, [], () => 'tombe', 6000).length, 1);
  assert.equal(suivreLesTravaux(apres, [], () => 'tombe', 5000 + DUREE_MAX_D_UN_TRAVAIL_FINI).length, 0);
});

test('l’avancement suit le relevé, sans doublon', () => {
  const suivis = suivreLesTravaux([], [etude], () => 'tombe', 3000);
  const apres = suivreLesTravaux(suivis, [{ ...etude, faits: 4 }], () => 'tombe', 4000);
  assert.equal(apres.length, 1);
  assert.equal(apres[0]!.faits, 4);
  assert.notEqual(signatureDesTravaux(suivis), signatureDesTravaux(apres));
  assert.equal(signatureDesTravaux(apres), signatureDesTravaux(suivreLesTravaux(apres, [{ ...etude, faits: 4 }], () => 'tombe', 5000)));
});

test('le vu suit le compte, et seuls ses projets lui parviennent', () => {
  const fini = suivreLesTravaux(suivreLesTravaux([], [etude, video], () => 'tombe'), [video], () => 'termine');
  assert.equal(travauxDuCompte(fini, 'a').length, 2);
  const vus = marquerLesTravauxVus(fini, [etude.id], 'a')!;
  assert.ok(vus);
  assert.deepEqual(travauxDuCompte(vus, 'a').map((t) => t.id), [video.id]);
  assert.equal(travauxDuCompte(vus, 'b').length, 2, 'un autre compte le voit encore');
  assert.equal(marquerLesTravauxVus(vus, [etude.id], 'a'), null, 'rien ne change deux fois');
  assert.equal(marquerLesTravauxVus(vus, [video.id], 'a'), null, 'un travail en cours ne se marque pas vu');
  assert.deepEqual(travauxDuCompte(vus, 'b', new Set(['p2'])).map((t) => t.id), [video.id]);
  assert.ok(!('vusPar' in travauxDuCompte(vus, 'b')[0]!));
});

test('ouvrir l’écran du service, ou l’une de ses pages, marque vu', () => {
  assert.ok(ecranDuTravail(etude, '#marketing/d1'));
  assert.ok(ecranDuTravail(etude, 'marketing/d1/etude/m1'));
  assert.ok(ecranDuTravail(etude, 'marketing/d1?projet=p1'));
  assert.ok(ecranDuTravail(video, 'projet/p2/studio/c1'));
  assert.ok(!ecranDuTravail(etude, 'marketing/d10'));
  assert.ok(!ecranDuTravail(etude, 'marketing'));
  const fini = { ...etude, etat: 'termine' as const, fin: 9 };
  assert.deepEqual(travauxVusALEcran([fini, video], 'marketing/d1'), [fini.id]);
  assert.deepEqual(travauxVusALEcran([fini, video], 'studio/c1'), [], 'un travail en cours ne se marque pas');
});

test('l’avancement se lit en compte ou en pourcentage, jamais pour un fini', () => {
  assert.deepEqual(avancementDuTravail(etude), { faits: 3, total: 10 });
  assert.deepEqual(avancementDuTravail(video), { pourcent: 42 });
  assert.deepEqual(avancementDuTravail({ ...video, pourcent: 140 }), { pourcent: 100 });
  assert.equal(avancementDuTravail({ ...etude, etat: 'termine' }), null);
  assert.equal(avancementDuTravail({ etat: 'en-cours' }), null);
});

test('un agent qui répond et le travail du même écran font une seule ligne', () => {
  const agentMarketing = { id: 'ag1', projectId: 'p1', title: 'Marketing — Wogo', service: { id: 'strategie', adresse: 'strategie/d1/marketing2' }, startedAt: 500 };
  const agentStudio = { id: 'ag2', projectId: 'p3', title: 'Studio', service: { id: 'studio', adresse: 'studio/c9' }, startedAt: 9000 };
  const adresse = (a: { service: { adresse: string } }) => a.service.adresse.replace(/^strategie\/([^/]+)\/marketing2$/, 'marketing/$1');
  const lignes = lignesDesServices([agentMarketing, agentStudio], [etude, video], adresse);
  assert.equal(lignes.length, 3);
  const ligneEtude = lignes.find((l) => l.id === etude.id)!;
  assert.equal(ligneEtude.genre === 'travail' && ligneEtude.agent?.id, 'ag1');
  assert.equal(lignes[0]!.id, 'agent:ag2', 'le plus récent en tête');
  /* Un travail fini passe après ce qui tourne, et n'emporte plus d'agent. */
  const fini = { ...video, etat: 'termine' as const, fin: 99_999 };
  const ordre = lignesDesServices([], [fini, etude], adresse).map((l) => l.id);
  assert.deepEqual(ordre, [etude.id, fini.id]);
});

test('le récurrent sort de la liste, et rien ne se réécrit quand il n’y en a pas', () => {
  const sauvegarde: TravailDeService = { id: 'backups:s1', service: 'backups', projectId: 'p1', nature: 'sauvegarde', adresse: 'backups/s1', etat: 'termine', debut: 3000, fin: 4000 };
  const suivis = [etude, video, sauvegarde];
  assert.deepEqual(
    sansLesTravauxRecurrents(suivis, (t) => t.id === 'backups:s1')?.map((t) => t.id),
    ['marketing:m1', 'studio:e1'],
  );
  assert.equal(sansLesTravauxRecurrents(suivis, () => false), null);
});
