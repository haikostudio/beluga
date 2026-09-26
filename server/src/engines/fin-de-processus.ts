import type { ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DELAI_COUP_DE_GRACE_MS, DELAI_VIDAGE_SORTIE_MS } from '@beluga/shared';
import { log } from '../logger.js';
import type { ResultatDuMoteur } from './types.js';

export interface OptionsDeFin {
  /** Le nom du moteur, pour le journal. */
  moteur: string;
  /**
   * Ce qu'il reste à vider et à dire avant de rendre la main. Appelé UNE SEULE
   * fois, quelle que soit la route prise (« close », « exit », plafond).
   */
  cloturer: (code: number | null, depassement: boolean) => ResultatDuMoteur;
  /** Le moteur n'a pas pu être lancé du tout. */
  surErreur: (message: string) => void;
  /** Plafond de durée. Sans lui, on attend aussi longtemps qu'il le faut. */
  plafondMs?: number;
  /**
   * LE DOSSIER DEPUIS LEQUEL LE MOTEUR A ÉTÉ LANCÉ.
   *
   * Sert à une seule chose, mais elle compte : quand `spawn` échoue en ENOENT,
   * dire LEQUEL des deux manque. Node rend la même phrase — « spawn claude
   * ENOENT » — que le binaire soit introuvable ou que le dossier courant ait
   * disparu, et la seconde cause se lisait comme la première : on cherchait un
   * moteur mal installé alors que c'était la copie de travail de la carte qui
   * venait d'être effacée sous l'agent (06/09/2026).
   */
  cwd?: string;
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
): Promise<ResultatDuMoteur> {
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
      const message = messageDeLancementRate(err, options);
      options.surErreur(message);
      // Le processus n'a même pas pu être lancé (binaire absent, droits,
      // dossier disparu) : le moteur n'a jamais démarré, et c'est lui qui le
      // dit, pas une déduction.
      resolve({ ok: false, error: message, jamaisDemarre: true });
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

/**
 * CE QUI MANQUAIT VRAIMENT QUAND LE LANCEMENT RATE.
 *
 * « spawn claude ENOENT » ne dit pas QUOI est introuvable. Si le dossier de
 * travail n'existe plus, c'est lui la cause — et c'est une tout autre histoire
 * qu'un moteur mal installé : la copie de travail de la carte a été effacée
 * pendant le tour, le travail enregistré est intact sur sa branche, et il n'y a
 * rien à réparer côté moteur. On le DIT, au lieu de laisser l'écran conclure
 * « Le moteur a échoué ».
 */
function messageDeLancementRate(err: Error, options: OptionsDeFin): string {
  const code = (err as NodeJS.ErrnoException).code;
  /*
   * LA MACHINE NE PEUT PLUS LANCER DE PROCESSUS. `EAGAIN` (et `ENOMEM`) au
   * moment du `spawn` ne dit rien du moteur : c'est le serveur qui refuse un
   * `fork` de plus, mémoire ou nombre de processus épuisés. Le message brut
   * — « spawn /usr/bin/node EAGAIN » — envoyait chercher du côté du moteur ou
   * de son installation, alors qu'il n'y a rien à y réparer : il faut de la
   * place.
   *
   * Le code d'origine reste sur sa PROPRE LIGNE, en dernier : c'est ainsi que
   * `motifDePannePassagere` le reconnaît (elle ne juge que des lignes courtes,
   * jamais un paragraphe) et fait retenter le tour.
   */
  if (code === 'EAGAIN' || code === 'ENOMEM') {
    return (
      `Le serveur n’a pas pu lancer un programme de plus : plus assez de mémoire ou de processus ` +
      `disponibles. Ce n’est pas une panne du moteur ni de la tâche — trop d’agents travaillent en ` +
      `même temps.\nspawn ${code}`
    );
  }
  if (code === 'ENOENT' && options.cwd && !existsSync(options.cwd)) {
    return (
      `Le dossier de travail a disparu pendant le tour (${options.cwd}) : le moteur n’a pas pu y ` +
      `être lancé. Ce n’est pas une panne du moteur — le travail déjà enregistré est intact sur la ` +
      `branche de la carte, et la copie sera recréée à la relance.`
    );
  }
  return err.message;
}

/**
 * Le délai laissé au moteur pour quitter proprement avant d'être achevé. Il vit
 * dans `shared` avec la règle qui l'explique : un arrêt demandé est un geste EN
 * FORCE, il n'attend pas quatre secondes qu'on veuille bien lui répondre.
 */
const DELAI_ARRET_FORCE_MS = DELAI_COUP_DE_GRACE_MS;

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
 * ACHEVER UN MOTEUR TOUT DE SUITE, SANS LUI DEMANDER SON AVIS.
 *
 * `arreterProcessus` demande d'abord (SIGTERM) et n'achève qu'après un délai de
 * grâce : c'est le bon geste tant que le serveur sera encore là pour le donner.
 * Il ne l'est plus au REDÉMARRAGE FORCÉ — mesuré par
 * `scripts/verif-arret-en-force.mjs` : le démon quittait avant l'échéance, le
 * minuteur mourait avec lui, et le moteur récalcitrant survivait en orphelin,
 * un `sleep` sans père qui continuait de tourner sur la machine.
 *
 * Ici on ne demande donc rien : la descendance est relevée d'abord (un parent
 * mort ne dit plus qui étaient ses enfants), puis tout le monde est achevé. Les
 * deux refus de sûreté d'`acheverLeProcessus` valent toujours — jamais le démon
 * lui-même, jamais un numéro qui n'en est pas un — et on ne vise JAMAIS un
 * groupe de processus, qui emporterait le serveur.
 */
export function acheverLArbre(pid: number | undefined, moteur: string): number {
  if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return 0;
  const suite = descendants(pid);
  acheverLeProcessus(pid);
  for (const enfant of suite) acheverLeProcessus(enfant);
  log.warn(`moteur ${moteur} achevé sur-le-champ (${1 + suite.length} processus)`);
  return 1 + suite.length;
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
