import { attendreLaPlaceDesTravauxLourds } from './porte-des-travaux-lourds.js';

/**
 * UN SEUL TRAVAIL LOURD À LA FOIS SUR LA MACHINE.
 *
 * Voix d'essai (Piper, ≈ 440 Mo), reconnaissance des mots (Whisper, ≈ 340 à
 * 590 Mo), export (Chrome sans carte graphique + ffmpeg, ≈ 3,5 × la durée de la
 * vidéo) : sur un serveur de 7 Go déjà pris aux deux tiers, deux de ces travaux
 * en même temps pourraient faire tomber le démon. Ils passent donc l'un après
 * l'autre, dans l'ordre d'arrivée — un échec n'arrête jamais la file.
 *
 * …ET CHACUN REGARDE LA MÉMOIRE AVANT DE PARTIR (18/11/2026). Le 17/11 à 17:17,
 * un export (ffmpeg, 413 Mo) est parti sur une machine pleine, fichier
 * d'échange compris : le démon s'est figé 25 puis 51 s. Arrivé en tête de file,
 * un travail ATTEND donc que la mémoire se libère, une attente BORNÉE, puis part
 * quand même (`attendreLaPlaceDesTravauxLourds`). `surAttente` le dit là où
 * l'on suit le travail (la ligne de l'export, par exemple).
 */
let queue: Promise<unknown> = Promise.resolve();

export interface OptionsDeLaFileLourde {
  /** Ce qui attend, pour le journal. */
  quoi?: string;
  /** Un arrêt demandé coupe l'attente de mémoire ; le travail juge ensuite lui-même son arrêt. */
  signal?: AbortSignal;
  /** Appelé UNE fois, avec la phrase stable, si le travail doit attendre la mémoire. */
  surAttente?: (phrase: string) => void;
}

export function dansLaFileLourde<T>(travail: () => Promise<T>, o: OptionsDeLaFileLourde = {}): Promise<T> {
  const jouer = async () => {
    await attendreLaPlaceDesTravauxLourds({ quoi: o.quoi ?? 'travail lourd du Studio', signal: o.signal, surAttente: o.surAttente });
    return travail();
  };
  const suite = queue.then(jouer, jouer);
  queue = suite.catch(() => undefined);
  return suite;
}
