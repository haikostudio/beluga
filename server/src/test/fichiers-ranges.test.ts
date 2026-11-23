/**
 * LE REGISTRE ET LE MIROIR DES FICHIERS RANGÉS (carte « Fichiers rangés et captures pleine page »).
 *
 * Ce que ces essais verrouillent, sur une base jetable : l'essai à blanc ne touche à rien ; le rangement range chaque
 * pièce, document et journal sous `<Projet>/<Service>/…` avec un LIEN vers l'endroit où il vit (l'ancien chemin
 * reste valide, rien n'est copié) ; il est idempotent ; un collaborateur ne voit que son projet, ni journaux ni
 * commun ; la corbeille retire puis restaure ; un dépôt vit pour de vrai dans l'arbre ; la recherche plein texte
 * trouve un document par un mot de son contenu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fichiers-ranges-'));
process.env.BELUGA_SANS_RANGEMENT = '1';

const { Agent, Attachment, Card, Project } = await import('@beluga/shared');
const { PATHS } = await import('../config.js');
const store = await import('../store.js');
const ranges = await import('../fichiers-ranges.js');

const admin = { role: 'admin', projets: [] as string[] };
const membre = { role: 'membre', projets: ['p-site'] };

const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-site-'));
fs.writeFileSync(path.join(depot, 'index.html'), '<h1>Bonjour</h1>');
store.saveProject(Project.parse({ id: 'p-site', name: 'Site vitrine', path: depot, createdAt: 1, updatedAt: 1 }));
store.saveProject(Project.parse({ id: 'p-autre', name: 'Autre projet', path: depot, createdAt: 2, updatedAt: 2 }));
store.saveCard(Card.parse({ id: 'c0ffee12-0000-4000-8000-000000000000', projectId: 'p-site', column: 'archived', position: 1, title: 'Refonte de l’accueil', run: { engine: 'claude' }, createdAt: 1, updatedAt: 1 }));
store.saveAgent(Agent.parse({ id: 'agent-1', projectId: 'p-site', cardId: 'c0ffee12-0000-4000-8000-000000000000', role: 'task', title: 'Agent', run: { engine: 'claude' }, status: 'done', createdAt: 1, updatedAt: 1 }));

fs.mkdirSync(PATHS.attachments, { recursive: true });
function piece(id: string, projectId: string, name: string, extra: Record<string, unknown> = {}) {
  store.saveAttachment(Attachment.parse({ id, projectId, alias: id.slice(0, 4), name, mime: 'image/png', size: 3, sha: `sha-${id}`, createdAt: 10, ...extra }));
  fs.writeFileSync(path.join(PATHS.attachments, `${id.slice(0, 4)}-${name}`), 'png');
}
piece('aaaa1111', 'p-site', 'maquette.png', { cardId: 'c0ffee12-0000-4000-8000-000000000000' });
piece('bbbb2222', 'p-site', 'maquette.png', { cardId: 'c0ffee12-0000-4000-8000-000000000000' });
piece('cccc3333', 'p-autre', 'logo.png');
fs.mkdirSync(PATHS.docs, { recursive: true });
fs.writeFileSync(path.join(PATHS.docs, 'refonte-de-l-accueil-c0ffee12.md'), '# Cahier\nLa page d’accueil présente les tarifs de la boulangerie.');
fs.writeFileSync(path.join(PATHS.docs, 'orphelin-deadbeef.md'), 'sans carte');
fs.mkdirSync(PATHS.logs, { recursive: true });
fs.writeFileSync(path.join(PATHS.logs, 'agent-1.log'), 'journal');

test("l'essai à blanc rend le rapport sans rien écrire", async () => {
  const r = await ranges.rangerLesFichiers({ essai: true });
  assert.equal(r.essai, true);
  assert.equal(r.parService.conversations, 3);
  assert.equal(r.parService.cartes, 2);
  assert.equal(r.parService.journaux, 1);
  assert.ok(r.nonClasses >= 1, 'le document orphelin va au commun');
  assert.equal(ranges.dernierRangement(), null);
  assert.ok(!fs.existsSync(path.join(PATHS.fichiers, 'Site vitrine')), 'aucun lien posé');
});

test('le rangement pose un lien par fichier, sans copier ni casser l’ancien chemin', async () => {
  const r = await ranges.rangerLesFichiers();
  assert.equal(r.nouveaux, r.total);
  const dossier = path.join(PATHS.fichiers, 'Site vitrine', 'Conversations', 'Refonte de l’accueil');
  const noms = fs.readdirSync(dossier).sort();
  assert.deepEqual(noms, ['maquette (2).png', 'maquette.png'], 'deux homonymes, deux noms');
  for (const n of noms) assert.ok(fs.lstatSync(path.join(dossier, n)).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(PATHS.attachments, 'aaaa-maquette.png')), 'l’original reste à sa place');
  assert.ok(fs.lstatSync(path.join(PATHS.fichiers, 'Site vitrine', 'Cartes', 'Refonte de l’accueil.md')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(PATHS.fichiers, 'Commun', 'Cartes', 'Non classés', 'orphelin-deadbeef.md')));
  assert.ok(ranges.dernierRangement());
});

test('relancé, le rangement ne change rien', async () => {
  const r = await ranges.rangerLesFichiers();
  assert.equal(r.nouveaux, 0);
  assert.equal(r.misAJour, 0);
  assert.equal(r.liensCrees, 0);
});

test('un collaborateur ne voit que son projet, sans journaux ni commun', () => {
  const racine = ranges.lireLeDossier(membre, '')!;
  assert.deepEqual(racine.dossiers.map((d) => d.nom), ['Site vitrine']);
  const projet = ranges.lireLeDossier(membre, 'Site vitrine')!;
  const services = projet.dossiers.map((d) => d.service);
  assert.ok(services.includes('conversations') && services.includes('cartes') && services.includes('code'));
  assert.ok(!services.includes('journaux'));
  assert.equal(ranges.lireLeDossier(membre, 'Autre projet'), null);
  assert.equal(ranges.lireLeDossier(membre, 'Commun'), null);
  assert.equal(ranges.lireLeDossier(membre, 'Site vitrine/Journaux'), null);
  const adminRacine = ranges.lireLeDossier(admin, '')!;
  assert.ok(adminRacine.dossiers.some((d) => d.nom === 'Commun'));
  assert.ok(ranges.lireLeDossier(admin, 'Site vitrine')!.dossiers.some((d) => d.service === 'journaux'));
});

test('le contenu se sert seulement à qui a le droit de le voir', () => {
  const journal = ranges.lireLeDossier(admin, 'Site vitrine/Journaux/Refonte de l’accueil')!.fichiers[0]!;
  assert.ok(ranges.fichierAServir(admin, journal.id));
  assert.equal(ranges.fichierAServir(membre, journal.id), null);
  const code = ranges.lireLeDossier(membre, 'Site vitrine/Code')!;
  const index = code.fichiers.find((f) => f.nom === 'index.html')!;
  assert.ok(ranges.fichierAServir(membre, index.id));
  assert.equal(ranges.fichierAServir(membre, `code:p-site:../../etc/passwd`), null);
});

test('la corbeille retire, puis restaure', () => {
  const f = ranges.lireLeDossier(membre, 'Site vitrine/Conversations/Refonte de l’accueil')!.fichiers.find((x) => x.nom === 'maquette.png')!;
  ranges.mettreALaCorbeille(membre, f.id);
  assert.ok(!fs.existsSync(path.join(PATHS.fichiers, 'Site vitrine', 'Conversations', 'Refonte de l’accueil', 'maquette.png')));
  assert.equal(ranges.lireLaCorbeille(membre).length, 1);
  assert.ok(fs.existsSync(path.join(PATHS.attachments, 'aaaa-maquette.png')), 'rien d’effacé avant trente jours');
  ranges.restaurerUnFichier(membre, f.id);
  assert.ok(fs.lstatSync(path.join(PATHS.fichiers, 'Site vitrine', 'Conversations', 'Refonte de l’accueil', 'maquette.png')).isSymbolicLink());
  assert.throws(() => ranges.mettreALaCorbeille({ role: 'lecteur', projets: ['p-site'] }, f.id));
});

test('un fichier déposé vit pour de vrai dans l’arbre, et se renomme sur le disque', () => {
  const f = ranges.deposerUnFichier(membre, 'Site vitrine/Ajouts', 'notes.txt', Buffer.from('rendez-vous avec le fournisseur de farine'));
  const reel = path.join(PATHS.fichiers, 'Site vitrine', 'Ajouts', 'notes.txt');
  assert.ok(fs.lstatSync(reel).isFile());
  const r = ranges.renommerUnFichier(membre, f.id, 'compte-rendu.txt');
  assert.equal(r.nom, 'compte-rendu.txt');
  assert.ok(fs.existsSync(path.join(PATHS.fichiers, 'Site vitrine', 'Ajouts', 'compte-rendu.txt')));
  assert.throws(() => ranges.deposerUnFichier(membre, 'Autre projet/Ajouts', 'x.txt', Buffer.from('x')));
});

test('un rangement suivant garde le nom choisi et le fichier déposé', async () => {
  await ranges.rangerLesFichiers();
  assert.ok(fs.existsSync(path.join(PATHS.fichiers, 'Site vitrine', 'Ajouts', 'compte-rendu.txt')));
});

test('la recherche trouve un document par un mot de son contenu, dans la portée du compte', async () => {
  const { resultats } = await ranges.chercherDesFichiers(membre, 'boulangerie');
  assert.equal(resultats[0]?.nom, 'Refonte de l’accueil.md');
  assert.match(resultats[0]!.extrait, /boulangerie/);
  const prefixe = await ranges.chercherDesFichiers(membre, 'farin');
  assert.equal(prefixe.resultats[0]?.nom, 'compte-rendu.txt', 'le dernier mot cherche en préfixe');
  const horsPortee = await ranges.chercherDesFichiers(membre, 'logo');
  assert.equal(horsPortee.resultats.length, 0, 'le logo de l’autre projet reste caché');
  assert.equal((await ranges.chercherDesFichiers(admin, 'logo')).resultats.length, 1);
});

test('une pièce neuve arrive directement à sa place', async () => {
  piece('dddd4444', 'p-site', 'photo-neuve.png', { cardId: 'c0ffee12-0000-4000-8000-000000000000' });
  ranges.rangerLesPieces(['dddd4444']);
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(fs.lstatSync(path.join(PATHS.fichiers, 'Site vitrine', 'Conversations', 'Refonte de l’accueil', 'photo-neuve.png')).isSymbolicLink());
});

test('les médias fabriqués sont MONTRÉS sous « Médias » de leur projet, relus sans tout reparcourir', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { releverLesMedias, mediasVoulus } = await import('../fichiers-ranges.js');
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'medias-'));
  fs.mkdirSync(path.join(racine, 'sans-projet-connu', 'carte-x'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'sans-projet-connu', 'carte-x', 'plan-v1.png'), 'png');
  fs.writeFileSync(path.join(racine, 'sans-projet-connu', '.en-cours.wav'), 'cache');
  await releverLesMedias(racine);
  const vues = mediasVoulus(racine).filter((v) => v.cheminReel.startsWith(racine));
  assert.equal(vues.length, 1, 'un fichier caché ne se montre pas');
  assert.equal(vues[0].service, 'medias');
  assert.equal(vues[0].nom, 'plan-v1.png');
  assert.equal(vues[0].dossier, 'sans-projet-connu/carte-x', 'sans projet, le dossier d’origine reste en tête');
  assert.equal(vues[0].taille, 3);
  // Un fichier ajouté plus bas se voit au relevé suivant.
  fs.writeFileSync(path.join(racine, 'sans-projet-connu', 'carte-x', 'plan-v2.png'), 'png2');
  const date = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(racine, 'sans-projet-connu', 'carte-x'), date, date);
  await releverLesMedias(racine);
  assert.equal(mediasVoulus(racine).filter((v) => v.cheminReel.startsWith(racine)).length, 2);
  fs.rmSync(racine, { recursive: true, force: true });
});
