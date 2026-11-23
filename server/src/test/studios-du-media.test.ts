import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LES STUDIOS D'UNE CRÉATION DE MÉDIA (26/10/2026) — photo et son, gratuits,
 * rendus par ffmpeg — et les règles d'argent du nouveau parcours : le bouton
 * « Générer · prix », le réessai d'office une seule fois, le garde qui refuse
 * de fabriquer hors de kie.ai. Règles pures (`shared/src/studios-du-media.ts`,
 * `shared/src/production.ts`, `shared/src/garde-creation.ts`), éprouvées avec
 * le VRAI ffmpeg du serveur quand il est là.
 */
const shared = await import('@beluga/shared');
const {
  reglagesPhotoLus,
  reglagesPhotoNeutres,
  photoInchangee,
  matriceDeCouleur,
  courbeDeTon,
  tableDeTon,
  noyauDeNettete,
  facteurDeRedressement,
  cadreDuFormat,
  filtresFfmpegDeLaPhoto,
  MontageSon,
  mixageFfmpeg,
  dureeDuMontageSon,
  extraitsEntendus,
  argumentsDuFormatSon,
  montageSonDeDepart,
  ajouterUnFinal,
  reessaiDOfficePermis,
  lotValideParLaReponse,
  questionDUneGeneration,
  commandeFabriqueHorsDeKie,
  refusDeCreation,
  nombreDePropositions,
  PROPOSITIONS_MIN_D_UN_MEDIA,
} = shared;

const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('les réglages photo se lisent avec tolérance : bornes, formats inconnus, cadre entier oublié', () => {
  const r = reglagesPhotoLus({ exposition: 250, contraste: -40.4, nettete: -5, format: 'carré', quartDeTour: 5, redressement: 90, recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 } });
  assert.equal(r.exposition, 100);
  assert.equal(r.contraste, -40);
  assert.equal(r.nettete, 0);
  assert.equal(r.format, 'libre');
  assert.equal(r.quartDeTour, 3);
  assert.equal(r.redressement, 45);
  assert.equal(r.recadrage, undefined, 'le cadre entier n’est pas un recadrage');
  assert.equal(photoInchangee(reglagesPhotoNeutres()), true);
  assert.equal(photoInchangee({ ...reglagesPhotoNeutres(), saturation: 10 }), false);
  // Un format fixe donne le plus grand cadre centré.
  const carre = cadreDuFormat('1:1', 1600, 900)!;
  assert.ok(Math.abs(carre.largeur - 900 / 1600) < 1e-9 && carre.hauteur === 1 && Math.abs(carre.x - (1 - 900 / 1600) / 2) < 1e-9);
  assert.equal(cadreDuFormat('libre', 100, 100), undefined);
});

