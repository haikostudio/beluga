import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE RELAIS DU MAC (13/11/2026) : bornage des points à la fenêtre de recopie, états et repli, puis un FAUX RELAIS qui
 * se relie par un code, signe ses demandes, reçoit un geste et le rend — sans Mac.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-relais-mac-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { getDb } = await import('../db.js');
const relais = await import('../relais-mac.js');
getDb();

const cadre = { x: 100, y: 50, largeur: 300, hauteur: 650 };

test('un point hors de la fenêtre, ou dans sa barre de titre, est refusé', () => {
  assert.deepEqual(shared.pointDansLaFenetre({ x: 0.5, y: 0.5 }, cadre), { x: 250, y: 375 });
  assert.equal(shared.pointDansLaFenetre({ x: 1.2, y: 0.5 }, cadre), null);
  assert.equal(shared.pointDansLaFenetre({ x: -0.1, y: 0.5 }, cadre), null);
  assert.equal(shared.pointDansLaFenetre({ x: 0.5, y: 0.01 }, cadre), null, 'barre de titre');
  assert.equal(shared.pointDansLaFenetre({ x: Number.NaN, y: 0.5 }, cadre), null);
  assert.equal(shared.pointDansLaFenetre({ x: 0.5, y: 0.5 }, { ...cadre, largeur: 0 }), null);
});

test('états du relais et conduite de repli', () => {
  assert.equal(shared.etatDuRelais({ relie: false, maintenant: 0 }), 'absent');
  assert.equal(shared.etatDuRelais({ relie: true, vuLe: 0, maintenant: shared.RELAIS_HORS_LIGNE_APRES_MS + 1 }), 'hors-ligne');
  assert.equal(shared.etatDuRelais({ relie: true, vuLe: 10, maintenant: 20, verrouille: true }), 'mac-verrouille');
  assert.equal(shared.etatDuRelais({ relie: true, vuLe: 10, maintenant: 20, recopie: false }), 'recopie-fermee');
  assert.equal(shared.etatDuRelais({ relie: true, vuLe: 10, maintenant: 20, recopie: true }), 'pret');
  assert.match(shared.conduiteDuRelais('hors-ligne'), /C’est fait/);
  assert.match(shared.conduiteDuRelais('recopie-fermee'), /ouvrir_recopie/);
  assert.equal(shared.texteATaper('a\u0007b'), 'ab');
  assert.equal(shared.texteATaper(''), null);
});

