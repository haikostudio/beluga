import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGLAGES_EXPORT_PAR_DEFAUT,
  argumentsDeRendu,
  chronoDeLExport,
  dureeDExportLisible,
  extensionDExport,
  facteurDeDureeDeRendu,
  lireReglagesExport,
  nomDExport,
  quatreKPossible,
  resumeReglagesExport,
} from '@beluga/shared';

/*
 * LES RÉGLAGES D'UN EXPORT DU STUDIO (`shared/src/studio-export.ts`) : les
 * défauts redonnent EXACTEMENT l'ancien export, une combinaison impossible est
 * corrigée avant d'atteindre le moteur, et chaque réglage devient l'argument
 * que `hyperframes render` connaît.
 */

test('les défauts redonnent l’ancien export : MP4, standard, 1080p, 30 images par seconde', () => {
  const r = lireReglagesExport(undefined, '9:16');
  assert.deepEqual(r, REGLAGES_EXPORT_PAR_DEFAUT);
  assert.deepEqual(argumentsDeRendu(r, '9:16'), ['--fps', '30', '--format', 'mp4', '-q', 'standard']);
  assert.equal(extensionDExport('video', r), 'mp4');
  assert.equal(nomDExport('Lancement', '9:16', 3, 'video'), 'lancement-9x16-v3.mp4', 'le nom d’avant ne change pas');
});

test('chaque réglage devient l’argument du moteur', () => {
  const r = lireReglagesExport({ qualite: 'maximale', definition: '4k', ips: 60, fichier: 'webm' }, '16:9');
  assert.deepEqual(argumentsDeRendu(r, '16:9'), ['--fps', '60', '--format', 'webm', '-q', 'high', '--crf', '10', '--resolution', 'landscape-4k']);
  assert.deepEqual(argumentsDeRendu(lireReglagesExport({ qualite: 'brouillon' }, '1:1'), '1:1').slice(-2), ['-q', 'draft']);
  assert.deepEqual(argumentsDeRendu(lireReglagesExport({ definition: '4k' }, '9:16'), '9:16').slice(-2), ['--resolution', 'portrait-4k']);
  assert.ok(facteurDeDureeDeRendu(r) > 8, 'le délai suit la 4K et les 60 images');
});

test('une combinaison impossible est corrigée avant le moteur', () => {
  assert.equal(quatreKPossible('4:5'), false);
  assert.equal(lireReglagesExport({ definition: '4k' }, '4:5').definition, '1080p', 'pas de 4K en Portrait');
  const gif = lireReglagesExport({ fichier: 'gif', sansSon: false, qualite: 'haute' }, '1:1');
  assert.equal(gif.sansSon, true, 'un GIF n’a jamais de son');
  assert.ok(!argumentsDeRendu(gif, '1:1').includes('-q'), 'ni de qualité réglable');
  assert.ok(!argumentsDeRendu(lireReglagesExport({ fichier: 'mov', qualite: 'maximale' }, '1:1'), '1:1').includes('--crf'), 'un MOV garde son profil fixe');
  const farfelu = lireReglagesExport({ qualite: 'ultra', ips: 1000, fichier: 'avi', image: 'bmp' }, '9:16');
  assert.deepEqual(farfelu, REGLAGES_EXPORT_PAR_DEFAUT, 'une valeur inconnue retombe sur son défaut');
  assert.equal(lireReglagesExport({ ips: '60' }, '9:16').ips, 60, 'un nombre reçu en texte est relu');
});

test('l’image et le rappel des réglages', () => {
  const r = lireReglagesExport({ image: 'jpg', definition: '4k', ips: 60, fichier: 'mov', sansSon: true }, '9:16');
  assert.equal(extensionDExport('image', r), 'jpg');
  assert.equal(nomDExport('Lancement', '9:16', 3, 'image', 'jpg'), 'lancement-9x16-v3.jpg');
  assert.equal(resumeReglagesExport('video', r), '4K · 60 i/s · MOV · sans son');
  assert.equal(resumeReglagesExport('image', r), 'JPG');
  const traduit = (texte: string, valeurs?: { n: number }) => ({ 'sans son': 'silent', '{n} i/s': '{n} fps', haute: 'high' }[texte] ?? texte).replace('{n}', String(valeurs?.n ?? ''));
  const mp4 = lireReglagesExport({ fichier: 'mp4', qualite: 'haute', ips: 30, definition: '1080p', sansSon: true }, '9:16');
  assert.equal(resumeReglagesExport('video', mp4, traduit), '1080p · 30 fps · MP4 · high · silent');
});

