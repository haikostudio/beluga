import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Les moteurs AJOUTÉS depuis les réglages : une fiche n'existe pour     */
/* l'application qu'une fois ACTIVE, l'activation exige une épreuve      */
/* verte, et un tour ne part jamais sans l'adresse et la clé de la fiche.*/
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'moteurs-ajoutes-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const {
  EngineId,
  activationPermise,
  descriptionMoteur,
  idsDesMoteurs,
  jugerDeclaration,
  moteursDeSecours,
  moteursParCle,
  poserLesMoteursAjoutes,
  verdictDEpreuve,
} = shared;
const { adapterFor } = await import('../engines/index.js');
const { environnementAnthropique, environnementOpenAI, raisonDeNePasPartir } = await import('../engines/ajoutes.js');
const moteurs = await import('../moteurs-ajoutes.js');

type Fiche = import('@beluga/shared').FicheMoteur;

const base = (famille: 'anthropic' | 'openai', statut: Fiche['statut'] = 'actif'): Fiche => ({
  id: famille === 'anthropic' ? 'ext-essai-a' : 'ext-essai-o',
  label: `Essai ${famille}`,
  nomCourt: 'Essai',
  famille,
  urlDeBase: famille === 'anthropic' ? 'https://api.exemple.test/anthropic' : 'https://api.exemple.test/v1',
  modeleParDefaut: 'modele-pro',
  modeleLeger: 'modele-flash',
  statut,
  creeLe: 1,
});

test.afterEach(() => poserLesMoteursAjoutes([]));

test('une fiche n’existe pour l’application qu’une fois active', () => {
  poserLesMoteursAjoutes([base('anthropic', 'essai')]);
  assert.equal(descriptionMoteur('ext-essai-a'), undefined);
  assert.ok(!idsDesMoteurs().includes('ext-essai-a'));
  poserLesMoteursAjoutes([base('anthropic')]);
  assert.ok(descriptionMoteur('ext-essai-a'));
  assert.ok(moteursParCle().includes('ext-essai-a'));
  // Payé à l'usage : jamais choisi seul en secours.
  assert.ok(!moteursDeSecours().includes('ext-essai-a'));
  assert.equal(descriptionMoteur('ext-essai-a')?.facturation, 'depense');
  assert.equal(descriptionMoteur('ext-essai-a')?.instructions, 'CLAUDE.md');
  poserLesMoteursAjoutes([base('openai')]);
  assert.equal(descriptionMoteur('ext-essai-o')?.outil, 'codex');
  assert.equal(descriptionMoteur('ext-essai-o')?.instructions, 'AGENTS.md');
});

test('le schéma relit une carte au moteur retiré, mais refuse une forme inconnue', () => {
  assert.equal(EngineId.safeParse('ext-retire-depuis-longtemps').success, true);
  assert.equal(EngineId.safeParse('claude').success, true);
  assert.equal(EngineId.safeParse('inconnu').success, false);
  assert.equal(EngineId.safeParse('ext-').success, false);
});

test('un moteur ajouté inconnu ou retiré ne lance rien, et ne retombe jamais sur Claude', async () => {
  poserLesMoteursAjoutes([{ ...base('anthropic'), statut: 'retire' }]);
  for (const id of ['ext-essai-a', 'ext-jamais-vu']) {
    const adaptateur = adapterFor(id);
    assert.notEqual(adaptateur.id, 'claude');
    const evenements: string[] = [];
    const fin = await adaptateur.run({ cwd: bacASable, prompt: 'x', fullAccess: true, onEvent: (e) => evenements.push(e.kind) }).finished;
    assert.equal(fin.ok, false);
    assert.equal(fin.jamaisDemarre, true);
  }
});

test('sans l’adresse et la clé DE LA FICHE, le tour ne part pas', () => {
  const a = base('anthropic');
  assert.match(raisonDeNePasPartir(a, {}) ?? '', /ne part pas/);
  assert.match(raisonDeNePasPartir(a, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: 'k' }) ?? '', /ne part pas/);
  assert.equal(raisonDeNePasPartir(a, environnementAnthropique(a, 'k', bacASable)), null);

  const o = base('openai');
  const coffre = path.join(bacASable, 'coffre-o');
  assert.match(raisonDeNePasPartir(o, { CODEX_HOME: coffre }) ?? '', /ne part pas/);
  const env = environnementOpenAI(o, 'k', coffre);
  assert.equal(raisonDeNePasPartir(o, env), null);
  const config = fs.readFileSync(path.join(coffre, 'config.toml'), 'utf8');
  assert.match(config, /web_search = "disabled"/);
  assert.match(config, /base_url = "https:\/\/api\.exemple\.test\/v1"/);
  // Un coffre réécrit vers un autre fournisseur n'est plus conforme.
  fs.writeFileSync(path.join(coffre, 'config.toml'), 'model_provider = "openai"\n');
  assert.match(raisonDeNePasPartir(o, env) ?? '', /ne part pas/);
});

