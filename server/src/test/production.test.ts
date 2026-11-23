import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE SOCLE DU STUDIO CRÉATIF (carte 1 sur 5, 24/10/2026).
 *
 *  - les règles pures : éléments versionnés, total et décision d'un lot, porte
 *    de génération, réservation, services à proposer, étapes du volet ;
 *  - le démon : un lot est une LISTE FERMÉE validée d'un clic ; réservation
 *    avant l'appel, débit au résultat, libération à l'échec ; deux « generer »
 *    simultanés ou une reprise ne lancent qu'UN appel ; le budget ne se
 *    dépasse jamais ; « noter » garde les versions ; « brancher » pose la
 *    question avec son encadré ; l'état se relit sans la conversation.
 *
 * Aucun appel réel : le réseau est piégé, tout appel inattendu fait échouer.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'production-'));
process.env.BELUGA_DATA = bacASable;
// Aucun modèle de traduction dans le bac à sable : la consigne passe telle quelle.
process.env.BELUGA_TRADUCTION_IDENTITE = "1";
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
const {
  Agent,
  Card,
  Message,
  Project,
  cleDElement,
  elementsCourants,
  totalDuLot,
  decisionDuLot,
  porteDeGeneration,
  reservationPossible,
  lotValideParLaReponse,
  questionDuLotDeDevis,
  servicesPourLesCapacites,
  capacitesDesTypes,
  capacitesSansService,
  catalogueDeGeneration,
  etapesDeLaProduction,
  etapesDuSuivi,
  etapeDuMedia,
  AgentQuestion,
} = shared;
/* fal.ai et Higgsfield sont CACHÉS depuis le 25/10/2026 (kie.ai les remplace),
   mais leur chaîne reste éprouvée : ces tests la rallument pour eux-mêmes. */
shared.fixerLesServicesCaches([]);
const store = await import('../store.js');
const { enregistrerAcces } = await import('../coffre-fort.js');
const realisation = await import('../realisation.js');
const production = await import('../production.js');

realisation.RYTHME_REALISATION.pauseMs = 1;
const attenteNulle = async () => {};
const attenteCourte = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 3000)));

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

test('un élément garde une clé stable et ses versions ; la courante est la plus récente', () => {
  assert.equal(cleDElement('Plan 2 — Arrivée du héros', 'plan'), 'plan-2-arrivee-du-heros');
  assert.equal(cleDElement('', 'brief'), 'brief');
  const base = { cardId: 'c', projectId: 'p', genre: 'plan' as const, titre: 't', contenu: 'x', parent: null };
  const courants = elementsCourants([
    { ...base, id: '1', cle: 'plan-1', version: 1, etat: 'remplace', creeLe: 1 },
    { ...base, id: '2', cle: 'plan-2', version: 1, etat: 'propose', creeLe: 2 },
    { ...base, id: '3', cle: 'plan-1', version: 2, etat: 'a-valider', creeLe: 3 },
  ]);
  assert.deepEqual(courants.map((e) => e.id), ['3', '2']);
});

