/**
 * LE DÉCOR D'UN DÉMON D'ESSAI, ÉCRIT UNE FOIS POUR TOUTES.
 *
 * Presque tous les contrôles de `scripts/` montent le même décor avant de
 * regarder quoi que ce soit : un dossier temporaire, `data/` et `projets/`
 * dedans, un petit dépôt git d'essai, le démon lancé sur un port libre avec
 * une base NEUVE, son journal capturé, et le tout retiré à la sortie. Ces
 * cinquante lignes étaient recopiées à l'identique dans des dizaines de
 * fichiers : une règle qui change le décor devait être appliquée autant de
 * fois. Elle vit ici désormais.
 *
 *   import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';
 *
 *   const PORT = Number(process.env.BELUGA_VERIF_PORT || 7195);
 *   const BASE = `http://127.0.0.1:${PORT}`;
 *   const { TMP, DATA, PROJETS, DEPOT, demon, journal, attendrePort } =
 *     demarrerDemonDEssai({ prefixe: 'verif-point-bleu-', port: PORT });
 *
 *   if (!(await attendrePort())) {
 *     console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
 *     process.exit(1);
 *   }
 *
 * Le démon de PRODUCTION n'est jamais touché : base neuve, dossier de projets
 * vide, port donné par l'appelant. Aucun quota n'est dépensé.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** La racine du dépôt d'où PART ce fichier — jamais un chemin personnel. */
export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Monte le décor, lance le démon d'essai et rend de quoi l'attendre.
 *
 * @param {object} options
 * @param {number} options.port           Le port du démon d'essai (obligatoire).
 * @param {string} [options.prefixe]      Préfixe du dossier temporaire (« verif-… »).
 * @param {string} [options.tmp]          Un dossier temporaire DÉJÀ créé, au lieu du préfixe.
 * @param {Record<string,string>} [options.env] Variables d'environnement en PLUS (elles gagnent).
 * @param {boolean} [options.depot=true]  Créer `depot/` et y faire un vrai dépôt git.
 * @param {string} [options.messageCommit='départ'] Le message du commit de départ.
 * @param {string[]} [options.dossiers]   D'autres dossiers à créer sous le temporaire.
 * @param {boolean} [options.signaux]     Nettoyer aussi sur SIGINT / SIGTERM / SIGHUP.
 * @param {boolean} [options.detached]    Lancer le démon dans son propre groupe de processus.
 * @param {boolean} [options.garder]      Laisser le décor sur le disque à la sortie.
 * @returns {{ TMP: string, DATA: string, PROJETS: string, DEPOT: string,
 *             demon: import('node:child_process').ChildProcess, journal: string[],
 *             attendrePort: (limiteMs?: number) => Promise<boolean>, nettoyer: () => void }}
 */
export function demarrerDemonDEssai({
  port,
  prefixe = 'verif-demon-essai-',
  tmp,
  env = {},
  depot = true,
  messageCommit = 'départ',
  dossiers = [],
  signaux = false,
  detached = false,
  garder = false,
} = {}) {
  if (!port) throw new Error('demarrerDemonDEssai : il faut un port.');

  const TMP = tmp ?? fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  const DATA = path.join(TMP, 'data');
  const PROJETS = path.join(TMP, 'projets');
  const DEPOT = path.join(TMP, 'depot');

  const aCreer = [DATA, PROJETS, ...(depot ? [DEPOT] : []), ...dossiers];
  for (const dossier of aCreer) fs.mkdirSync(dossier, { recursive: true });

  if (depot) {
    // Un vrai petit dépôt git : la préparation de branche doit avoir de quoi mordre.
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
    fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
    execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
    execFileSync(
      'git',
      ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', messageCommit],
      { cwd: DEPOT },
    );
  }

  const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
    env: {
      ...process.env,
      BELUGA_PORT: String(port),
      BELUGA_HOST: '127.0.0.1',
      BELUGA_DATA: DATA,
      BELUGA_PROJECTS_ROOT: PROJETS,
      BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
      // Les comptes lus sont les vrais : un démon d'essai n'ouvre pas leur fenêtre de cinq heures.
      BELUGA_SANS_AMORCE: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(detached ? { detached: true } : {}),
  });

  const journal = [];
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));

  let rangé = false;
  const nettoyer = () => {
    if (rangé) return;
    rangé = true;
    try {
      demon.kill('SIGKILL');
    } catch {
      /* déjà parti */
    }
    if (!garder) fs.rmSync(TMP, { recursive: true, force: true });
  };

  process.on('exit', nettoyer);
  if (signaux) {
    // Un arrêt à la main doit emporter le démon d'essai AVEC lui : sans cela il
    // garde son port, et la mesure suivante s'ouvre sur une base vide.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(signal, () => {
        nettoyer();
        process.exit(130);
      });
    }
  }

  return { TMP, DATA, PROJETS, DEPOT, demon, journal, nettoyer, attendrePort: (limiteMs) => attendrePort(port, limiteMs) };
}

/** Attend qu'un port réponde. Rend `false` au bout du délai, sans jeter. */
export async function attendrePort(port, limiteMs = 60_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
