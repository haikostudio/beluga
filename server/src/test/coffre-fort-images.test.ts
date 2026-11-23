import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Attachment,
  DUREE_ARCHIVE_MS,
  FICHIERS_FICHE_OCTETS_MAX,
  PROJET_DU_COFFRE,
  refusDuFichierDuCoffre,
  refusDuPoidsDeLaFiche,
  imagesApresEnregistrement,
  jugerAcces,
  jugerImages,
} from '@beluga/shared';

/**
 * LES IMAGES DU COFFRE-FORT — une fiche porte des captures, des codes QR, des
 * documents scannés.
 *
 * Verrouillé ici : une image ne passe jamais par le garde-fou « une fiche par
 * secret » ; une correction qui ne dit rien des images (celle d'un agent) les
 * GARDE ; une image retirée ou purgée avec sa fiche est effacée du disque,
 * SAUF si une autre fiche la cite encore ; une pièce déposée ailleurs que dans
 * le coffre n'entre pas dans une fiche ; l'outil des agents donne le chemin de
 * chaque fichier et sait en joindre. Tout genre de fichier est accepté SAUF un
 * programme, sans limite de nombre, 1 Go au total par fiche.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-fort-images-'));
process.env.BELUGA_DATA = bacASable;

const coffre = await import('../coffre-fort.js');
const store = await import('../store.js');
const { callTool } = await import('../tools.js');
const { cheminDePieceJointe, dossierDEcriture } = await import('../pieces-jointes.js');
const { nomSurDisque } = await import('@beluga/shared');

const projet = store.saveProject({
  id: store.newId(),
  name: 'Projet Images',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

let compteur = 0;
/** Dépose une image comme le fait `/api/upload?coffre=1` : la ligne, et le fichier. */
function deposer(projectId = PROJET_DU_COFFRE, creeLe = Date.now(), taille = 4): { id: string; chemin: string } {
  compteur += 1;
  const id = store.newId();
  const piece = Attachment.parse({
    id,
    alias: `img${compteur}`,
    projectId,
    name: `capture-${compteur}.png`,
    mime: 'image/png',
    size: taille,
    sha: `sha-${compteur}`,
    createdAt: creeLe,
  });
  const chemin = path.join(dossierDEcriture(), nomSurDisque(piece));
  fs.writeFileSync(chemin, 'png!');
  store.saveAttachment(piece);
  assert.equal(cheminDePieceJointe(piece), chemin);
  return { id, chemin };
}

function ranger(nom: string, images?: string[], maintenant = Date.now()) {
  const r = coffre.enregistrerAcces(
    { nom, type: 'jeton', champs: { service: 'X', jeton: `j-${nom}` }, ...(images ? { images } : {}) },
    maintenant,
  );
  assert.equal(r.ok, true, (r as any).raison);
  return (r as any).acces as { id: string; images: string[] };
}

/* ------------------------------ Les règles ------------------------------ */

test('les images ne passent pas par le garde-fou « une fiche par secret »', () => {
  // Des identifiants qui ressemblent à des affectations de secrets : sans effet.
  const juge = jugerAcces({
    nom: 'Console',
    type: 'mot-de-passe',
    champs: { motDePasse: 'x' },
    images: ['API_KEY=abc', 'DB_PASSWORD=def', 'TOKEN=ghi'],
  });
  assert.equal(juge.ok, true);
  assert.deepEqual((juge as any).images, ['API_KEY=abc', 'DB_PASSWORD=def', 'TOKEN=ghi']);
});

