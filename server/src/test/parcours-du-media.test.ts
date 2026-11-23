import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LE PARCOURS D'UNE CRÉATION DE MÉDIA, CÔTÉ DÉMON (26/10/2026) : le bouton du
 * bas écrit chaque passage s'il est permis et le suivant ; « Passer aux
 * esquisses » vaut accord sur l'écrit du brief ; le studio photo rend une
 * retouche qui devient le média final ; le studio son exporte un mixage ; la
 * page Téléchargement range finaux, validés et esquisses, et l'archive porte
 * trois dossiers nommés d'après les étapes. Rien de tout cela n'appelle un
 * service payant.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'parcours-media-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_TRADUCTION_IDENTITE = '1';
process.env.BELUGA_MEDIAS = path.join(bacASable, 'disque-de-stockage', 'beluga-medias');

const shared = await import('@beluga/shared');
const { Agent, Card, Project } = shared;
const store = await import('../store.js');
const production = await import('../production.js');
const realisation = await import('../realisation.js');
const parcours = await import('../parcours-du-media.js');
const { joindreUnFichier } = await import('../joindre-fichier.js');

const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const projet = store.saveProject(Project.parse({ id: 'projet-parcours', name: 'Atelier Parcours', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

function carte(id: string, medias: string[]) {
  const c = store.saveCard(
    Card.parse({
      id: `carte-${id}`,
      projectId: projet.id,
      column: 'planned',
      position: 1,
      title: `Création ${id}`,
      run: { engine: 'claude', model: 'opus' },
      agentId: `cadrage-${id}`,
      parcours: { plans: [], realisationSouhaitee: true },
      realisation: { ...shared.realisationNeuve(), medias, demandeA: 1 },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveAgent(
    Agent.parse({ id: `cadrage-${id}`, projectId: projet.id, cardId: c.id, role: 'cadrage', title: 'Directeur', run: { engine: 'claude', model: 'opus' }, status: 'idle', createdAt: store.now(), updatedAt: store.now() }),
  );
  return c;
}

/** Un média FINI de la carte, rangé à la main (un fichier réel joint), comme une fabrication réussie. */
let n = 0;
async function mediaFini(cardId: string, fichier: string, plan: string, capacite: 'image' | 'animation' | 'voix' | 'musique', retenu = false) {
  const card = store.getCard(cardId)!;
  const jointe = await joindreUnFichier({ projectId: card.projectId, cardId, fichier, nom: path.basename(fichier) });
  assert.ok(jointe.ok);
  const genre = capacite === 'image' ? 'image' : capacite === 'animation' ? 'video' : 'son';
  const id = `m-${++n}`;
  const maintenant = Date.now() + n;
  const { getDb } = await import('../db.js');
  getDb()
    .prepare(
      `INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison, prix, source_prix, cout_reel, etat, question_id, echec, fichier, taille, attachment_id, etape, lot_id, retenu_le, source_id, mesure, cree_le, modifie_le)
       VALUES (?, ?, ?, NULL, 'b', ?, 1, ?, ?, 'kie', 'm', 'Modèle', '{"consigne":"x","format":"16:9"}', 'r', 0.02, 'credits-kie', NULL, 'fini', NULL, NULL, ?, 10, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    )
    .run(id, card.projectId, cardId, plan, capacite, genre, fichier, jointe.attachment.id, retenu ? maintenant : null, maintenant, maintenant);
  return { id, piece: jointe.attachment.id };
}

test('le bouton du bas : un passage permis et suivant s’écrit, un double clic ne change rien, et « Passer aux esquisses » valide l’écrit du brief', async () => {
  const c = carte('passage', ['musique']);
  // Sans brief, le passage est refusé avec ce qui manque.
  const refus = await parcours.passerALEtape(c.id, 'passer-esquisses');
  assert.equal(refus.ok, false);
  assert.match((refus as { raison: string }).raison, /brief n’est pas encore écrit/);
  production.noterUnElement({ cardId: c.id, projectId: c.projectId, genre: 'brief', cle: 'brief', titre: 'Brief', contenu: '- Objectif : un jingle (réponse)', etat: 'propose', parent: null });
  const ok = await parcours.passerALEtape(c.id, 'passer-esquisses');
  assert.deepEqual(ok, { ok: true, deja: false });
  assert.ok(store.getCard(c.id)!.realisation?.esquissesA);
  assert.equal(production.elementsDeLaCarte(c.id).find((e) => e.genre === 'brief')?.etat, 'valide', 'passer aux esquisses vaut accord sur le brief');
  assert.deepEqual(await parcours.passerALEtape(c.id, 'passer-esquisses'), { ok: true, deja: true });
  // Pas de saut : le montage attend un élément validé.
  const saut = await parcours.passerALEtape(c.id, 'passer-montage');
  assert.equal(saut.ok, false);
  assert.match((saut as { raison: string }).raison, /Validez au moins un élément/);
});

test('le studio photo rend une retouche sur le serveur : elle devient le média final, et les réglages se rouvrent', { skip: !ffmpeg && 'ffmpeg absent' }, async () => {
  const c = carte('photo', ['image']);
  const fichier = path.join(bacASable, 'photo.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=80x60:rate=1', '-frames:v', '1', fichier]);
  const m = await mediaFini(c.id, fichier, 'Affiche', 'image', true);
  const r = await parcours.rendreLaPhoto(c.id, m.id, { contraste: 30, saturation: -20, recadrage: { x: 0, y: 0, largeur: 0.5, hauteur: 0.5 } });
  assert.notEqual(r.attachmentId, m.piece, 'une nouvelle pièce, l’original gardé');
  const apres = shared.realisationDeLaCarte(store.getCard(c.id));
  assert.deepEqual(apres.finaux?.map((f) => [f.genre, f.source, f.studio]), [['image', m.id, 'photo']]);
  assert.equal(apres.retouchesPhoto?.[m.id]?.contraste, 30);
  const piece = store.getAttachment(r.attachmentId)!;
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', (await import('../pieces-jointes.js')).cheminDePieceJointe(piece)]).toString().trim();
  assert.equal(dims, '40x30', 'le recadrage est rendu');
  // Un second rendu de la même image remplace le premier comme final.
  const r2 = await parcours.rendreLaPhoto(c.id, m.id, { exposition: 10 });
  assert.deepEqual(shared.realisationDeLaCarte(store.getCard(c.id)).finaux?.map((f) => f.piece), [r2.attachmentId]);
});

test('le studio son part des sons validés, s’enregistre, et exporte un mixage final', { skip: !ffmpeg && 'ffmpeg absent' }, async () => {
  const c = carte('son', ['voix', 'musique']);
  const ton = (nom: string, hz: number, s: number) => {
    const f = path.join(bacASable, `${nom}.mp3`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${s}`, f]);
    return f;
  };
  const voix = await mediaFini(c.id, ton('voix', 440, 2), 'Voix off', 'voix', true);
  await mediaFini(c.id, ton('musique', 220, 3), 'Musique', 'musique', true);
  await mediaFini(c.id, ton('rejet', 330, 1), 'Brouillon', 'musique', false);
  const montage = await parcours.montageSonDeLaCarte(c.id);
  assert.equal(montage.extraits.length, 2, 'seulement les sons validés');
  assert.equal(montage.extraits.find((x) => x.mediaId === voix.id)?.piste, 'voix');
  const enregistre = parcours.enregistrerLeMontageSon(c.id, { ...montage, normaliser: false });
  assert.equal(shared.realisationDeLaCarte(store.getCard(c.id)).montageSon?.normaliser, false);
  const r = await parcours.exporterLeSon(c.id, enregistre, 'mp3');
  const final = shared.realisationDeLaCarte(store.getCard(c.id)).finaux?.find((f) => f.piece === r.attachmentId);
  assert.equal(final?.genre, 'son');
  assert.equal(store.getAttachment(r.attachmentId)?.mime.startsWith('audio/'), true);
});

test('la page Téléchargement et son archive : finaux, validés, esquisses, en trois dossiers nommés d’après les étapes', { skip: !ffmpeg && 'ffmpeg absent' }, async () => {
  const c = carte('telechargement', ['image']);
  const image = (nom: string) => {
    const f = path.join(bacASable, `${nom}.png`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${nom}:size=16x16`, '-frames:v', '1', f]);
    return f;
  };
  const gardee = await mediaFini(c.id, image('red'), 'Affiche', 'image', true);
  await mediaFini(c.id, image('blue'), 'Variante', 'image', false);
  await parcours.rendreLaPhoto(c.id, gardee.id, { saturation: 50 });
  const sections = await parcours.telechargementDeLaCarte(c.id);
  assert.equal(sections.finaux.length, 1, 'la retouche remplace l’original parmi les finaux');
  assert.equal(sections.valides.length, 1);
  assert.equal(sections.esquisses.length, 2, 'toutes les esquisses, validées ou non');
  const archive = await parcours.archiveDuTelechargement(c.id, 'fr');
  assert.ok(archive.ok);
  if (!archive.ok) return;
  const zip = path.join(bacASable, 'archive.zip');
  const ecriture = fs.createWriteStream(zip);
  await new Promise<void>((fin, echec) => {
    archive.flux.pipe(ecriture);
    ecriture.on('finish', () => fin());
    ecriture.on('error', echec);
  });
  assert.equal(await archive.poids, fs.statSync(zip).size, 'le poids annoncé est exact');
  const noms = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', zip]).toString().trim().split('\n');
  assert.ok(noms.some((x) => x.startsWith('Médias finaux/')), noms.join(', '));
  assert.ok(noms.some((x) => x.startsWith('Validés/')));
  assert.equal(noms.filter((x) => x.startsWith('Esquisses/')).length, 2);
  // En anglais, les dossiers suivent la langue.
  const anglaise = await parcours.archiveDuTelechargement(c.id, 'en');
  assert.ok(anglaise.ok);
  if (anglaise.ok) anglaise.flux.resume();
});

test('le panneau d’un média se chiffre sans rien dépenser, et refuse de partir avant les esquisses', async () => {
  const c = carte('panneau', ['image']);
  const fichier = path.join(bacASable, 'panneau.png');
  fs.writeFileSync(fichier, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c60000000049454e44ae426082', 'hex'));
  const m = await mediaFini(c.id, fichier, 'Portrait', 'image', true);
  const avant = realisation.depenseDeLaCarte(c.id);
  const refus = await realisation.lancerUnPanneau(c.id, { mediaId: m.id, operation: 'angles', service: 'kie', modele: 'google/nano-banana-edit', angle: 'profil-gauche' });
  assert.equal(refus.ok, false);
  assert.match((refus as { raison: string }).raison, /brief/);
  // Aucun service branché dans le bac à sable : le panneau le dit, sans rien lancer.
  const chiffre = await realisation.chiffrerUnPanneau(c.id, { mediaId: m.id, operation: 'visage' });
  assert.equal(chiffre.capacite, 'visage');
  assert.equal(chiffre.modeles.length, 0);
  assert.match(chiffre.raison ?? '', /branchez kie\.ai/);
  assert.equal(realisation.depenseDeLaCarte(c.id), avant, 'rien de plus n’est engagé');
  assert.equal(realisation.mediasDeLaCarte(c.id).length, 1, 'aucun devis créé');
});
