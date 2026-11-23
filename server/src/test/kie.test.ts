import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * kie.ai REMPLACE HIGGSFIELD ET fal.ai (décision de l'utilisateur du 25/10/2026).
 *
 *  - les règles pures : la commande d'après le schéma recopié, la lecture des
 *    réponses (erreurs en HTTP 200, coût réel en crédits), le prix lu dans la
 *    liste publique, le catalogue de la documentation, la lecture d'une page ;
 *  - fal.ai et Higgsfield sont CACHÉS (réglages, listes, conseils, devis) sans
 *    que leur code soit retiré ;
 *  - le démon : une clé refusée n'est pas rangée ; un devis kie.ai validé
 *    d'un clic part, se suit, se télécharge et relève les crédits consommés.
 *
 * Aucun appel réel : le réseau est piégé, tout appel inattendu fait échouer.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_TRADUCTION_IDENTITE = '1';
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
const {
  Agent,
  Card,
  Message,
  Project,
  MODELES_KIE,
  SERVICES_CREATION,
  catalogueVisible,
  corpsEnDirect,
  entreesDeLaPageKie,
  entreesDuSchemaJson,
  estServiceCache,
  lireCommandeKie,
  lireCreationDeClip,
  lireSuiviKie,
  modeleKie,
  modelesKieDeLaDoc,
  modelesProposes,
  prixKie,
  requeteDeCreation,
  requeteDeGeneration,
  servicesPourLesCapacites,
  verdictDuSoldeKie,
} = shared;
const store = await import('../store.js');
const { enregistrerAcces } = await import('../coffre-fort.js');
const services = await import('../studio-services.js');
const realisation = await import('../realisation.js');

realisation.RYTHME_REALISATION.pauseMs = 1;
const attenteNulle = async () => {};
const attenteCourte = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 3000)));

function reseau(table: Record<string, (init?: RequestInit) => Response>) {
  const vrai = globalThis.fetch;
  const appels: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (adresse: any, init?: RequestInit) => {
    const url = String(adresse);
    appels.push({ url, init });
    const cle = Object.keys(table).find((k) => url.startsWith(k));
    if (!cle) throw new Error(`appel réseau inattendu : ${url}`);
    return table[cle]!(init);
  }) as typeof fetch;
  return { appels, rendre: () => (globalThis.fetch = vrai) };
}
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

test('fal.ai et Higgsfield sont rallumés à côté de kie.ai, qui reste en tête des conseils', () => {
  assert.ok(!estServiceCache('fal') && !estServiceCache('higgsfield') && !estServiceCache('kie'));
  assert.ok(SERVICES_CREATION.some((s) => s.id === 'fal') && SERVICES_CREATION.some((s) => s.id === 'higgsfield'));
  assert.ok(catalogueVisible().some((m) => m.service === 'fal') && catalogueVisible().some((m) => m.service === 'higgsfield'));
  assert.ok(modelesProposes(['fal', 'higgsfield', 'kie']).some((m) => m.service === 'fal'));
  const conseil = servicesPourLesCapacites(['video', 'image', 'voix', 'musique', 'synchro'], catalogueVisible());
  assert.equal(conseil[0]!.id, 'kie');
  assert.equal(conseil[0]!.rang, 'recommande');
  assert.deepEqual(conseil[0]!.capacites, ['video', 'image', 'voix', 'musique', 'synchro']);
  // L'interrupteur reste : un service recaché disparaît, sans que son code bouge.
  shared.fixerLesServicesCaches(['fal', 'higgsfield']);
  try {
    assert.ok(!catalogueVisible().some((m) => m.service === 'fal' || m.service === 'higgsfield'));
  } finally {
    shared.fixerLesServicesCaches();
  }
});