test('des images absentes ne sont pas une liste vide : la fiche garde les siennes', () => {
  assert.equal(jugerImages(undefined), undefined);
  assert.equal(jugerImages('a'), undefined);
  assert.deepEqual(jugerImages([]), []);
  assert.deepEqual(jugerImages(['a', ' a ', 'b', 3, '']), ['a', 'b']);
  assert.equal(jugerImages(Array.from({ length: 40 }, (_, i) => `i${i}`))!.length, 40, 'plus de limite de nombre');
  assert.equal('images' in (jugerAcces({ nom: 'N', type: 'jeton', champs: {} }) as any), false);

  assert.deepEqual(imagesApresEnregistrement(['a', 'b'], undefined), { images: ['a', 'b'], retirees: [] });
  assert.deepEqual(imagesApresEnregistrement(['a', 'b'], ['b', 'c']), { images: ['b', 'c'], retirees: ['a'] });
  assert.deepEqual(imagesApresEnregistrement(['a'], []), { images: [], retirees: ['a'] });
});

test('le coffre prend tout fichier, sauf un programme', () => {
  const fichierDuCoffreAccepte = (mime: string, nom: string) => refusDuFichierDuCoffre(mime, nom) === null;
  assert.equal(fichierDuCoffreAccepte('image/png', 'a.png'), true);
  assert.equal(fichierDuCoffreAccepte('application/pdf', 'Recto.pdf'), true);
  assert.equal(fichierDuCoffreAccepte('video/mp4', 'film.mp4'), true);
  assert.equal(fichierDuCoffreAccepte('text/plain; charset=utf-8', 'notes.txt'), true);
  assert.equal(fichierDuCoffreAccepte('application/zip', 'archive.zip'), true);
  assert.equal(fichierDuCoffreAccepte('application/octet-stream', 'sans-extension'), true);
  assert.equal(fichierDuCoffreAccepte('', ''), true);
  // Par l'extension, même quand le navigateur ne dit rien du type.
  assert.equal(fichierDuCoffreAccepte('application/octet-stream', 'setup.EXE'), false);
  assert.equal(fichierDuCoffreAccepte('application/octet-stream', 'appli.apk'), false);
  assert.equal(fichierDuCoffreAccepte('', 'install.sh'), false);
  assert.equal(fichierDuCoffreAccepte('', 'Logiciel.dmg'), false);
  // Par le type annoncé, même avec un nom trompeur.
  assert.equal(fichierDuCoffreAccepte('application/x-msdownload', 'photo.png'), false);
  assert.match(refusDuFichierDuCoffre('application/octet-stream', 'setup.exe')!, /programme/);

  assert.equal(refusDuPoidsDeLaFiche(FICHIERS_FICHE_OCTETS_MAX), null);
  assert.match(refusDuPoidsDeLaFiche(FICHIERS_FICHE_OCTETS_MAX + 1)!, /1 Go/);
});

/* ------------------------------ Le rangement ------------------------------ */

test('une fiche garde ses images, et les rend avec leur chemin', () => {
  const a = deposer();
  const b = deposer();
  const fiche = ranger('Fiche à deux images', [a.id, b.id]);
  assert.deepEqual(fiche.images, [a.id, b.id]);
  const relue = coffre.listerAcces().find((x) => x.id === fiche.id)!;
  assert.deepEqual(relue.images, [a.id, b.id]);
  const pieces = coffre.imagesDesAcces([relue]);
  assert.deepEqual(pieces.map((p) => p.chemin), [a.chemin, b.chemin]);
});

test('une correction qui ne dit rien des images les garde — celle d’un agent, par exemple', async () => {
  const a = deposer();
  const fiche = ranger('Fiche corrigée par un agent', [a.id]);
  const r = await callTool({ agentId: 'ag', projectId: projet.id, role: 'task' } as any, 'coffre_fort', {
    action: 'enregistrer',
    id: fiche.id,
    nom: 'Fiche corrigée par un agent',
    type: 'jeton',
    champs: { service: 'X', jeton: 'nouveau-jeton' },
  });
  assert.equal(r.ok, true, r.text);
  const relue = coffre.listerAcces().find((x) => x.id === fiche.id)!;
  assert.equal(relue.champs.jeton, 'nouveau-jeton');
  assert.deepEqual(relue.images, [a.id]);
  assert.equal(fs.existsSync(a.chemin), true);
});

