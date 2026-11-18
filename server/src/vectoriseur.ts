import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { JETONS_DU_TRI, LOT_DU_TRI, MODELE_DE_TRI, MODELE_VECTEURS, REPOS_DU_VECTORISEUR_MS, triDesCompetencesPermis } from '@beluga/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';
import { memoireDeLaMachine, type MemoireDeLaMachine } from './porte-des-travaux-lourds.js';

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

/**
 * Le MODÈLE DE TRI est-il sur le disque (`scripts/installer-modele-vecteurs.mjs`) ?
 * Absent, rien ne casse : les compétences gardent l'ordre de la recherche.
 */
export function modeleDeTriDisponible(): boolean {
  // Interrupteur d'arrêt (et mesure « avant » de `scripts/mesure-competences-par-le-sens.mjs --sans-tri`).
  if (process.env.BELUGA_SANS_TRI_DES_COMPETENCES === '1') return false;
  if (essai.modeleDeTri) return true;
  return vectoriseurDisponible() && fs.existsSync(path.join(dossierDuVectoriseur(), 'modeles', MODELE_DE_TRI, 'onnx'));
}

/* ------------------------------------------------------------------ */
/* Les processus                                                        */
/* ------------------------------------------------------------------ */

/**
 * DEUX PROCESSUS, CHACUN SON REPOS : le vectoriseur (e5-small, ~500 Mo) sert
 * toute recherche de mémoire et vit `REPOS_DU_VECTORISEUR_MS` ; le TRIEUR
 * (bge-reranker, ~1,1 Go) ne sert qu'aux compétences et quitte la mémoire vive
 * après `REPOS_DU_TRIEUR_MS`. Séparés, le gros modèle ne prolonge jamais la vie
 * du petit, et un tri ne fait pas attendre une recherche.
 */
type Reponse = { vecteurs?: string[]; notes?: number[] };
interface Emplacement {
  nom: string;
  args: () => string[];
  repos: number;
  processus: ChildProcessWithoutNullStreams | null;
  enAttente: Map<number, { resoudre: (r: Reponse) => void; rejeter: (e: Error) => void }>;
  minuteurDeRepos: NodeJS.Timeout | null;
}

/**
 * Le trieur quitte la mémoire vive plus tôt que le vectoriseur : ~1,1 Go, utile seulement autour d'un cadrage.
 * 2 min depuis le 18/11/2026 (5 avant) : au calme, il pesait encore 688 Mo sur une machine dont le fichier
 * d'échange était plein à 98 %. Un cadrage enchaîne ses tris en quelques secondes ; au-delà, le recharger
 * coûte moins que le garder.
 */
export const REPOS_DU_TRIEUR_MS = 2 * 60 * 1000;

/* Pour les tests : un modèle de tri d'essai (`@essai`, sans moteur) et une mémoire imposée. */
const essai: { modeleDeTri?: string; memoire?: () => MemoireDeLaMachine } = {};
export function reglerLeTriPourLesTests(r: { modeleDeTri?: string; memoire?: () => MemoireDeLaMachine }): void {
  essai.modeleDeTri = r.modeleDeTri;
  essai.memoire = r.memoire;
  if (trieur.processus) arreterLeProcessus(trieur, 'réglage d’essai');
}

const vecteurs: Emplacement = {
  nom: 'vectoriseur',
  args: () => [dossierDuVectoriseur(), MODELE_VECTEURS],
  repos: REPOS_DU_VECTORISEUR_MS,
  processus: null,
  enAttente: new Map(),
  minuteurDeRepos: null,
};
const trieur: Emplacement = {
  nom: 'trieur',
  args: () => [dossierDuVectoriseur(), '-', essai.modeleDeTri ?? MODELE_DE_TRI, String(JETONS_DU_TRI), String(LOT_DU_TRI)],
  repos: REPOS_DU_TRIEUR_MS,
  processus: null,
  enAttente: new Map(),
  minuteurDeRepos: null,
};
let prochainId = 1;

function arreterLeProcessus(e: Emplacement, raison: string): void {
  if (!e.processus) return;
  const p = e.processus;
  e.processus = null;
  for (const [, attente] of e.enAttente) attente.rejeter(new Error(raison));
  e.enAttente.clear();
  try {
    p.kill();
  } catch {
    // déjà parti
  }
}

function demarrerLeProcessus(e: Emplacement): ChildProcessWithoutNullStreams {
  if (e.processus) return e.processus;
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vectoriseur-processus.js');
  const p = spawn(process.execPath, [script, ...e.args()], { stdio: ['pipe', 'pipe', 'pipe'] });
  e.processus = p;
  readline.createInterface({ input: p.stdout }).on('line', (ligne) => {
    try {
      const r = JSON.parse(ligne) as { id: number; vecteurs?: string[]; notes?: number[]; erreur?: string; annule?: boolean; lots?: number };
      if (r.id === 0 && r.erreur) {
        log.warn(`${e.nom} : ${r.erreur}`);
        return;
      }
      if (r.annule) {
        annulationsConfirmees += 1;
        log.info(`${e.nom} : demande ${r.id} arrêtée après ${r.lots ?? 0} lot(s)`);
        return;
      }
      const attente = e.enAttente.get(r.id);
      if (!attente) return;
      e.enAttente.delete(r.id);
      if (r.erreur || (!r.vecteurs && !r.notes)) attente.rejeter(new Error(r.erreur ?? 'réponse vide'));
      else attente.resoudre(r);
    } catch {
      // une ligne qui n'est pas du JSON (avertissement du moteur) : ignorée
    }
  });
  p.stderr.on('data', () => {});
  p.on('exit', () => {
    if (e.processus === p) arreterLeProcessus(e, `le ${e.nom} s’est arrêté`);
  });
  return p;
}

