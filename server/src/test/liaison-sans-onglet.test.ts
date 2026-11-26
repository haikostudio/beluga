import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * BELUGA CONNECT : LIAISON SANS ONGLET (carte « Beluga Connect : liaison et suivi », 22/11/2026). Les codes survivent
 * aux redémarrages du démon ; le code du téléchargement vit vingt-quatre heures et n'est plus effacé par un nouveau clic
 * « Lier ». DEPUIS LE 26/11/2026 il ne relie plus rien : il reconnaît le parcours, et seul le code à taper relie —
 * Beluga Connect n'ouvre jamais de page.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-liaison-sans-onglet-'));
process.env.BELUGA_DATA = bacASable;

const { getDb } = await import('../db.js');
const { bus } = await import('../bus.js');
const relais = await import('../relais-mac.js');
const ecrans = await import('../ecrans-ouverts.js');
getDb();

const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

test('les codes sont rangés hachés : un démon qui redémarre retrouve le code à taper', async () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-redemarre', Date.now(), null, null, 'saisie');
  const { getMeta } = await import('../db.js');
  const brut = getMeta('relais-mac.codes') ?? '';
  assert.ok(brut.length > 0, 'les codes vivent dans la base, plus en mémoire');
  assert.ok(!brut.includes(`"${code}"`), 'le code n’est jamais écrit en clair');
  /* Le module rechargé (nouveau démon) relit la base. */
  const neuf = await import(`../relais-mac.js?redemarrage=${Date.now()}`);
  const r = neuf.relierUnMac({ code, nom: 'Mac redémarré' }, '10.1.0.1');
  assert.ok(r.ok, 'le code survit au redémarrage');
});

test('le code du téléchargement reconnaît le parcours vingt-quatre heures ; un nouveau clic « Lier » ne le tue pas', () => {
  const recus: any[] = [];
  const stop = bus.subscribe((e: any) => {
    if (e.type === 'relaisMac.connectLance') recus.push(e);
  });
  const ancien = relais.emettreUnCodeDuRelais('compte-patient', Date.now() - 3 * 60 * 60_000, null);
  relais.emettreUnCodeDuRelais('compte-patient', Date.now(), null);
  relais.emettreUnCodeDuRelais('compte-patient', Date.now(), null);
  relais.annoncerConnect({ code: ancien.code, nom: 'Mac lent' }, '10.1.0.2');
  const vieux = relais.emettreUnCodeDuRelais('compte-perime', Date.now() - 49 * 60 * 60_000, null);
  relais.annoncerConnect({ code: vieux.code, nom: 'Mac' }, '10.1.0.3');
  stop();
  assert.deepEqual(recus.map((e) => e.pour), ['compte-patient'], 'trois heures après le clic, il reconnaît encore le parcours ; périmé, rien');
});

test('six codes à taper vivants au plus par compte : le plus ancien cesse de relier', () => {
  const t0 = Date.now() - 60_000;
  const codes = Array.from({ length: 7 }, (_, i) => relais.emettreUnCodeDuRelais('compte-plafond', t0 + i, null, null, 'saisie').code);
  assert.equal(relais.relierUnMac({ code: codes[0], nom: 'Mac' }, '10.1.0.5').ok, false);
  assert.ok(relais.relierUnMac({ code: codes[6], nom: 'Mac' }, '10.1.0.6').ok);
});

test('un Beluga Connect d’avant qui demande sa liaison avec le code de son téléchargement n’est JAMAIS relié tout seul : son compte est prévenu (26/11/2026)', () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-repli', Date.now(), null);
  relais.ouvrirLeParcours('compte-repli', 'mac');
  const recus: any[] = [];
  const stop = bus.subscribe((e: any) => {
    if (e.type === 'relaisMac.codeAttendu' || e.type === 'relaisMac.connectLance') recus.push(e);
  });
  const d = relais.demanderUneLiaison({ nom: 'MacBook Pro', systeme: 'mac', code }, '10.1.0.8');
  stop();
  assert.ok(d.ok);
  if (!d.ok) return;
  assert.equal(d.etat, 'code', 'plus de liaison toute seule : un code de secours');
  assert.equal(d.identifiant, undefined, 'aucune clé sans code tapé');
  assert.ok(recus.some((e) => e.type === 'relaisMac.codeAttendu' && e.pour === 'compte-repli'), 'le compte du code est prévenu');
  assert.ok(recus.some((e) => e.type === 'relaisMac.connectLance' && e.pour === 'compte-repli'), 'les réglages du compte se rouvrent');
  assert.ok(relais.parcoursDuCompte('compte-repli')?.connectVuLe, 'le parcours passe à l’étape du code');
});

test('aucun code lisible et aucun « Lier » sur ce réseau : un code de secours, et on ne devine aucun compte', () => {
  const d = relais.demanderUneLiaison({ nom: 'Mac' }, '10.1.0.11');
  assert.ok(d.ok);
  if (!d.ok) return;
  assert.equal(d.etat, 'code');
  assert.match(d.codeDeSecours ?? '', /^[0-9]{6}$/);
  assert.equal(d.identifiant, undefined, 'aucune clé sans compte certain');
});

test('Beluga Connect (Mac et Go) n’ouvre plus jamais Beluga de lui-même', () => {
  const swift = fs.readFileSync(path.join(racine, 'connect/Sources/main.swift'), 'utf8');
  const demander = swift.slice(swift.indexOf('func demanderLaLiaison('), swift.indexOf('\n    }\n', swift.indexOf('func demanderLaLiaison(')));
  assert.ok(demander.length > 0);
  assert.doesNotMatch(demander, /NSWorkspace\.shared\.open/, 'la demande ne s’ouvre plus dans le navigateur');
  /* La seule ouverture de Beluga : le bouton « Ouvrir Beluga » de la fenêtre, sur clic. */
  const ouvertures = swift.match(/NSWorkspace\.shared\.open\(/g) ?? [];
  assert.ok(ouvertures.length >= 1);
  assert.match(swift, /@objc func ouvrirBelugaSurClic\(/);
  const go = fs.readdirSync(path.join(racine, 'connect/go')).filter((f) => f.endsWith('.go')).map((f) => fs.readFileSync(path.join(racine, 'connect/go', f), 'utf8')).join('\n');
  assert.doesNotMatch(go, /\?liaison=/, 'l’application Go n’ouvre plus la page de liaison');
});

test('un ordinateur délié qui redemande sa liaison n’est PAS relié de nouveau tout seul : son compte est prévenu du code de secours', async () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-delie', Date.now(), null, null, 'saisie');
  const r = relais.relierUnMac({ code, nom: 'Mac délié' }, '10.1.0.12');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(relais.delierLeMac('compte-delie'));
  const lacher = ecrans.noterUnEcranOuvert('compte-delie');
  const d = relais.demanderUneLiaison({ nom: 'Mac délié', ancien: r.identifiant }, '10.1.0.13');
  assert.ok(d.ok && d.etat === 'code' && d.prevenus >= 1);
  assert.equal(relais.codeAttenduParLeCompte('compte-delie')?.nom, 'Mac délié');
  const [compte, id] = r.identifiant.split('.');
  const faux = relais.demanderUneLiaison({ nom: 'Mac', ancien: `${compte}.${id}.fauxnonce` }, '10.1.0.14');
  assert.ok(faux.ok && faux.etat === 'code');
  lacher();
});