test('une déclaration est jugée : famille, adresses https, doublon actif', () => {
  const ok = jugerDeclaration(
    { label: 'DeepSeek', famille: 'anthropic', urlDeBase: 'https://api.deepseek.com/anthropic/', modeleParDefaut: 'deepseek-chat' },
    [],
    5,
  );
  assert.ok('fiche' in ok);
  if ('fiche' in ok) {
    assert.equal(ok.fiche.id, 'ext-deepseek');
    assert.equal(ok.fiche.statut, 'essai');
    assert.equal(ok.fiche.urlDeBase, 'https://api.deepseek.com/anthropic');
  }
  assert.ok('refus' in jugerDeclaration({ label: 'X', famille: 'gemini', urlDeBase: 'https://x.test', modeleParDefaut: 'm' }, [], 5));
  assert.ok('refus' in jugerDeclaration({ label: 'X', famille: 'openai', urlDeBase: 'http://x.test', modeleParDefaut: 'm' }, [], 5));
  assert.ok('refus' in jugerDeclaration({ label: 'Mimo', famille: 'openai', urlDeBase: 'https://x.test', modeleParDefaut: 'm' }, [], 5));
  assert.ok(
    'refus' in jugerDeclaration({ label: 'DeepSeek', famille: 'openai', urlDeBase: 'https://x.test', modeleParDefaut: 'm' }, [{ id: 'ext-deepseek', statut: 'actif' }], 5),
  );
});

test('le verdict n’est vert que si tout a été vu, et l’activation l’exige', () => {
  const tout = { cleAcceptee: true, formatReconnu: true, outilUtilise: true, reponseJuste: true, finPropre: true, modelesLus: true, usageLu: false };
  assert.equal(verdictDEpreuve(tout).ok, true);
  assert.equal(verdictDEpreuve({ ...tout, modelesLus: null }).ok, true);
  for (const manque of ['cleAcceptee', 'outilUtilise', 'reponseJuste', 'finPropre', 'modelesLus'] as const) {
    assert.equal(verdictDEpreuve({ ...tout, [manque]: false }).ok, false, manque);
  }
  assert.equal(activationPermise(undefined).ok, false);
  assert.equal(activationPermise({ statut: 'essai' }).ok, false);
  assert.equal(activationPermise({ statut: 'essai', epreuve: { ok: false, at: 1, resume: 'raté' } }).ok, false);
  assert.equal(activationPermise({ statut: 'essai', epreuve: { ok: true, at: 1, resume: 'vert' } }).ok, true);
  assert.equal(activationPermise({ statut: 'retire', epreuve: { ok: true, at: 1, resume: 'vert' } }).ok, false);
});

test('en base : déclarer, refuser l’activation sans épreuve, retirer', async () => {
  const d = moteurs.declarerMoteur({ label: 'Essai Base', famille: 'openai', urlDeBase: 'https://api.exemple.test/v1', modeleParDefaut: 'm' });
  assert.equal(d.ok, true);
  const id = d.ok ? d.fiche.id : 'ext-x';
  assert.equal(descriptionMoteur(id), undefined, 'une fiche en essai reste invisible');
  const refus = await moteurs.activerMoteur(id);
  assert.equal(refus.ok, false);
  assert.match(refus.raison, /éprouvé/);
  const retrait = await moteurs.retirerMoteur(id, { agentsAuTravail: [], comptesOccupes: [] });
  assert.equal(retrait.ok, true);
  assert.equal(moteurs.ficheEnBase(id)?.statut, 'retire');
});

test('chaque ajout a sa carte : posée au premier message, liée à la fiche, rangée d’après elle', async () => {
  const store = await import('../store.js');
  store.saveProject(
    shared.Project.parse({ id: 'projet-ajouts', name: 'Beluga Build', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
  );
  const agent = moteurs.agentAjoutDeMoteur(true);
  assert.ok(agent);
  const carteId = await moteurs.carteDeLAjout(agent!.id, 'Ajoute Gemini');
  assert.ok(carteId);
  // Une seule carte par conversation.
  assert.equal(await moteurs.carteDeLAjout(agent!.id, 'encore'), carteId);
  let carte = store.getCard(carteId!)!;
  assert.equal(carte.column, 'running');
  assert.equal(carte.agentId, agent!.id);
  assert.ok(carte.labels.includes(shared.ETIQUETTE_AJOUT_DE_MOTEUR));
  assert.equal(store.getAgent(agent!.id)?.cardId, carteId);

  const d = moteurs.declarerMoteur({ label: 'Essai Carte', famille: 'openai', urlDeBase: 'https://api.exemple.test/v1', modeleParDefaut: 'm' }, carteId!);
  assert.ok(d.ok && d.fiche.carteId === carteId);
  carte = store.getCard(carteId!)!;
  assert.equal(carte.title, 'Ajout du LLM « Essai Carte »');
  assert.match(carte.scheduling?.waitingReason ?? '', /pas encore essayé/);
  // Redéclarée sans carte : elle garde la sienne.
  const re = moteurs.declarerMoteur({ label: 'Essai Carte', famille: 'openai', urlDeBase: 'https://api.exemple.test/v2', modeleParDefaut: 'm' });
  assert.ok(re.ok && re.fiche.carteId === carteId);

  // Sans clé collée ni connue, l'écran reçoit une consigne, pas une panne.
  const sansCle = await moteurs.eprouverDepuisLesReglages(d.ok ? d.fiche.id : '', '');
  assert.equal(sansCle.ok, false);
  assert.match(sansCle.resume, /Collez la clé/);

  // Un autre ajout ouvre une carte neuve ; l'ancienne reste.
  const autre = moteurs.agentAjoutDeMoteur(true);
  const autreCarte = await moteurs.carteDeLAjout(autre!.id, 'Mistral');
  assert.notEqual(autreCarte, carteId);
  assert.ok(store.getCard(carteId!));

  // Retiré : la carte est rangée en « Archivé », avec sa phrase.
  await moteurs.retirerMoteur(d.ok ? d.fiche.id : '', { agentsAuTravail: [], comptesOccupes: [] });
  carte = store.getCard(carteId!)!;
  assert.equal(carte.column, 'archived');
  assert.match(carte.sansModification ?? '', /retiré/);
});