test('le catalogue kie.ai couvre image, vidéo, animation, mouvement, retouches, voix, musique et synchro', () => {
  const capacites = new Set(MODELES_KIE.map((m) => m.capacite));
  for (const c of ['image', 'video', 'animation', 'mouvement', 'retouche', 'visage', 'lumiere', 'angles', 'voix', 'musique', 'synchro', 'avatar', 'visage-video']) assert.ok(capacites.has(c as any), c);
  const kie = SERVICES_CREATION.find((s) => s.id === 'kie')!;
  assert.equal(kie.nom, 'kie.ai', 'le nom exact retrouve la fiche « Studio — kie.ai »');
  assert.ok(kie.modeles.length >= 3 && kie.modeles.every((m) => m.durees.length));
  /* Chaque modèle choisi se commande sans entrée obligatoire manquante, à partir d'une demande ordinaire. */
  for (const m of MODELES_KIE) {
    const d: any = { consigne: 'a calm sea', format: '9:16', duree: 5 };
    if (m.capacite === 'animation' || m.capacite === 'mouvement' || m.capacite === 'retouche' || m.capacite === 'lumiere' || m.capacite === 'angles') d.imageUrls = ['https://x/a.png'];
    if (m.capacite === 'visage') d.imageUrls = ['https://x/a.png', 'https://x/visage.png'];
    if (m.capacite === 'mouvement') d.videoDeMouvementUrl = 'https://x/danse.mp4';
    if (m.capacite === 'synchro') Object.assign(d, { videoUrl: 'https://x/v.mp4', audioUrl: 'https://x/voix.mp3' });
    /* Le présentateur parlant : un portrait et la voix qu'il dit ; le visage dans une vidéo : la photo et la vidéo (31/10/2026). */
    if (m.capacite === 'avatar') Object.assign(d, { imageUrls: ['https://x/portrait.png'], audioUrl: 'https://x/voix.mp3' });
    if (m.capacite === 'visage-video') Object.assign(d, { imageUrls: ['https://x/visage.png'], videoDeMouvementUrl: 'https://x/scene.mp4' });
    const c = corpsEnDirect(m.entrees, d, m.defauts);
    assert.ok(c.ok, `${m.id} [${m.capacite}] : ${!c.ok ? c.raison : ''}`);
  }
});

test('les commandes suivent les schémas : Kling 3.0 (départ et fin dans la même liste), motion control en listes, synchro, voix, Suno', () => {
  const anim = requeteDeGeneration({ service: 'kie', id: 'kling-3.0/video', capacite: 'animation' }, 'k', { consigne: 'go', format: '16:9', duree: 7, imageUrls: ['https://x/a.png'], imageDeFinUrl: 'https://x/b.png' })!;
  assert.equal(anim.requete.adresse, 'https://api.kie.ai/api/v1/jobs/createTask');
  assert.equal(anim.requete.entetes.Authorization, 'Bearer k');
  assert.deepEqual(anim.requete.corps, { model: 'kling-3.0/video', input: { prompt: 'go', image_urls: ['https://x/a.png', 'https://x/b.png'], duration: '7', aspect_ratio: '16:9', mode: 'std', multi_shots: false, sound: true } });
  const geste = requeteDeGeneration({ service: 'kie', id: 'kling-3.0/motion-control', capacite: 'mouvement' }, 'k', { consigne: '', format: '9:16', imageUrls: ['https://x/a.png'], videoDeMouvementUrl: 'https://x/d.mp4' })!;
  assert.deepEqual((geste.requete.corps as any).input, { input_urls: ['https://x/a.png'], video_urls: ['https://x/d.mp4'], character_orientation: 'video' });
  const synchro = requeteDeGeneration({ service: 'kie', id: 'volcengine/video-to-video-lip-sync', capacite: 'synchro' }, 'k', { consigne: 'x', format: '16:9', videoUrl: 'https://x/v.mp4', audioUrl: 'https://x/a.mp3' })!;
  assert.deepEqual((synchro.requete.corps as any).input, { video_url: 'https://x/v.mp4', audio_url: 'https://x/a.mp3', mode: 'lite' });
  const voix = requeteDeGeneration({ service: 'kie', id: 'elevenlabs/text-to-speech-turbo-2-5', capacite: 'voix' }, 'k', { consigne: 'Bonjour', format: '16:9', voix: 'Z3R5wn05IrDiVCyEkUrK', langue: 'fr' })!;
  assert.deepEqual((voix.requete.corps as any).input, { text: 'Bonjour', voice: 'Z3R5wn05IrDiVCyEkUrK', language_code: 'fr' });
  const inventee = requeteDeGeneration({ service: 'kie', id: 'elevenlabs/text-to-speech-turbo-2-5', capacite: 'voix' }, 'k', { consigne: 'Bonjour', format: '16:9', voix: 'pas-une-voix' })!;
  assert.equal((inventee.requete.corps as any).input.voice, undefined, 'une voix hors de la liste laisse celle par défaut');
  const musique = requeteDeGeneration({ service: 'kie', id: 'ai-music-api/generate', capacite: 'musique' }, 'k', { consigne: 'calm piano', format: '16:9', duree: 30 })!;
  /* La durée n'est admise qu'en mode personnalisé, qui exige titre et style ; `prompt` y serait chanté comme des paroles. */
  assert.deepEqual((musique.requete.corps as any).input, { duration: 30, custom_mode: true, instrumental: true, model: 'V6', title: 'calm piano', style: 'calm piano' });
  const longue = requeteDeGeneration({ service: 'kie', id: 'ai-music-api/generate', capacite: 'musique' }, 'k', { consigne: 'une musique '.repeat(10), format: '16:9' })!;
  assert.ok(((longue.requete.corps as any).input.title as string).length <= 80, 'le titre tient dans la limite du service');
  /* Un format absent de la liste prend le plus proche ; un format obligatoire n'est jamais oublié. */
  const z = requeteDeGeneration({ service: 'kie', id: 'z-image', capacite: 'image' }, 'k', { consigne: 'x', format: '4:5' })!;
  assert.equal((z.requete.corps as any).input.aspect_ratio, '3:4');
  /* Le Studio commande sa vidéo par le même schéma. */
  const clip = requeteDeCreation('kie', 'bytedance/seedance-2-fast', 'k', { consigne: 'waves', duree: 8, ratio: '9:16', son: false });
  assert.deepEqual((clip.corps as any).input, { prompt: 'waves', generate_audio: false, aspect_ratio: '9:16', duration: 8, resolution: '720p' });
});

