import type { ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

/** Le délai laissé au moteur pour quitter proprement avant d'être achevé. */
const DELAI_ARRET_FORCE_MS = 4000;

/**
 * LES DESCENDANTS D'UN PROCESSUS, LUS DANS `/proc`.
 *
 * Un moteur n'est pas seul : il lance son pont d'outils, des commandes, parfois
 * un sous-agent. Ces petits-enfants ne reçoivent PAS le signal envoyé à leur
 * parent — `child.kill()` ne vise qu'un seul numéro de processus — et l'un
 * d'eux qui survit garde le tuyau de sortie ouvert. On les retrouve donc pour
 * les emporter avec lui.
 *
 * On ne passe JAMAIS par un groupe de processus : les moteurs sont lancés sans
 * `detached`, ils portent donc le groupe du DÉMON lui-même, et un signal de
 * groupe couperait le serveur. On descend l'arbre à partir du seul numéro du
 * moteur, jamais plus haut.
 */
function descendants(pid: number, vus = new Set<number>()): number[] {
  if (vus.has(pid)) return [];
  vus.add(pid);
  let enfants: number[] = [];
  try {
    const taches = readdirSync(`/proc/${pid}/task`);
    for (const tache of taches) {
      const brut = readFileSync(`/proc/${pid}/task/${tache}/children`, 'utf8');
      for (const morceau of brut.trim().split(/\s+/)) {
        const enfant = Number(morceau);
        if (Number.isInteger(enfant) && enfant > 1) enfants.push(enfant);
      }
    }
  } catch {
    // Pas de `/proc` (ou processus déjà parti) : on ne connaît aucun descendant.
    return [];
  }
  enfants = [...new Set(enfants)];
  return enfants.flatMap((enfant) => [enfant, ...descendants(enfant, vus)]);
}

/**
 * Achever un numéro de processus, avec deux refus qui rendent le geste sûr : on
 * ne signale jamais le démon lui-même, ni un numéro qui n'en est pas un.
 */
function acheverLeProcessus(pid: number | undefined): void {
  if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* déjà parti */
  }
}

/**
 * ARRÊTER UN PROCESSUS DE MOTEUR — POUR DE VRAI.
 *
 * Le bouton d'arrêt envoyait SIGTERM puis vérifiait `child.killed` avant de
 * se résoudre à SIGKILL : mais cette propriété devient vraie dès que le
 * SIGNAL est PARTI, pas quand le processus a réellement quitté (documenté par
 * Node lui-même). Un moteur qui ignore ou n'a pas encore traité le SIGTERM —
 * en plein appel d'outil, par exemple — ne recevait donc JAMAIS le coup de
 * grâce : le clic « Arrêter » semblait n'avoir aucun effet, et l'agent
 * continuait exactement où il en était. On suit ici la fin RÉELLE du
 * processus (l'événement « exit », comme `finDuProcessus`), et c'est son
 * absence après le délai qui déclenche SIGKILL — jamais `child.killed`.
 *
 * ET LE COUP DE GRÂCE EMPORTE TOUTE LA DESCENDANCE. Le signal ne visait que
 * l'enfant direct : le pont d'outils et les commandes lancées par le moteur lui
 * survivaient, gardant la sortie ouverte et parfois une construction en cours
 * sur une copie de travail qu'on s'apprête à refermer. Un arrêt demandé arrête
 * tout ce que le moteur avait mis en route.
 */
export function arreterProcessus(child: ChildProcess, moteur: string, delaiMs = DELAI_ARRET_FORCE_MS): void {
  let termine = false;
  child.once('exit', () => {
    termine = true;
  });
  // Relevés AVANT le signal : un moteur qui s'en va emporte ses enfants dans sa
  // chute, et `/proc` ne dirait plus rien d'eux au moment de les achever.
  const suite = child.pid ? descendants(child.pid) : [];
  try {
    child.kill('SIGTERM');
  } catch (err) {
    log.warn(`arrêt du moteur ${moteur} impossible`, err);
    return;
  }
  const forcer = setTimeout(() => {
    if (!termine) acheverLeProcessus(child.pid);
    for (const pid of suite) acheverLeProcessus(pid);
  }, delaiMs);
  forcer.unref?.();
}