test('un lot : son total, sa décision, sa porte, sa réservation — en dollars, sans « libre »', () => {
  assert.deepEqual(totalDuLot([{ prix: 0.5 }, { prix: null }, { prix: 0.25 }]), { connu: 0.75, sansPrix: 1 });
  assert.equal(decisionDuLot({ total: 1, budget: null, depense: 0 }).verdict, 'refus');
  assert.equal(decisionDuLot({ total: 3, budget: 5, depense: 2.5 }).verdict, 'refus');
  assert.equal(decisionDuLot({ total: 0.1, budget: 5, depense: 0 }).verdict, 'a-valider', 'même un petit lot se valide d’un clic');
  const op = (mediaId: string, etat: any) => ({ id: `o-${mediaId}`, lotId: 'l', mediaId, plan: 'p', service: 'fal', modeleNom: 'm', capacite: 'image', prix: 1, etat, montantReserve: 0, montantDebite: null, cle: 'k', majLe: 0 });
  assert.equal(porteDeGeneration(null, 'a'), 'hors-lot');
  assert.equal(porteDeGeneration({ etat: 'valide', operations: [op('a', 'prevue')] }, 'b'), 'hors-lot', 'hors de la liste fermée');
  assert.equal(porteDeGeneration({ etat: 'propose', operations: [op('a', 'prevue')] }, 'a'), 'attente');
  assert.equal(porteDeGeneration({ etat: 'refuse', operations: [op('a', 'prevue')] }, 'a'), 'refuse');
  assert.equal(porteDeGeneration({ etat: 'valide', operations: [op('a', 'reservee')] }, 'a'), 'deja');
  assert.equal(porteDeGeneration({ etat: 'valide', operations: [op('a', 'debitee')] }, 'a'), 'deja');
  assert.equal(porteDeGeneration({ etat: 'valide', operations: [op('a', 'liberee')] }, 'a'), 'liberee');
  assert.equal(porteDeGeneration({ etat: 'valide', operations: [op('a', 'prevue')] }, 'a'), 'partir');
  assert.equal(reservationPossible({ montant: 1, budget: 2, depense: 1 }).ok, true);
  assert.equal(reservationPossible({ montant: 1.01, budget: 2, depense: 1 }).ok, false);
  assert.equal(lotValideParLaReponse('Valider le devis'), true);
  assert.equal(lotValideParLaReponse('Refuser'), false);
  const q = questionDuLotDeDevis({ lotId: 'l', titre: 'Plans finaux', lignes: [{ plan: 'P1', modele: 'Kling', service: 'fal.ai', prix: 0.4 }, { plan: 'Voix', modele: 'V', service: 'ElevenLabs', prix: null }], budget: 10, depense: 1 });
  assert.match(q.question, /Valider le devis « Plans finaux » \(0\.4 \$ \+ 1 ligne au prix non publié\)/);
  assert.deepEqual(q.options.map((o) => o.label), ['Valider le devis', 'Refuser']);
  assert.equal(q.devis.total, 0.4);
  assert.doesNotMatch(JSON.stringify(q), /€|EUR|CHF/, 'jamais une autre monnaie');
  // La question garde son bloc « Devis » une fois passée au schéma.
  assert.equal(AgentQuestion.parse({ id: 'x', question: q.question, options: [], devis: q.devis }).devis?.lignes.length, 2);
});

test('les services à proposer : kie.ai en tête (puis fal.ai et Higgsfield s’ils sont rallumés), les autres ensuite', () => {
  const video = servicesPourLesCapacites(['video'], catalogueDeGeneration());
  assert.equal(video[0]!.id, 'kie');
  assert.equal(video[0]!.rang, 'recommande');
  assert.equal(video[1]!.id, 'fal');
  assert.equal(video[2]!.id, 'higgsfield');
  assert.equal(video[2]!.rang, 'economique');
  assert.ok(video.slice(3).every((s) => s.rang === 'autre'));
  const image = servicesPourLesCapacites(['image'], catalogueDeGeneration());
  assert.equal(image[0]!.id, 'kie');
  assert.ok(!image.some((s) => s.id === 'higgsfield'), 'Higgsfield ne fait pas d’image');
  const voix = servicesPourLesCapacites(['voix'], catalogueDeGeneration());
  assert.ok(voix.some((s) => s.id === 'elevenlabs'));
  /* Une vidéo comprend tout : images des plans, animation, voix, musique, bruitages. */
  assert.deepEqual(capacitesDesTypes(['video']), ['image', 'video', 'voix', 'musique', 'son']);
  assert.deepEqual(capacitesDesTypes(['video', 'bruitages']), ['image', 'video', 'voix', 'musique', 'son']);
  assert.deepEqual(capacitesDesTypes(['son']), ['voix', 'musique', 'son']);
  assert.deepEqual(capacitesSansService(['video', 'image'], ['image']), ['video']);
});

