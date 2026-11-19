import fs from 'node:fs';
import {
  ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS,
  PHRASE_D_ATTENTE_DE_MEMOIRE,
  RELECTURE_DES_TRAVAUX_LOURDS_MS,
  porteDesTravauxLourds,
  pressionMemoire,
  psiSomeAvg10,
  signesDeMeminfo,
  type PressionMemoire,
} from '@beluga/shared';
import { log } from './logger.js';

/**
 * LA MÉMOIRE DE LA MACHINE, LUE SANS RIEN D'AUTRE QUE `/proc`.
 *
 * Module à part, sans tableau ni agent : le tri des compétences, le Studio et
 * la publication le lisent sans tirer `runtime` (que `capacity.ts` importe).
 * Les signaux sont ceux de la porte des départs (`pressionMemoire`), moins le
 * débit d'échange, qui demande deux mesures espacées : la pression du noyau
 * (`some avg10`) voit le même va-et-vient.
 */
export interface MemoireDeLaMachine {
  pression: PressionMemoire;
  memPct?: number;
  memDispoMo?: number;
  /** Le remplissage du fichier d'échange, en % (absent sans échange). */
  swapPct?: number;
}

export function memoireDeLaMachine(): MemoireDeLaMachine {
  let signes: ReturnType<typeof signesDeMeminfo>;
  let psi: number | undefined;
  try {
    signes = signesDeMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
  } catch {
    signes = undefined;
  }
  try {
    psi = psiSomeAvg10(fs.readFileSync('/proc/pressure/memory', 'utf8'));
  } catch {
    psi = undefined;
  }
  if (!signes) return { pression: { suspendre: false } };
  return {
    pression: pressionMemoire(signes.memPct, signes.swapPct, { psiSomeAvg10: psi }),
    memPct: signes.memPct,
    memDispoMo: signes.memDispoMo,
    ...(signes.swapPct !== undefined ? { swapPct: signes.swapPct } : {}),
  };
}

export type IssueDeLAttente = 'libre' | 'apres-attente' | 'force' | 'arrete';

/**
 * UN TRAVAIL LOURD ATTEND LA PLACE, ET LE DIT (décision de l'utilisateur, 18/11/2026).
 *
 * Mémoire libre : rend « libre » aussitôt, sans un mot. Sous pression : dit
 * UNE FOIS la phrase stable (`surAttente`), relit la mémoire toutes les
 * `RELECTURE_DES_TRAVAUX_LOURDS_MS`, et part dès qu'elle se libère — ou, au
 * bout de `ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS`, part QUAND MÊME (« force »,
 * noté au journal) : rien ne reste bloqué sans rien dire. Un signal d'arrêt
 * coupe l'attente (« arrete ») ; c'est à l'appelant d'en tirer la suite.
 */
export async function attendreLaPlaceDesTravauxLourds(o: {
  quoi: string;
  signal?: AbortSignal;
  surAttente?: (phrase: string) => void;
  /* Pour les tests. */
  lire?: () => PressionMemoire;
  maxMs?: number;
  relectureMs?: number;
}): Promise<IssueDeLAttente> {
  const lire = o.lire ?? (() => memoireDeLaMachine().pression);
  const maxMs = o.maxMs ?? ATTENTE_MAX_DES_TRAVAUX_LOURDS_MS;
  const relecture = o.relectureMs ?? RELECTURE_DES_TRAVAUX_LOURDS_MS;
  const debut = Date.now();
  let premiere = lire();
  if (porteDesTravauxLourds(premiere, 0, maxMs) === 'partir') return 'libre';
  log.warn(`travail lourd en attente de mémoire (${o.quoi}) : ${premiere.raison ?? 'mémoire pleine'}`);
  try {
    o.surAttente?.(PHRASE_D_ATTENTE_DE_MEMOIRE);
  } catch {
    // dire l'attente ne fait jamais tomber le travail
  }
  for (;;) {
    if (o.signal?.aborted) return 'arrete';
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, relecture);
      o.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    if (o.signal?.aborted) return 'arrete';
    premiere = lire();
    const verdict = porteDesTravauxLourds(premiere, Date.now() - debut, maxMs);
    if (verdict === 'partir') {
      log.info(`travail lourd parti après ${Math.round((Date.now() - debut) / 1000)} s d'attente de mémoire (${o.quoi})`);
      return 'apres-attente';
    }
    if (verdict === 'forcer') {
      log.warn(`travail lourd parti QUAND MÊME après ${Math.round((Date.now() - debut) / 1000)} s : mémoire toujours pleine (${o.quoi}, ${premiere.raison ?? ''})`);
      return 'force';
    }
  }
}
