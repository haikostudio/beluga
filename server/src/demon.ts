import fs from 'node:fs';
import path from 'node:path';
import { EtatDemon, redemarrageNecessaire } from '@haikodev/shared';
import { ROOT } from './config.js';
import { bus } from './bus.js';
import { runningAgentIds } from './runtime.js';
import { log } from './logger.js';

/**
 * L'état du démon lui-même : depuis quand il tourne, et si le code construit
 * qu'il devrait servir est plus récent que lui. C'est ce qui allume le petit
 * triangle sur le bouton de redémarrage.
 */

/** Le démarrage de CE processus, figé une fois pour toutes. */
const DEMARRE_A = Date.now();

/** Les dossiers construits dont dépend le démon en marche. */
const DOSSIERS_CONSTRUITS = [path.join(ROOT, 'server', 'dist'), path.join(ROOT, 'shared', 'dist')];

/** La date d'écriture la plus récente sous un dossier, sans le parcourir sans fin. */
function derniereEcriture(dossier: string, profondeur = 0): number {
  if (profondeur > 4) return 0;
  let derniere = 0;
  let entrees: fs.Dirent[];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entree of entrees) {
    const complet = path.join(dossier, entree.name);
    try {
      if (entree.isDirectory()) {
        derniere = Math.max(derniere, derniereEcriture(complet, profondeur + 1));
      } else if (entree.name.endsWith('.js')) {
        derniere = Math.max(derniere, fs.statSync(complet).mtimeMs);
      }
    } catch {
      // Fichier disparu en cours de lecture : il ne dit rien de plus.
    }
  }
  return derniere;
}

export function etatDemon(): EtatDemon & { redemarrageNecessaire: boolean } {
  const construitA = Math.max(...DOSSIERS_CONSTRUITS.map((d) => derniereEcriture(d)), 0) || undefined;
  const etat: EtatDemon = {
    demarreA: DEMARRE_A,
    construitA,
    agentsEnCours: runningAgentIds().length,
  };
  return { ...etat, redemarrageNecessaire: redemarrageNecessaire(etat) };
}

/** Ce qui a déjà été annoncé aux navigateurs : on ne répète pas pour rien. */
let dernierEnvoi = '';

/** Diffuse l'état s'il a changé. Appelé au rythme du relevé de capacité. */
export function diffuserEtatDemon(force = false): void {
  const etat = etatDemon();
  const signature = `${etat.redemarrageNecessaire}:${etat.agentsEnCours}`;
  if (!force && signature === dernierEnvoi) return;
  dernierEnvoi = signature;
  bus.emit({ type: 'demon', etat });
}

/**
 * L'arrêt volontaire. Le service est déclaré `Restart=always` : quitter, c'est
 * repartir cinq secondes plus tard avec le code construit. On laisse le temps
 * à la réponse de partir, sinon le navigateur croit à une coupure.
 */
export function redemarrerDemon(): void {
  log.info('redémarrage demandé depuis l’interface');
  bus.toast('info', 'Le serveur redémarre — l’application se reconnectera toute seule.');
  setTimeout(() => process.exit(0), 400);
}
