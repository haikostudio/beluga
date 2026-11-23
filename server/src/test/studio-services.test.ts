import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LES SERVICES DE CRÉATION BRANCHÉS PAR L'UTILISATEUR (demande du 14/10/2026).
 *
 *  - le catalogue porte kie.ai, sept services vidéo et OpenRouter, jamais Adobe Firefly ;
 *  - chaque service reçoit SON en-tête et SA demande ; sa réponse se lit sans
 *    deviner (en cours, fini avec l'adresse de l'extrait, échec avec sa raison) ;
 *  - une clé que le service refuse n'est pas rangée ; une clé acceptée l'est,
 *    UNE fiche par service, et ne revient jamais en clair vers l'écran ;
 *  - le compte OpenRouter branché passe devant celui de Beluga Build ;
 *  - AUCUN appel ne part sans dépense validée par un clic ;
 *  - un extrait validé est téléchargé, SÉPARÉ en image muette et en son, et
 *    posé tout seul sur deux pistes, au même instant ; sans son, aucun son vide.
 *
 * Le bac à sable est posé AVANT le premier import du démon.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-services-'));
process.env.BELUGA_DATA = bacASable;
// Aucun modèle de traduction dans le bac à sable : la consigne passe telle quelle.
process.env.BELUGA_TRADUCTION_IDENTITE = "1";

const shared = await import('@beluga/shared');
const {
  Project,
  SERVICES_CREATION,
  serviceDeCreation,
  cleAssemblee,
  dureeAjustee,
  ratioAjuste,
  requeteDeCreation,
  lireCreationDeClip,
  lireSuiviDeClip,
  lireResultatFal,
  verdictDuTest,
  plafondFal,
  regroupementDeSecrets,
} = shared;
/* fal.ai et Higgsfield sont CACHÉS depuis le 25/10/2026 (kie.ai les remplace),
   mais leur chaîne reste éprouvée : ces tests la rallument pour eux-mêmes. */
shared.fixerLesServicesCaches([]);
const store = await import('../store.js');
const services = await import('../studio-services.js');
const generation = await import('../voix-de-realisation.js');

