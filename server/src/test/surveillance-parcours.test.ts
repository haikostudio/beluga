import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/*
 * UNE SURVEILLANCE PAR PARCOURS, JOUÉE POUR DE VRAI.
 *
 * Un faux site protégé par mot de passe est servi ici même. Ce que ces tests
 * verrouillent : le parcours passe avec le bon accès lu au COFFRE-FORT, tombe en
 * NOMMANT l'étape avec un mauvais, l'outil de l'agent refuse d'enregistrer une
 * recette qui tombe, et changer le mot de passe au coffre suffit pour que le
 * passage suivant repasse au vert — historique écrit à chaque passage.
 *
 * Le bac à sable est posé AVANT le premier import du démon : la base servie
 * n'est jamais touchée (`scripts/verif-tests-isoles.mjs`).
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'surveillance-parcours-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Card, LABEL_SURVEILLANCE, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { enregistrerAcces } = await import('../coffre-fort.js');
const surveillance = await import('../surveillance.js');

const MOT_DE_PASSE = 'correct-cheval';
const site = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/connexion') {
    let corps = '';
    req.on('data', (d) => (corps += d));
    req.on('end', () => {
      const champs = new URLSearchParams(corps);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        champs.get('motdepasse') === MOT_DE_PASSE
          ? '<html><body><h1>Tableau de bord</h1></body></html>'
          : '<html><body><p>Accès refusé</p></body></html>',
      );
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    '<html><body><form method="post" action="/connexion"><input id="identifiant" name="identifiant"><input id="motdepasse" name="motdepasse" type="password"><button type="submit">Entrer</button></form></body></html>',
  );
});
await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
const adresse = `http://localhost:${(site.address() as AddressInfo).port}/`;

// Chrome absent de la machine : le parcours ne peut pas se jouer, le test le dit au lieu de mentir.
const chrome = ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'].some((c) => fs.existsSync(c));

const projet = store.saveProject(
  Project.parse({ id: 'projet-surv', name: 'Projet surveillance', path: bacASable, isSelf: true, createdAt: store.now(), updatedAt: store.now() }),
);
// Comme `ouvrirCarteDAgent` : l'agent de surveillance naît avec SA carte étiquetée,
// sans quoi l'outil ne le retient pas comme conversation du site (agents de volet).
store.saveCard(
  Card.parse({ id: 'carte-surv', projectId: projet.id, title: 'Surveillance', column: 'running', position: 0, labels: [LABEL_SURVEILLANCE], run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now() }),
);
const agent = store.saveAgent(
  Agent.parse({
    id: 'agent-surv',
    projectId: projet.id,
    cardId: 'carte-surv',
    role: 'task',
    title: 'Agent de surveillance',
    run: { engine: 'claude' },
    status: 'running',
    createdAt: store.now(),
    updatedAt: store.now(),
  }),
);
const contexte = { agentId: agent.id, projectId: projet.id, role: 'task' as const };

const fiche = enregistrerAcces({
  nom: 'Faux site',
  type: 'mot-de-passe',
  champs: { adresse, identifiant: 'haiko', motDePasse: 'mauvais' },
});
assert.ok(fiche.ok, 'la fiche du coffre-fort s’enregistre');
const idFiche = fiche.ok ? fiche.acces.id : '';

const recette = {
  type: 'parcours',
  explication: 'Connexion puis tableau de bord',
  etapes: [
    { action: 'aller', url: adresse },
    { action: 'remplir', selecteur: '#identifiant', acces: { id: idFiche, champ: 'identifiant' } },
    { action: 'remplir', selecteur: '#motdepasse', acces: { id: idFiche, champ: 'motDePasse' } },
    { action: 'cliquer', selecteur: 'button[type=submit]' },
    { action: 'verifierTexte', texte: 'Tableau de bord' },
  ],
};

test.after(async () => {
  await surveillance.fermerNavigateur();
  site.close();
});

test('un appel simple avec mot attendu passe, et le mot absent tombe en « contenu »', async () => {
  const bon = await surveillance.jouerRecette(adresse, { type: 'appel', motAttendu: 'Entrer' });
  assert.equal(bon.etat, 'ok');
  const absent = await surveillance.jouerRecette(adresse, { type: 'appel', motAttendu: 'Introuvable' });
  assert.equal(absent.raison, 'contenu');
});

test('avec un mauvais mot de passe, le parcours tombe en nommant l’étape, et rien ne s’enregistre', { skip: !chrome }, async () => {
  const essai = await callTool(contexte, 'surveillance_essai', { url: adresse, recette });
  assert.equal(essai.ok, true);
  assert.match(essai.text, /TOMBÉ/);
  assert.match(essai.text, /Tableau de bord/);

  const refus = await callTool(contexte, 'surveillance_recette', { url: adresse, nom: 'Faux site', recette });
  assert.equal(refus.ok, false);
  assert.match(refus.text, /NON enregistrée/);
  assert.equal(surveillance.listerSites().length, 0);
});

test('le bon accès au coffre-fort fait passer le parcours, et la surveillance s’enregistre avec son rythme', { skip: !chrome }, async () => {
  enregistrerAcces({ id: idFiche, nom: 'Faux site', type: 'mot-de-passe', champs: { adresse, identifiant: 'haiko', motDePasse: MOT_DE_PASSE } });
  const resultat = await callTool(contexte, 'surveillance_recette', { url: adresse, nom: 'Faux site', recette, periodeMinutes: 10 });
  assert.equal(resultat.ok, true, resultat.text);
  const [enregistree] = surveillance.listerSites();
  assert.equal(enregistree.periodeMs, 10 * 60_000);
  assert.equal(enregistree.recette?.type, 'parcours');
  assert.equal(enregistree.agentId, agent.id);
  // Aucun secret dans la recette gardée.
  assert.equal(JSON.stringify(enregistree.recette).includes(MOT_DE_PASSE), false);
});

test('un mot de passe changé au coffre casse le passage suivant, le remettre le répare, et l’historique suit', { skip: !chrome }, async () => {
  const [site1] = surveillance.listerSites();
  enregistrerAcces({ id: idFiche, nom: 'Faux site', type: 'mot-de-passe', champs: { adresse, identifiant: 'haiko', motDePasse: 'perime' } });
  await surveillance.verifierSites([site1.id]);
  const tombe = surveillance.lireSurveillance(site1.id)!;
  assert.equal(tombe.etat, 'panne');
  assert.match(tombe.etapeEchouee ?? '', /Tableau de bord/);

  enregistrerAcces({ id: idFiche, nom: 'Faux site', type: 'mot-de-passe', champs: { adresse, identifiant: 'haiko', motDePasse: MOT_DE_PASSE } });
  await surveillance.verifierSites([site1.id]);
  assert.equal(surveillance.lireSurveillance(site1.id)!.etat, 'ok');

  const historique = surveillance.listerControles(site1.id);
  assert.ok(historique.length >= 2, `au moins deux passages gardés (${historique.length})`);
  assert.ok(historique.some((c) => c.etat === 'panne' && c.etape));
});

test('l’historique de plus de 24 heures s’efface', async () => {
  const { getDb } = await import('../db.js');
  const [site1] = surveillance.listerSites().length ? surveillance.listerSites() : [surveillance.ajouterSite(adresse, 'Appel').ok && surveillance.listerSites()[0]];
  const id = (site1 as { id: string }).id;
  getDb()
    .prepare('INSERT INTO controles_surveillance (site_id, instant, etat, duree_ms) VALUES (?, ?, ?, 1)')
    .run(id, Date.now() - 25 * 3_600_000, 'ok');
  assert.ok(surveillance.purgerHistorique() >= 1);
  assert.equal(
    (getDb().prepare('SELECT count(*) AS n FROM controles_surveillance WHERE instant < ?').get(Date.now() - 24 * 3_600_000) as { n: number }).n,
    0,
  );
});