test('la couleur et le ton : neutres à zéro, la saturation garde la luminance, la courbe reste dans [0, 1]', () => {
  const neutre = matriceDeCouleur(reglagesPhotoNeutres());
  assert.deepEqual(neutre, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  // Désaturée : chaque ligne vaut les poids de luminance.
  const gris = matriceDeCouleur({ ...reglagesPhotoNeutres(), saturation: -100 });
  for (const ligne of gris) assert.deepEqual(ligne.map((v) => Math.round(v * 1000) / 1000), [0.213, 0.715, 0.072]);
  // +100 d'exposition = un diaphragme : tout double.
  assert.equal(matriceDeCouleur({ ...reglagesPhotoNeutres(), exposition: 100 })[0]![0], 2);
  const f = courbeDeTon({ contraste: 60, ombres: 50, hautesLumieres: -50 });
  for (let i = 0; i <= 20; i++) {
    const v = f(i / 20);
    assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(courbeDeTon({ contraste: 0, ombres: 0, hautesLumieres: 0 })(0.37), 0.37);
  assert.equal(tableDeTon({ contraste: 0, ombres: 0, hautesLumieres: 0 }, 5).join(), '0,0.25,0.5,0.75,1');
  assert.equal(noyauDeNettete(0).join(), '0,0,0,0,1,0,0,0,0');
  assert.ok(Math.abs(noyauDeNettete(100).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'le noyau garde la luminosité moyenne');
  assert.equal(facteurDeRedressement(1000, 500, 0), 1);
  assert.ok(facteurDeRedressement(1000, 500, 10) < 1);
});

test('la chaîne ffmpeg du rendu : quart de tour, redressement sans coins vides, recadrage, couleur, ton, netteté, vignettage', () => {
  const r = reglagesPhotoLus({ quartDeTour: 1, redressement: 5, recadrage: { x: 0.1, y: 0.2, largeur: 0.5, hauteur: 0.5 }, saturation: 20, contraste: 10, nettete: 30, vignettage: 40 });
  const f = filtresFfmpegDeLaPhoto(r, { largeur: 800, hauteur: 600 });
  assert.match(f, /^transpose=1,rotate=/);
  assert.match(f, /crop=trunc\(iw\*0\.\d+\/2\)\*2:trunc\(ih\*0\.\d+\/2\)\*2,crop=/);
  assert.match(f, /colorchannelmixer=rr=/);
  assert.match(f, /lutrgb=r=st\(1\\,clip/, 'les virgules des expressions sont protégées');
  assert.match(f, /convolution=0m=0 -18 0 -18 172 -18 0 -18 0/);
  assert.match(f, /vignette=a=/);
  assert.equal(filtresFfmpegDeLaPhoto(reglagesPhotoNeutres(), { largeur: 10, hauteur: 10 }), 'format=rgb24', 'des réglages neutres ne touchent rien');
});

test('le rendu ffmpeg tourne vraiment, et concorde avec l’aperçu : même matrice, même courbe, écart moyen borné', { skip: !ffmpeg && 'ffmpeg absent' }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-photo-'));
  const source = path.join(dossier, 'source.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=1', '-frames:v', '1', source]);
  const lire = (fichier: string, l: number, h: number) => execFileSync('ffmpeg', ['-v', 'error', '-i', fichier, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${l}x${h}`, '-']);
  const original = lire(source, 64, 48);
  // La couleur et le ton seuls : l'aperçu se calcule ici, pixel par pixel, avec les mêmes règles.
  const reglages = reglagesPhotoLus({ exposition: 20, saturation: 35, temperature: 30, teinte: -20, contraste: 25, ombres: 30, hautesLumieres: -20 });
  const sortie = path.join(dossier, 'rendu.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-vf', filtresFfmpegDeLaPhoto(reglages, { largeur: 64, hauteur: 48 }), '-frames:v', '1', sortie]);
  const rendu = lire(sortie, 64, 48);
  const m = matriceDeCouleur(reglages);
  const ton = courbeDeTon(reglages);
  let ecart = 0;
  for (let i = 0; i < original.length; i += 3) {
    const rgb = [original[i]! / 255, original[i + 1]! / 255, original[i + 2]! / 255];
    for (let c = 0; c < 3; c++) {
      const mixe = Math.max(0, Math.min(1, m[c]![0]! * rgb[0]! + m[c]![1]! * rgb[1]! + m[c]![2]! * rgb[2]!));
      ecart += Math.abs(ton(mixe) * 255 - rendu[i + c]!);
    }
  }
  const moyen = ecart / original.length;
  assert.ok(moyen < 3, `l’aperçu et le rendu concordent (écart moyen ${moyen.toFixed(2)} sur 255)`);
  // La géométrie : quart de tour et recadrage changent les dimensions comme prévu.
  const geo = reglagesPhotoLus({ quartDeTour: 1, recadrage: { x: 0, y: 0, largeur: 0.5, hauteur: 0.5 }, nettete: 50, vignettage: 50 });
  const tournee = path.join(dossier, 'tournee.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-vf', filtresFfmpegDeLaPhoto(geo, { largeur: 64, hauteur: 48 }), '-frames:v', '1', tournee]);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', tournee]).toString().trim();
  assert.equal(dims, '24x32', 'tournée (48×64), puis la moitié');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('le studio son : extraits coupés, dosés, fondus, placés, mixés sans baisser chaque entrée', () => {
  const montage = MontageSon.parse({
    extraits: [
      { id: 'a', piste: 'voix', piece: 'p-voix', duree: 4, debut: 1, entree: 0.5, fonduEntree: 0.2 },
      { id: 'b', piste: 'musique', piece: 'p-musique', duree: 6, volume: 0.6, fonduSortie: 1 },
      { id: 'c', piste: 'bruitages', piece: 'p-bruit', duree: 1, debut: 2 },
    ],
    volumes: { musique: 0.5 },
    muettes: ['bruitages'],
  });
  assert.equal(dureeDuMontageSon(montage), 6);
  const entendus = extraitsEntendus(montage);
  assert.deepEqual(entendus.map((x) => x.id), ['a', 'b'], 'une piste coupée ne s’entend pas');
  assert.equal(entendus[1]!.gain, 0.3, 'extrait × piste');
  const m = mixageFfmpeg(montage, (piece) => `/sons/${piece}.mp3`)!;
  assert.deepEqual(m.entrees, ['/sons/p-voix.mp3', '/sons/p-musique.mp3']);
  assert.match(m.filtre, /\[0:a\]atrim=start=0\.5:duration=4,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0\.2,volume=1,adelay=delays=1000:all=1\[a0\]/);
  assert.match(m.filtre, /afade=t=out:st=5:d=1,volume=0\.3\[a1\]/);
  assert.match(m.filtre, /\[a0\]\[a1\]amix=inputs=2:normalize=0:dropout_transition=0:duration=longest,loudnorm=I=-16/);
  assert.equal(mixageFfmpeg(MontageSon.parse({ extraits: [] }), () => ''), null);
  assert.deepEqual(argumentsDuFormatSon('wav').slice(0, 2), ['-c:a', 'pcm_s16le']);
  // Le premier montage : les voix à la suite, la musique sous elles, plus basse.
  const depart = montageSonDeDepart([
    { mediaId: 'm1', piece: 'v1', nom: 'Voix 1', capacite: 'voix', duree: 3 },
    { mediaId: 'm2', piece: 'v2', nom: 'Voix 2', capacite: 'voix', duree: 2 },
    { mediaId: 'm3', piece: 'mu', nom: 'Musique', capacite: 'musique', duree: 10 },
  ]);
  assert.deepEqual(depart.extraits.map((x) => [x.piste, x.debut, x.volume]), [['voix', 0, 1], ['voix', 3, 1], ['musique', 0, 0.6]]);
});

test('le mixage tourne vraiment avec ffmpeg et rend un MP3 à la bonne durée', { skip: !ffmpeg && 'ffmpeg absent' }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-son-'));
  const ton = (nom: string, hz: number, s: number) => {
    const f = path.join(dossier, `${nom}.wav`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${s}`, f]);
    return f;
  };
  const chemins: Record<string, string> = { voix: ton('voix', 440, 3), musique: ton('musique', 220, 5) };
  const montage = MontageSon.parse({
    extraits: [
      { id: 'a', piste: 'voix', piece: 'voix', duree: 2, debut: 1.5, entree: 0.5, fonduEntree: 0.3 },
      { id: 'b', piste: 'musique', piece: 'musique', duree: 4, volume: 0.5, fonduSortie: 1 },
    ],
  });
  const m = mixageFfmpeg(montage, (p) => chemins[p]!)!;
  const sortie = path.join(dossier, 'mixage.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...m.entrees.flatMap((e) => ['-i', e]), '-filter_complex', m.filtre, '-map', m.sortie, '-t', String(m.duree), ...argumentsDuFormatSon('mp3'), sortie]);
  const duree = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sortie]).toString().trim());
  assert.ok(Math.abs(duree - 4) < 0.15, `durée ${duree}`);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('les médias finaux : un nouveau rendu d’une même source remplace l’ancien', () => {
  const a = ajouterUnFinal([], { piece: 'p1', genre: 'image', source: 'm1', studio: 'photo', at: 1 });
  const b = ajouterUnFinal(a, { piece: 'p2', genre: 'image', source: 'm1', studio: 'photo', at: 2 });
  assert.deepEqual(b.map((f) => f.piece), ['p2']);
  const c = ajouterUnFinal(b, { piece: 'p3', genre: 'son', source: 'mixage-mp3', studio: 'son', at: 3 });
  assert.deepEqual(c.map((f) => f.piece), ['p2', 'p3']);
});

test('l’argent : 2 à 4 brouillons, le bouton « Générer · prix » vaut accord, le réessai d’office une seule fois au même prix', () => {
  assert.equal(nombreDePropositions(1, PROPOSITIONS_MIN_D_UN_MEDIA), 2);
  assert.equal(nombreDePropositions(9, PROPOSITIONS_MIN_D_UN_MEDIA), 4);
  assert.equal(nombreDePropositions(undefined), 1, 'hors création de média, rien ne change');
  assert.equal(lotValideParLaReponse('Générer'), true);
  assert.equal(lotValideParLaReponse('générer'), true);
  assert.equal(lotValideParLaReponse('Valider le devis'), true);
  assert.equal(lotValideParLaReponse('Refuser'), false);
  assert.equal(lotValideParLaReponse('plutôt en noir et blanc'), false, 'une réponse écrite refuse le lot et part au directeur');
  const q = questionDUneGeneration({ lotId: 'l1', titre: 'Affiche', lignes: [{ plan: 'Affiche', modele: 'Z', service: 'kie', prix: 0.02 }, { plan: 'Affiche', modele: 'Z', service: 'kie', prix: 0.02 }], depense: 0 });
  assert.equal(q.options.length, 0, 'aucun choix à cocher : le bouton du devis');
  assert.equal(q.devis.bouton, true);
  assert.equal(q.devis.total, 0.04);
  const rate = { etat: 'echec', coutReel: null, modele: 'z', prix: 0.02, plan: 'Affiche' };
  const memes = [{ modele: 'z', prix: 0.02, plan: 'Affiche' }];
  assert.equal(reessaiDOfficePermis({ rate, devis: memes, dejaReessaye: false }).ok, true);
  assert.equal(reessaiDOfficePermis({ rate, devis: memes, dejaReessaye: true }).ok, false, 'une seule fois');
  assert.equal(reessaiDOfficePermis({ rate: { ...rate, coutReel: 0.02 }, devis: memes, dejaReessaye: false }).ok, false, 'facturée : on redemande');
  assert.equal(reessaiDOfficePermis({ rate, devis: [{ ...memes[0]!, modele: 'autre' }], dejaReessaye: false }).ok, false, 'autre modèle : on redemande');
  assert.equal(reessaiDOfficePermis({ rate, devis: [{ ...memes[0]!, prix: 0.05 }], dejaReessaye: false }).ok, false, 'autre prix : on redemande');
  assert.equal(reessaiDOfficePermis({ rate: { ...rate, etat: 'fini' }, devis: memes, dejaReessaye: false }).ok, false);
});

test('une carte de création fabrique par « realiser » seulement : codex exec et les appels directs aux générateurs sont refusés, le reste passe', () => {
  for (const c of [
    'codex exec "génère une image de chat" --image out.png',
    'cd /tmp && codex e "image"',
    'curl https://api.openai.com/v1/images/generations -d @x',
    'curl -X POST https://queue.fal.run/fal-ai/flux/schnell',
    'curl https://platform.higgsfield.ai/v1/generate',
    'curl https://generativelanguage.googleapis.com/v1beta/models/imagen-4:predict',
  ]) {
    const v = commandeFabriqueHorsDeKie(c);
    assert.equal(v.refusee, true, c);
    // fal.ai et Higgsfield sont rallumés (11/11/2026), mais par « realiser » seulement : un appel direct reste refusé.
    assert.match(refusDeCreation(v), /« realiser » \(kie\.ai, fal\.ai, Higgsfield, ou OpenRouter/);
  }
  // OpenRouter est proposé au Studio depuis le 31/10/2026 : ses appels ne sont pas visés (ils passent par « realiser »).
  for (const c of ['ls -la', 'ffmpeg -i a.mp4 b.mp4', 'node scripts/x.mjs', 'git log', 'cat codex-notes.md', 'curl https://docs.kie.ai/llms.txt', 'curl https://openrouter.ai/api/v1/models?output_modalities=image']) {
    assert.equal(commandeFabriqueHorsDeKie(c).refusee, false, c);
  }
});