const agent = { agentId: 'ag', projectId: projet.id, role: 'task' } as any;

/** Une pièce jointe ordinaire, rangée sous le projet d'une carte (pas du coffre). */
function pieceDeCarte(alias: string, nom: string, contenu: string): { id: string; chemin: string } {
  const id = store.newId();
  const piece = Attachment.parse({
    id,
    alias,
    projectId: projet.id,
    name: nom,
    mime: nom.endsWith('.png') ? 'image/png' : nom.endsWith('.pdf') ? 'application/pdf' : nom.endsWith('.exe') ? 'application/octet-stream' : 'text/plain',
    size: contenu.length,
    sha: `carte-${alias}`,
    createdAt: Date.now(),
  });
  const chemin = path.join(dossierDEcriture(), nomSurDisque(piece));
  fs.writeFileSync(chemin, contenu);
  store.saveAttachment(piece);
  return { id, chemin };
}

const enregistrerAvec = (fiche: { id: string }, nom: string, images?: unknown) =>
  callTool(agent, 'coffre_fort', {
    action: 'enregistrer',
    id: fiche.id,
    nom,
    type: 'jeton',
    champs: { service: 'X', jeton: 'j' },
    ...(images === undefined ? {} : { images }),
  });

test('l’outil des agents donne le chemin et l’id de chaque image', async () => {
  const a = deposer();
  ranger('Fiche lue par un agent', [a.id]);
  const liste = await callTool(agent, 'coffre_fort', { action: 'lister', recherche: 'Fiche lue par un agent' });
  assert.equal(liste.ok, true);
  assert.ok(liste.text.includes(`fichier : ${a.chemin}`), liste.text);
  assert.ok(liste.text.includes(`id ${a.id}`), liste.text);
});

test('un agent joint une pièce jointe par son alias : copie sous le coffre, la pièce de la carte reste', async () => {
  const source = pieceDeCarte('aa11', 'photo.png', 'contenu-photo');
  const fiche = ranger('Fiche à illustrer');
  const r = await enregistrerAvec(fiche, 'Fiche à illustrer', ['#aa11']);
  assert.equal(r.ok, true, r.text);
  const relue = coffre.listerAcces().find((x) => x.id === fiche.id)!;
  assert.equal(relue.images?.length, 1);
  const copie = store.getAttachment(relue.images![0]!)!;
  assert.equal(copie.projectId, PROJET_DU_COFFRE);
  assert.notEqual(copie.id, source.id);
  assert.equal(fs.readFileSync(cheminDePieceJointe(copie), 'utf8'), 'contenu-photo');
  const intacte = store.getAttachment(source.id)!;
  assert.equal(intacte.projectId, projet.id, 'la pièce de la carte garde son projet');
  assert.equal(fs.existsSync(source.chemin), true);
});

test('le même contenu ajouté deux fois ne fait qu’une image', async () => {
  pieceDeCarte('bb11', 'a.png', 'meme-contenu');
  pieceDeCarte('bb22', 'b.png', 'meme-contenu');
  const fiche = ranger('Fiche aux doublons');
  const r = await enregistrerAvec(fiche, 'Fiche aux doublons', ['bb11', 'bb22']);
  assert.equal(r.ok, true, r.text);
  assert.equal(coffre.listerAcces().find((x) => x.id === fiche.id)!.images?.length, 1);
});

test('un alias inconnu et un programme sont refusés avec leur raison', async () => {
  pieceDeCarte('cc11', 'setup.exe', 'MZ-programme');
  const a = deposer();
  const fiche = ranger('Fiche prudente', [a.id]);
  const inconnu = await enregistrerAvec(fiche, 'Fiche prudente', ['zz99']);
  assert.equal(inconnu.ok, false);
  assert.match(inconnu.text, /zz99/);
  assert.doesNotMatch(inconnu.text, /droit|refusé/i);
  const programme = await enregistrerAvec(fiche, 'Fiche prudente', [a.id, 'cc11']);
  assert.equal(programme.ok, false);
  assert.match(programme.text, /programme/);
  assert.deepEqual(coffre.listerAcces().find((x) => x.id === fiche.id)!.images, [a.id], 'rien n’a changé');
});

