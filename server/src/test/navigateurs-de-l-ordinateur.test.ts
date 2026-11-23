import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LES NAVIGATEURS AU CHOIX (carte « Navigateurs facultatifs à la liaison », 22/11/2026) : règles pures (marques,
 * détection nettoyée, liste proposée, choix par défaut, choix effectif d'un ordinateur relié avant la carte, prêt sans
 * navigateur obligatoire), puis la base — la marque annoncée à la liaison, le choix enregistré et ce qu'il ajoute ou
 * retire, jamais sur l'ordinateur d'un autre compte.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-navigateurs-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const chrome = await import('../extension-chrome.js');
const ordinateurs = await import('../ordinateurs.js');
getDb();

type O = import('@beluga/shared').Ordinateur;
type M = import('@beluga/shared').MarqueDeNavigateur;
const V = shared.VERSION_EXTENSION_CHROME;
const nav = (id: string, genre: 'chrome' | 'safari', enLigne: boolean, extra: Partial<O['navigateurs'][number]> = {}) => ({
  id,
  genre,
  enLigne,
  version: V,
  incognito: true,
  vuLe: 1,
  agentsAuTravail: 0,
  ...extra,
});
const programme = (systeme: 'mac' | 'windows' | 'linux', extra: Partial<NonNullable<O['programme']>> = {}): NonNullable<O['programme']> => ({
  id: 'p',
  systeme,
  etat: 'pret',
  vuLe: Date.now(),
  autorisations: { accessibilite: true, ecran: true },
  connect: '1.6.0',
  ...extra,
});
const ordi = (navigateurs: O['navigateurs'], p: O['programme'], navigateursChoisis: M[] | null = null): O => ({
  id: 'o',
  nom: 'Mac',
  repere: 'mac',
  creeLe: 0,
  navigateurs,
  programme: p,
  navigateursChoisis,
});

test('marques : genre technique, éprouvées, nettoyage du rapport', () => {
  assert.equal(shared.genreDeLaMarque('edge'), 'chrome', 'la famille Chromium a le débogueur');
  assert.equal(shared.genreDeLaMarque('firefox'), 'safari', 'Firefox joue en mode dégradé');
  assert.equal(shared.genreDeNavigateur('firefox'), 'safari');
  assert.equal(shared.marqueEquipable('chrome', 'linux'), true);
  assert.equal(shared.marqueEquipable('safari', 'mac'), true);
  assert.equal(shared.marqueEquipable('safari', 'windows'), false);
  assert.equal(shared.marqueEquipable('orion', 'mac'), false, 'jamais éprouvé : « Bientôt »');
  const brut = [{ marque: 'firefox', version: '133.0' }, { marque: 'chrome', parDefaut: true }, { marque: 'chrome' }, { marque: 'netscape' }, { marque: 'edge', version: 'rm -rf /' }];
  assert.deepEqual(shared.navigateursInstallesValables(brut), [
    { marque: 'chrome', version: null, parDefaut: true },
    { marque: 'firefox', version: '133.0', parDefaut: false },
    { marque: 'edge', version: null, parDefaut: false },
  ]);
  assert.deepEqual(shared.choixValable(['safari', 'chrome', 'x', 'chrome']), ['chrome', 'safari']);
  assert.equal(shared.navigateursNommes(['chrome', 'safari', 'firefox'], 'et'), 'Chrome, Safari et Firefox');
});

test('la liste proposée et les cases cochées d’office', () => {
  const detecte = ordi([], programme('mac', { installes: [{ marque: 'chrome', version: null, parDefaut: false }, { marque: 'safari', version: null, parDefaut: false }, { marque: 'orion', version: null, parDefaut: false }] }));
  assert.deepEqual(shared.navigateursAProposer(detecte).map((n) => n.marque), ['chrome', 'safari', 'orion']);
  assert.deepEqual(shared.choixParDefaut(detecte), ['chrome', 'safari'], 'Orion se voit mais ne se coche pas');
  /* Sans détection (Beluga Connect d'avant) : ce qu'on sait équiper sur ce système. */
  assert.deepEqual(shared.navigateursAProposer(ordi([], programme('windows'))).map((n) => n.marque), ['chrome']);
  /* Un navigateur relié est forcément installé, même manqué par la détection. */
  const relie = ordi([nav('e', 'chrome', true, { marque: 'edge' })], programme('windows', { installes: [] }));
  assert.deepEqual(shared.navigateursAProposer(relie).map((n) => n.marque), ['edge']);
});