test('les étapes du volet s’adaptent : huit pour une vidéo, quatre pour une image, quatre pour un son', () => {
  assert.deepEqual(etapesDeLaProduction(['video', 'voix']), ['brief', 'direction', 'scenario', 'storyboard', 'plans', 'son', 'montage', 'export']);
  assert.deepEqual(etapesDeLaProduction(['image']), ['brief', 'style', 'creation', 'livraison']);
  assert.deepEqual(etapesDeLaProduction(['musique']), ['brief', 'ecriture', 'creation-sonore', 'livraison']);
  assert.deepEqual(etapesDeLaProduction([]), ['brief']);
  const etapes = etapesDeLaProduction(['video']);
  assert.equal(etapeDuMedia({ plan: 'apercu-direction-1', capacite: 'image', service: 'fal', etape: null }, etapes), 'direction');
  /* L'aperçu d'un plan est une image clé : il va avec le storyboard (25/10/2026). */
  assert.equal(etapeDuMedia({ plan: 'apercu-plans-1', capacite: 'image', service: 'fal', etape: null }, etapes), 'storyboard');
  assert.equal(etapeDuMedia({ plan: 'Voix off', capacite: 'voix', service: 'elevenlabs', etape: null }, etapes), 'son');
  assert.equal(etapeDuMedia({ plan: 'P1', capacite: 'video', service: 'fal', etape: null }, etapes), 'plans');
  assert.equal(etapeDuMedia({ plan: 'P1', capacite: 'image', service: 'fal', etape: 'storyboard' }, etapes), 'storyboard');
  assert.equal(etapeDuMedia({ plan: 'P1', capacite: 'image', service: 'fal', etape: null }, etapesDeLaProduction(['image'])), 'creation');
});

test('les états du volet suivent la carte et la base, jamais les messages', () => {
  // Questionnaire au scénario : brief en cours, scénario en cours, le reste à définir.
  const q = etapesDuSuivi({ column: 'planned', realisation: { medias: ['video'], phase: 'scenario', demandeA: 1 } });
  const etat = (v: typeof q, e: string) => v.find((x) => x.etape === e)!.etat;
  assert.equal(etat(q, 'brief'), 'en-cours');
  assert.equal(etat(q, 'scenario'), 'en-cours');
  assert.equal(etat(q, 'direction'), 'a-definir');
  assert.equal(etat(q, 'plans'), 'a-definir');
  // Phase « plans » : scénario et direction validés, storyboard en cours.
  const p = etapesDuSuivi({ column: 'planned', realisation: { medias: ['video'], phase: 'plans' } });
  assert.equal(etat(p, 'scenario'), 'validee');
  assert.equal(etat(p, 'direction'), 'validee');
  assert.equal(etat(p, 'storyboard'), 'en-cours');
  // Au travail : un lot en attente → à valider ; un plan en cours ; un plan raté puis refait.
  const media = (id: string, plan: string, etat: any, creeLe: number) => ({ id, plan, version: 1, capacite: 'video', genre: 'video' as const, service: 'fal', etape: null, etat, attachmentId: null, prix: 1, creeLe });
  const lot = { etape: 'plans', etat: 'propose' as const, operations: [] };
  const t1 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, lots: [lot] });
  assert.equal(etat(t1, 'brief'), 'validee');
  assert.equal(etat(t1, 'plans'), 'a-valider');
  const t2 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, medias: [media('a', 'P1', 'en-cours', 1)] });
  assert.equal(etat(t2, 'plans'), 'en-cours');
  assert.equal(t2.find((x) => x.etape === 'plans')!.medias.length, 0, 'une création en cours vit dans le fil : le suivi ne montre que le retenu');
  const t3 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, medias: [media('a', 'P1', 'echec', 1)] });
  assert.equal(etat(t3, 'plans'), 'erreur');
  const t4 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, medias: [media('a', 'P1', 'echec', 1), media('b', 'P1', 'fini', 2)] });
  assert.equal(etat(t4, 'plans'), 'a-valider', 'fini mais rien d’ajouté au suivi : l’utilisateur doit choisir');
  assert.equal(t4.find((x) => x.etape === 'plans')!.medias.length, 0);
  // AJOUTÉ AU SUIVI (24/10/2026) : le média paraît sous son étape, qui est faite.
  const t4bis = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, medias: [media('a', 'P1', 'echec', 1), { ...media('b', 'P1', 'fini', 2), retenuLe: 3 }] });
  assert.equal(etat(t4bis, 'plans'), 'terminee', 'le dernier essai d’un plan juge l’étape');
  assert.deepEqual(t4bis.find((x) => x.etape === 'plans')!.medias.map((m) => m.id), ['b'], 'seul le retenu paraît dans le suivi');
  // EN CONCEPTION (25/10/2026) : le fini pas encore retenu (avec sa pièce) se montre à part, l'échec non.
  const t4ter = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, medias: [media('a', 'P1', 'echec', 1), { ...media('b', 'P1', 'fini', 2), attachmentId: 'pj-b' }] });
  assert.deepEqual(t4ter.find((x) => x.etape === 'plans')!.enConception.map((m) => m.id), ['b']);
  assert.deepEqual(t4bis.find((x) => x.etape === 'plans')!.enConception, [], 'un média retenu n’est plus « en conception »');
  assert.equal(etat(t4, 'montage'), 'a-definir');
  const t5 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1, montageA: 5 } });
  assert.equal(etat(t5, 'montage'), 'en-cours');
  const t6 = etapesDuSuivi({ column: 'review', realisation: { medias: ['video'], termineA: 1 } });
  assert.equal(etat(t6, 'export'), 'terminee');
  // Un élément soumis à l'utilisateur l'emporte sur le questionnaire.
  const el = { id: 'e', cardId: 'c', projectId: 'p', genre: 'script' as const, cle: 'script', version: 1, titre: 'Scénario', contenu: '…', etat: 'a-valider' as const, parent: null, creeLe: 1 };
  const t7 = etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, elements: [el] });
  assert.equal(etat(t7, 'scenario'), 'a-valider');
  assert.equal(t7.find((x) => x.etape === 'scenario')!.elements[0]!.titre, 'Scénario');
});

