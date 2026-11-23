import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * L'AGENT CRÉATIF PAS À PAS (24/10/2026) : le suivi ne montre que le retenu,
 * un devis porte 1 à 4 propositions, une vidéo s'anime à partir de l'image
 * AJOUTÉE AU SUIVI, et une image se retouche — autres angles, autre lumière
 * (sphère libre ou bloquée selon le modèle), autre visage — par les seuls
 * services en place (jamais Magnific), toujours derrière un devis validé.
 *
 * Aucun appel réel : le réseau est piégé, tout appel inattendu fait échouer.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'retouches-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_TRADUCTION_IDENTITE = '1';
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
/* fal.ai et Higgsfield sont CACHÉS depuis le 25/10/2026 (kie.ai les remplace),
   mais leur chaîne reste éprouvée : ces tests la rallument pour eux-mêmes. */
shared.fixerLesServicesCaches([]);
const {
  Agent,
  Card,
  Message,
  Project,
  angleDeVue,
  catalogueDeGeneration,
  directionAimantee,
  directionBornee,
  directionPermise,
  DIRECTIONS_ICLIGHT,
  etapesDuSuivi,
  informationsDuMedia,
  lireMesureFfprobe,
  lireReponseDeLumiere,
  nombreDePropositions,
  phraseDeLumiere,
  reponseDeLumiere,
  requeteDeGeneration,
} = shared;
const store = await import('../store.js');
const { enregistrerAcces } = await import('../coffre-fort.js');
const realisation = await import('../realisation.js');

realisation.RYTHME_REALISATION.pauseMs = 1;
const attenteNulle = async () => {};
const attenteCourte = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 3000)));

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

test('les angles : nommés ou chiffrés, ramenés dans les bornes du modèle', () => {
  assert.deepEqual(angleDeVue('profil-droit'), { horizontal: 90, vertical: 0, zoom: 5 });
  assert.deepEqual(angleDeVue('plongee', { verticalMin: 0, verticalMax: 60 }), { horizontal: 0, vertical: 60, zoom: 5 });
  assert.deepEqual(angleDeVue('contre-plongee', { verticalMin: 0, verticalMax: 60 })!.vertical, 0, 'une caméra jamais sous le sujet pour FLUX 2');
  assert.deepEqual(angleDeVue({ horizontal: -45, vertical: 10, zoom: 12 }), { horizontal: 315, vertical: 10, zoom: 10 });
  assert.equal(angleDeVue('hologramme'), null);
  assert.equal(nombreDePropositions(9), 4, 'jamais plus de quatre propositions');
  assert.equal(nombreDePropositions(0), 1);
});

test('la sphère : libre, ou aimantée sur les directions permises ; la réponse se relit', () => {
  const d = directionBornee({ azimut: 200, elevation: 120 })!;
  assert.deepEqual(d, { azimut: -160, elevation: 90 });
  const aimantee = directionAimantee({ azimut: -70, elevation: 10 }, DIRECTIONS_ICLIGHT);
  assert.equal((aimantee as { valeur?: string }).valeur, 'Left');
  assert.ok(directionPermise({ azimut: -90, elevation: 0 }, DIRECTIONS_ICLIGHT));
  assert.ok(!directionPermise({ azimut: 45, elevation: 30 }, DIRECTIONS_ICLIGHT), 'hors des directions fixes : refusé');
  assert.ok(directionPermise({ azimut: 45, elevation: 30 }, 'libre'));
  assert.match(phraseDeLumiere({ azimut: 45, elevation: 30 }), /right side.*azimuth 45°, elevation 30°/);
  assert.deepEqual(lireReponseDeLumiere(reponseDeLumiere({ azimut: -30, elevation: 20 })), { azimut: -30, elevation: 20 });
  assert.equal(lireReponseDeLumiere('autre chose'), null);
});

test('la ligne d’informations ne dit que ce qui est mesuré, selon le genre', () => {
  const video = lireMesureFfprobe({
    streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '24/1' }, { codec_type: 'audio' }],
    format: { duration: '8.04', bit_rate: '4200000', format_name: 'mov,mp4' },
  });
  assert.deepEqual(video, { largeur: 1920, hauteur: 1080, duree: 8.04, debit: 4200, ips: 24 });
  const image = lireMesureFfprobe({ streams: [{ codec_type: 'video', width: 1024, height: 1280, avg_frame_rate: '25/1' }], format: { format_name: 'png_pipe' } });
  assert.deepEqual(image, { largeur: 1024, hauteur: 1280 }, 'une image fixe n’a ni durée ni images par seconde');
  assert.deepEqual(
    informationsDuMedia({ genre: 'image', mesure: image, taille: 2_400_000 }).map((i) => i.genre),
    ['format', 'dimensions', 'poids'],
  );
  assert.equal(informationsDuMedia({ genre: 'image', mesure: image }).find((i) => i.genre === 'format')!.valeur, '4:5');
  assert.deepEqual(informationsDuMedia({ genre: 'video', mesure: video }).map((i) => i.genre), ['format', 'dimensions', 'duree', 'ips', 'debit']);
  assert.deepEqual(informationsDuMedia({ genre: 'son', mesure: { duree: 12, debit: 128 } }).map((i) => i.genre), ['duree', 'debit']);
  assert.deepEqual(informationsDuMedia({ genre: 'video', mesure: null }), [], 'rien de mesuré : rien d’affiché, jamais estimé');
});