test('un PDF et un texte se joignent, et l’outil dit leur type', async () => {
  pieceDeCarte('pf11', 'Recto.pdf', '%PDF-1.4 recto');
  pieceDeCarte('tx11', 'notes.txt', 'des notes');
  const fiche = ranger('Fiche aux documents');
  const r = await enregistrerAvec(fiche, 'Fiche aux documents', ['pf11', '#tx11']);
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /Fichiers portés : 2/);
  const liste = await callTool(agent, 'coffre_fort', { action: 'lister', recherche: 'Fiche aux documents' });
  assert.match(liste.text, /fichier : .*\(Recto\.pdf, application\/pdf, /);
  assert.match(liste.text, /\(notes\.txt, text\/plain, /);
});

test('aucune limite de nombre : vingt fichiers passent', async () => {
  const fiche = ranger('Fiche très chargée');
  const alias = Array.from({ length: 20 }, (_, i) => {
    pieceDeCarte(`dd${i}`, `p${i}.png`, `contenu-${i}`);
    return `dd${i}`;
  });
  const r = await enregistrerAvec(fiche, 'Fiche très chargée', alias);
  assert.equal(r.ok, true, r.text);
  assert.equal(coffre.listerAcces().find((x) => x.id === fiche.id)!.images?.length, 20);
});

test('une fiche qui dépasserait 1 Go au total est refusée, avec sa raison', () => {
  // Deux fichiers de 600 Mo annoncés : la somme est jugée, pas chaque fichier.
  const lourd = () => deposer(PROJET_DU_COFFRE, Date.now(), 600 * 1024 * 1024);
  const a = lourd();
  const b = lourd();
  assert.equal(ranger('Fiche à 600 Mo', [a.id]).images.length, 1);
  const r = coffre.enregistrerAcces({ nom: 'Fiche à 1,2 Go', type: 'jeton', champs: { service: 'X', jeton: 'j' }, images: [a.id, b.id] });
  assert.equal(r.ok, false);
  assert.match((r as any).raison, /1 Go de fichiers au plus/);
});

test('corriger sans « images » garde les photos ; une liste vide les retire et efface le fichier', async () => {
  const a = deposer();
  const fiche = ranger('Fiche gardée puis vidée', [a.id]);
  const garde = await enregistrerAvec(fiche, 'Fiche gardée puis vidée');
  assert.equal(garde.ok, true, garde.text);
  assert.deepEqual(coffre.listerAcces().find((x) => x.id === fiche.id)!.images, [a.id]);
  const vide = await enregistrerAvec(fiche, 'Fiche gardée puis vidée', []);
  assert.equal(vide.ok, true, vide.text);
  assert.deepEqual(coffre.listerAcces().find((x) => x.id === fiche.id)!.images, []);
  assert.equal(fs.existsSync(a.chemin), false, 'le fichier orphelin est effacé');
});

test('redonner l’id d’une image portée la garde, avec une nouvelle', async () => {
  const a = deposer();
  pieceDeCarte('ee11', 'neuve.png', 'neuve');
  const fiche = ranger('Fiche augmentée', [a.id]);
  const r = await enregistrerAvec(fiche, 'Fiche augmentée', [a.id, 'ee11']);
  assert.equal(r.ok, true, r.text);
  const images = coffre.listerAcces().find((x) => x.id === fiche.id)!.images!;
  assert.equal(images.length, 2);
  assert.ok(images.includes(a.id));
  assert.equal(fs.existsSync(a.chemin), true);
});

test('une image retirée de sa fiche est effacée du disque', () => {
  const a = deposer();
  const b = deposer();
  const fiche = ranger('Fiche allégée', [a.id, b.id]);
  const r = coffre.enregistrerAcces({ id: fiche.id, nom: 'Fiche allégée', type: 'jeton', champs: { service: 'X', jeton: 'j' }, images: [b.id] });
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(a.chemin), false, 'le fichier retiré est effacé');
  assert.equal(store.getAttachment(a.id), null);
  assert.equal(fs.existsSync(b.chemin), true);
});