/* ------------------------------------------------------------------ */
/* Le démon                                                             */
/* ------------------------------------------------------------------ */

const projet = store.saveProject(Project.parse({ id: 'projet-prod', name: 'Atelier Prod', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function carte(id: string, budget = 'Budget total : 1 $\nSeuil d’accord par génération : 1 $', realisation: Record<string, unknown> = {}) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'running',
      position: 1,
      title: `Prod ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `agent-${id}`,
      github: { branch: `tache/prod-${id}` },
      parcours: { plans: [], realisationSouhaitee: true, comprehension: { texte: 'x', at: store.now(), cahierDesCharges: [{ titre: 'Budget et seuil', contenu: budget }] } },
      ...(Object.keys(realisation).length ? { realisation } : {}),
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
  store.saveMessage(Message.parse({ id: `m-prod-${rang}`, agentId, role: 'assistant', content: '', questions: [{ ...question, answer }], createdAt: store.now() }));
}

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
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c60000000049454e44ae426082', 'hex');

const r = enregistrerAcces({ nom: 'Studio — fal.ai', type: 'cle-api', projectId: null, champs: { service: 'fal.ai', cle: 'cle-fal-ABCDEFGH1234', adresse: 'https://exemple.test' } });
assert.ok(r.ok);

/** Le faux fal.ai : prix publié 0,4 $, chaque soumission compte. */
function falFactice(opts: { echec?: boolean; lent?: Promise<void> } = {}) {
  let soumissions = 0;
  const faux = reseau({
    'https://api.fal.ai/v1/models/pricing': () => json({ prices: [{ endpoint_id: 'fal-ai/flux-pro/v1.1-ultra', unit_price: 0.4, unit: 'image' }] }),
    'https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra': async () => {
      soumissions += 1;
      if (opts.lent) await opts.lent;
      return json({ status_url: `https://queue.fal.run/etat/${soumissions}`, response_url: `https://queue.fal.run/resultat/${soumissions}` });
    },
    'https://queue.fal.run/etat/': () => json(opts.echec ? { status: 'COMPLETED', error: 'refus du modèle' } : { status: 'COMPLETED' }),
    'https://queue.fal.run/resultat/': () => json({ images: [{ url: 'https://cdn.fal.test/image.png' }] }),
    'https://cdn.fal.test/image.png': () => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }),
  });
  return { ...faux, soumissions: () => soumissions };
}

