/*
 * CARTE « Extension à jour et Jarvis tout en voix » (20/11/2026) : Beluga met à jour lui-même l'extension Chrome des
 * Mac, SEUL la nuit et sur un clic le jour, et refuse d'ouvrir une fenêtre privée sur un Chrome non autorisé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  VERSION_EXTENSION_CHROME,
  VERSION_MIN_FENETRE_PRIVEE,
  aMettreAJourSeul,
  avisDeLIssue,
  choisirPourFenetrePrivee,
  doublonsDuNavigateur,
  echecRecent,
  gesteDuRetard,
  estLaNuitDeLaMiseAJour,
  faconDeRecharger,
  heureA,
  retardsDExtension,
  versionAuMoins,
  type ChromeAJuger,
  type Ordinateur,
} from '@beluga/shared';

const H = 3600_000;
const maintenant = Date.UTC(2026, 10, 20, 12, 0); // 13 h à Paris
const chrome = (id: string, version: string | null, autre: Partial<ChromeAJuger> = {}): ChromeAJuger => ({
  id,
  nom: id,
  genre: 'chrome',
  version,
  incognito: null,
  vuLe: maintenant - H,
  enLigne: true,
  ordinateurId: `o-${id}`,
  agentsAuTravail: 0,
  ...autre,
});

test('la version servie est celle du manifeste de l’extension, et elle sait se recharger', () => {
  const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'extension-chrome/manifest.json'), 'utf8'));
  assert.equal(manifeste.version, VERSION_EXTENSION_CHROME);
  assert.equal(faconDeRecharger(VERSION_EXTENSION_CHROME), 'extension');
  assert.equal(faconDeRecharger('1.0.8'), 'relancer-chrome');
  assert.equal(faconDeRecharger(null), 'relancer-chrome');
});

test('le Mac mini en 1.0.8 et le Mac en 1.0.5 sont signalés ; un Chrome à jour et autorisé ne l’est pas', () => {
  const retards = retardsDExtension(
    [chrome('mini', '1.0.8'), chrome('mac', '1.0.5'), chrome('neuf', VERSION_EXTENSION_CHROME, { incognito: true })],
    VERSION_EXTENSION_CHROME,
    new Set(['o-mini']),
    maintenant,
  );
  assert.deepEqual(retards.map((r) => [r.chromeId, r.raison, r.programmeEnLigne]), [
    ['mini', 'version', true],
    ['mac', 'version', false],
  ]);
});

test('à jour mais non autorisé en navigation privée : signalé pour la case, pas pour la version', () => {
  const [r] = retardsDExtension([chrome('a', VERSION_EXTENSION_CHROME, { incognito: false })], VERSION_EXTENSION_CHROME, new Set(), maintenant);
  assert.equal(r?.raison, 'navigation-privee');
});

test('un Chrome éteint depuis plus de sept jours, ou un Safari, ne déclenche pas la bannière', () => {
  const retards = retardsDExtension(
    [chrome('vieux', '1.0.5', { enLigne: false, vuLe: maintenant - 8 * 24 * H }), chrome('safari', '1.0.0', { genre: 'safari' }), chrome('recent', '1.0.5', { enLigne: false, vuLe: maintenant - 2 * 24 * H })],
    VERSION_EXTENSION_CHROME,
    new Set(),
    maintenant,
  );
  assert.deepEqual(retards.map((r) => r.chromeId), ['recent']);
});

test('la nuit de la mise à jour va de 1 h à 6 h, heure de Paris, quel que soit le fuseau du serveur', () => {
  assert.equal(heureA(Date.UTC(2026, 10, 20, 0, 30)), 1); // 1 h 30 à Paris (UTC+1 en novembre)
  assert.equal(estLaNuitDeLaMiseAJour(Date.UTC(2026, 10, 20, 0, 30)), true);
  assert.equal(estLaNuitDeLaMiseAJour(Date.UTC(2026, 10, 20, 4, 59)), true);
  assert.equal(estLaNuitDeLaMiseAJour(Date.UTC(2026, 10, 20, 5, 0)), false); // 6 h
  assert.equal(estLaNuitDeLaMiseAJour(Date.UTC(2026, 10, 19, 23, 59)), false); // 0 h 59
  assert.equal(estLaNuitDeLaMiseAJour(maintenant), false);
});

test('mise à jour TOUT DE SUITE quand l’extension se recharge et qu’aucun agent ne travaille (décision du 20/11/2026)', () => {
  const [r] = retardsDExtension([chrome('mac', '1.0.11', { vuLe: maintenant })], '1.0.12', new Set(['o-mac']), maintenant);
  assert.ok(r);
  assert.equal(r.geste, 'aucun', 'Beluga s’en charge : pas de bande orange');
  assert.equal(aMettreAJourSeul(r, 0, null, maintenant), true, 'le jour aussi');
  assert.equal(aMettreAJourSeul(r, 1, null, maintenant), false, 'un agent travaille dans ce Chrome : elle attend');
  assert.equal(aMettreAJourSeul(r, 0, maintenant - 10 * 60_000, maintenant), false, 'un essai il y a dix minutes : pas de boucle');
  assert.equal(aMettreAJourSeul(r, 0, maintenant - 31 * 60_000, maintenant), true);
  assert.equal(aMettreAJourSeul({ ...r, programmeEnLigne: false }, 0, null, maintenant), false);
  assert.equal(aMettreAJourSeul({ ...r, raison: 'navigation-privee' }, 0, null, maintenant), false);
});

test('une relance de Chrome (extension d’avant 1.0.11) reste la nuit ou sur un clic', () => {
  const nuit = Date.UTC(2026, 10, 20, 2, 0);
  const [r] = retardsDExtension([chrome('mini', '1.0.8', { vuLe: nuit })], VERSION_EXTENSION_CHROME, new Set(['o-mini']), nuit);
  assert.ok(r);
  assert.equal(r.geste, 'relancer-chrome');
  assert.equal(aMettreAJourSeul(r, 0, null, nuit), true);
  assert.equal(aMettreAJourSeul(r, 0, null, maintenant), false, 'le jour : on attend le clic');
  assert.equal(aMettreAJourSeul(r, 0, nuit - H, nuit), false, 'déjà essayé il y a une heure');
});

test('la bande n’est orange que si un geste est nécessaire', () => {
  const g = (autre: Partial<Parameters<typeof gesteDuRetard>[0]>) =>
    gesteDuRetard({ raison: 'version', version: '1.0.11', programmeEnLigne: true, agentsAuTravail: 0, echecRecent: false, ...autre });
  assert.equal(g({}), 'aucun');
  assert.equal(g({ agentsAuTravail: 2 }), 'aucun', 'un agent travaille : la mise à jour attend, sans bande orange');
  assert.equal(g({ version: '1.0.5' }), 'relancer-chrome');
  assert.equal(g({ version: '1.0.5', agentsAuTravail: 1 }), 'aucun');
  assert.equal(g({ programmeEnLigne: false }), 'guider', 'PC sans Beluga Connect : trois clics');
  assert.equal(g({ echecRecent: true }), 'reessayer');
  assert.equal(g({ raison: 'navigation-privee' }), 'autoriser');
});

test('une mise à jour faite seule devient un avis d’information, une journée au plus ; un clic non', () => {
  assert.deepEqual(avisDeLIssue('ok 1.0.12 (auto)', maintenant - H, maintenant), { version: '1.0.12' });
  assert.deepEqual(avisDeLIssue('ok 1.0.12 (nuit)', maintenant - H, maintenant), { version: '1.0.12' });
  assert.equal(avisDeLIssue('ok 1.0.12 (clic)', maintenant - H, maintenant), null);
  assert.equal(avisDeLIssue('ok 1.0.12 (auto)', maintenant - 25 * H, maintenant), null);
  assert.equal(avisDeLIssue('échec : relais muet', maintenant - H, maintenant), null);
  assert.equal(echecRecent('échec : relais muet', maintenant - 10 * 60_000, maintenant), true);
  assert.equal(echecRecent('échec : relais muet', maintenant - 2 * H, maintenant), false);
  assert.equal(echecRecent('ok 1.0.12 (auto)', maintenant - 60_000, maintenant), false);
});

test('relier de nouveau un Chrome retire l’ancienne fiche, jamais celle d’un autre profil', () => {
  const f = (id: string, autre: Partial<Parameters<typeof doublonsDuNavigateur>[0]> = {}) => ({
    id,
    ordinateurId: 'oMac',
    genre: 'chrome' as const,
    extensionId: null as string | null,
    creeLe: 100,
    vuLe: 150 as number | null,
    enLigne: false,
    ...autre,
  });
  /* Le cas réel du Mac de l'utilisateur : 1.0.5 sans identifiant, plus vue depuis la 1.0.11 reliée ensuite. */
  const neuve = f('gl2W', { creeLe: 200, vuLe: 200, extensionId: 'mplol', enLigne: true });
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('mD99'), neuve]), ['mD99']);
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('meme', { extensionId: 'mplol', vuLe: 300 })]), ['meme'], 'même extension : même Chrome');
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('autreProfil', { extensionId: 'abcd', vuLe: 300 })]), [], 'autre identifiant : autre profil');
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('vuApres', { vuLe: 250 })]), [], 'sans identifiant mais vu après : un autre profil vivant');
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('allume', { enLigne: true })]), [], 'en ligne : gardé');
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('autreMac', { ordinateurId: 'oMini' })]), []);
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('safari', { genre: 'safari' })]), []);
  assert.deepEqual(doublonsDuNavigateur(neuve, [f('plusJeune', { creeLe: 300 })]), [], 'jamais une fiche plus récente');
});