test('une image citée par DEUX fiches survit au retrait de l’une', () => {
  const commune = deposer();
  const une = ranger('Fiche une', [commune.id]);
  const deux = ranger('Fiche deux', [commune.id]);
  coffre.enregistrerAcces({ id: une.id, nom: 'Fiche une', type: 'jeton', champs: { service: 'X', jeton: 'j' }, images: [] });
  assert.equal(fs.existsSync(commune.chemin), true, 'l’autre fiche la cite encore');
  assert.deepEqual(coffre.listerAcces().find((x) => x.id === deux.id)!.images, [commune.id]);
});

test('archiver et restaurer ne touchent pas aux images ; la purge les efface avec la fiche', () => {
  const a = deposer();
  const partagee = deposer();
  const t0 = Date.now() - DUREE_ARCHIVE_MS - 10_000;
  const fiche = ranger('Fiche à purger', [a.id, partagee.id], t0);
  ranger('Fiche qui reste', [partagee.id]);

  assert.equal(coffre.supprimerAcces(fiche.id, t0).ok, true);
  assert.deepEqual(coffre.listerArchives().find((x) => x.id === fiche.id)!.images, [a.id, partagee.id]);
  assert.equal(fs.existsSync(a.chemin), true, 'une fiche archivée garde ses fichiers');

  assert.equal(coffre.restaurerAcces(fiche.id).ok, true);
  assert.deepEqual(coffre.listerAcces().find((x) => x.id === fiche.id)!.images, [a.id, partagee.id]);

  assert.equal(coffre.supprimerAcces(fiche.id, t0).ok, true);
  assert.equal(coffre.purgerArchives(), 1);
  assert.equal(fs.existsSync(a.chemin), false, 'l’image de la fiche purgée est effacée');
  assert.equal(store.getAttachment(a.id), null);
  assert.equal(fs.existsSync(partagee.chemin), true, 'l’image qu’une autre fiche cite reste');
});

test('une pièce déposée hors du coffre n’entre pas dans une fiche, et n’est jamais effacée par lui', () => {
  const dUneCarte = deposer(projet.id);
  const r = coffre.enregistrerAcces({ nom: 'Fiche pirate', type: 'jeton', champs: { service: 'X', jeton: 'j' }, images: [dUneCarte.id] });
  assert.equal(r.ok, false);
  assert.match((r as any).raison, /pas été déposé dans le coffre-fort/);
  assert.equal(coffre.effacerLesImagesOrphelines([dUneCarte.id]), 0);
  assert.equal(fs.existsSync(dUneCarte.chemin), true);

  const inconnue = coffre.enregistrerAcces({ nom: 'Fiche trouée', type: 'jeton', champs: { service: 'X', jeton: 'j' }, images: ['inconnue'] });
  assert.equal(inconnue.ok, false);
});

test('une image envoyée puis jamais rattachée est balayée après un jour, pas avant', () => {
  const hier = deposer(PROJET_DU_COFFRE, Date.now() - 25 * 3600_000);
  const fraiche = deposer();
  const citee = deposer(PROJET_DU_COFFRE, Date.now() - 25 * 3600_000);
  ranger('Fiche qui cite une vieille image', [citee.id]);
  coffre.balayerLesImagesSansFiche();
  assert.equal(fs.existsSync(hier.chemin), false);
  assert.equal(fs.existsSync(fraiche.chemin), true, 'la fiche est peut-être encore ouverte à l’écran');
  assert.equal(fs.existsSync(citee.chemin), true);
});