async function devis(id: string, plan: string, etape?: string): Promise<string> {
  return (await variantes(id, plan, etape))[0]!;
}

/** Les identifiants des 2 à 4 brouillons d'une même génération (une création de média en fait toujours au moins deux). */
async function variantes(id: string, plan: string, etape?: string): Promise<string[]> {
  const d = await realisation.realiser(ctx(id), { action: 'devis', service: 'fal', modele: 'fal-ai/flux-pro/v1.1-ultra', plan, consigne: 'a hero', raison: 'photo réaliste', ...(etape ? { etape } : {}) });
  assert.ok(d.ok, d.text);
  return [...d.text.split('\n')[0]!.matchAll(/« ([^ »]+) »/g)].map((m) => m[1]!);
}

test('une génération = un lot de ses variantes : une question à bouton, un clic, puis seules ses opérations partent ; jamais deux plans ensemble', async () => {
  carte('lot');
  const faux = falFactice();
  try {
    const [a, b] = await variantes('lot', 'Plan 1', 'plans');
    assert.ok(a && b, 'deux brouillons au moins');
    const autre = await devis('lot', 'Plan 2', 'plans');
    const melange = await realisation.realiser(ctx('lot'), { action: 'lot', devis_du_lot: [a, autre], titre: 'Mélange' });
    assert.equal(melange.ok, false, 'un lot ne mêle jamais deux plans');
    const hors = await devis('lot', 'Plan 3', 'plans');
    const q = await realisation.realiser(ctx('lot'), { action: 'lot', devis_du_lot: [a, b], titre: 'Plan 1', etape: 'plans' });
    assert.ok(q.question?.devis?.bouton, q.text);
    assert.equal(q.question!.devis!.lignes.length, 2);
    assert.equal(q.question!.devis!.total, 0.8);
    // Avant le clic, rien ne part.
    const avant = await realisation.realiser(ctx('lot'), { action: 'generer', devis: a }, attenteNulle);
    assert.match(avant.text, /attend la réponse/);
    assert.equal(faux.soumissions(), 0);
    // Le volet voit l'étape « Plans » à valider.
    const etat = realisation.etatDeProductionDeLaCarte('carte-lot');
    assert.equal(etapesDuSuivi({ column: 'running', realisation: { medias: ['video'], termineA: 1 }, ...etat }).find((x) => x.etape === 'plans')!.etat, 'a-valider');
    repondre('agent-lot', q.question, 'Générer');
    const lot = q.question!.devis!.lotId;
    const g = await realisation.realiser(ctx('lot'), { action: 'generer', lot }, attenteNulle);
    assert.ok(g.ok, g.text);
    await realisation.realiser(ctx('lot'), { action: 'suivre', id: a }, attenteCourte);
    await realisation.realiser(ctx('lot'), { action: 'suivre', id: b }, attenteCourte);
    assert.equal(faux.soumissions(), 2);
    const lu = production.lotParId(lot)!;
    assert.equal(lu.etat, 'valide');
    assert.deepEqual(lu.operations.map((o) => o.etat), ['debitee', 'debitee']);
    assert.equal(realisation.depenseDeLaCarte('carte-lot'), 0.8);
    // Hors de la liste fermée : un nouveau bouton à prix, jamais un appel.
    const h = await realisation.realiser(ctx('lot'), { action: 'generer', devis: hors }, attenteNulle);
    assert.ok(h.question?.devis?.bouton, h.text);
    assert.equal(faux.soumissions(), 2, 'aucun appel hors lot');
  } finally {
    faux.rendre();
  }
});

