import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  RELAIS_TERMINAL,
  SESSION_TERMINAL,
  argumentsAttache,
  argumentsCreationSession,
  argumentsEnvironnementSession,
  argumentsFinDeSession,
  argumentsSessionExiste,
  argumentsSuiviDeTaille,
  choisirLeCompteDuTerminal,
  type ChoixDuTerminal,
} from '@beluga/shared';
import { applyAccountEnv, listAccountRecords } from './accounts.js';
import { ROOT } from './config.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';

/**
 * LE TERMINAL DU SERVEUR — LA PART QUI TOUCHE À TMUX.
 *
 * Les règles (nom de la session, bornes de taille, arguments) vivent dans
 * `shared/src/terminal-serveur.ts`, où elles se testent sans machine. Ici, on ne
 * fait que les appliquer : garantir la session, l'attacher, et rendre au
 * demandeur deux tuyaux.
 *
 * UNE SESSION, PLUSIEURS ATTACHES. Chaque écran ouvert lance SON `script` +
 * `tmux attach` : c'est ainsi que tmux partage un terminal, et c'est ce qui fait
 * que deux écrans voient la même chose au même moment. Fermer un écran détache
 * ce client-là et ne touche PAS à ce qui tourne dedans.
 */

/** Où trouver tmux. Absent, le terminal se refuse en le disant. */
export function tmuxDisponible(): boolean {
  const essai = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return !essai.error && essai.status === 0;
}

function tmux(args: string[], env?: NodeJS.ProcessEnv): { ok: boolean; sortie: string } {
  const essai = spawnSync('tmux', args, { encoding: 'utf8', env: env ?? process.env });
  if (essai.error) return { ok: false, sortie: essai.error.message };
  return { ok: essai.status === 0, sortie: `${essai.stdout ?? ''}${essai.stderr ?? ''}`.trim() };
}

/* ------------------------------------------------------------------ */
/* LE COMPTE QUI FAIT TOURNER LE TERMINAL                              */
/* ------------------------------------------------------------------ */

/**
 * LE COMPTE DU TERMINAL EST UN RÉGLAGE DU SERVEUR, PAS UNE PRÉFÉRENCE D'ÉCRAN.
 * La session tmux est PARTAGÉE : deux écrans attachés regardent le même shell,
 * donc le même coffre. Ranger le choix par utilisateur aurait promis quelque
 * chose d'impossible à tenir.
 */
const CLE_COMPTE_TERMINAL = 'terminal.compte';

/** Le compte demandé à la main, s'il y en a un. */
export function compteDemandePourLeTerminal(): string | undefined {
  try {
    return getMeta(CLE_COMPTE_TERMINAL) || undefined;
  } catch {
    return undefined;
  }
}

/** Retient le compte choisi à la main. Il survit au redémarrage du démon. */
export function retenirLeCompteDuTerminal(id: string | undefined): void {
  setMeta(CLE_COMPTE_TERMINAL, id ?? '');
}

/**
 * QUEL COMPTE POUR LE TERMINAL, ICI ET MAINTENANT. La règle est pure
 * (`shared/src/terminal-serveur.ts`) ; ce qu'on fait ici, c'est lui donner les
 * comptes réellement déclarés.
 */
export function compteDuTerminal(): ChoixDuTerminal {
  const comptes = listAccountRecords().map((compte) => ({
    id: compte.id,
    engine: compte.engine,
    label: compte.label,
    plan: compte.plan,
  }));
  return choisirLeCompteDuTerminal(comptes, compteDemandePourLeTerminal());
}

/**
 * L'ENVIRONNEMENT DE LA SESSION : celui du démon, plus le coffre du compte
 * retenu. `applyAccountEnv` remet ce coffre d'aplomb au passage, exactement
 * comme avant le lancement d'un agent.
 */
function environnementDuTerminal(choix: ChoixDuTerminal): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' };
  if (!choix.compte) return base;
  const enregistrement = listAccountRecords().find((compte) => compte.id === choix.compte!.id);
  if (!enregistrement) return base;
  return { ...base, ...applyAccountEnv(enregistrement) };
}

/**
 * TUE LA SESSION PARTAGÉE. Le seul appelant est le changement de compte : une
 * session vivante garde l'environnement de sa création, donc l'ancien coffre.
 */
export function tuerLaSession(): void {
  if (!tmuxDisponible()) return;
  if (!tmux(argumentsSessionExiste(SESSION_TERMINAL)).ok) return;
  tmux(argumentsFinDeSession(SESSION_TERMINAL));
  log.info(`terminal : session tmux « ${SESSION_TERMINAL} » tuée pour changer de compte`);
}

