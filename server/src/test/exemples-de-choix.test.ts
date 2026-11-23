import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'exemples-de-choix-'));
process.env.BELUGA_DATA = bacASable;

const { ENVELOPPE_DES_EXEMPLES, PREFIXE_DES_APERCUS, PREFIXE_DES_EXEMPLES, decisionDApercu, estUnApercu, couperLaConsigne, LONGUEUR_MAX_CONSIGNE_DES_APERCUS } = await import('@beluga/shared');
const { pistesLues, formuleDeCodex, fabriquerLesExemples, limiteDeCodex, comptesCodexPourLesImages, raisonCodexASec, raisonCourteDuServiceExterne } = await import('../exemples-de-choix.js');
const { fabriquerUnApercu } = await import('../realisation.js');

test('les pistes sont bornées à quatre et gardent leur titre', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ titre: `Piste ${i}`, html: '<p>x</p>' }));
  assert.equal(pistesLues(six).length, 4);
  assert.deepEqual(pistesLues([{ titre: '' }, { label: 'Vert franc' }]).map((p) => p.titre), ['Vert franc']);
});

test('la formule de Codex se lit dans son fichier de connexion, sans jamais jeter', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  assert.equal(formuleDeCodex(dossier), null);
  const charge = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url');
  fs.writeFileSync(path.join(dossier, 'auth.json'), JSON.stringify({ tokens: { id_token: `x.${charge}.y` } }));
  assert.equal(formuleDeCodex(dossier), 'plus');
});

test('l’enveloppe des exemples est de 1 $ par carte, à part de celle du mode caméra', () => {
  assert.equal(ENVELOPPE_DES_EXEMPLES, 1);
  assert.ok(PREFIXE_DES_EXEMPLES.startsWith(PREFIXE_DES_APERCUS), 'un exemple payant reste un aperçu, jamais un média du suivi');
  assert.ok(estUnApercu(`${PREFIXE_DES_EXEMPLES}1`));
  assert.equal(decisionDApercu({ enveloppe: ENVELOPPE_DES_EXEMPLES, prix: 0.004, depense: 0.998 }).verdict, 'refus');
  assert.notEqual(decisionDApercu({ enveloppe: ENVELOPPE_DES_EXEMPLES, prix: 0.004, depense: 0.2 }).verdict, 'refus');
});

test('sans carte, aucun exemple payant ne part', async () => {
  const r = await fabriquerUnApercu({ agentId: 'a', projectId: 'p' } as any, { consigne: 'un chat' }, undefined, { exemple: true });
  assert.equal(r.ok, false);
  assert.match(r.text, /sans carte/i);
});

test('une nature inconnue ou des pistes vides sont refusées en clair', async () => {
  assert.match((await fabriquerLesExemples({ agentId: 'a', projectId: 'p' }, { nature: 'film', pistes: [{ titre: 'x' }] })).text, /« nature »/);
  assert.match((await fabriquerLesExemples({ agentId: 'a', projectId: 'p' }, { nature: 'page', pistes: [] })).text, /« pistes »/);
});

test('le dernier lot d’exemples d’un agent est retenu, remplacé, puis oublié', async () => {
  const { lotDExemplesEnAttente, retenirLeLot, oublierLeLot } = await import('../exemples-de-choix.js');
  assert.equal(lotDExemplesEnAttente('agent-lot'), undefined);
  retenirLeLot('agent-lot', { champ: 'image', pieces: [{ id: 'p1', lettre: 'A', titre: 'Rond' }] });
  retenirLeLot('agent-lot', { champ: 'media', pieces: [{ id: 'p2', lettre: 'A', titre: 'Grave' }] });
  assert.deepEqual(lotDExemplesEnAttente('agent-lot')?.pieces.map((p) => p.id), ['p2']);
  assert.equal(lotDExemplesEnAttente('autre-agent'), undefined);
  retenirLeLot('agent-lot', { champ: 'image', pieces: [] });
  assert.equal(lotDExemplesEnAttente('agent-lot'), undefined, 'un lot sans pièce réussie n’oblige à rien');
  retenirLeLot('agent-lot', { champ: 'image', pieces: [{ id: 'p3', lettre: 'A', titre: 'x' }] });
  oublierLeLot('agent-lot');
  assert.equal(lotDExemplesEnAttente('agent-lot'), undefined);
});