test('le catalogue des retouches : services en place seulement, jamais Magnific', () => {
  const retouches = catalogueDeGeneration().filter((m) => ['angles', 'lumiere', 'visage', 'animation'].includes(m.capacite));
  assert.ok(retouches.length >= 8);
  assert.ok(retouches.every((m) => ['kie', 'fal', 'higgsfield', 'openrouter'].includes(m.service)), 'aucun Magnific ni autre service');
  const higgsLumiere = retouches.find((m) => m.service === 'higgsfield' && m.capacite === 'lumiere')!;
  assert.equal(higgsLumiere.retouche?.lumiere, 'libre', 'Higgsfield : sphère libre, direction décrite');
  assert.ok(retouches.find((m) => m.id === 'fal-ai/iclight-v2')!.retouche!.lumiere !== 'libre', 'IC-Light : directions fixes');
});

test('les requêtes des retouches portent l’image et le réglage, au bon format pour chaque service', () => {
  const fal = requeteDeGeneration({ service: 'fal', id: 'fal-ai/qwen-image-edit-2511-multiple-angles', capacite: 'angles' }, 'k', {
    consigne: 'keep the logo',
    format: '1:1',
    imageUrls: ['https://f/a.png'],
    angle: { horizontal: 90, vertical: 0, zoom: 5 },
  })!;
  assert.deepEqual(fal.requete.corps, { image_urls: ['https://f/a.png'], horizontal_angle: 90, vertical_angle: 0, zoom: 5, num_images: 1, additional_prompt: 'keep the logo' });
  const ic = requeteDeGeneration({ service: 'fal', id: 'fal-ai/iclight-v2', capacite: 'lumiere' }, 'k', { consigne: 'relight', format: '1:1', imageUrls: ['https://f/a.png'], lumiere: { azimut: -90, elevation: 0, valeur: 'Left' } })!;
  assert.equal((ic.requete.corps as any).initial_latent, 'Left');
  assert.equal(requeteDeGeneration({ service: 'fal', id: 'fal-ai/iclight-v2', capacite: 'lumiere' }, 'k', { consigne: 'x', format: '1:1' }), null, 'sans image, rien ne part');
  const hf = requeteDeGeneration({ service: 'higgsfield', id: 'alibaba/qwen-image-3/edit', capacite: 'visage' }, 'id:secret', { consigne: 'replace', format: '4:5', imageUrls: ['u1', 'u2', 'u3', 'u4'] })!;
  assert.equal(hf.requete.adresse, 'https://api.higgsfield.ai/alibaba/qwen-image-3/edit');
  assert.deepEqual((hf.requete.corps as any).image_urls, ['u1', 'u2', 'u3'], 'trois images au plus chez Higgsfield');
  assert.equal((hf.requete.corps as any).aspect_ratio, '3:4');
  const or = requeteDeGeneration({ service: 'openrouter', id: 'google/gemini-nano-banana-2.1', capacite: 'lumiere' }, 'k', { consigne: 'relight', format: '1:1', imageUrls: ['data:image/png;base64,AA'] })!;
  assert.equal((or.requete.corps as any).messages[0].content[1].image_url.url, 'data:image/png;base64,AA');
  const anim = requeteDeGeneration({ service: 'higgsfield', id: 'kling-video/v3.0/pro/image-to-video', capacite: 'animation' }, 'k', { consigne: 'slow push in', format: '16:9', duree: 6, imageUrls: ['https://i'] })!;
  assert.deepEqual(anim.requete.corps, { prompt: 'slow push in', image_url: 'https://i', duration: 6, sound: 'on' });
});

/* ------------------------------------------------------------------ */
/* Le démon                                                              */
/* ------------------------------------------------------------------ */