test('deux « generer » simultanés et une reprise ne lancent qu’UN appel, et ne réservent qu’une fois', async () => {
  carte('simultane', 'Budget total : 5 $\nSeuil d’accord par génération : 1 $');
  let lacher!: () => void;
  const lent = new Promise<void>((r) => (lacher = r));
  const faux = falFactice({ lent });
  try {
    const a = await devis('simultane', 'Plan A');
    const q = await realisation.realiser(ctx('simultane'), { action: 'lot', devis_du_lot: [a], titre: 'Essai' });
    repondre('agent-simultane', q.question, 'Générer');
    const [g1, g2] = await Promise.all([
      realisation.realiser(ctx('simultane'), { action: 'generer', devis: a }, attenteNulle),
      realisation.realiser(ctx('simultane'), { action: 'generer', devis: a }, attenteNulle),
    ]);
    assert.ok(g1.ok && g2.ok);
    assert.ok([g1.text, g2.text].some((t) => /déjà lancé/.test(t)), 'le second voit le premier');
    // La reprise réseau de l'agent : le même appel, encore.
    const g3 = await realisation.realiser(ctx('simultane'), { action: 'generer', devis: a }, attenteNulle);
    assert.match(g3.text, /déjà lancé/);
    lacher();
    await realisation.realiser(ctx('simultane'), { action: 'suivre', id: a }, attenteCourte);
    assert.equal(faux.soumissions(), 1, 'un seul appel payant');
    assert.equal(realisation.depenseDeLaCarte('carte-simultane'), 0.4);
    const g4 = await realisation.realiser(ctx('simultane'), { action: 'generer', devis: a }, attenteNulle);
    assert.equal(g4.ok, false, 'un devis fabriqué ne repart pas');
    assert.equal(faux.soumissions(), 1);
  } finally {
    faux.rendre();
  }
});

test('plus de budget : chaque lot accepté d’un clic part, et rien d’autre ; ce qui est accepté se relit', async () => {
  carte('budget', 'Budget total : 0.5 $\nSeuil d’accord par génération : 1 $');
  const faux = falFactice();
  try {
    const a = await devis('budget', 'Plan A');
    const b = await devis('budget', 'Plan B');
    const qa = await realisation.realiser(ctx('budget'), { action: 'lot', devis_du_lot: [a], titre: 'A' });
    const qb = await realisation.realiser(ctx('budget'), { action: 'lot', devis_du_lot: [b], titre: 'B' });
    assert.ok(qa.question && qb.question);
    assert.equal(realisation.totalDesLotsAcceptes('carte-budget'), 0, 'rien d’accepté avant les clics');
    repondre('agent-budget', qa.question, 'Générer');
    repondre('agent-budget', qb.question, 'Générer');
    const [ga, gb] = await Promise.all([
      realisation.realiser(ctx('budget'), { action: 'generer', devis: a }, attenteNulle),
      realisation.realiser(ctx('budget'), { action: 'generer', devis: b }, attenteNulle),
    ]);
    assert.ok(ga.ok && gb.ok, `${ga.text} / ${gb.text}`);
    assert.equal(realisation.totalDesLotsAcceptes('carte-budget'), 0.8, 'l’ancien budget du cahier ne compte plus');
    await realisation.realiser(ctx('budget'), { action: 'suivre', id: a }, attenteCourte);
    await realisation.realiser(ctx('budget'), { action: 'suivre', id: b }, attenteCourte);
    assert.equal(realisation.depenseDeLaCarte('carte-budget'), 0.8);
    assert.equal(faux.soumissions(), 2);
  } finally {
    faux.rendre();
  }
});