function signe(identifiant: string, secret: string, corps: string, ts = Math.floor(Date.now() / 1000)) {
  const empreinte = crypto.createHash('sha256').update(corps).digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${identifiant}.${empreinte}`).digest('base64url');
  return { id: identifiant, ts: String(ts), sig };
}

test('un faux relais se relie, signe, reçoit un geste et le rend', async () => {
  const { code } = relais.emettreUnCodeDuRelais('compte-1', Date.now(), null, null, 'saisie');
  const lie = relais.relierUnMac({ code, nom: 'Mac de test' }, '127.0.0.1');
  assert.equal(lie.ok, true);
  if (!lie.ok) return;
  // le code est à usage unique
  assert.equal(relais.relierUnMac({ code }, '127.0.0.1').ok, false);

  const entetes = signe(lie.identifiant, lie.secret, '');
  const voie = relais.verifierLeRelais(entetes, '');
  assert.ok(voie, 'signature acceptée');
  assert.equal(relais.verifierLeRelais(entetes, ''), null, 'jamais rejouée');
  assert.equal(relais.verifierLeRelais(signe(lie.identifiant, 'mauvais', ''), ''), null, 'mauvais secret');

  const appareilId = voie!.appareilId;
  const attente = relais.attendreUnGeste(appareilId, { recopie: true });
  const resultat = relais.demanderAuRelais<{ recopie: boolean }>(appareilId, 'etat', {});
  const commande = await attente;
  assert.equal(commande?.geste, 'etat');
  assert.equal(relais.relaisDuCompte('compte-1').etat, 'pret');
  assert.equal(relais.recevoirLaReponse(appareilId, { id: commande!.id, ok: true, resultat: { recopie: true } }), true);
  assert.deepEqual(await resultat, { recopie: true });

  // un geste refusé par le relais (point hors de la fenêtre) revient en erreur
  const refus = relais.demanderAuRelais(appareilId, 'toucher', { x: 2, y: 2 });
  const suivante = await relais.attendreUnGeste(appareilId, { recopie: true });
  relais.recevoirLaReponse(appareilId, { id: suivante!.id, ok: false, erreur: 'point hors de la fenêtre de recopie : refusé' });
  await assert.rejects(refus, /hors de la fenêtre/);

  assert.equal(relais.delierLeMac('compte-1'), true);
  assert.equal(relais.relaisDuCompte('compte-1').etat, 'absent');
  assert.equal(relais.verifierLeRelais(signe(lie.identifiant, lie.secret, ''), ''), null, 'délié : plus reconnu');
});

test('le programme du relais et son installateur sont servis', () => {
  assert.match(relais.scriptDuRelais() ?? '', /pointBorne/);
  const installateur = relais.installateurDuRelais('https://beluga.exemple.fr') ?? '';
  assert.match(installateur, /BASE="https:\/\/beluga\.exemple\.fr"/);
  assert.equal(relais.installateurDuRelais('https://x.fr/$(rm -rf)'), null);
});

test('« Beluga Relais » : une application nommée, et ses autorisations rapportées au démon', async () => {
  const installateur = relais.installateurDuRelais('https://beluga.exemple.fr') ?? '';
  assert.match(installateur, /osacompile -l JavaScript -o "\$APPLI"/, 'compilé en application');
  assert.match(installateur, /Beluga Relais\.app/);
  assert.match(installateur, /codesign --force --deep --sign -/, 'signé ad hoc');
  assert.match(installateur, /Contents\/MacOS\/applet/, 'launchd lance l’application, plus osascript');
  assert.doesNotMatch(installateur, /<string>\/usr\/bin\/osascript<\/string>/);
  assert.match(installateur, /Privacy_Accessibility/);
  assert.match(relais.scriptDuRelais() ?? '', /AXIsProcessTrusted/);

  const { code } = relais.emettreUnCodeDuRelais('compte-2', Date.now(), null, null, 'saisie');
  const lie = relais.relierUnMac({ code, nom: 'Mac des autorisations' }, '127.0.0.2');
  assert.equal(lie.ok, true);
  if (!lie.ok) return;
  const voie = relais.verifierLeRelais(signe(lie.identifiant, lie.secret, ''), '');
  const appareilId = voie!.appareilId;

  // un relais d'avant ne rapporte rien : autorisations inconnues (`null`)
  void relais.attendreUnGeste(appareilId, { recopie: true });
  assert.equal(relais.programmesDuCompte('compte-2')[0]?.autorisations, null);

  // « Beluga Relais » les rapporte à chaque attente
  void relais.attendreUnGeste(appareilId, { recopie: true, accessibilite: true, ecran: false });
  const p = relais.programmesDuCompte('compte-2')[0]!;
  assert.deepEqual(p.autorisations, { accessibilite: true, ecran: false });
  assert.equal(shared.autorisationsDonnees(p), false);
  const attente = relais.attendreUnGeste(appareilId, { recopie: true, accessibilite: true, ecran: true });
  assert.equal(shared.autorisationsDonnees(relais.programmesDuCompte('compte-2')[0]), true);

  // rouvrir un réglage passe par un geste borné, rendu par le relais
  const ordinateurId = p.ordinateurId;
  const ouverture = relais.ouvrirUnReglageDuMac('compte-2', ordinateurId, 'ecran');
  const geste = await attente;
  assert.equal(geste?.geste, 'ouvrir_reglage');
  assert.deepEqual(geste?.args, { reglage: 'ecran' });
  relais.recevoirLaReponse(appareilId, { id: geste!.id, ok: true, resultat: { ouvert: 'ecran' } });
  await ouverture;
  await assert.rejects(relais.ouvrirUnReglageDuMac('compte-2', 'autre-ordinateur', 'ecran'), /pas installé/);
  relais.delierLeMac('compte-2');
});