test('prêt : aucun navigateur obligatoire, seuls les choisis comptent', () => {
  const sansChoix = ordi([], programme('mac'));
  assert.equal(shared.ordinateurPret(sansChoix), false, 'rien choisi : l’étape « Navigateurs » attend');
  assert.equal(shared.ordinateurPret({ ...sansChoix, navigateursChoisis: [] }), true, '« Continuer sans navigateur »');
  const chromeSeul = ordi([nav('c', 'chrome', true)], programme('mac'), ['chrome']);
  assert.equal(shared.ordinateurPret(chromeSeul), true, 'un Mac neuf avec Chrome seul, sans Safari');
  assert.equal(shared.ordinateurPret({ ...chromeSeul, navigateurs: [nav('c', 'chrome', true, { incognito: false })] }), false, 'navigation privée non vérifiée sur Mac');
  assert.equal(shared.ordinateurPret({ ...chromeSeul, navigateursChoisis: ['chrome', 'safari'] }), false, 'Safari choisi mais pas relié');
  assert.equal(shared.ordinateurPret({ ...chromeSeul, programme: programme('mac', { autorisations: { accessibilite: true, ecran: false } }) }), false);
  /* Relié avant la carte (choix nul) : ses navigateurs reliés font le choix — Safari jamais pris n'est plus attendu. */
  const ancien = ordi([nav('c', 'chrome', true)], programme('mac'), null);
  assert.deepEqual(shared.choixEffectif(ancien.navigateursChoisis, ancien.navigateurs), ['chrome']);
  assert.equal(shared.ordinateurPret(ancien), true, 'le Mac de l’utilisateur se débloque sans geste');
  /* Firefox (mode dégradé) : relié et en ligne suffit. */
  const firefox = ordi([nav('f', 'safari', true, { marque: 'firefox', version: '1.0.17', incognito: null })], programme('linux'), ['firefox']);
  assert.equal(shared.ordinateurPret(firefox), true);
  /* Un Edge relié n'est pas Chrome. */
  const edge = ordi([nav('e', 'chrome', true, { marque: 'edge' })], programme('windows'), ['chrome']);
  assert.equal(shared.navigateurPret(edge, 'chrome'), false);
  assert.equal(shared.navigateurPret(edge, 'edge'), true);
});

test('base : marque annoncée à la liaison, choix enregistré, ajouts et retraits, périmètre du compte', () => {
  const mac = ordinateurs.creerUnOrdinateur('a1', 'Mac');
  const { code } = chrome.emettreUnCodeDeLiaison('a1', Date.now(), { ordinateurId: mac.id });
  const r = chrome.relierUnChrome({ code, nom: 'macOS', version: '1.0.17', navigateur: 'chrome', marque: 'edge' }, 'ip-n1');
  assert.equal(r.ok, true);
  const { code: code2 } = chrome.emettreUnCodeDeLiaison('a1', Date.now(), { ordinateurId: mac.id });
  const r2 = chrome.relierUnChrome({ code: code2, nom: '', version: '1.0.17', navigateur: 'safari', marque: 'firefox' }, 'ip-n1');
  assert.equal(r2.ok, true);
  assert.equal(r2.ok && r2.nom, 'Firefox', 'le nom par défaut suit la marque');
  const relies = chrome.chromesDuCompte('a1').filter((c) => c.ordinateurId === mac.id);
  assert.deepEqual(relies.map((c) => [c.genre, c.marque]).sort(), [['chrome', 'edge'], ['safari', 'firefox']]);

  /* Premier choix : Edge gardé, Firefox décoché (retiré), Chrome ajouté. */
  const change = ordinateurs.choisirLesNavigateurs('a1', mac.id, ['edge', 'chrome', 'pas-un-navigateur']);
  assert.deepEqual(change, { choisis: ['chrome', 'edge'], ajoutes: ['chrome'], retires: ['firefox'] });
  assert.deepEqual(ordinateurs.navigateursChoisisDe(ordinateurs.ligneDOrdinateur('a1', mac.id)), ['chrome', 'edge']);
  /* « Continuer sans navigateur » : tout se retire. */
  assert.deepEqual(ordinateurs.choisirLesNavigateurs('a1', mac.id, [])?.retires.sort(), ['chrome', 'edge', 'firefox']);
  assert.deepEqual(ordinateurs.navigateursChoisisDe(ordinateurs.ligneDOrdinateur('a1', mac.id)), []);
  /* Jamais l'ordinateur d'un autre compte. */
  assert.equal(ordinateurs.choisirLesNavigateurs('a2', mac.id, ['chrome']), null);
});