test('la limite d’usage de Codex se reconnaît même sortie sans erreur, avec sa date de reprise', () => {
  const sortie = "ERROR: You've hit your usage limit. Upgrade to Pro, or try again at Nov 9th, 2026 6:01 PM.";
  const limite = limiteDeCodex(sortie, new Date('2026-11-05T10:00:00'));
  assert.ok(limite);
  assert.equal(new Date(limite!.reprise!).getDate(), 9);
  assert.equal(new Date(limite!.reprise!).getMonth(), 10);
  assert.deepEqual(limiteDeCodex('{"error":"usage_limit_reached"}'), { reprise: null });
  assert.equal(limiteDeCodex('image écrite'), null);
  assert.match(raisonCodexASec([limite!]), /^Codex : quota épuisé jusqu’au 9 nov/);
  assert.equal(raisonCodexASec([{ reprise: null }, { reprise: null }]), 'Codex : quotas épuisés');
});

test('l’image passe au compte Codex suivant quand le premier est à sec, sans rappeler un compte connu à sec', () => {
  const maintenant = Date.parse('2026-11-05T10:00:00Z');
  const comptes = [
    { id: 'codex-3', engine: 'codex', priority: 20, configDir: '/c3' },
    { id: 'codex-principal', engine: 'codex', priority: 10, configDir: '/c1' },
    { id: 'codex-off', engine: 'codex', priority: 5, configDir: '/c0', disabled: true },
    { id: 'claude', engine: 'claude', priority: 1, configDir: '/cl' },
  ];
  const plein = { usedPct: 100, resetsAt: maintenant + 86_400_000 };
  const r = comptesCodexPourLesImages(comptes, [{ id: 'codex-principal', weekly: plein }], new Map(), maintenant);
  assert.deepEqual(r.utilisables.map((c) => c.id), ['codex-3']);
  assert.deepEqual(r.aSec, [{ id: 'codex-principal', reprise: plein.resetsAt }]);
  const passe = comptesCodexPourLesImages(comptes, [{ id: 'codex-principal', weekly: { usedPct: 100, resetsAt: maintenant - 1 } }], new Map(), maintenant);
  assert.deepEqual(passe.utilisables.map((c) => c.id), ['codex-principal', 'codex-3'], 'une remise à zéro passée rend le compte');
  const connu = comptesCodexPourLesImages(comptes, [], new Map([['codex-3', maintenant + 1000]]), maintenant);
  assert.deepEqual(connu.utilisables.map((c) => c.id), ['codex-principal']);
});

test('la consigne d’un aperçu tient dans les 1000 signes du modèle, coupée à la fin d’une phrase', () => {
  assert.equal(LONGUEUR_MAX_CONSIGNE_DES_APERCUS, 1000);
  assert.equal(couperLaConsigne('court.'), 'court.');
  const longue = `${'A calm studio scene with soft light. '.repeat(40)}`;
  const coupee = couperLaConsigne(longue);
  assert.ok(coupee.length <= 1000);
  assert.ok(coupee.endsWith('.'));
  assert.ok(couperLaConsigne('x'.repeat(1500)).length <= 1000);
});

test('un refus du service externe se dit en une raison courte', () => {
  assert.equal(raisonCourteDuServiceExterne('L’aperçu a échoué : crédit de votre compte kie.ai épuisé.'), 'service externe : crédit épuisé');
  assert.equal(raisonCourteDuServiceExterne('500 text length cannot exceed the maximum limit'), 'service externe : consigne trop longue');
  assert.equal(raisonCourteDuServiceExterne('quelque chose'), 'service externe : échec');
});

test('un exemple raté ne laisse aucun bloc dans le fil, sa raison reste pour l’agent (23/11/2026)', async () => {
  const { mediasEnFabrication } = await import('../medias-en-fabrication.js');
  const r = await fabriquerLesExemples({ agentId: 'agent-exemple-rate', projectId: 'p' }, { nature: 'image', pistes: [{ titre: 'Sans consigne' }] });
  assert.equal(r.ok, false);
  assert.match(r.text, /A « Sans consigne » : échec — il manque « consigne »/);
  assert.equal(mediasEnFabrication().filter((m) => m.agentId === 'agent-exemple-rate').length, 0, 'aucune tuile d’échec');
});