function versVecteur(buf: Buffer): Float32Array {
  // Copie : le tampon d'un Buffer peut être partagé et décalé.
  const copie = new Uint8Array(buf.length);
  copie.set(buf);
  return new Float32Array(copie.buffer);
}

/**
 * Une demande au processus, bornée dans le temps. Tient le processus éveillé (repos repoussé). `annulerAuDelai` :
 * au-delà du délai, le processus reçoit `{ annuler: id }` et s'arrête au lot suivant, au lieu de finir un calcul
 * dont plus personne ne veut (le trieur, 18/11/2026).
 */
function demander(e: Emplacement, corps: Record<string, unknown>, delaiMs: number, lent: string, annulerAuDelai = false): Promise<Reponse> {
  const p = demarrerLeProcessus(e);
  if (e.minuteurDeRepos) clearTimeout(e.minuteurDeRepos);
  e.minuteurDeRepos = setTimeout(() => arreterLeProcessus(e, 'repos'), e.repos);
  e.minuteurDeRepos.unref();
  const id = prochainId++;
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => {
      e.enAttente.delete(id);
      if (annulerAuDelai && e.processus === p) {
        try {
          p.stdin.write(`${JSON.stringify({ annuler: id })}\n`);
        } catch {
          // processus déjà parti : rien à arrêter
        }
      }
      rejeter(new Error(lent));
    }, delaiMs);
    minuteur.unref();
    e.enAttente.set(id, {
      resoudre: (r) => {
        clearTimeout(minuteur);
        resoudre(r);
      },
      rejeter: (e) => {
        clearTimeout(minuteur);
        rejeter(e);
      },
    });
    p.stdin.write(`${JSON.stringify({ id, ...corps })}\n`);
  });
}

/** Vectorise des textes déjà préfixés. Rejette si le vectoriseur manque ou tarde au-delà de `delaiMs`. */
export async function vectoriser(textes: readonly string[], delaiMs = 120_000): Promise<Float32Array[]> {
  if (!textes.length) return [];
  if (!vectoriseurDisponible()) throw new Error('vectoriseur non installé');
  const r = await demander(vecteurs, { textes }, delaiMs, 'vectoriseur trop lent');
  if (!r.vecteurs) throw new Error('réponse sans vecteurs');
  return r.vecteurs.map((b64) => versVecteur(Buffer.from(b64, 'base64')));
}

let triEnVol = false;
let annulationsConfirmees = 0;

/** Pour les tests et le relevé : un tri est-il en vol, combien de tris abandonnés le processus a-t-il vraiment arrêtés ? */
export function etatDuTrieur(): { enVol: boolean; charge: boolean; annulationsConfirmees: number } {
  return { enVol: triEnVol, charge: !!trieur.processus, annulationsConfirmees };
}

/**
 * LE TRI PAR LE MODÈLE QUI LIT : une note entre 0 et 1 par document, dans
 * l'ordre reçu. Rend `undefined` — JAMAIS d'exception — sans modèle, au-delà de
 * `delaiMs` ou sur une panne : l'appelant garde alors son ordre d'avant.
 *
 * SEULEMENT QUAND LA MACHINE A DE LA PLACE (décision de l'utilisateur, 18/11/2026) :
 *  - mémoire sous pression (`pressionMemoire`), ou trieur à charger sans ~1,5 Go
 *    disponibles : tri SAUTÉ, aussitôt (`triDesCompetencesPermis`) ;
 *  - UN SEUL tri en vol, sans file : une demande concurrente rend `undefined`
 *    tout de suite (cinq cadrages à la fois en empilaient onze en deux minutes) ;
 *  - au délai, le tri est ANNULÉ dans le processus, qui s'arrête au lot suivant
 *    au lieu de finir un calcul abandonné.
 */
export async function noterParLeTri(requete: string, documents: readonly string[], delaiMs: number): Promise<number[] | undefined> {
  if (!documents.length || delaiMs <= 0 || !modeleDeTriDisponible()) return undefined;
  if (triEnVol) {
    log.info('tri des compétences : ordre d’avant gardé (tri sauté : un autre tri est en cours)');
    return undefined;
  }
  const memoire = (essai.memoire ?? memoireDeLaMachine)();
  const porte = triDesCompetencesPermis({ pression: memoire.pression, trieurCharge: !!trieur.processus, memDispoMo: memoire.memDispoMo });
  if (!porte.permis) {
    log.info(`tri des compétences : ordre d’avant gardé (tri sauté : ${porte.raison})`);
    return undefined;
  }
  triEnVol = true;
  try {
    const r = await demander(trieur, { tri: { requete, documents } }, delaiMs, 'tri trop lent', true);
    return r.notes && r.notes.length === documents.length ? r.notes : undefined;
  } catch (err) {
    log.info(`tri des compétences : ordre d'avant gardé (${(err as Error).message})`);
    return undefined;
  } finally {
    triEnVol = false;
  }
}

/** La mémoire vive d'un processus (vectoriseur ou trieur), en Mo (mesure) ; `undefined` s'il ne tourne pas. */
export function memoireDuProcessusMo(quel: 'vectoriseur' | 'trieur'): number | undefined {
  const pid = (quel === 'trieur' ? trieur : vecteurs).processus?.pid;
  if (!pid) return undefined;
  try {
    const ligne = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);
    return ligne ? Math.round(Number(ligne[1]) / 1024) : undefined;
  } catch {
    return undefined;
  }
}

/** Pour les tests et l'arrêt du démon. */
export function arreterLeVectoriseur(): void {
  for (const e of [vecteurs, trieur]) {
    if (e.minuteurDeRepos) clearTimeout(e.minuteurDeRepos);
    arreterLeProcessus(e, 'arrêt');
  }
}