test('le lot courant : les exports du dernier clic « Exporter », le reste est ancien', async () => {
  const { partagerLesExports, nomsSansDoublon, exportFini } = await import('@beluga/shared');
  const e = (id: string, creeLe: number, lot?: string) => ({ id, creeLe, ...(lot ? { lot } : {}) });
  assert.deepEqual(partagerLesExports([]), { courants: [], anciens: [] });
  const lot = partagerLesExports([e('d', 40, 'L2'), e('c', 39, 'L2'), e('b', 20, 'L1'), e('a', 10)]);
  assert.deepEqual(lot.courants.map((x) => x.id), ['c', 'd'], 'le lot, dans l’ordre où il a été lancé');
  assert.deepEqual(lot.anciens.map((x) => x.id), ['b', 'a']);
  // Un export lancé seul (agent, refait après la voix finale) forme un lot à lui seul, quel que soit l'ordre reçu.
  const seul = partagerLesExports([e('c', 39, 'L2'), e('z', 50), e('d', 40, 'L2')]);
  assert.deepEqual(seul.courants.map((x) => x.id), ['z']);
  assert.deepEqual(seul.anciens.map((x) => x.id), ['d', 'c']);
  assert.deepEqual(nomsSansDoublon(['a-9x16-v1.mp4', 'a-1x1-v1.mp4', 'a-9x16-v1.mp4', 'A-9x16-v1.mp4', 'sans']), ['a-9x16-v1.mp4', 'a-1x1-v1.mp4', 'a-9x16-v1-2.mp4', 'A-9x16-v1-3.mp4', 'sans']);
  assert.equal(exportFini({ etat: 'en-file' }), false);
  assert.equal(exportFini({ etat: 'en-cours' }), false);
  assert.ok(exportFini({ etat: 'pret' }) && exportFini({ etat: 'echoue' }) && exportFini({ etat: 'annule' }));
});

test('un export qui attend ou se fabrique reste dans le lot courant, jamais rangé dans les anciens', async () => {
  const { partagerLesExports } = await import('@beluga/shared');
  const e = (id: string, creeLe: number, lot: string | undefined, etat: 'en-file' | 'en-cours' | 'pret' | 'annule') => ({ id, creeLe, etat, ...(lot ? { lot } : {}) });
  // Le lot L1 se fabrique encore quand L2 est lancé : ses exports non finis restent sous les yeux (et annulables).
  const r = partagerLesExports([e('d', 40, 'L2', 'en-file'), e('c', 39, 'L2', 'en-file'), e('b', 20, 'L1', 'en-cours'), e('b2', 21, 'L1', 'pret'), e('a', 10, undefined, 'pret')]);
  assert.deepEqual(r.courants.map((x) => x.id), ['b', 'c', 'd'], 'dans l’ordre de la file : l’export en cours d’abord');
  assert.deepEqual(r.anciens.map((x) => x.id), ['b2', 'a'], 'seuls les exports FINIS d’avant sont anciens');
});

test('l’avancement des exports : finis sur total et pourcentage d’ensemble, rien quand tout est fini', async () => {
  const { avancementDesExports } = await import('@beluga/shared');
  const e = (id: string, creeLe: number, etat: 'en-file' | 'en-cours' | 'pret' | 'annule', progression = 0) => ({ id, creeLe, etat, progression, lot: 'L' });
  assert.equal(avancementDesExports([]), null);
  assert.equal(avancementDesExports([e('a', 1, 'pret'), e('b', 2, 'pret')]), null);
  // 1 prêt (1) + 1 en cours à 50 % (0,5) + 1 en file (0) + 1 annulé (ignoré) → 1,5 / 3 = 50 %.
  const a = avancementDesExports([e('a', 1, 'pret'), e('b', 2, 'en-cours', 0.02), e('c', 3, 'en-file'), e('d', 4, 'annule')], { b: 0.5 });
  assert.deepEqual(a, { faits: 1, total: 3, pourcent: 50 });
});

