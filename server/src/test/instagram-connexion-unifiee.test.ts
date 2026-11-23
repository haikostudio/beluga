import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * INSTAGRAM SANS PAGE FACEBOOK — LA CONNEXION UNIFIÉE DE META (12/11/2026) — ce qui ne doit jamais casser :
 *  - l'ID de configuration réglé, « Relier » Instagram ouvre `dialog/oauth?config_id=…` (droits portés par la
 *    configuration, `prompt=login` pour « Continuer avec Instagram ») ; sans lui, l'ancienne connexion reste ;
 *  - le code rend un jeton système : `me/assigned_instagram_accounts` donne les comptes, sans page ;
 *  - les messages d'un compte sans page passent par son identifiant Instagram ;
 *  - un compte relié « par Chrome » cède sa place au même compte relié par l'API, ses envois en attente compris.
 *
 * Aucun réseau réel : `fetch` est remplacé par un faux qui rejoue les réponses vues chez Meta le 12/11/2026.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-unifiee-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_ADRESSE_PUBLIQUE = 'https://beluga.exemple.ch';

const shared = await import('@beluga/shared');
const { Project, memeCompteSocial } = shared;
const store = await import('../store.js');
const marketing = await import('../marketing.js');
const sociale = await import('../publication-sociale.js');
const { instagram } = await import('../reseaux/meta.js');
const { getDb } = await import('../db.js');

const projet = store.saveProject(Project.parse({ id: 'projet-beluga', name: 'Beluga Build', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
marketing.assurerEspace(projet.id);

const appels: string[] = [];
const vraiFetch = globalThis.fetch;
function fauxMeta(): void {
  globalThis.fetch = (async (entree: string | URL) => {
    const url = new URL(String(entree));
    appels.push(`${url.pathname}?${url.searchParams.toString()}`);
    const corps = (() => {
      if (url.pathname.endsWith('/oauth/access_token')) return url.searchParams.get('grant_type') ? { error: { message: 'pas d’échange long ici' } } : { access_token: 'jeton-systeme-secret', token_type: 'bearer' };
      if (url.pathname.endsWith('/me/assigned_instagram_accounts')) return { data: [{ id: '17841467026781660', username: 'belugabuild', profile_picture_url: 'https://cdn.exemple/belugabuild.jpg' }] };
      if (url.pathname.endsWith('/me/accounts')) return { data: [] };
      if (url.pathname.endsWith('/me')) return { client_business_id: '1568053041677164' };
      if (url.pathname.endsWith('/conversations')) return { data: [] };
      return { error: { message: `inattendu : ${url.pathname}` } };
    })();
    return new Response(JSON.stringify(corps), { status: corps && 'error' in corps ? 400 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
test.after(() => {
  globalThis.fetch = vraiFetch;
});

test('le même compte se reconnaît quelle que soit sa voie', () => {
  assert.equal(memeCompteSocial('@belugabuild', 'BelugaBuild'), true);
  assert.equal(memeCompteSocial('@beluga.build', '@belugabuild'), true);
  assert.equal(memeCompteSocial('@belugabuild', '@studhunt.ch'), false);
  assert.equal(memeCompteSocial('', ''), false);
});

test('la connexion unifiée ne s’ouvre que si la configuration est réglée', () => {
  const base = { app: { clientId: '1160128423056940', secret: 's' }, retour: 'https://beluga.exemple.ch/m/oauth/retour', etat: 'e1', verificateur: 'v' };
  const ancienne = new URL(instagram.urlDeConnexion(base));
  assert.ok(ancienne.searchParams.get('scope')?.includes('instagram_content_publish'));
  assert.equal(ancienne.searchParams.get('config_id'), null);
  const unifiee = new URL(instagram.urlDeConnexion({ ...base, app: { ...base.app, configConnexion: '1875978850190771' } }));
  assert.equal(unifiee.searchParams.get('config_id'), '1875978850190771');
  assert.equal(unifiee.searchParams.get('prompt'), 'login');
  assert.equal(unifiee.searchParams.get('scope'), null, 'les droits viennent de la configuration');
  assert.equal(unifiee.searchParams.get('state'), 'e1');
});

test('l’ID de configuration se règle sur l’application Meta seulement, en chiffres', () => {
  assert.ok(sociale.ecrireApplication({ reseau: 'instagram', clientId: '1160128423056940', secret: 'secret-meta' }).ok);
  assert.equal(sociale.ecrireApplication({ application: 'meta', configConnexion: 'pas-un-id' }).ok, false);
  assert.equal(sociale.ecrireApplication({ application: 'x', configConnexion: '123456' }).ok, false);
  const r = sociale.ecrireApplication({ application: 'meta', configConnexion: '1875978850190771' });
  assert.ok(r.ok && r.application.configConnexion === '1875978850190771');
  assert.match(sociale.commencerConnexion(projet.id, 'instagram').url, /config_id=1875978850190771/);
  assert.doesNotMatch(sociale.commencerConnexion(projet.id, 'facebook').url, /config_id/, 'Facebook garde sa connexion');
});

test('Relier : @belugabuild sans page prend la place de sa ligne par Chrome, avec ses envois en attente', async () => {
  const parChrome = sociale.relierParChrome(projet.id, 'instagram', { nom: '@belugabuild', compteBeluga: 'admin', appareilId: null });
  const c = marketing.creerContenu({ projectId: projet.id, genre: 'post', canal: 'instagram', titre: 'Sortie', texte: 'Ça sort', origine: 'humain' });
  const contenuId = c.ok ? c.contenu.id : '';
  assert.ok(sociale.ecrireCibles(contenuId, [parChrome.id]).ok);

  fauxMeta();
  const { url } = sociale.commencerConnexion(projet.id, 'instagram');
  const etat = new URL(url).searchParams.get('state')!;
  const r = await sociale.terminerConnexion(new URLSearchParams({ state: etat, code: 'code-unifie' }));
  assert.ok(r.ok, r.ok ? '' : r.raison);
  assert.ok(!appels.some((a) => a.includes('fb_exchange_token')), 'le jeton système ne s’échange pas');

  const comptes = sociale.listerComptes(projet.id).filter((x) => x.reseau === 'instagram');
  assert.equal(comptes.length, 1, 'une seule ligne @belugabuild');
  const compte = comptes[0]!;
  assert.equal(compte.nom, '@belugabuild');
  assert.equal(compte.mode, 'officiel');
  const ligne = getDb().prepare('SELECT * FROM marketing_comptes WHERE id = ?').get(compte.id) as { distant_id: string; details: string };
  assert.equal(ligne.distant_id, '17841467026781660');
  assert.deepEqual(JSON.parse(ligne.details), { voie: 'unifiee', entreprise: '1568053041677164' });
  assert.deepEqual(
    sociale.ciblesDuContenu(contenuId).map((x) => x.compteId),
    [compte.id],
    'l’envoi prévu par Chrome part désormais par l’API',
  );
});

test('les messages d’un compte sans page se lisent sur son identifiant Instagram', async () => {
  fauxMeta();
  appels.length = 0;
  await instagram.lireMessages!({ app: { clientId: 'a', secret: 's' }, ctx: { distantId: '17841467026781660', nom: '@belugabuild', jeton: 'j', details: { voie: 'unifiee' } } });
  assert.ok(appels.some((a) => a.startsWith('/v21.0/17841467026781660/conversations')));
});