test('une génération ratée libère sa réservation ; un lot refusé ferme ses devis sans appel', async () => {
  carte('echec', 'Budget total : 5 $\nSeuil d’accord par génération : 1 $');
  const faux = falFactice({ echec: true });
  try {
    const a = await devis('echec', 'Plan A');
    const q = await realisation.realiser(ctx('echec'), { action: 'lot', devis_du_lot: [a], titre: 'Essai' });
    repondre('agent-echec', q.question, 'Valider le devis');
    await realisation.realiser(ctx('echec'), { action: 'generer', devis: a }, attenteNulle);
    const s = await realisation.realiser(ctx('echec'), { action: 'suivre', id: a }, attenteCourte);
    assert.equal(s.ok, false);
    assert.equal(production.operationDuMedia(a)!.etat, 'liberee');
    assert.equal(realisation.depenseDeLaCarte('carte-echec'), 0, 'rien n’est retenu sur le budget');
    const b = await devis('echec', 'Plan B');
    const qb = await realisation.realiser(ctx('echec'), { action: 'lot', devis_du_lot: [b], titre: 'Refusé' });
    repondre('agent-echec', qb.question, 'Refuser');
    const appels = faux.soumissions();
    const g = await realisation.realiser(ctx('echec'), { action: 'generer', devis: b }, attenteNulle);
    assert.equal(g.ok, false);
    assert.equal(realisation.mediaParId(b)!.etat, 'refuse');
    assert.equal(faux.soumissions(), appels);
    const approbations = (await import('../db.js')).getDb().prepare("SELECT decision FROM production_approbations WHERE card_id = 'carte-echec' ORDER BY at").all() as { decision: string }[];
    assert.deepEqual(approbations.map((x) => x.decision), ['valide', 'refuse']);
  } finally {
    faux.rendre();
  }
});

test('« noter » garde chaque version ; l’état se relit sans la conversation', async () => {
  carte('noter');
  const v1 = await realisation.realiser(ctx('noter'), { action: 'noter', genre: 'plan', cle: 'plan-2', titre: 'Plan 2', contenu: 'Le héros arrive.' });
  assert.ok(v1.ok, v1.text);
  const v2 = await realisation.realiser(ctx('noter'), { action: 'noter', genre: 'plan', cle: 'plan-2', titre: 'Plan 2', contenu: 'Le héros arrive de nuit.', etat: 'a-valider' });
  assert.match(v2.text, /v2/);
  assert.match(v2.text, /précédente est gardée/);
  const etat = realisation.etatDeProductionDeLaCarte('carte-noter');
  assert.equal(etat.elements.length, 2);
  assert.deepEqual(etat.elements.map((e) => e.etat), ['remplace', 'a-valider']);
  assert.equal(elementsCourants(etat.elements)[0]!.contenu, 'Le héros arrive de nuit.');
  const refus = await realisation.realiser(ctx('noter'), { action: 'noter', genre: 'inconnu', titre: 'x', contenu: 'y' });
  assert.equal(refus.ok, false);
});

test('« brancher » : déjà branché le dit ; sinon la question porte son encadré et propose fal.ai', async () => {
  carte('brancher', 'Budget total : 5 $\nSeuil d’accord par génération : 1 $', { medias: ['video', 'voix'], faites: 0, total: 0, phase: 'intention', restants: [] });
  const deja = await realisation.realiser(ctx('brancher'), { action: 'brancher', capacites: ['image'] });
  assert.ok(deja.ok && !deja.question, 'fal.ai fait déjà les images');
  // Une vidéo comprend tout (24/10/2026) : fal.ai fait l'image, la vidéo et la voix ; il manque la musique et les bruitages.
  const q = await realisation.realiser(ctx('brancher'), { action: 'brancher' });
  assert.ok(q.question, q.text);
  assert.deepEqual(q.question!.branchement?.capacites, ['musique', 'son']);
  assert.match(q.question!.question, /musique/);
  assert.deepEqual(q.question!.options.map((o) => o.label), ['Continuer sans brancher']);
  assert.doesNotMatch(JSON.stringify(q.question), /cle-fal/, 'aucune clé dans la question');
  const modeles = await realisation.realiser(ctx('brancher'), { action: 'modeles', capacite: 'musique' });
  assert.match(modeles.text, /« brancher »/);
});
