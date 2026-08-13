import type { ChildProcess } from 'node:child_process';
import { DELAI_VIDAGE_SORTIE_MS } from '@haikodev/shared';
import { log } from '../logger.js';

export interface OptionsDeFin {
  /** Le nom du moteur, pour le journal. */
  moteur: string;
  /**
   * Ce qu'il reste à vider et à dire avant de rendre la main. Appelé UNE SEULE
   * fois, quelle que soit la route prise (« close », « exit », plafond).
   */
  cloturer: (code: number | null, depassement: boolean) => { ok: boolean; error?: string };
  /** Le moteur n'a pas pu être lancé du tout. */
  surErreur: (message: string) => void;
  /** Plafond de durée. Sans lui, on attend aussi longtemps qu'il le faut. */
  plafondMs?: number;
}

/**
 * ATTENDRE LA FIN D'UN PROCESSUS DE MOTEUR — SANS RISQUER DE L'ATTENDRE POUR
 * TOUJOURS.
 *
 * On n'écoutait que « close », qui n'arrive que lorsque le programme est fini ET
 * que toutes ses sorties sont fermées. Or le moteur lance lui-même des enfants
 * (pont d'outils, sous-agents) qui héritent de sa sortie standard : l'un d'eux
 * qui survit garde le tuyau ouvert, « close » n'arrive jamais, et le tour reste
 * « en cours » indéfiniment alors que la réponse est écrite depuis longtemps.
 *
 * « exit » dit, lui, que le PROGRAMME est terminé. On lui laisse un court délai
 * de vidage pour récupérer les dernières lignes, puis on rend la main et on
 * lâche nos extrémités de tuyaux.
 */
export function finDuProcessus(
  child: ChildProcess,
  options: OptionsDeFin,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let rendu = false;
    let vidage: NodeJS.Timeout | undefined;
    let plafond: NodeJS.Timeout | undefined;

    const rendre = (code: number | null, depassement = false) => {
      if (rendu) return;
      rendu = true;
      if (vidage) clearTimeout(vidage);
      if (plafond) clearTimeout(plafond);
      const resultat = options.cloturer(code, depassement);
      // Nos extrémités de tuyaux sont libérées ici : un petit-fils qui garde les
      // siennes ouvertes ne retient plus rien de notre côté.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(resultat);
    };

    child.on('error', (err) => {
      if (rendu) return;
      rendu = true;
      if (vidage) clearTimeout(vidage);
      if (plafond) clearTimeout(plafond);
      options.surErreur(err.message);
      resolve({ ok: false, error: err.message });
    });

    child.on('close', (code) => rendre(code));

    child.on('exit', (code) => {
      if (rendu || vidage) return;
      vidage = setTimeout(() => rendre(code), DELAI_VIDAGE_SORTIE_MS);
      vidage.unref?.();
    });

    if (options.plafondMs) {
      plafond = setTimeout(() => {
        if (rendu) return;
        log.warn(
          `moteur ${options.moteur} arrêté au plafond de ${Math.round(options.plafondMs! / 1000)} s : il ne rendait pas la main`,
        );
        try {
          child.kill('SIGKILL');
        } catch {
          /* déjà parti */
        }
        rendre(null, true);
      }, options.plafondMs);
      plafond.unref?.();
    }
  });
}