test('une fenêtre privée ne se prend jamais sur un Chrome qui dit ne pas être autorisé', () => {
  const ordi = (incognito: boolean | null): Ordinateur => ({
    id: 'mini',
    nom: 'MacMini',
    repere: 'macmini',
    creeLe: 0,
    programme: null,
    navigateurs: [{ id: 'c', genre: 'chrome', enLigne: true, version: VERSION_EXTENSION_CHROME, incognito, vuLe: 1, agentsAuTravail: 0 }],
  });
  const aJour = (v: string | null) => versionAuMoins(v, VERSION_MIN_FENETRE_PRIVEE);
  assert.equal(choisirPourFenetrePrivee([ordi(false)], VERSION_MIN_FENETRE_PRIVEE, aJour).genre, 'sans-autorisation');
  assert.equal(choisirPourFenetrePrivee([ordi(true)], VERSION_MIN_FENETRE_PRIVEE, aJour).genre, 'pret');
  assert.equal(choisirPourFenetrePrivee([ordi(null)], VERSION_MIN_FENETRE_PRIVEE, aJour).genre, 'pret', 'une extension qui ne dit rien est essayée : elle refusera elle-même');
});

test('le relais sait mettre l’extension à jour et se remplacer, sans aucune commande libre', () => {
  const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  const relais = fs.readFileSync(path.join(racine, 'scripts/relais-mac/relais.js'), 'utf8');
  const lanceur = fs.readFileSync(path.join(racine, 'scripts/relais-mac/lanceur.js'), 'utf8');
  const installateur = fs.readFileSync(path.join(racine, 'scripts/relais-mac/installer.sh'), 'utf8');
  assert.match(relais, /case 'mettre_a_jour_extension':/);
  assert.match(relais, /case 'se_mettre_a_jour':/);
  assert.match(relais, /const VERSION_DU_RELAIS = \d+;/);
  assert.match(relais, /paquet altéré/, 'l’empreinte est comparée avant tout remplacement');
  assert.match(relais, /config\.json/, 'la configuration de l’installation est gardée');
  assert.match(lanceur, /new Function\('LANCEUR'/);
  assert.match(installateur, /osacompile -l JavaScript -o "\$APPLI" "\$DOSSIER\/lanceur\.js"/, 'seul le lanceur est compilé');
});
