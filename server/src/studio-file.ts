/**
 * UN SEUL TRAVAIL LOURD À LA FOIS SUR LA MACHINE (studio).
 *
 * Voix d'essai (Piper, ≈ 440 Mo), reconnaissance des mots (Whisper, ≈ 340 à
 * 590 Mo), export (Chrome sans carte graphique + ffmpeg, ≈ 3,5 × la durée de la
 * vidéo) : sur un serveur de 7 Go déjà pris aux deux tiers, deux de ces travaux
 * en même temps pourraient faire tomber le démon. Ils passent donc l'un après
 * l'autre, dans l'ordre d'arrivée — un échec n'arrête jamais la file.
 */
let queue: Promise<unknown> = Promise.resolve();

export function dansLaFileLourde<T>(travail: () => Promise<T>): Promise<T> {
  const suite = queue.then(travail, travail);
  queue = suite.catch(() => undefined);
  return suite;
}