test('la même vidéo déjà en file ou en cours est un doublon ; une autre version, un autre format ou une image ne le sont pas', async () => {
  const { exportEnDouble, lireReglagesExport } = await import('@beluga/shared');
  const reglages = lireReglagesExport({}, '9:16');
  const enFile = { genre: 'video' as const, format: '9:16' as const, version: 146, reglages, etat: 'en-file' as const };
  const demande = { genre: 'video' as const, format: '9:16' as const, version: 146, reglages };
  assert.equal(exportEnDouble([enFile], demande), true);
  assert.equal(exportEnDouble([{ ...enFile, etat: 'pret' }], demande), false, 'un export fini se refait');
  assert.equal(exportEnDouble([enFile], { ...demande, version: 147 }), false);
  assert.equal(exportEnDouble([enFile], { ...demande, format: '1:1' }), false);
  assert.equal(exportEnDouble([enFile], { ...demande, reglages: { ...reglages, ips: 60 } }), false);
  assert.equal(exportEnDouble([enFile], { ...demande, genre: 'image' }), false);
  // Un export d'avant les réglages vaut les réglages par défaut.
  assert.equal(exportEnDouble([{ ...enFile, reglages: undefined }], demande), true);
});

/*
 * LE CHRONOMÈTRE D'UN EXPORT : l'attente, la fabrication et le total ne se
 * mélangent jamais, et un export sans heure de départ n'affiche rien.
 */
test('le chrono d’un export dit l’attente, puis l’écoulé, puis le total sans l’attente', () => {
  const cree = 1_000_000;
  assert.deepEqual(chronoDeLExport({ etat: 'en-file', creeLe: cree }, cree + 90_000), { genre: 'attente', depuis: cree, attenteMs: 90_000 });
  const demarre = cree + 120_000;
  assert.deepEqual(chronoDeLExport({ etat: 'en-cours', creeLe: cree, demarreLe: demarre }, demarre + 45_000), {
    genre: 'fabrication',
    demarreLe: demarre,
    ecouleMs: 45_000,
    attenteMs: 120_000,
  });
  assert.deepEqual(chronoDeLExport({ etat: 'pret', creeLe: cree, demarreLe: demarre, termineLe: demarre + 159_000 }, demarre + 999_999), {
    genre: 'termine',
    demarreLe: demarre,
    fabricationMs: 159_000,
    attenteMs: 120_000,
  });
});

test('un export sans heure de départ n’a pas de chrono, et jamais un temps négatif', () => {
  assert.equal(chronoDeLExport({ etat: 'pret', creeLe: 10, termineLe: 99 }, 100), null, 'fabriqué avant le chrono');
  assert.equal(chronoDeLExport({ etat: 'annule', creeLe: 10, termineLe: 50 }, 100), null, 'annulé avant d’avoir démarré');
  assert.equal(chronoDeLExport({ etat: 'en-cours', creeLe: 10 }, 100), null);
  const c = chronoDeLExport({ etat: 'en-cours', creeLe: 10, demarreLe: 500 }, 400);
  assert.ok(c && c.genre === 'fabrication' && c.ecouleMs === 0, 'des horloges décalées ne donnent pas un écoulé négatif');
});

test('la durée se lit « 12 s », « 2 min 39 s », « 1 h 05 min »', () => {
  assert.equal(dureeDExportLisible(12_400), '12 s');
  assert.equal(dureeDExportLisible(159_000), '2 min 39 s');
  assert.equal(dureeDExportLisible(3_900_000), '1 h 05 min');
  assert.equal(dureeDExportLisible(-5), '0 s');
});
