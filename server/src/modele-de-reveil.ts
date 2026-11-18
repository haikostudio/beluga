import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { dossierDesOutils } from './voix-de-realisation.js';

const execFileAsync = promisify(execFile);

/**
 * LE PETIT MODÈLE QUI RECONNAÎT « DIS JARVIS » SUR L'APPAREIL (carte « Veille privée et réveil »).
 *
 * Le navigateur attend le mot de réveil LUI-MÊME (`web/src/lib/mot-de-reveil.ts`, Vosk en WebAssembly) : aucun son
 * ne quitte l'appareil avant le mot. Il lui faut un modèle de reconnaissance français (Vosk « small fr 0.22 »,
 * ≈ 42 Mo), que le démon SERT sous une adresse authentifiée, au format attendu par vosk-browser (archive .tar.gz
 * avec son dossier de tête). Le modèle vit dans les données (`dossierDesOutils()/models/vosk-fr-small`), JAMAIS
 * dans git : il est téléchargé une seule fois, au premier besoin, depuis alphacephei.com, puis servi en cache long
 * (nom versionné : un modèle neuf changera de nom).
 */
export const VERSION_DU_MODELE_DE_REVEIL = 'vosk-model-small-fr-0.22';
const SOURCE = `https://alphacephei.com/vosk/models/${VERSION_DU_MODELE_DE_REVEIL}.zip`;
/** Une archive plus petite est une archive tronquée : on la refait. */
const TAILLE_MIN = 30 * 1024 * 1024;

export function cheminDuModeleDeReveil(): string {
  return path.join(dossierDesOutils(), 'models', 'vosk-fr-small', `${VERSION_DU_MODELE_DE_REVEIL}.tar.gz`);
}

function archivePrete(chemin: string): boolean {
  try {
    return fs.statSync(chemin).size >= TAILLE_MIN;
  } catch {
    return false;
  }
}

let enPreparation: Promise<string> | null = null;

/** Rend le chemin de l'archive, en la fabriquant d'abord si elle manque (un seul téléchargement à la fois). */
export function modeleDeReveil(): Promise<string> {
  const chemin = cheminDuModeleDeReveil();
  if (archivePrete(chemin)) return Promise.resolve(chemin);
  enPreparation ??= preparer(chemin).finally(() => {
    enPreparation = null;
  });
  return enPreparation;
}