/**
 * GARANTIT LA SESSION PARTAGÉE. Créée seulement si elle manque : le démon peut
 * redémarrer vingt fois, ce qui tourne dans le terminal n'en sait rien.
 *
 * La fenêtre est aussitôt réglée pour SUIVRE LE DERNIER ÉCRAN ACTIF : sans cela,
 * tmux la ramènerait à la taille du plus petit client attaché, et un téléphone
 * oublié dans un onglet briderait l'ordinateur à sa largeur.
 */
export function garantirLaSession(
  colonnes: number,
  lignes: number,
  choix: ChoixDuTerminal = compteDuTerminal(),
): { ok: boolean; creee: boolean; erreur?: string } {
  if (!tmuxDisponible()) return { ok: false, creee: false, erreur: 'tmux n’est pas installé sur ce serveur' };
  if (tmux(argumentsSessionExiste(SESSION_TERMINAL)).ok) {
    tmux(argumentsSuiviDeTaille(SESSION_TERMINAL));
    return { ok: true, creee: false };
  }
  /*
   * L'ENVIRONNEMENT SE POSE À LA CRÉATION, ET NULLE PART AILLEURS. tmux fige
   * l'environnement du shell au moment où il l'ouvre : injecter la variable
   * plus tard ne toucherait pas le shell déjà lancé. C'est pour cela qu'un
   * changement de compte TUE la session au lieu de la corriger en vol.
   *
   * Et il se pose par `-e`, pas par l'environnement du `spawn` : tmux est un
   * SERVEUR, et une session créée par un second appel hérite de l'environnement
   * du serveur, pas de celui du démon qui la demande.
   */
  const env = environnementDuTerminal(choix);
  const surLaSession: Record<string, string> = {};
  if (env.CLAUDE_CONFIG_DIR) surLaSession.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
  const creation = tmux(argumentsCreationSession(SESSION_TERMINAL, colonnes, lignes, surLaSession), env);
  if (!creation.ok) return { ok: false, creee: false, erreur: creation.sortie || 'création de la session refusée' };
  tmux(argumentsSuiviDeTaille(SESSION_TERMINAL));
  // …et pour les fenêtres ouvertes ENSUITE, qui repartiraient sinon sur
  // l'environnement du démon et donc sur un autre coffre que le shell d'à côté.
  if (env.CLAUDE_CONFIG_DIR) {
    tmux(argumentsEnvironnementSession(SESSION_TERMINAL, 'CLAUDE_CONFIG_DIR', env.CLAUDE_CONFIG_DIR));
  }
  log.info(
    `terminal : session tmux « ${SESSION_TERMINAL} » créée (${colonnes}×${lignes})` +
      (choix.compte ? ` sur le compte ${choix.compte.label}` : ' sans compte de l’application'),
  );
  return { ok: true, creee: true };
}

/**
 * ATTACHE UN CLIENT À LA SESSION et rend le processus.
 *
 * QUATRE TUYAUX, PAS TROIS. Les trois habituels portent la frappe et la sortie ;
 * le QUATRIÈME (fd 3) est le canal des TAILLES : le démon y écrit
 * « colonnes×lignes » à chaque fois que la fenêtre du navigateur change, et le
 * relais refait la taille du terminal puis prévient tmux. Sans ce canal, il
 * aurait fallu couper l'attache et la refaire à chaque redimensionnement — et
 * l'écran aurait clignoté à chaque poignée tirée.
 *
 * `TERM=xterm-256color` : c'est ce que l'afficheur du navigateur sait rendre, et
 * ce qui donne les couleurs aux outils lancés dedans (claude, codex, git).
 * `HOME` reste celui du démon : c'est le même compte, donc les mêmes accès et
 * les mêmes identifiants que ceux dont les agents se servent. `CLAUDE_CONFIG_DIR`,
 * lui, pointe le coffre du compte retenu — le `claude` tapé ici dépense donc sur
 * le compte Max x20 de l'application, plus sur le coffre du compte système.
 */
export function attacherUnClient(
  colonnes: number,
  lignes: number,
  choix: ChoixDuTerminal = compteDuTerminal(),
): ChildProcess {
  const relais = path.join(ROOT, RELAIS_TERMINAL);
  const { commande, arguments: args } = argumentsAttache(SESSION_TERMINAL, colonnes, lignes, relais);
  return spawn(commande, args, {
    cwd: os.homedir(),
    env: environnementDuTerminal(choix),
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
}