const projet = store.saveProject(Project.parse({ id: 'projet-ret', name: 'Atelier Retouches', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function carte(id: string) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'running',
      position: 1,
      title: `Retouches ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `agent-${id}`,
      github: { branch: `tache/ret-${id}` },
      parcours: { plans: [], realisationSouhaitee: true, comprehension: { texte: 'x', at: store.now(), cahierDesCharges: [{ titre: 'Budget et seuil', contenu: 'Budget total : 50 $\nSeuil d’accord par génération : 10 $' }] } },
      /* Aux esquisses, second temps d'une vidéo : l'animation y est permise (26/10/2026). */
      realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], esquissesA: 1, sequencesA: 2 },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({ id: `agent-${id}`, projectId: projet.id, cardId: c.id, role: 'task', title: 'Agent', run: { engine: 'claude', model: 'opus' }, status: 'running', createdAt: store.now(), updatedAt: store.now() }),
  );
  return c;
}
const ctx = (id: string) => ({ agentId: `agent-${id}`, projectId: projet.id, cardId: `carte-${id}` });
let rang = 0;
function repondre(agentId: string, question: any, answer: string) {
  rang += 1;
  store.saveMessage(Message.parse({ id: `m-ret-${rang}`, agentId, role: 'assistant', content: '', questions: [{ ...question, answer }], createdAt: store.now() }));
}
function reseau(table: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const vrai = globalThis.fetch;
  const appels: { url: string; corps: any }[] = [];
  globalThis.fetch = (async (adresse: any, init?: RequestInit) => {
    const url = String(adresse);
    let corps: any = null;
    try {
      corps = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      corps = null;
    }
    appels.push({ url, corps });
    const cle = Object.keys(table).find((k) => url.startsWith(k));
    if (!cle) throw new Error(`appel réseau inattendu : ${url}`);
    return table[cle]!(init);
  }) as typeof fetch;
  return { appels, rendre: () => (globalThis.fetch = vrai) };
}
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c60000000049454e44ae426082', 'hex');

assert.ok(enregistrerAcces({ nom: 'Studio — fal.ai', type: 'cle-api', projectId: null, champs: { service: 'fal.ai', cle: 'cle-fal-ABCDEFGH1234', adresse: 'https://exemple.test' } }).ok);
assert.ok(enregistrerAcces({ nom: 'Studio — Higgsfield', type: 'cle-api', projectId: null, champs: { service: 'Higgsfield', cle: 'id-hf:secret-hf-1234', adresse: 'https://exemple.test' } }).ok);

/** Un faux fal.ai : prix publié par modèle, files d'attente qui rendent une image ou une vidéo. */
function falFactice() {
  return reseau({
    'https://api.fal.ai/v1/models/pricing': (init) => json({ prices: [{ endpoint_id: 'x', unit_price: 0.05, unit: 'image' }] }),
    'https://rest.fal.ai/storage/upload/initiate': () => json({ upload_url: 'https://depot.fal.test/source.png', file_url: 'https://fichiers.fal.test/source.png' }),
    'https://depot.fal.test/': () => new Response('', { status: 200 }),
    'https://queue.fal.run/etat/': () => json({ status: 'COMPLETED' }),
    'https://queue.fal.run/resultat/': () => json({ images: [{ url: 'https://cdn.fal.test/r.png' }] }),
    'https://queue.fal.run/': () => json({ status_url: 'https://queue.fal.run/etat/1', response_url: 'https://queue.fal.run/resultat/1' }),
    'https://cdn.fal.test/r.png': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
}

/** Fabrique une image finie (devis → lot validé → génération). */
async function imageFinie(id: string, plan: string): Promise<string> {
  const d = await realisation.realiser(ctx(id), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan, consigne: 'a hero', raison: 'essai' });
  assert.ok(d.ok, d.text);
  const devis = /« ([^ »]+) »/.exec(d.text)![1]!;
  const g = await realisation.realiser(ctx(id), { action: 'generer', devis }, attenteNulle);
  if (g.question) {
    repondre(`agent-${id}`, g.question, 'Valider le devis');
    await realisation.realiser(ctx(id), { action: 'generer', devis }, attenteNulle);
  }
  const s = await realisation.realiser(ctx(id), { action: 'suivre', id: devis }, attenteCourte);
  assert.ok(s.ok, s.text);
  return devis;
}

test('un devis porte 1 à 4 propositions, jamais plus', async () => {
  carte('var');
  const faux = falFactice();
  try {
    const d = await realisation.realiser(ctx('var'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Plan 1', consigne: 'a hero', raison: 'r', variantes: 3 });
    assert.ok(d.ok, d.text);
    assert.match(d.text, /3 devis — Plan 1 \(3 propositions\)/);
    assert.equal(realisation.mediasDeLaCarte('carte-var').filter((m) => m.plan === 'Plan 1').length, 3);
    const trop = await realisation.realiser(ctx('var'), { action: 'devis', service: 'fal', modele: 'fal-ai/flux/schnell', plan: 'Plan 2', consigne: 'a hero', raison: 'r', variantes: 5 });
    assert.equal(trop.ok, false);
    assert.equal(realisation.mediasDeLaCarte('carte-var').filter((m) => m.plan === 'Plan 2').length, 0, 'rien n’est enregistré');
  } finally {
    faux.rendre();
  }
});

test('le suivi ne garde que le retenu ; un plan ne s’anime qu’à partir de son image ajoutée au suivi', async () => {
  carte('anim');
  const faux = falFactice();
  try {
    const image = await imageFinie('anim', 'Plan 1');
    const fini = realisation.mediaParId(image)!;
    assert.ok(fini.mesure === null || typeof fini.mesure === 'object');
    let etat = realisation.etatDeProductionDeLaCarte('carte-anim');
    let volet = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, ...etat });
    assert.equal(volet.find((e) => e.etape === 'plans')!.medias.length, 0, 'fabriquée, mais pas encore ajoutée');
    assert.equal(volet.find((e) => e.etape === 'plans')!.etat, 'a-valider');

    // Animer sans image retenue : refusé, rien n'est enregistré.
    const refus = await realisation.realiser(ctx('anim'), { action: 'devis', service: 'fal', modele: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', plan: 'Plan 1 animé', consigne: 'slow push in', raison: 'r', source: image, duree: 5 });
    assert.equal(refus.ok, false);
    assert.match(refus.text, /AJOUTÉE AU SUIVI/);
    // Le texte seul vers la vidéo est refusé dans une production vidéo.
    const texteSeul = await realisation.realiser(ctx('anim'), { action: 'devis', service: 'fal', modele: 'fal-ai/veo3/fast', plan: 'Plan 1 texte', consigne: 'x', raison: 'r', duree: 8 });
    assert.equal(texteSeul.ok, false);
    assert.match(texteSeul.text, /animation/);

    // Ajouter au suivi, idempotent ; puis l'animation part de cette image.
    const r1 = realisation.retenirUnMedia('carte-anim', image, true);
    assert.ok(r1.ok && r1.change);
    const r2 = realisation.retenirUnMedia('carte-anim', image, true);
    assert.ok(r2.ok && !r2.change, 'un double clic ne change rien');
    etat = realisation.etatDeProductionDeLaCarte('carte-anim');
    volet = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, ...etat });
    assert.deepEqual(volet.find((e) => e.etape === 'plans')!.medias.map((m) => m.id), [image]);
    assert.equal(volet.find((e) => e.etape === 'plans')!.etat, 'terminee');
    const anim = await realisation.realiser(ctx('anim'), { action: 'devis', service: 'fal', modele: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', plan: 'Plan 1 animé', consigne: 'slow push in', raison: 'r', source: image, duree: 5 });
    assert.ok(anim.ok, anim.text);
    const idAnim = /« ([^ »]+) »/.exec(anim.text)![1]!;
    assert.deepEqual(realisation.mediaParId(idAnim)!.demande.sources, [image]);
    assert.equal(realisation.mediaParId(idAnim)!.sourceId, image);

    // Retirer du suivi : le fichier reste.
    const r3 = realisation.retenirUnMedia('carte-anim', image, false);
    assert.ok(r3.ok && r3.change);
    assert.ok(fs.existsSync(realisation.mediaParId(image)!.fichier!), 'le fichier reste dans le fil');
    assert.equal(realisation.retenirUnMedia('carte-anim', idAnim, true).ok, false, 'un devis non fabriqué ne s’ajoute pas');
  } finally {
    faux.rendre();
  }
});

test('autres angles : l’image source part chez le service avant l’appel, avec l’angle en degrés', async () => {
  carte('angle');
  const faux = falFactice();
  try {
    const image = await imageFinie('angle', 'Héros');
    const sans = await realisation.realiser(ctx('angle'), { action: 'devis', service: 'fal', modele: 'fal-ai/qwen-image-edit-2511-multiple-angles', plan: 'Héros — profil', consigne: 'x', raison: 'r', source: image });
    assert.equal(sans.ok, false, 'il faut un angle');
    const d = await realisation.realiser(ctx('angle'), { action: 'devis', service: 'fal', modele: 'fal-ai/qwen-image-edit-2511-multiple-angles', plan: 'Héros — profil', consigne: 'keep the jacket', raison: 'r', source: image, angle: 'profil-droit', variantes: 2 });
    assert.ok(d.ok, d.text);
    const ids = realisation.mediasDeLaCarte('carte-angle').filter((m) => m.plan === 'Héros — profil').map((m) => m.id);
    assert.equal(ids.length, 2);
    const g = await realisation.realiser(ctx('angle'), { action: 'generer', devis: ids[0] }, attenteNulle);
    assert.ok(g.question, 'le devis repasse par la question d’accord');
    repondre('agent-angle', g.question, 'Valider le devis');
    await realisation.realiser(ctx('angle'), { action: 'generer', devis: ids[0] }, attenteNulle);
    const s = await realisation.realiser(ctx('angle'), { action: 'suivre', id: ids[0] }, attenteCourte);
    assert.ok(s.ok, s.text);
    const envoi = faux.appels.find((a) => a.url === 'https://queue.fal.run/fal-ai/qwen-image-edit-2511-multiple-angles');
    assert.ok(envoi, 'l’appel payant est parti après l’accord');
    assert.deepEqual(envoi!.corps.image_urls, ['https://fichiers.fal.test/source.png']);
    assert.equal(envoi!.corps.horizontal_angle, 90);
    const reglages = realisation.etatDeProductionDeLaCarte('carte-angle').medias.find((m) => m.id === ids[0])!.reglages!;
    assert.ok(reglages.some((r) => r.cle === 'Angle' && /Profil droit/.test(r.valeur)));
    assert.ok(reglages.some((r) => r.cle === 'Image d’origine' && /Héros v1/.test(r.valeur)));
  } finally {
    faux.rendre();
  }
});

test('la lumière : la sphère suit le modèle, le démon refuse une direction non permise', async () => {
  carte('lum');
  const faux = falFactice();
  try {
    const image = await imageFinie('lum', 'Héros');
    const q = await realisation.realiser(ctx('lum'), { action: 'lumiere', service: 'fal', modele: 'fal-ai/iclight-v2', source: image });
    assert.ok(q.question, q.text);
    assert.equal((q.question!.lumiere!.directions as unknown[]).length, 4, 'IC-Light : quatre directions');
    const libre = await realisation.realiser(ctx('lum'), { action: 'lumiere', service: 'higgsfield', modele: 'alibaba/qwen-image-3/edit', source: image });
    assert.equal(libre.question!.lumiere!.directions, 'libre');
    const hors = await realisation.realiser(ctx('lum'), { action: 'devis', service: 'fal', modele: 'fal-ai/iclight-v2', plan: 'Héros — contre-jour', consigne: 'warm', raison: 'r', source: image, lumiere: { azimut: 45, elevation: 30 } });
    assert.equal(hors.ok, false);
    assert.match(hors.text, /n’accepte que ces directions/);
    const ok = await realisation.realiser(ctx('lum'), { action: 'devis', service: 'fal', modele: 'fal-ai/iclight-v2', plan: 'Héros — gauche', consigne: 'warm', raison: 'r', source: image, lumiere: 'Lumière : azimut -90°, élévation 0°' });
    assert.ok(ok.ok, ok.text);
    const m = realisation.mediasDeLaCarte('carte-lum').find((x) => x.plan === 'Héros — gauche')!;
    assert.equal(m.demande.lumiere!.valeur, 'Left');
    assert.match(m.demande.consigne, /Relight the image/);
  } finally {
    faux.rendre();
  }
});

test('le visage : photos du projet, plafond du modèle, cible obligatoire', async () => {
  carte('vis');
  const faux = falFactice();
  try {
    const image = await imageFinie('vis', 'Groupe');
    const photo = await imageFinie('vis', 'Portrait');
    const sansCible = await realisation.realiser(ctx('vis'), { action: 'devis', service: 'fal', modele: 'fal-ai/nano-banana/edit', plan: 'Groupe — visage', consigne: 'x', raison: 'r', source: image, photos: [photo] });
    assert.equal(sansCible.ok, false);
    const trop = await realisation.realiser(ctx('vis'), { action: 'devis', service: 'higgsfield', modele: 'alibaba/qwen-image-3/edit', capacite: 'visage', plan: 'Groupe — visage', consigne: 'x', raison: 'r', source: image, photos: [photo, photo, photo], cible: 'la personne n° 2' });
    assert.equal(trop.ok, false, 'deux photos au plus chez Higgsfield');
    assert.match(trop.text, /2 photo\(s\) du visage au plus/);
    const d = await realisation.realiser(ctx('vis'), { action: 'devis', service: 'fal', modele: 'fal-ai/nano-banana/edit', plan: 'Groupe — visage', consigne: 'natural smile', raison: 'r', source: image, photos: [photo], cible: 'la personne n° 2, à gauche' });
    assert.ok(d.ok, d.text);
    const m = realisation.mediasDeLaCarte('carte-vis').find((x) => x.plan === 'Groupe — visage')!;
    assert.deepEqual(m.demande.sources, [image, photo]);
    assert.match(m.demande.consigne, /replace the face of la personne n° 2/);
  } finally {
    faux.rendre();
  }
});

/* ------------------------------------------------------------------ */
/* Le catalogue lu en direct, l'image de fin, le contrôle du mouvement  */
/* ------------------------------------------------------------------ */

/** Une section de la documentation publique de Higgsfield, à la forme du 24/10/2026. */
const DOC_HIGGSFIELD = [
  '# Kling 3.0 Motion Control — Pro API',
  'Source: https://docs.higgsfield.ai/docs/models/kling-3-motion-control/pro',
  '',
  'Pro with Kling 3.0 Motion Control: request parameters, examples and response handling.',
  '',
  '**Endpoint ID:** `kling-video/v3/motion-control/pro`',
  '',
  '> **Complete JSON schema**',
  '>',
  '> ```json theme={"theme":{"light":"github-light","dark":"github-dark"}}',
  '> {',
  '>   "type": "object",',
  '>   "required": ["image_url", "video_url"],',
  '>   "properties": {',
  '>     "prompt": { "type": "string", "default": "" },',
  '>     "image_url": { "type": "string", "format": "uri" },',
  '>     "video_url": { "type": "string", "format": "uri" },',
  '>     "character_orientation": { "enum": ["image", "video"], "type": "string", "default": "video" }',
  '>   }',
  '> }',
  '> ```',
  '',
  '# Seedance 2.5 — Image to video API',
  '',
  'Image to video with Seedance 2.5.',
  '',
  '**Endpoint ID:** `bytedance/seedance-2.5/image-to-video`',
  '',
  '> **Complete JSON schema**',
  '>',
  '> ```json',
  '> {',
  '>   "type": "object",',
  '>   "required": ["image_url"],',
  '>   "properties": {',
  '>     "prompt": { "type": "string" },',
  '>     "duration": { "type": "integer", "default": 5, "minimum": 4, "maximum": 12 },',
  '>     "image_url": { "type": "string" },',
  '>     "end_image_url": { "type": "string" },',
  '>     "resolution": { "type": "string", "enum": ["480p", "720p", "1080p"], "default": "720p" }',
  '>   }',
  '> }',
  '> ```',
  '',
  '# Guide sans modèle',
  'Rien à commander ici.',
  '',
].join('\n');

test('le catalogue en direct : Higgsfield lu dans sa documentation, fal dans sa liste, chacun avec sa capacité', () => {
  const hf = shared.modelesHiggsfieldDeLaDoc(DOC_HIGGSFIELD);
  assert.deepEqual(
    hf.map((m) => [m.id, m.capacite]),
    [
      ['kling-video/v3/motion-control/pro', 'mouvement'],
      ['bytedance/seedance-2.5/image-to-video', 'animation'],
    ],
  );
  const seedance = hf[1]!;
  assert.deepEqual(shared.ceQueRecoitLeModele(seedance.entrees), { imageDeDepart: true, imageDeFin: true, images: false, video: false, audio: false });
  assert.equal(seedance.entrees.find((e) => e.nom === 'image_url')!.requis, true);

  const fal = shared.modelesFalLus({
    models: [
      { endpoint_id: 'fal-ai/kling-video/v3/pro/motion-control', metadata: { display_name: 'Kling Motion Control', category: 'video-to-video', status: 'active', kind: 'inference' } },
      { endpoint_id: 'fal-ai/kling-video/v3/pro/image-to-video', metadata: { display_name: 'Kling 3 i2v', category: 'image-to-video', status: 'active', kind: 'inference' } },
      { endpoint_id: 'fal-ai/vieux', metadata: { category: 'text-to-image', status: 'deprecated' } },
      { endpoint_id: 'fal-ai/entrainement', metadata: { category: 'training', status: 'active', kind: 'training' } },
    ],
  });
  assert.deepEqual(fal.map((m) => [m.id, m.capacite]), [
    ['fal-ai/kling-video/v3/pro/motion-control', 'mouvement'],
    ['fal-ai/kling-video/v3/pro/image-to-video', 'animation'],
  ]);
  const entrees = shared.entreesDuModeleFal(
    {
      models: [
        {
          endpoint_id: 'fal-ai/x',
          openapi: {
            paths: { '/fal-ai/x': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/XInput' } } } } } } },
            components: {
              schemas: {
                XInput: { required: ['start_image_url'], properties: { start_image_url: { type: 'string' }, duration: { $ref: '#/components/schemas/Duree' }, end_image_url: { anyOf: [{ type: 'string' }, { type: 'null' }] } } },
                Duree: { type: 'string', enum: ['5', '10'] },
              },
            },
          },
        },
      ],
    },
    'fal-ai/x',
  );
  assert.deepEqual(entrees.find((e) => e.nom === 'duration')!.valeurs, ['5', '10']);
  assert.equal(entrees.find((e) => e.nom === 'end_image_url')!.type, 'string');
});

test('la commande d’un modèle lu suit son schéma : entrées connues posées, réglages vérifiés, manques refusés', () => {
  const seedance = shared.modelesHiggsfieldDeLaDoc(DOC_HIGGSFIELD)[1]!;
  const ok = shared.corpsEnDirect(seedance.entrees, { consigne: 'slow dolly', format: '16:9', duree: 20, imageUrls: ['https://a/depart.png'], imageDeFinUrl: 'https://a/fin.png', parametres: { resolution: '1080p' } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.corps, { prompt: 'slow dolly', image_url: 'https://a/depart.png', end_image_url: 'https://a/fin.png', duration: 12, resolution: '1080p' });
  const inconnu = shared.corpsEnDirect(seedance.entrees, { consigne: 'x', format: '16:9', imageUrls: ['https://a/d.png'], parametres: { couleur: 'rouge' } });
  assert.ok(!inconnu.ok && /réglage inconnu/.test(inconnu.raison));
  const horsListe = shared.corpsEnDirect(seedance.entrees, { consigne: 'x', format: '16:9', imageUrls: ['https://a/d.png'], parametres: { resolution: '8k' } });
  assert.ok(!horsListe.ok && /480p, 720p, 1080p/.test(horsListe.raison));
  const adresse = shared.corpsEnDirect(seedance.entrees, { consigne: 'x', format: '16:9', imageUrls: ['https://a/d.png'], parametres: { image_url: 'https://ailleurs' } });
  assert.ok(!adresse.ok && /posé par le démon/.test(adresse.raison));
  const sansImage = shared.corpsEnDirect(seedance.entrees, { consigne: 'x', format: '16:9' });
  assert.ok(!sansImage.ok && /image de départ/.test(sansImage.raison));
  const mouvement = shared.modelesHiggsfieldDeLaDoc(DOC_HIGGSFIELD)[0]!;
  const sansFin = shared.corpsEnDirect(mouvement.entrees, { consigne: 'x', format: '16:9', imageUrls: ['https://a/d.png'], imageDeFinUrl: 'https://a/f.png', videoDeMouvementUrl: 'https://a/v.mp4' });
  assert.ok(!sansFin.ok && /image de fin/.test(sansFin.raison), 'un modèle sans image de fin ne la reçoit pas en silence');
  const req = shared.requeteEnDirect('higgsfield', mouvement.id, 'id:secret', { image_url: 'https://a/d.png' });
  assert.equal(req.adresse, 'https://api.higgsfield.ai/kling-video/v3/motion-control/pro');
  assert.equal(req.entetes.Authorization, 'Key id:secret');
});

test('l’image de fin et le contrôle du mouvement partent au bon champ de chaque service', () => {
  const d = { consigne: 'walk', format: '16:9' as const, duree: 8, imageUrls: ['https://a/d.png'], imageDeFinUrl: 'https://a/f.png', videoDeMouvementUrl: 'https://a/v.mp4' };
  const kling3 = requeteDeGeneration({ service: 'fal', id: 'fal-ai/kling-video/v3/pro/image-to-video', capacite: 'animation' }, 'k', d)!;
  assert.deepEqual([(kling3.requete.corps as any).start_image_url, (kling3.requete.corps as any).end_image_url, (kling3.requete.corps as any).duration], ['https://a/d.png', 'https://a/f.png', '8']);
  const kling25 = requeteDeGeneration({ service: 'fal', id: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', capacite: 'animation' }, 'k', d)!;
  assert.equal((kling25.requete.corps as any).tail_image_url, 'https://a/f.png');
  const hf = requeteDeGeneration({ service: 'higgsfield', id: 'kling-video/v3.0/pro/image-to-video', capacite: 'animation' }, 'k', d)!;
  assert.equal((hf.requete.corps as any).last_image_url, 'https://a/f.png');
  const mFal = requeteDeGeneration({ service: 'fal', id: 'fal-ai/kling-video/v3/pro/motion-control', capacite: 'mouvement' }, 'k', { ...d, orientation: 'image' })!;
  assert.deepEqual(mFal.requete.corps, { image_url: 'https://a/d.png', video_url: 'https://a/v.mp4', character_orientation: 'image', keep_original_sound: true, prompt: 'walk' });
  const mHf = requeteDeGeneration({ service: 'higgsfield', id: 'kling-video/v3/motion-control/pro', capacite: 'mouvement' }, 'k', d)!;
  assert.equal((mHf.requete.corps as any).keep_original_sound, 'yes');
  assert.equal(requeteDeGeneration({ service: 'fal', id: 'fal-ai/kling-video/v3/pro/motion-control', capacite: 'mouvement' }, 'k', { ...d, videoDeMouvementUrl: undefined }), null, 'sans vidéo de référence, rien ne part');
  const refaite = requeteDeGeneration({ service: 'fal', id: 'fal-ai/nano-banana/edit', capacite: 'retouche' }, 'k', d)!;
  assert.deepEqual((refaite.requete.corps as any).image_urls, ['https://a/d.png']);
  assert.ok(catalogueDeGeneration().some((m) => m.capacite === 'mouvement' && m.service === 'higgsfield'));
  assert.ok(catalogueDeGeneration().filter((m) => m.capacite === 'animation').every((m) => m.fin), 'chaque modèle d’animation choisi prend une image de fin');
});

test('animer jusqu’à une image de fin, puis reprendre les gestes d’une vidéo avec un modèle lu en direct', async () => {
  carte('fin');
  const faux = reseau({
    'https://api.fal.ai/v1/models/pricing': () => json({ prices: [] }),
    'https://api.fal.ai/v1/models?category=video-to-video': () =>
      json({ models: [{ endpoint_id: 'fal-ai/wan-motion', metadata: { display_name: 'Wan Motion', category: 'video-to-video', status: 'active', kind: 'inference' } }], has_more: false }),
    'https://api.fal.ai/v1/models?category=': () => json({ models: [], has_more: false }),
    'https://api.fal.ai/v1/models?endpoint_id=fal-ai%2Fwan-motion': () =>
      json({
        models: [
          {
            endpoint_id: 'fal-ai/wan-motion',
            openapi: { components: { schemas: { WanMotionInput: { required: ['image_url', 'video_url'], properties: { image_url: { type: 'string' }, video_url: { type: 'string' }, prompt: { type: 'string' }, seed: { type: 'integer' } } } } } },
          },
        ],
      }),
    'https://rest.fal.ai/storage/upload/initiate': () => json({ upload_url: 'https://depot.fal.test/source.png', file_url: 'https://fichiers.fal.test/source.png' }),
    'https://depot.fal.test/': () => new Response('', { status: 200 }),
    'https://queue.fal.run/etat/': () => json({ status: 'COMPLETED' }),
    'https://queue.fal.run/resultat/': () => json({ images: [{ url: 'https://cdn.fal.test/r.png' }], video: { url: 'https://cdn.fal.test/r.png' } }),
    'https://queue.fal.run/': () => json({ status_url: 'https://queue.fal.run/etat/1', response_url: 'https://queue.fal.run/resultat/1' }),
    'https://cdn.fal.test/r.png': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
  try {
    const depart = await imageFinie('fin', 'Plan 2');
    const fin = await imageFinie('fin', 'Plan 2 fin');
    assert.ok(realisation.retenirUnMedia('carte-fin', depart, true).ok);
    const anim = await realisation.realiser(ctx('fin'), { action: 'devis', service: 'fal', modele: 'fal-ai/kling-video/v3/pro/image-to-video', plan: 'Plan 2 animé', consigne: 'the hero turns', raison: 'r', source: depart, fin, duree: 6 });
    assert.ok(anim.ok, anim.text);
    const idAnim = /« ([^ »]+) »/.exec(anim.text)![1]!;
    assert.equal(realisation.mediaParId(idAnim)!.demande.fin, fin);
    const reglages = realisation.etatDeProductionDeLaCarte('carte-fin').medias.find((m) => m.id === idAnim)!.reglages!;
    assert.ok(reglages.some((r) => r.cle === 'Image de fin' && /Plan 2 fin/.test(r.valeur)));
    const finInconnue = await realisation.realiser(ctx('fin'), { action: 'devis', service: 'fal', modele: 'fal-ai/kling-video/v3/pro/image-to-video', plan: 'Plan 2 animé', consigne: 'x', raison: 'r', source: depart, fin: 'rien' });
    assert.equal(finInconnue.ok, false);

    // La vidéo de référence : un fichier rangé par l'agent.
    const fichier = path.join(bacASable, 'danse.mp4');
    fs.writeFileSync(fichier, Buffer.from('faux mp4'));
    const rangee = await realisation.realiser(ctx('fin'), { action: 'ajouter', chemin: fichier, plan: 'Danse de référence' });
    assert.ok(rangee.ok, rangee.text);
    const video = realisation.mediasDeLaCarte('carte-fin').find((m) => m.plan === 'Danse de référence')!.id;

    // Le catalogue en direct le propose, avec ses entrées.
    const liste = await realisation.realiser(ctx('fin'), { action: 'modeles', en_direct: true, service: 'fal', capacite: 'mouvement' });
    assert.ok(liste.ok && /fal-ai\/wan-motion/.test(liste.text), liste.text);
    const detail = await realisation.realiser(ctx('fin'), { action: 'modeles', en_direct: true, service: 'fal', modele: 'fal-ai/wan-motion' });
    assert.match(detail.text, /vidéo de référence/);
    assert.match(detail.text, /seed/);

    const sansVideo = await realisation.realiser(ctx('fin'), { action: 'devis', service: 'fal', modele: 'fal-ai/wan-motion', plan: 'Danse', consigne: 'x', raison: 'r', source: depart });
    assert.equal(sansVideo.ok, false);
    assert.match(sansVideo.text, /mouvement/);
    const mauvais = await realisation.realiser(ctx('fin'), { action: 'devis', service: 'fal', modele: 'fal-ai/wan-motion', plan: 'Danse', consigne: 'x', raison: 'r', source: depart, mouvement: video, parametres: { seed: 'abc' } });
    assert.equal(mauvais.ok, false, 'un réglage hors schéma est refusé au devis, avant toute dépense');
    const d = await realisation.realiser(ctx('fin'), { action: 'devis', service: 'fal', modele: 'fal-ai/wan-motion', plan: 'Danse', consigne: 'the hero dances', raison: 'r', source: depart, mouvement: video, parametres: { seed: 7 } });
    assert.ok(d.ok, d.text);
    const id = /« ([^ »]+) »/.exec(d.text)![1]!;
    const g = await realisation.realiser(ctx('fin'), { action: 'generer', devis: id }, attenteNulle);
    if (g.question) {
      repondre('agent-fin', g.question, 'Valider le devis');
      await realisation.realiser(ctx('fin'), { action: 'generer', devis: id }, attenteNulle);
    }
    const s = await realisation.realiser(ctx('fin'), { action: 'suivre', id }, attenteCourte);
    assert.ok(s.ok, s.text);
    const envoi = faux.appels.find((a) => a.url === 'https://queue.fal.run/fal-ai/wan-motion');
    assert.ok(envoi, 'la commande est partie après l’accord');
    assert.deepEqual(envoi!.corps, { prompt: 'the hero dances', image_url: 'https://fichiers.fal.test/source.png', video_url: 'https://fichiers.fal.test/source.png', seed: 7 });
    assert.equal(realisation.mediaParId(id)!.genre, 'video');
  } finally {
    faux.rendre();
  }
});

/*
 * LES RETOUCHES REFAITES (26/10/2026, captures #7a99, #129c, #8c9bf) : le
 * visage cliqué se dit en mots au modèle, la caméra du cube se cale sur un
 * angle nommé, les visages repérés restent au démon, et chaque retouche
 * propose TOUS ses modèles, le meilleur d'office.
 */
test('le visage cliqué se dit au modèle : seul, ou par son rang de gauche à droite', () => {
  const { phraseDeVisageCible } = shared;
  const seul = { x: 0.4, y: 0.1, largeur: 0.2, hauteur: 0.25 };
  assert.match(phraseDeVisageCible(seul, [seul]), /^the person \(face centred about 50% from the left and 23% from the top/);
  const gauche = { x: 0.05, y: 0.2, largeur: 0.15, hauteur: 0.2 };
  const droite = { x: 0.75, y: 0.15, largeur: 0.15, hauteur: 0.2 };
  const phrase = phraseDeVisageCible(droite, [gauche, droite]);
  assert.match(phrase, /^the second person from the left, on the right of the image/);
  assert.match(phrase, /among 2 people/);
  assert.match(phraseDeVisageCible(gauche, [gauche, droite]), /^the first person from the left, on the left/);
});

test('une boîte de visage est ramenée dans l’image, une boîte vide refusée', () => {
  const { boiteDeVisage } = shared;
  assert.deepEqual(boiteDeVisage({ x: -0.1, y: 0.9, largeur: 0.3, hauteur: 0.3 }), { x: 0, y: 0.9, largeur: 0.3, hauteur: 0.1 });
  assert.equal(boiteDeVisage({ x: 0.1, y: 0.1, largeur: 0, hauteur: 0.2 }), null);
  assert.equal(boiteDeVisage('rien'), null);
});

test('la caméra du cube se cale sur l’angle nommé le plus proche, le cadrage choisi gardé', () => {
  const { angleAimante } = shared;
  assert.deepEqual(angleAimante({ horizontal: 50, vertical: 4, zoom: 6 }), { horizontal: 45, vertical: 0, zoom: 6, nom: 'trois-quarts-droite' });
  assert.deepEqual(angleAimante({ horizontal: 355, vertical: -3, zoom: 9 }), { horizontal: 0, vertical: 0, zoom: 9, nom: 'gros-plan' });
  assert.equal(angleAimante({ horizontal: 0, vertical: 2, zoom: 1 }).nom, 'plan-large');
  assert.equal(angleAimante({ horizontal: 182, vertical: 0, zoom: 5 }).nom, 'dos');
  // Entre deux angles nommés : rien ne se cale.
  assert.deepEqual(angleAimante({ horizontal: 22, vertical: 25, zoom: 5 }), { horizontal: 22, vertical: 25, zoom: 5, nom: null });
});

test('les visages repérés restent au démon, par projet, et une pièce d’ailleurs est ignorée', async () => {
  const { enregistrerLesVisages, visagesDuProjet } = await import('../visages-des-pieces.js');
  const piece = store.saveAttachment({ id: 'piece-portrait', projectId: projet.id, name: 'portrait.png', mime: 'image/png', size: 3, sha: 'sha-portrait', createdAt: store.now() } as never);
  const ecrits = enregistrerLesVisages(projet.id, [
    { attachmentId: piece.id, boites: [{ x: 0.3, y: 0.1, largeur: 0.2, hauteur: 0.3 }, { x: 'faux' }] },
    { attachmentId: 'piece-inconnue', boites: [] },
  ]);
  assert.equal(ecrits, 1);
  const lus = visagesDuProjet(projet.id).find((v) => v.attachmentId === piece.id);
  assert.equal(lus?.visages, 1);
  assert.deepEqual(lus?.boites, [{ x: 0.3, y: 0.1, largeur: 0.2, hauteur: 0.3 }]);
});

test('chaque retouche d’image a plusieurs modèles kie.ai, le meilleur d’abord', () => {
  const { MODELES_KIE } = shared;
  for (const capacite of ['visage', 'lumiere', 'angles'] as const) {
    const modeles = MODELES_KIE.filter((m) => m.capacite === capacite);
    assert.ok(modeles.length >= 4, `${capacite} : ${modeles.length} modèle(s)`);
    for (const m of modeles) {
      assert.ok(m.tarif.length, `${m.id} sans ligne de prix`);
      assert.ok(m.entrees.some((e) => ['image_urls', 'image_input', 'input_urls'].includes(e.nom)), `${m.id} ne reçoit pas d’image`);
    }
  }
});

test('dans le Studio, un plan s’anime depuis une image finie sans validation ; le montage d’une carte garde sa porte', async () => {
  carte('studio');
  const { creerCreation } = await import('../studio.js');
  const { getDb } = await import('../db.js');
  const faux = falFactice();
  try {
    const image = await imageFinie('studio', 'Plan 1');
    assert.ok(!realisation.mediaParId(image)!.retenuLe);
    const cree = creerCreation({ projectId: projet.id });
    assert.ok(cree.ok);
    const lier = getDb().prepare('UPDATE studio_creations SET card_id = ?, agent_id = ? WHERE id = ?');
    const devis = { action: 'devis', service: 'fal', modele: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', plan: 'Plan 1 animé', consigne: 'slow push in', raison: 'r', source: image, duree: 5 };

    lier.run('carte-studio', null, cree.creation.id);
    const montage = await realisation.realiser(ctx('studio'), devis);
    assert.equal(montage.ok, false, 'le montage d’une carte garde ses étapes');

    lier.run('carte-studio', 'agent-studio', cree.creation.id);
    assert.equal(realisation.studioSansEtapes({ id: 'carte-studio' }), true);
    const studio = await realisation.realiser(ctx('studio'), devis);
    assert.ok(studio.ok, studio.text);
    const id = /« ([^ »]+) »/.exec(studio.text)![1]!;
    assert.equal(realisation.mediaParId(id)!.sourceId, image);
    assert.equal(realisation.mediaParId(id)!.etat, 'devis', 'le devis ne lance rien');
  } finally {
    faux.rendre();
  }
});