async function preparer(chemin: string): Promise<string> {
  const atelier = fs.mkdtempSync(path.join(os.tmpdir(), 'modele-reveil-'));
  try {
    const zip = path.join(atelier, 'modele.zip');
    const reponse = await fetch(SOURCE, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!reponse.ok || !reponse.body) throw new Error(`téléchargement du modèle refusé (${reponse.status})`);
    fs.writeFileSync(zip, Buffer.from(await reponse.arrayBuffer()));
    const extrait = path.join(atelier, 'extrait');
    fs.mkdirSync(extrait);
    await execFileAsync('unzip', ['-q', zip, '-d', extrait], { timeout: 120_000 });
    if (!fs.existsSync(path.join(extrait, VERSION_DU_MODELE_DE_REVEIL))) throw new Error('archive du modèle inattendue');
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    const provisoire = `${chemin}.${process.pid}.part`;
    await execFileAsync('tar', ['czf', provisoire, '-C', extrait, VERSION_DU_MODELE_DE_REVEIL], { timeout: 300_000 });
    fs.renameSync(provisoire, chemin);
    return chemin;
  } finally {
    fs.rmSync(atelier, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Le vocabulaire du modèle : un nom d'assistant sera-t-il entendu ?    */
/* ------------------------------------------------------------------ */

/**
 * LES MOTS QUE LE MODÈLE CONNAÎT (carte « En-tête collant et défilement des pages », 17/11/2026). La reconnaissance
 * locale IGNORE un mot absent de son vocabulaire (« Ignoring word missing in vocabulary ») : un nom d'assistant
 * inconnu ne réveillerait jamais rien. Le vocabulaire est la table des symboles d'entrée posée en tête du graphe
 * `graph/Gr.fst` (format binaire OpenFst : entête, puis la table — ≈ 136 000 mots pour « small fr 0.22 »). Il est lu
 * UNE fois dans l'archive servie au navigateur, puis gardé à côté d'elle (`vocabulaire.txt`, un mot par ligne).
 */
const MAGIE_FST = 2125659606;
const MAGIE_SYMBOLES = 2125658996;

/** La table des symboles d'entrée d'un graphe OpenFst binaire. Lève une erreur sur un format inattendu. */
export function symbolesDuGraphe(graphe: Buffer): string[] {
  let o = 0;
  const entier = () => {
    const v = graphe.readInt32LE(o);
    o += 4;
    return v;
  };
  const long = () => {
    const v = Number(graphe.readBigInt64LE(o));
    o += 8;
    return v;
  };
  const texte = () => {
    const n = entier();
    if (n < 0 || n > 4096) throw new Error('chaîne inattendue dans le graphe');
    const s = graphe.toString('utf8', o, o + n);
    o += n;
    return s;
  };
  if (entier() !== MAGIE_FST) throw new Error('graphe du modèle illisible (signature)');
  texte(); // type de graphe
  texte(); // type d'arc
  entier(); // version
  const drapeaux = entier();
  long(); // propriétés
  long(); // état de départ
  long(); // nombre d'états
  long(); // nombre d'arcs
  if (!(drapeaux & 1)) throw new Error('le graphe du modèle ne porte pas sa table de mots');
  if (entier() !== MAGIE_SYMBOLES) throw new Error('table de mots illisible (signature)');
  texte(); // nom de la table
  long(); // prochaine clé libre
  const taille = long();
  if (taille <= 0 || taille > 2_000_000) throw new Error('table de mots de taille inattendue');
  const mots: string[] = [];
  for (let k = 0; k < taille; k += 1) {
    mots.push(texte());
    long();
  }
  return mots;
}

/** Le fichier `Gr.fst` lu dans l'archive .tar.gz du modèle (lecture tar minimale, sans dépendance). */
function grapheDeLArchive(archive: string): Buffer {
  const tar = zlib.gunzipSync(fs.readFileSync(archive));
  let o = 0;
  while (o + 512 <= tar.length) {
    const entete = tar.subarray(o, o + 512);
    if (entete.every((b) => b === 0)) break;
    const nom = entete.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefixe = entete.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    const taille = parseInt(entete.toString('utf8', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const chemin = prefixe ? `${prefixe}/${nom}` : nom;
    o += 512;
    if (chemin.endsWith('graph/Gr.fst')) return tar.subarray(o, o + taille);
    o += Math.ceil(taille / 512) * 512;
  }
  throw new Error('graphe du modèle introuvable dans l’archive');
}

let vocabulaire: Set<string> | null = null;
let vocabulaireEnLecture: Promise<Set<string>> | null = null;

/**
 * LE VOCABULAIRE DU MODÈLE, en ensemble. Prépare le modèle s'il manque (premier besoin), lit la table une fois et
 * la garde. Une panne se DIT (erreur levée) : on n'accepte jamais un nom en silence faute de pouvoir le juger.
 */
export function vocabulaireDuReveil(): Promise<Set<string>> {
  if (vocabulaire) return Promise.resolve(vocabulaire);
  vocabulaireEnLecture ??= (async () => {
    const archive = await modeleDeReveil();
    const cache = path.join(path.dirname(archive), 'vocabulaire.txt');
    let mots: string[];
    if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(archive).mtimeMs) {
      mots = fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean);
    } else {
      mots = symbolesDuGraphe(grapheDeLArchive(archive));
      try {
        fs.writeFileSync(cache, `${mots.join('\n')}\n`);
      } catch {
        /* cache refusé : on relira l'archive la prochaine fois */
      }
    }
    vocabulaire = new Set(mots);
    return vocabulaire;
  })().finally(() => {
    vocabulaireEnLecture = null;
  });
  return vocabulaireEnLecture;
}
