import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { MODELE_VECTEURS, REPOS_DU_VECTORISEUR_MS } from '@beluga/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * LE VECTORISEUR LOCAL — une recherche par le SENS, en renfort du plein texte,
 * toujours locale et sans quota. Il sert la base de connaissances
 * (`server/src/connaissances.ts`).
 *
 * Le modèle (multilingual-e5-small) tourne dans un PROCESSUS À PART
 * (`vectoriseur-processus.ts`), lancé à la première demande et arrêté après
 * `REPOS_DU_VECTORISEUR_MS` sans travail : le démon ne porte jamais ses ~500 Mo.
 * Rien n'est obligatoire : sans moteur installé, sans modèle, ou si le processus
 * tarde, la recherche reste le plein texte seul.
 */
export function dossierDuVectoriseur(): string {
  return path.join(CONFIG.dataDir, 'vectoriseur');
}

/** Le moteur et le modèle sont-ils sur le disque ? Aucun réseau, aucun chargement. */
export function vectoriseurDisponible(): boolean {
  const dossier = dossierDuVectoriseur();
  return (
    fs.existsSync(path.join(dossier, 'node_modules/@huggingface/transformers/package.json')) &&
    fs.existsSync(path.join(dossier, 'modeles', MODELE_VECTEURS, 'onnx'))
  );
}

/* ------------------------------------------------------------------ */
/* Le processus                                                         */
/* ------------------------------------------------------------------ */

let processus: ChildProcessWithoutNullStreams | null = null;
let prochainId = 1;
const enAttente = new Map<number, { resoudre: (v: Float32Array[]) => void; rejeter: (e: Error) => void }>();
let minuteurDeRepos: NodeJS.Timeout | null = null;

function arreterLeProcessus(raison: string): void {
  if (!processus) return;
  const p = processus;
  processus = null;
  for (const [, attente] of enAttente) attente.rejeter(new Error(raison));
  enAttente.clear();
  try {
    p.kill();
  } catch {
    // déjà parti
  }
}

function demarrerLeProcessus(): ChildProcessWithoutNullStreams {
  if (processus) return processus;
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vectoriseur-processus.js');
  const p = spawn(process.execPath, [script, dossierDuVectoriseur(), MODELE_VECTEURS], { stdio: ['pipe', 'pipe', 'pipe'] });
  processus = p;
  readline.createInterface({ input: p.stdout }).on('line', (ligne) => {
    try {
      const r = JSON.parse(ligne) as { id: number; vecteurs?: string[]; erreur?: string };
      if (r.id === 0 && r.erreur) {
        log.warn(`vecteurs : ${r.erreur}`);
        return;
      }
      const attente = enAttente.get(r.id);
      if (!attente) return;
      enAttente.delete(r.id);
      if (r.erreur || !r.vecteurs) attente.rejeter(new Error(r.erreur ?? 'réponse vide'));
      else attente.resoudre(r.vecteurs.map((b64) => versVecteur(Buffer.from(b64, 'base64'))));
    } catch {
      // une ligne qui n'est pas du JSON (avertissement du moteur) : ignorée
    }
  });
  p.stderr.on('data', () => {});
  p.on('exit', () => {
    if (processus === p) arreterLeProcessus('le vectoriseur s’est arrêté');
  });
  return p;
}

function versVecteur(buf: Buffer): Float32Array {
  // Copie : le tampon d'un Buffer peut être partagé et décalé.
  const copie = new Uint8Array(buf.length);
  copie.set(buf);
  return new Float32Array(copie.buffer);
}

/** Vectorise des textes déjà préfixés. Rejette si le vectoriseur manque ou tarde au-delà de `delaiMs`. */
export function vectoriser(textes: readonly string[], delaiMs = 120_000): Promise<Float32Array[]> {
  if (!textes.length) return Promise.resolve([]);
  if (!vectoriseurDisponible()) return Promise.reject(new Error('vectoriseur non installé'));
  const p = demarrerLeProcessus();
  if (minuteurDeRepos) clearTimeout(minuteurDeRepos);
  minuteurDeRepos = setTimeout(() => arreterLeProcessus('repos'), REPOS_DU_VECTORISEUR_MS);
  minuteurDeRepos.unref();
  const id = prochainId++;
  return new Promise<Float32Array[]>((resoudre, rejeter) => {
    const minuteur = setTimeout(() => {
      enAttente.delete(id);
      rejeter(new Error('vectoriseur trop lent'));
    }, delaiMs);
    minuteur.unref();
    enAttente.set(id, {
      resoudre: (v) => {
        clearTimeout(minuteur);
        resoudre(v);
      },
      rejeter: (e) => {
        clearTimeout(minuteur);
        rejeter(e);
      },
    });
    p.stdin.write(`${JSON.stringify({ id, textes })}\n`);
  });
}

/** Pour les tests et l'arrêt du démon. */
export function arreterLeVectoriseur(): void {
  if (minuteurDeRepos) clearTimeout(minuteurDeRepos);
  arreterLeProcessus('arrêt');
}