test('les réponses de kie.ai : le code du corps fait foi, le coût réel vient des crédits consommés', () => {
  assert.deepEqual(lireCommandeKie(200, { code: 200, data: { taskId: 't-1' } }), { etat: 'attente', suivi: 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t-1' });
  const refus = lireCommandeKie(200, { code: 402, msg: 'Insufficient credits' });
  assert.equal(refus.etat, 'echec');
  assert.match((refus as any).raison, /crédit de votre compte kie\.ai est épuisé/);
  assert.match((lireCommandeKie(200, { code: 401 }) as any).raison, /refuse la clé/);
  assert.match((lireCommandeKie(200, { code: 422, msg: 'duration invalid' }) as any).raison, /duration invalid/);
  assert.deepEqual(lireSuiviKie(200, { code: 200, data: { state: 'generating' } }, 's'), { etat: 'attente', suivi: 's' });
  assert.deepEqual(lireSuiviKie(503, {}, 's'), { etat: 'attente', suivi: 's' });
  assert.deepEqual(lireSuiviKie(200, { code: 200, data: { state: 'success', resultJson: '{"resultUrls":["https://x/v.mp4"]}', creditsConsumed: 100 } }), { etat: 'fini', url: 'https://x/v.mp4', coutReel: 0.5 });
  assert.deepEqual(lireSuiviKie(200, { code: 200, data: { state: 'success', response: { data: [{ audio_url: 'https://x/a.mp3' }] } } }), { etat: 'fini', url: 'https://x/a.mp3' });
  assert.match((lireSuiviKie(200, { code: 200, data: { state: 'fail', failMsg: 'content policy' } }) as any).raison, /content policy/);
  assert.match((lireSuiviKie(200, { code: 422, msg: 'recordInfo is null' }) as any).raison, /ne retrouve plus/);
  // Juste après la commande, le 422 est une ATTENTE (le travail n'est pas encore enregistré chez kie.ai).
  assert.equal(lireSuiviKie(200, { code: 422, msg: 'recordInfo is null' }, 'https://x', 5_000).etat, 'attente');
  assert.equal(lireSuiviKie(200, { code: 422, msg: 'recordInfo is null' }, 'https://x', 10 * 60_000).etat, 'echec');
  assert.deepEqual(lireCreationDeClip('kie', 'x', 200, { code: 200, data: { taskId: 't' } }), { etat: 'attente', suivi: 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t' });
  assert.equal(verdictDuSoldeKie(200, { code: 401 }).ok, false, 'une fausse clé répond 200 avec code 401');
  assert.equal(verdictDuSoldeKie(200, { code: 200, data: 1080 }).ok, true);
});

test('le prix vient de la liste publique : la ligne la plus chère du tarif, à la seconde, à l’image ou aux mille caractères', () => {
  const lignes = [
    { modelDescription: 'Kling 3.0, video, with audio-720P', creditPrice: '20', creditUnit: 'per second' },
    { modelDescription: 'Kling 3.0, video, without audio-720P', creditPrice: '14', creditUnit: 'per second' },
    { modelDescription: 'Qwen z-image, text-to-image, 1.0s', creditPrice: '0.8', creditUnit: 'per image', anchor: 'https://kie.ai/z-image' },
    { modelDescription: 'Elevenlabs Text to Speech, turbo 2.5', creditPrice: '6.0', creditUnit: 'per 1000 characters' },
    { modelDescription: 'wan 3.0', creditPrice: '3', creditUnit: 'per megapixel', anchor: 'https://kie.ai/wan?model=wan%2F3-0-video' },
  ];
  assert.equal(prixKie(lignes, modeleKie('kling-3.0/video', 'video')!, { secondes: 5 }), 0.5);
  assert.equal(prixKie(lignes, modeleKie('z-image')!, {}), 0.004);
  assert.equal(prixKie(lignes, modeleKie('elevenlabs/text-to-speech-turbo-2-5')!, { caracteres: 500 }), 0.015);
  assert.equal(prixKie(lignes, { tarif: ['rien de tel'] }, {}), null);
  assert.equal(prixKie(lignes, { id: 'wan/3-0-video' }, { secondes: 5 }), null, 'unité inconnue : pas de prix deviné');
});

const PAGE = [
  '# Exemple',
  '```yaml',
  'openapi: 3.0.1',
  'paths:',
  '  /api/v1/jobs/createTask:',
  '    post:',
  '      description: >',
  '        Un modèle d’essai.',
  '      requestBody:',
  '        content:',
  '          application/json:',
  '            schema:',
  '              type: object',
  '              properties:',
  '                model:',
  '                  type: string',
  '                  enum:',
  '                    - kling/v3-turbo-image-to-video',
  '                input:',
  '                  type: object',
  '                  required:',
  '                    - prompt',
  '                    - duration',
  '                  properties:',
  '                    prompt:',
  '                      type: string',
  '                      description: >-',
  '                        The text prompt (Max',
  '                        length: 2500 characters)',
  '                    image_urls:',
  '                      type: array',
  '                      items:',
  '                        type: string',
  '                    duration:',
  '                      type: string',
  '                      enum:',
  "                        - '5'",
  "                        - '10'",
  '                    seed:',
  '                      type: integer',
  '                      minimum: 0',
  '                      maximum: 99',
  '                      default: 3',
  '```',
].join('\n');

test('une page de la documentation donne l’identifiant et les entrées du modèle ; la liste donne les modèles et leur page', () => {
  const lu = entreesDeLaPageKie(PAGE, (s) => entreesDuSchemaJson(s))!;
  assert.equal(lu.id, 'kling/v3-turbo-image-to-video');
  assert.deepEqual(
    lu.entrees.map((e) => [e.nom, e.requis, e.type, e.valeurs ?? null, e.defaut ?? null]),
    [
      ['prompt', true, 'string', null, null],
      ['image_urls', false, 'array', null, null],
      ['duration', true, 'string', ['5', '10'], null],
      ['seed', false, 'integer', null, 3],
    ],
  );
  assert.equal(lu.entrees[0]!.description, 'The text prompt (Max length: 2500 characters)');
  assert.equal(entreesDeLaPageKie('# rien', (s) => entreesDuSchemaJson(s)), null);
  const doc = [
    '- Video Models > Kling [Kling - V3 Turbo Image to Video](https://docs.kie.ai/market/kling/v3-turbo-image-to-video.md): ## Overview',
    '- Video Models > Kling [Kling 3.0 motion-control](https://docs.kie.ai/market/kling/motion-control-v3.md): x',
    '- Image    Models > Google [Google - Nano Banana Edit](https://docs.kie.ai/market/google/nano-banana-edit.md): x',
    '- Image    Models > Google [Google - imagen4](https://docs.kie.ai/market/google/imagen4.md): x',
    '- Music Models > ElevenLabs [elevenlabs/text-to-speech-turbo-2-5](https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5.md): x',
    '- Video Models > Kling [Kling 2.6 Text to Video](https://docs.kie.ai/cn/market/kling/text-to-video.md): x',
    '- Chat  Models > Claude [Claude](https://docs.kie.ai/market/chat/claude.md): x',
    '- Video Models > Veo3.1 API [Veo3.1 Video Generation Callbacks](https://docs.kie.ai/veo3-api/generate-veo-3-video-callbacks.md): ',
  ].join('\n');
  assert.deepEqual(
    modelesKieDeLaDoc(doc).map((m) => [m.page, m.capacite]),
    [
      ['kling/v3-turbo-image-to-video', 'animation'],
      ['kling/motion-control-v3', 'mouvement'],
      ['google/nano-banana-edit', 'retouche'],
      ['google/imagen4', 'image'],
      ['elevenlabs/text-to-speech-turbo-2-5', 'voix'],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

test('une clé kie.ai que le service refuse (code 401 en HTTP 200) n’est pas rangée ; une bonne l’est, et une clé fal.ai rebranche fal.ai', async () => {
  const faux = reseau({ 'https://api.kie.ai/api/v1/chat/credit': (init) => json(String((init?.headers as any)?.Authorization).includes('bonne') ? { code: 200, msg: 'success', data: 1080 } : { code: 401, msg: 'Unauthorized' }) });
  try {
    const refus = await services.enregistrerService('kie', { cle: 'fausse' });
    assert.equal(refus.ok, false);
    const ok = await services.enregistrerService('kie', { cle: 'bonne-cle-1234' });
    assert.ok(ok.ok, JSON.stringify(ok));
  } finally {
    faux.rendre();
  }
  /* Une clé fal.ai au coffre le rebranche (rallumé le 11/11/2026) ; Higgsfield, sans clé, paraît sans être branché. */
  enregistrerAcces({ nom: 'Studio — fal.ai', type: 'cle-api', projectId: null, champs: { service: 'fal.ai', cle: 'cle-fal-XYZ', adresse: 'https://fal.ai' } });
  assert.ok(services.servicesDeGenerationBranches().includes('kie'));
  assert.ok(services.servicesDeGenerationBranches().includes('fal'));
  assert.ok(!services.servicesDeGenerationBranches().includes('higgsfield'));
  assert.ok(services.etatDesServices().some((s) => s.id === 'fal') && services.etatDesServices().some((s) => s.id === 'higgsfield'));
  assert.equal(services.etatDesServices().find((s) => s.id === 'kie')?.fin, '1234');
});

const projet = store.saveProject(Project.parse({ id: 'projet-kie', name: 'Atelier Kie', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
function carte(id: string, parcours: Record<string, unknown>) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'running',
      position: 1,
      title: `Pub ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `agent-${id}`,
      github: { branch: `tache/pub-${id}` },
      parcours: { plans: [], ...parcours },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(Agent.parse({ id: `agent-${id}`, projectId: projet.id, cardId: c.id, role: 'task', title: 'Agent', run: { engine: 'claude', model: 'opus' }, status: 'running', createdAt: store.now(), updatedAt: store.now() }));
  return c;
}
const ctx = (id: string) => ({ agentId: `agent-${id}`, projectId: projet.id, cardId: `carte-${id}` });
const cahier = (budget: string) => ({ comprehension: { texte: 'x', at: store.now(), cahierDesCharges: [{ titre: 'Budget et seuil', contenu: budget }] } });

test('un devis kie.ai donne son prix et le solde, part au clic et relève les crédits consommés', async () => {
  carte('kie', { realisationSouhaitee: true, ...cahier('Budget total : 5 $\nSeuil d’accord par génération : 1 $') });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c60000000049454e44ae426082', 'hex');
  const faux = reseau({
    'https://api.kie.ai/client/v1/model-pricing/page': () => json({ code: 200, data: { records: [{ modelDescription: 'Qwen z-image, text-to-image, 1.0s', creditPrice: '0.8', creditUnit: 'per image' }], pages: 1 } }),
    'https://api.kie.ai/api/v1/chat/credit': () => json({ code: 200, data: 1080 }),
    'https://api.kie.ai/api/v1/jobs/createTask': () => json({ code: 200, msg: 'success', data: { taskId: 'tache-1' } }),
    'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=tache-1': () => json({ code: 200, data: { state: 'success', resultJson: '{"resultUrls":["https://tempfile.kie.test/image.png"]}', creditsConsumed: 0.8 } }),
    'https://tempfile.kie.test/image.png': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
  try {
    const d = await realisation.realiser(ctx('kie'), { action: 'devis', service: 'kie', modele: 'z-image', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon', format: '9:16' });
    assert.ok(d.ok, d.text);
    assert.match(d.text, /🎬 Affiche ×2 — Z-Image \(kie\.ai\) — 0\.004 \$/);
    assert.match(d.text, /Solde kie\.ai : 1080 crédits/);
    const id = /« ([^ »]+) »/.exec(d.text)![1]!;
    const q = await realisation.realiser(ctx('kie'), { action: 'generer', devis: id }, attenteNulle);
    assert.ok(q.question, 'le devis se valide d’un clic');
    assert.equal(faux.appels.filter((a) => a.url.includes('/jobs/')).length, 0, 'aucune commande avant le clic');
    store.saveMessage(Message.parse({ id: 'm-reponse-kie', agentId: 'agent-kie', role: 'assistant', content: '', questions: [{ ...q.question, answer: 'Valider le devis' }], createdAt: store.now() }));
    const g = await realisation.realiser(ctx('kie'), { action: 'generer', devis: id }, attenteNulle);
    assert.ok(g.ok, g.text);
    const s = await realisation.realiser(ctx('kie'), { action: 'suivre', id }, attenteCourte);
    assert.ok(s.ok, s.text);
    const m = realisation.mediaParId(id)!;
    assert.equal(m.etat, 'fini');
    assert.equal(m.coutReel, 0.004, 'les crédits consommés deviennent le coût réel');
    assert.ok(m.fichier && fs.existsSync(m.fichier));
    const commande = faux.appels.find((a) => a.url === 'https://api.kie.ai/api/v1/jobs/createTask')!;
    assert.deepEqual(JSON.parse(String(commande.init?.body)), { model: 'z-image', input: { prompt: 'a poster', aspect_ratio: '9:16' } });
  } finally {
    faux.rendre();
  }
});

test('un solde kie.ai vide se dit au devis : aucun lot ne doit partir', async () => {
  carte('kie-vide', { realisationSouhaitee: true, ...cahier('Budget total : 5 $\nSeuil d’accord par génération : 1 $') });
  const faux = reseau({
    'https://api.kie.ai/client/v1/model-pricing/page': () => json({ code: 200, data: { records: [], pages: 1 } }),
    'https://api.kie.ai/api/v1/chat/credit': () => json({ code: 200, data: 0 }),
  });
  try {
    const d = await realisation.realiser(ctx('kie-vide'), { action: 'devis', service: 'kie', modele: 'z-image', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon' });
    assert.ok(d.ok, d.text);
    assert.match(d.text, /INSUFFISANT/);
    assert.match(d.text, /Lancement impossible en l’état/);
  } finally {
    faux.rendre();
  }
});

/*
 * LE MENU DES MODÈLES DE L'ENCART « GÉNÉRER » (01/11/2026, maquette #81ce) : une lecture sans frais donne les
 * modèles qui savent faire la génération, avec le prix total de chacun ; changer de modèle ne lance RIEN, réécrit
 * devis, lot et question d'un bloc, et refuse un prix qui a monté depuis l'affichage. La génération suivante du
 * même type repart du modèle utilisé, et un autre se signale dans l'encart.
 */
test('le menu des modèles d’une génération : prix de chacun, changement sans dépense, hausse refusée', async () => {
  carte('menu', { realisationSouhaitee: true });
  const faux = reseau({
    'https://api.kie.ai/client/v1/model-pricing/page': () => json({ code: 200, data: { records: [{ modelDescription: 'Qwen z-image, text-to-image, 1.0s', creditPrice: '0.8', creditUnit: 'per image' }], pages: 1 } }),
    'https://api.kie.ai/api/v1/chat/credit': () => json({ code: 200, data: 1080 }),
  });
  try {
    const d = await realisation.realiser(ctx('menu'), { action: 'devis', service: 'kie', modele: 'z-image', plan: 'Affiche', consigne: 'a poster', raison: 'brouillon', format: '9:16', variantes: 2 });
    assert.ok(d.ok, d.text);
    const ids = [...d.text.matchAll(/« ([^ »]+) »/g)].map((x) => x[1]!).filter((x) => realisation.mediaParId(x));
    assert.equal(ids.length, 2);
    const l = await realisation.realiser(ctx('menu'), { action: 'lot', devis_du_lot: ids, titre: 'Affiche' });
    assert.ok(l.ok && l.question?.devis?.bouton, l.text);
    const lotId = l.question!.devis!.lotId;
    store.saveMessage(Message.parse({ id: 'm-menu', agentId: 'agent-menu', role: 'assistant', content: '', questions: [l.question], createdAt: store.now() }));

    const menu = await realisation.modelesDuLot(lotId);
    assert.ok(menu.modeles.length > 1, JSON.stringify(menu));
    assert.equal(menu.modeles[0]!.modele, 'z-image', 'le modèle prévu est en tête');
    assert.ok(menu.modeles[0]!.actuel);
    assert.equal(menu.modeles[0]!.prix, 0.008, 'deux brouillons à 0,004 $');
    const autre = menu.modeles.find((m) => !m.actuel)!;
    assert.ok(modelesProposes(['kie', 'fal', 'higgsfield'], 'image').some((m: any) => m.id === autre.modele), 'seuls des modèles d’image des services branchés');

    const change = await realisation.changerLeModeleDuLot({ messageId: 'm-menu', questionId: l.question!.id, service: autre.service, modele: autre.modele, prixVu: autre.prix });
    assert.ok(change.ok, JSON.stringify(change));
    for (const id of ids) {
      const m = realisation.mediaParId(id)!;
      assert.equal(m.modele, autre.modele, 'chaque brouillon passe au modèle choisi');
      assert.equal(m.etat, 'devis', 'rien n’est lancé');
    }
    const q = store.getMessage('m-menu')!.questions[0]!;
    assert.match(q.description ?? '', new RegExp(autre.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(q.answer, undefined, 'la question attend toujours le clic');
    assert.equal(faux.appels.filter((a: any) => String(a.url ?? a).includes('/jobs/')).length, 0, 'aucune commande au service');

    /* Revenir à z-image avec un prix vu plus bas : refusé, le prix à jour est rendu. */
    const hausse = await realisation.changerLeModeleDuLot({ messageId: 'm-menu', questionId: l.question!.id, service: 'kie', modele: 'z-image', prixVu: 0.001 });
    assert.equal(hausse.ok, false);
    assert.equal((hausse as any).prix, 0.008);
    assert.match((hausse as any).raison, /a monté/);
    assert.equal(realisation.mediaParId(ids[0]!)!.modele, autre.modele, 'un refus ne change rien');

    /* Une génération tranchée n'a plus de menu, et ne change plus. */
    store.saveMessage(Message.parse({ ...store.getMessage('m-menu')!, questions: [{ ...q, answer: 'Refuser' }] }));
    const apres = await realisation.changerLeModeleDuLot({ messageId: 'm-menu', questionId: l.question!.id, service: 'kie', modele: 'z-image', prixVu: 0.008 });
    assert.equal(apres.ok, false);
  } finally {
    faux.rendre();
  }
});
