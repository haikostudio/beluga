import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA LIAISON BELUGA PASS CÔTÉ BELUGA BUILD (carte « Audits passés et synchro Beluga Pass », 15/11/2026), sur une base
 * jetable et un Beluga Pass FACTICE (aucun réseau) qui chiffre comme bp-core (prouvé par belugapass-crypto.test) :
 *
 *  - une clé de liaison se montre une fois ; le coffre-fort la garde, la base n'en garde que l'empreinte ;
 *  - les portes /api/belugapass/* refusent une clé inconnue, un appel en clair, un miroir mal formé ou trop gros ;
 *  - le premier GET /link vaut liaison et rend la clé publique des agents ;
 *  - le miroir est rangé tel quel, la date et le volume suivent ;
 *  - l'interrupteur des agents passe par le webhook ; accès ouvert, un agent lit les coffres, rien n'est écrit en base ;
 *  - l'assistant rend une intention conforme au contrat ;
 *  - délier prévient Beluga Pass et efface la liaison et la sauvegarde.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'belugapass-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const bp = await import('../belugapass.js');
const crypto = await import('../belugapass-crypto.js');
const coffre = await import('../coffre-fort.js');

const appels: { url: string; methode: string; corps?: unknown; agent?: string }[] = [];
let coffresScelles: { vaults: unknown[]; items: unknown[] } = { vaults: [], items: [] };
let accesCoteBelugaPass = false;
bp.remplacerLesAppels(async (url, init) => {
  const corps = init.body ? JSON.parse(init.body) : undefined;
  appels.push({ url, methode: init.method, corps, agent: init.headers['x-beluga-agent'] });
  if (url.endsWith('/api/beluga/agent/vaults')) {
    if (!accesCoteBelugaPass) return { status: 403, json: async () => ({}) };
    return { status: 200, json: async () => coffresScelles };
  }
  return { status: 200, json: async () => ({ ok: true }) };
});

const entrant = (methode: string, route: string, cle: string | null, corps?: unknown, proto?: string) =>
  bp.traiterAppelEntrant({
    methode,
    route,
    autorisation: cle ? `Bearer ${cle}` : undefined,
    proto,
    ip: '203.0.113.9',
    lireLeCorps: async (plafond) => {
      const b = Buffer.from(corps === undefined ? '' : typeof corps === 'string' ? corps : JSON.stringify(corps));
      if (b.length > plafond) throw new Error('trop gros');
      return b;
    },
  });

let cle = '';

test('une clé de liaison : montrée une fois, rangée au coffre, seule son empreinte en base', () => {
  assert.equal(bp.etatBelugaPass().existe, false);
  const r = bp.nouvelleCle('https://belugapass.exemple.ch/');
  cle = r.cle;
  assert.ok(shared.formeDeCleDeLiaison(cle));
  assert.equal(r.etat.endpoint, 'https://belugapass.exemple.ch');
  assert.equal(r.etat.existe, true);
  assert.equal(r.etat.relie, false);
  assert.ok(!JSON.stringify(r.etat).includes(cle), 'l’état ne porte jamais la clé');
  const ligne = getDb().prepare('SELECT * FROM belugapass_liaison').get() as Record<string, unknown>;
  assert.ok(!JSON.stringify(ligne).includes(cle), 'la base ne garde que l’empreinte');
  const fiches = coffre.listerAcces();
  assert.equal(fiches.find((f) => f.nom === shared.FICHE_CLE_DE_LIAISON)?.champs.jeton, cle);
  assert.ok(fiches.find((f) => f.nom === shared.FICHE_CLE_DES_AGENTS)?.champs.valeur, 'la clé privée des agents a sa fiche');
  assert.throws(() => bp.nouvelleCle('http://belugapass.exemple.ch'), /https/);
});

test('les portes refusent une clé inconnue, un appel en clair, et rendent la clé publique des agents', async () => {
  assert.equal((await entrant('GET', '/api/belugapass/link', null)).status, 401);
  assert.equal((await entrant('GET', '/api/belugapass/link', `${cle}x`)).status, 401);
  assert.equal((await entrant('GET', '/api/belugapass/link', cle, undefined, 'http')).status, 403);
  const r = await entrant('GET', '/api/belugapass/link', cle, undefined, 'https');
  assert.equal(r.status, 200);
  const corps = r.corps as { ok: boolean; agent_public_key: string; agent_access: boolean };
  assert.equal(corps.ok, true);
  assert.equal(corps.agent_access, false);
  assert.equal(crypto.unb64(corps.agent_public_key).length, 32);
  const privee = coffre.listerAcces().find((f) => f.nom === shared.FICHE_CLE_DES_AGENTS)!.champs.valeur!;
  assert.equal(crypto.publiqueDeLaPrivee(privee), corps.agent_public_key);
  assert.equal(bp.etatBelugaPass().relie, true);
});

test('le miroir chiffré est rangé tel quel ; un miroir mal formé ou trop gros est refusé', async () => {
  const miroir = {
    format: 'belugapass-mirror-1',
    account: { account_id: 'A1', kdf: {}, salt: 'c2Fs', keyset_enc: 'a2V5c2V0', public_key: 'cHVi' },
    vaults: [{ id: 'v1', kind: 'personal', meta_enc: 'bWV0YQ', key_sealed: 'c2NlbGxl', sensitive: false, revision: 1 }],
    items: [
      { id: 'i1', vault_id: 'v1', data_enc: 'ZGF0YQ', revision: 1, updated_at: 'x', deleted_at: null },
      { id: 'i2', vault_id: 'v1', data_enc: 'ZGF0YQ', revision: 1, updated_at: 'x', deleted_at: 'y' },
    ],
    sent_at: 'x',
  };
  assert.equal((await entrant('POST', '/api/belugapass/mirror', cle, { ...miroir, format: 'autre' })).status, 400);
  assert.equal((await entrant('POST', '/api/belugapass/mirror', cle, { ...miroir, items: [{ id: 'i', vault_id: 'v1', data_enc: 'en clair !' }] })).status, 400);
  assert.equal((await entrant('POST', '/api/belugapass/mirror', cle, 'x'.repeat(shared.PLAFOND_DU_MIROIR_OCTETS + 1))).status, 413);
  assert.equal((await entrant('POST', '/api/belugapass/mirror', cle, miroir)).status, 200);
  const etat = bp.etatBelugaPass();
  assert.equal(etat.coffres, 1);
  assert.equal(etat.fiches, 1, 'une fiche effacée ne compte pas');
  assert.ok(etat.volume! > 100);
  assert.ok(etat.derniereSauvegardeLe);
  const range = getDb().prepare('SELECT contenu FROM belugapass_miroir').get() as { contenu: string };
  assert.deepEqual(JSON.parse(range.contenu), miroir);
});

test('l’interrupteur passe par le webhook ; accès ouvert, un agent lit les coffres sans rien écrire en base', async () => {
  await assert.rejects(() => bp.lireLesCoffres('Agent X'), /fermé/);
  const etat = await bp.reglerLAcces(true);
  assert.equal(etat.agentAccess, false, 'ouvrir est une DEMANDE : Beluga Pass confirmera');
  assert.deepEqual(appels.at(-1)?.corps, { event: 'agent_access', enabled: true });
  assert.equal(appels.at(-1)?.url, 'https://belugapass.exemple.ch/api/beluga/webhook');

  // Beluga Pass scelle la clé du coffre pour nos agents, puis confirme.
  const publique = ((await entrant('GET', '/api/belugapass/link', cle)).corps as { agent_public_key: string }).agent_public_key;
  const cleDuCoffre = Buffer.alloc(32, 3);
  coffresScelles = {
    vaults: [{ id: 'v1', meta_enc: crypto.scellerJson(cleDuCoffre, 'v1', { name: 'Serveurs' }), key_sealed: crypto.sceller(publique, cleDuCoffre) }],
    items: [
      { id: 'i1', vault_id: 'v1', data_enc: crypto.scellerJson(cleDuCoffre, 'i1', { type: 'ssh_key', title: 'Serveur de test', fields: { host: '203.0.113.5', username: 'root', private_key: 'CLE-FACTICE-XYZ' } }), revision: 1 },
      { id: 'i2', vault_id: 'v1', data_enc: crypto.scellerJson(cleDuCoffre, 'autre-id', { title: 'déplacé' }), revision: 1 },
    ],
  };
  accesCoteBelugaPass = true;
  assert.equal((await entrant('POST', '/api/belugapass/agent-access', cle, { enabled: true })).status, 200);
  assert.equal(bp.etatBelugaPass().agentAccess, true);

  const fiches = await bp.lireLesCoffres('Agent X');
  assert.equal(fiches.length, 1, 'un bloc déplacé d’une fiche à l’autre ne s’ouvre pas');
  assert.equal(fiches[0]!.coffre, 'Serveurs');
  assert.equal(fiches[0]!.champs.private_key, 'CLE-FACTICE-XYZ');
  assert.equal(appels.at(-1)?.agent, 'Agent X');
  assert.equal(bp.nomPourLEntete('Sécurité d’Éloïse'), "Securite d'Eloise", 'un en-tête HTTP ne porte que de l’ASCII');
  const lecture = bp.etatBelugaPass().lectures[0]!;
  assert.deepEqual([lecture.agent, lecture.coffres, lecture.fiches, lecture.erreur], ['Agent X', 1, 1, null]);

  // L'outil des agents ne rend qu'un chemin : la valeur est dans un fichier 0600, jamais dans la réponse.
  const phrase = (await bp.lectureDesAgentsPourLOutil('Agent X', 'serveur'))!;
  assert.ok(!phrase.includes('CLE-FACTICE-XYZ'));
  const chemin = /fichier (\S+\.json)/.exec(phrase)![1]!;
  assert.equal(fs.statSync(chemin).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(chemin, 'utf8'), /CLE-FACTICE-XYZ/);
  fs.rmSync(chemin);

  // Rien de déchiffré n'est jamais entré dans la base.
  const toute = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  for (const { name } of toute) {
    const lignes = JSON.stringify(getDb().prepare(`SELECT * FROM "${name}"`).all());
    assert.ok(!lignes.includes('CLE-FACTICE-XYZ'), `table ${name}`);
  }

  // Fermer : immédiat chez nous, et Beluga Pass est prévenu.
  await bp.reglerLAcces(false);
  assert.equal(bp.etatBelugaPass().agentAccess, false);
  assert.deepEqual(appels.at(-1)?.corps, { event: 'agent_access', enabled: false });
  await assert.rejects(() => bp.lireLesCoffres('Agent X'), /fermé/);
});

test('l’assistant rend une intention conforme au contrat', async () => {
  const r = await entrant('POST', '/api/belugapass/assistant', cle, { question: 'Quels mots de passe sont réutilisés ?', locale: 'fr', signals: { counts: { reused: 4 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(shared.validerIntention(r.corps), r.corps);
  assert.equal((r.corps as { filter: string }).filter, 'reused');
  assert.match((r.corps as { reply: string }).reply, /4/);
  assert.equal(shared.intentionParRegles({ question: 'show my credit cards', locale: 'en', signals: {} }).type, 'card');
  assert.equal(shared.intentionParRegles({ question: 'which accounts have no 2FA?', locale: 'en', signals: {} }).filter, 'no_2fa');
  const recherche = shared.intentionParRegles({ question: 'trouve mon compte GitHub', locale: 'fr', signals: {} });
  assert.equal(recherche.intent, 'type');
  const libre = shared.intentionParRegles({ question: 'github infomaniak', locale: 'fr', signals: {} });
  assert.deepEqual([libre.intent, libre.terms], ['search', ['github', 'infomaniak']]);
  assert.equal(shared.validerIntention({ intent: 'filter', filter: 'inconnu', terms: [], reply: 'x' }), null);
  assert.equal(shared.validerIntention({ intent: 'search', terms: [], reply: '' }), null);
  assert.equal((await entrant('POST', '/api/belugapass/assistant', cle, { question: '' })).status, 400);
});

test('délier prévient Beluga Pass et efface la liaison, la sauvegarde et la fiche de la clé', async () => {
  const avant = appels.length;
  await bp.delier();
  assert.deepEqual(appels.slice(avant).map((a) => a.corps), [{ event: 'unlinked' }]);
  assert.equal(bp.etatBelugaPass().existe, false);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM belugapass_miroir').get() as { n: number }).n, 0);
  assert.equal(coffre.listerAcces().some((f) => f.nom === shared.FICHE_CLE_DE_LIAISON), false);
  assert.ok(coffre.listerAcces().some((f) => f.nom === shared.FICHE_CLE_DES_AGENTS), 'la clé des agents reste');
  assert.equal((await entrant('GET', '/api/belugapass/link', cle)).status, 401, 'l’ancienne clé ne vaut plus rien');
  // Une nouvelle liaison reprend la même clé des agents.
  shared.definirIdentiteDInstallation({ zoneDesProjets: 'exemple.com' });
  const nouvelle = bp.nouvelleCle();
  assert.equal(nouvelle.etat.endpoint, 'https://belugapass.exemple.com');
  bp.remplacerLesAppels(null);
});

test('relier en un clic : le lien ouvre Beluga Pass rempli, valeurs dans le fragment, jamais sa propre adresse', () => {
  const cleFactice = `bpl_${'A'.repeat(43)}`;
  const lien = shared.lienDeLiaison('https://belugapass.exemple.ch/', 'https://build.exemple.ch', cleFactice);
  assert.equal(lien, `https://belugapass.exemple.ch/app/beluga#endpoint=${encodeURIComponent('https://build.exemple.ch')}&token=${cleFactice}`);
  assert.ok(!lien!.includes('?'), 'aucune valeur dans la requête');
  assert.equal(shared.lienDeLiaison('https://pass.exemple.ch', 'https://pass.exemple.ch', cleFactice), null, 'Beluga Pass ne s’appelle pas lui-même');
  assert.equal(shared.lienDeLiaison('http://pass.exemple.ch', 'https://build.exemple.ch', cleFactice), null, 'HTTPS seulement');
  assert.equal(shared.lienDeLiaison('https://pass.exemple.ch', 'https://build.exemple.ch', 'pas-une-cle'), null);

  // Sans adresse publique réglée, l'origine de la page sert de repli ; l'adresse de Beluga Pass elle-même est refusée
  // avant que la clé en place ne bouge.
  shared.definirIdentiteDInstallation({ adressePublique: '' });
  const avant = bp.etatBelugaPass().creeLe;
  assert.throws(() => bp.relierEnUnClic('https://pass.exemple.ch', 'https://pass.exemple.ch'), /celle de Beluga Build/);
  assert.equal(bp.etatBelugaPass().creeLe, avant);
  const repli = bp.relierEnUnClic('https://pass.exemple.ch', 'https://essai.exemple.ch');
  assert.equal(repli.adresseDeBelugaBuild, 'https://essai.exemple.ch');
  // L'adresse publique réglée passe avant l'origine de la page.
  shared.definirIdentiteDInstallation({ adressePublique: 'https://build.exemple.ch/' });
  const r = bp.relierEnUnClic('https://pass.exemple.ch', 'http://localhost:7099');
  assert.equal(r.adresseDeBelugaBuild, 'https://build.exemple.ch');
  assert.equal(r.etat.adresseDeBelugaBuild, 'https://build.exemple.ch');
  assert.equal(r.lien, shared.lienDeLiaison('https://pass.exemple.ch', 'https://build.exemple.ch', r.cle));
  assert.equal(r.etat.endpoint, 'https://pass.exemple.ch');
  assert.ok(!JSON.stringify(r.etat).includes(r.cle), 'l’état ne porte jamais la clé');
});