const projet = store.saveProject(Project.parse({ id: 'projet-services', name: 'Services Test', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
services.RYTHME_DU_SUIVI.pauseMs = 5;

/** Un faux réseau : chaque adresse rend ce que la table dit ; tout le reste fait échouer le test. */
function reseau(table: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const vrai = globalThis.fetch;
  const appels: string[] = [];
  globalThis.fetch = (async (adresse: any, init?: RequestInit) => {
    const url = String(adresse);
    appels.push(url);
    const cle = Object.keys(table).find((k) => url.startsWith(k));
    if (!cle) throw new Error(`appel réseau inattendu : ${url}`);
    return table[cle]!(init);
  }) as typeof fetch;
  return { appels, rendre: () => (globalThis.fetch = vrai) };
}
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

test('le catalogue : kie.ai, sept services vidéo, OpenRouter et Meshy (3D), sans Adobe Firefly', () => {
  const ids = SERVICES_CREATION.map((s) => s.id);
  assert.deepEqual(ids, ['kie', 'higgsfield', 'byteplus', 'magnific', 'krea', 'runway', 'fal', 'replicate', 'openrouter', 'meshy']);
  assert.ok(!ids.some((id) => /firefly|adobe/i.test(id)));
  for (const s of SERVICES_CREATION) {
    assert.match(s.adresseCle, /^https:\/\//);
    // OpenRouter (voix, musique) et Meshy (personnages 3D) ne portent aucun modèle vidéo.
    if (s.id === 'openrouter' || s.id === 'meshy') assert.equal(s.modeles.length, 0);
    else assert.ok(s.modeles.length >= 2, s.id);
    for (const m of s.modeles) assert.ok(m.durees.length && m.nom, `${s.id} ${m.id}`);
  }
  // Higgsfield : identifiant ET secret, collés comme le service l'attend.
  const hf = serviceDeCreation('higgsfield')!;
  assert.equal(cleAssemblee(hf, { cle: 'abc' }), null);
  assert.equal(cleAssemblee(hf, { cle: 'abc', secret: 'xyz' }), 'abc:xyz');
});

test('la durée et le cadrage se ramènent à ce que le modèle accepte', () => {
  const veo = serviceDeCreation('krea')!.modeles.find((m) => m.id === 'google/veo-3.1-fast')!;
  assert.equal(dureeAjustee(veo, 5), 4);
  assert.equal(dureeAjustee(veo, 7.5), 8);
  assert.equal(dureeAjustee(veo, 30), 8);
  assert.equal(ratioAjuste(veo, '1:1'), '9:16');
  assert.equal(ratioAjuste(veo, '16:9'), '16:9');
  const wan = serviceDeCreation('magnific')!.modeles.find((m) => m.id === 'wan-2-5-t2v-720p')!;
  assert.equal(ratioAjuste(wan, '9:16'), null);
});

test('chaque service reçoit son en-tête et sa demande', () => {
  const d = { consigne: 'a fox', duree: 6, ratio: '9:16' as const, son: true };
  const hf = requeteDeCreation('higgsfield', 'kling-video/v2.5-turbo/pro/text-to-video', 'id:sec', { ...d, ratio: null, duree: 5 });
  assert.equal(hf.entetes.Authorization, 'Key id:sec');
  assert.equal(hf.adresse, 'https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/text-to-video');
  const bp = requeteDeCreation('byteplus', 'dreamina-seedance-2-0-fast-260128', 'k', d);
  assert.equal(bp.entetes.Authorization, 'Bearer k');
  assert.deepEqual((bp.corps as any).content, [{ type: 'text', text: 'a fox' }]);
  assert.equal((bp.corps as any).ratio, '9:16');
  const mg = requeteDeCreation('magnific', 'veo-3-1-fast', 'k', d);
  assert.equal(mg.entetes['x-magnific-api-key'], 'k');
  assert.equal((mg.corps as any).aspect_ratio, '9:16');
  const rw = requeteDeCreation('runway', 'gen4.5', 'k', d);
  assert.equal(rw.entetes['X-Runway-Version'], '2024-11-06');
  assert.equal((rw.corps as any).ratio, '720:1280');
  assert.equal((rw.corps as any).promptText, 'a fox');
  const fal = requeteDeCreation('fal', 'fal-ai/veo3/fast', 'k', d);
  assert.equal(fal.entetes.Authorization, 'Key k');
  assert.equal((fal.corps as any).duration, '6s');
  const rp = requeteDeCreation('replicate', 'google/veo-3-fast', 'k', d);
  assert.equal(rp.adresse, 'https://api.replicate.com/v1/models/google/veo-3-fast/predictions');
  assert.equal((rp.corps as any).input.prompt, 'a fox');
});

test('les réponses se lisent sans deviner : en cours, fini, échec', () => {
  assert.equal(lireCreationDeClip('krea', 'kling/kling-2.5', 401, {}).etat, 'echec');
  assert.equal(lireCreationDeClip('krea', 'kling/kling-2.5', 402, {}).etat, 'echec');
  assert.deepEqual(lireCreationDeClip('krea', 'kling/kling-2.5', 200, { job_id: 'j1' }), { etat: 'attente', suivi: 'https://api.krea.ai/jobs/j1' });
  assert.deepEqual(lireSuiviDeClip('krea', 200, { status: 'completed', result: { urls: ['https://x/v.mp4'] } }), { etat: 'fini', url: 'https://x/v.mp4' });
  assert.deepEqual(lireCreationDeClip('magnific', 'kling-v3-turbo-720p', 200, { data: { task_id: 't1', status: 'CREATED' } }), {
    etat: 'attente',
    suivi: 'https://api.magnific.com/v1/ai/text-to-video/kling-v3-turbo/t1',
  });
  assert.deepEqual(lireSuiviDeClip('magnific', 200, { data: { status: 'COMPLETED', generated: ['https://x/m.mp4'] } }), { etat: 'fini', url: 'https://x/m.mp4' });
  assert.deepEqual(lireSuiviDeClip('byteplus', 200, { status: 'succeeded', content: { video_url: 'https://x/b.mp4' } }), { etat: 'fini', url: 'https://x/b.mp4' });
  assert.equal(lireSuiviDeClip('byteplus', 200, { status: 'running' }, 's').etat, 'attente');
  assert.deepEqual(lireSuiviDeClip('runway', 200, { status: 'SUCCEEDED', output: ['https://x/r.mp4'] }), { etat: 'fini', url: 'https://x/r.mp4' });
  assert.equal(lireSuiviDeClip('runway', 200, { status: 'FAILED', failure: 'policy' }).etat, 'echec');
  assert.deepEqual(lireSuiviDeClip('higgsfield', 200, { status: 'completed', video: { url: 'https://x/h.mp4' } }), { etat: 'fini', url: 'https://x/h.mp4' });
  assert.equal(lireSuiviDeClip('higgsfield', 200, { status: 'nsfw' }).etat, 'echec');
  assert.deepEqual(lireSuiviDeClip('replicate', 200, { status: 'succeeded', output: 'https://x/p.mp4' }), { etat: 'fini', url: 'https://x/p.mp4' });
  assert.deepEqual(lireResultatFal({ video: { url: 'https://x/f.mp4' } }), { etat: 'fini', url: 'https://x/f.mp4' });
  // Une panne passagère du suivi n'est pas un échec : on relit plus tard.
  assert.equal(lireSuiviDeClip('krea', 503, {}, 's').etat, 'attente');
});

test('le test d’une clé : refusée, acceptée, ou service en panne', () => {
  assert.equal(verdictDuTest('krea', 401).ok, false);
  assert.equal(verdictDuTest('krea', 200).ok, true);
  assert.equal(verdictDuTest('higgsfield', 404).ok, true);
  assert.match(verdictDuTest('runway', 502).raison ?? '', /ne répond pas/);
});

test('le prix de fal.ai se lit, jamais écrit', () => {
  assert.equal(plafondFal({ unit_price: 0.1, unit: 'second' }, 6), 0.6);
  assert.equal(plafondFal({ unit_price: 0.5, unit: 'video' }, 6), 0.5);
  assert.equal(plafondFal({ unit_price: 0.1, unit: 'megapixel' }, 6), null);
  assert.equal(plafondFal(undefined, 6), null);
});

test('la clé Higgsfield (identifiant:secret) tient dans UNE fiche du coffre', () => {
  assert.equal(regroupementDeSecrets('Studio — Higgsfield', { service: 'Higgsfield', cle: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890:s3cr3tK3yV4lu3Xx9Qq', adresse: 'https://console.higgsfield.ai' }), null);
});

test('une clé refusée n’est pas rangée ; une clé acceptée l’est, sans jamais revenir en clair', async () => {
  const faux = reseau({ 'https://api.krea.ai/jobs?limit=1': () => json({ detail: 'Invalid' }, 401) });
  try {
    const r = await services.enregistrerService('krea', { cle: 'mauvaise-cle-krea-123456' });
    assert.equal(r.ok, false);
    assert.equal(services.cleDuService('krea'), undefined);
  } finally {
    faux.rendre();
  }
  const bon = reseau({ 'https://api.krea.ai/jobs?limit=1': () => json({ items: [] }) });
  try {
    const r = await services.enregistrerService('krea', { cle: 'krea-cle-secrete-ABCDEFGH-9876' });
    assert.ok(r.ok);
    assert.equal(services.cleDuService('krea'), 'krea-cle-secrete-ABCDEFGH-9876');
    const ecran = JSON.stringify(services.etatDesServices());
    assert.ok(!ecran.includes('krea-cle-secrete-ABCDEFGH-9876'), 'la clé ne doit jamais revenir à l’écran');
    const krea = services.etatDesServices().find((s: any) => s.id === 'krea')!;
    assert.equal(krea.branche, true);
    assert.equal(krea.fin, '9876');
    // Rebrancher remplace la fiche : toujours UNE fiche par service.
    await services.enregistrerService('krea', { cle: 'krea-cle-secrete-ABCDEFGH-1111' });
    const { listerAcces } = await import('../coffre-fort.js');
    assert.equal(listerAcces().filter((a) => a.nom === 'Studio — Krea AI').length, 1);
  } finally {
    bon.rendre();
  }
});

test('le compte OpenRouter branché passe devant celui de Beluga Build', async () => {
  assert.equal(services.cleDuService('openrouter'), undefined, 'aucune clé de l’utilisateur : la voix passe par le relais de Beluga Build');
  const faux = reseau({ 'https://openrouter.ai/api/v1/key': () => json({ data: {} }) });
  try {
    assert.ok((await services.enregistrerService('openrouter', { cle: 'sk-or-v1-utilisateur-abcdef123456' })).ok);
  } finally {
    faux.rendre();
  }
  assert.equal(generation.cleOpenRouter(), 'sk-or-v1-utilisateur-abcdef123456', 'la clé de l’utilisateur passe devant');
  assert.ok(services.retirerService('openrouter').ok);
  assert.equal(services.cleDuService('openrouter'), undefined, 'aucune clé de l’utilisateur : la voix passe par le relais de Beluga Build');
});
