import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  MODELE_TTS_GEMINI,
  VOIX_D_ESSAI,
  VOIX_ESSAI_PAR_DEFAUT,
  alignerMots,
  cleOpenRouterDuRelais,
  motsRepartis,
  sonGeminiEnWav,
  texteDeVoixFinale,
  type MotHorodate,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { listerAcces } from './coffre-fort.js';
import { cleDuService } from './studio-services.js';
import { dansLaFileLourde } from './file-lourde.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * LA VOIX ET LES MOTS DU DIRECTEUR ARTISTIQUE — sortis du Studio (retiré le
 * 26/10/2026), sans rien changer à leur comportement :
 *
 *  - VOIX D'ESSAI : Piper, sur le serveur, gratuite, dans la file lourde ;
 *  - MOTS HORODATÉS : faster-whisper (`scripts/mots-horodates.py`, modèle
 *    « base »), alignés sur le texte connu ; repli au prorata, dit ;
 *  - VOIX FINALE : une voix Gemini PAR OPENROUTER seulement (MEM-4350), avec
 *    la clé branchée par l'utilisateur, sinon celle du relais de Beluga Build.
 *    Elle ne part que par un devis du directeur, dans le prix accordé.
 */

/** Où vivent l'environnement Python et les modèles (le dépôt principal depuis une copie de carte). */
export function dossierDesOutils(): string {
  return fs.existsSync(path.join(CONFIG.dataDir, 'venv')) ? CONFIG.dataDir : path.join(CONFIG.depotDuDemon, 'data');
}
const PYTHON = () => path.join(dossierDesOutils(), 'venv', 'bin', 'python');
const SCRIPT_MOTS = path.join(CONFIG.selfPath, 'scripts', 'mots-horodates.py');

/** La durée réelle d'un fichier son ou vidéo, lue par ffprobe. */
export async function dureeDuFichier(fichier: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier], { timeout: 30_000 });
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error('durée illisible');
  return d;
}

/* ------------------------------------------------------------------ */
/* Voix d'essai (Piper)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Une voix d'essai est TOUJOURS une voix Piper du serveur : jamais Gemini, même mal nommée.
 * `voice.ts` se charge à la demande : il importe `runtime.ts`, et ce module est
 * chargé par `realisation.ts`, lui-même chargé par `tools.ts` — un import en
 * tête refermerait la boucle tools → runtime → tools au démarrage.
 */
async function resoudreEssai(id: string): Promise<{ modele: string; personne?: number } | null> {
  const dossier = dossierDesOutils();
  if (dossier !== CONFIG.dataDir) {
    // Depuis une copie de carte, les modèles vivent dans le dépôt principal.
    const [modele, personne] = id.split('@');
    const fichier = path.join(dossier, 'models', 'piper', `${modele}.onnx`);
    if (!fs.existsSync(fichier)) return null;
    if (!personne) return { modele: fichier };
    try {
      const numero = JSON.parse(fs.readFileSync(`${fichier}.json`, 'utf8')).speaker_id_map?.[personne];
      return typeof numero === 'number' ? { modele: fichier, personne: numero } : null;
    } catch {
      return null;
    }
  }
  const { resoudre } = await import('./voice.js');
  const r = resoudre(id);
  return r && r.moteur === 'piper' ? { modele: r.modele, ...(r.personne !== undefined ? { personne: r.personne } : {}) } : null;
}

/** Les voix d'essai proposées : les voix Piper posées sur le serveur. */
export function voixDEssaiDisponibles(): { id: string; label: string }[] {
  const dossier = path.join(dossierDesOutils(), 'models', 'piper');
  try {
    const presents = new Set(fs.readdirSync(dossier).filter((f) => f.endsWith('.onnx')).map((f) => f.replace(/\.onnx$/, '')));
    return Object.entries(VOIX_D_ESSAI)
      .filter(([id]) => presents.has(id.split('@')[0]!))
      .map(([id, label]) => ({ id, label }));
  } catch {
    return [];
  }
}

/**
 * PIPER, PAR SON MODULE (`python -m piper`, jamais le lanceur `venv/bin/piper`
 * dont l'entête vise un chemin disparu — MEM-4331).
 */
function synthetiserParPiper(retenue: { modele: string; personne?: number }, texte: string, sortie: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const enfant = execFile(
      PYTHON(),
      ['-m', 'piper', '--model', retenue.modele, ...(retenue.personne === undefined ? [] : ['--speaker', String(retenue.personne)]), '--output_file', sortie],
      { timeout: 180_000 },
      (err) => (err ? reject(err) : resolve()),
    );
    enfant.stdin?.end(texte);
  });
}

/** FABRIQUE UNE VOIX D'ESSAI dans `sortie` (WAV) : gratuite, sur le serveur, dans la file lourde. */
export async function fabriquerVoixDEssai(texte: string, sortie: string, voix = VOIX_ESSAI_PAR_DEFAUT): Promise<{ ok: true; duree: number } | { ok: false; raison: string }> {
  if (!texte.trim()) return { ok: false, raison: 'le texte de la voix est vide' };
  const retenue = await resoudreEssai(voix);
  if (!retenue) return { ok: false, raison: `la voix d’essai « ${voix} » n’est pas posée sur le serveur (voix possibles : ${voixDEssaiDisponibles().map((v) => v.id).join(', ') || 'aucune'})` };
  try {
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    await dansLaFileLourde(() => synthetiserParPiper(retenue, texte, sortie));
    return { ok: true, duree: await dureeDuFichier(sortie) };
  } catch (err: any) {
    log.warn('réalisation : voix d’essai impossible', err?.message);
    return { ok: false, raison: `la voix d’essai n’a pas pu être fabriquée (${String(err?.message ?? err).slice(0, 160)})` };
  }
}

/* ------------------------------------------------------------------ */
/* Mots horodatés (faster-whisper)                                      */
/* ------------------------------------------------------------------ */

async function motsReconnus(fichier: string): Promise<MotHorodate[]> {
  const { stdout } = await dansLaFileLourde(() =>
    execFileAsync(PYTHON(), [SCRIPT_MOTS, fichier, 'base'], {
      timeout: 180_000,
      env: { ...process.env, BELUGA_WHISPER_DIR: path.join(dossierDesOutils(), 'models', 'whisper') },
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  const r = JSON.parse(stdout) as { mots: MotHorodate[] };
  return Array.isArray(r.mots) ? r.mots : [];
}

/**
 * LES MOTS D'UNE VOIX, AUX TEMPS DE LA VOIX : avec le texte connu, la
 * reconnaissance ne donne que les temps ; sans texte, les mots reconnus tels
 * quels. Une reconnaissance impossible répartit au prorata (`reconnus` faux).
 */
export async function motsDeLaVoix(fichier: string, texte?: string): Promise<{ mots: MotHorodate[]; reconnus: boolean; duree: number }> {
  const duree = await dureeDuFichier(fichier);
  try {
    const reconnus = await motsReconnus(fichier);
    if (reconnus.length) return { mots: texte?.trim() ? alignerMots(texte, reconnus, duree) : reconnus, reconnus: true, duree };
  } catch (err: any) {
    log.warn('réalisation : reconnaissance des mots impossible, temps répartis au prorata', err?.message);
  }
  return { mots: texte?.trim() ? motsRepartis(texte, duree) : [], reconnus: false, duree };
}

/* ------------------------------------------------------------------ */
/* Voix finale (OpenRouter)                                             */
/* ------------------------------------------------------------------ */

const OPENROUTER = 'https://openrouter.ai/api/v1';
export const MODELE_VOIX_OPENROUTER = `google/${MODELE_TTS_GEMINI}`;

/** LA CLÉ OPENROUTER : celle que l'utilisateur a branchée (« Services de création »), sinon celle du relais de Beluga Build. */
export function cleOpenRouter(): string | undefined {
  const branchee = cleDuService('openrouter');
  if (branchee) return branchee;
  try {
    return cleOpenRouterDuRelais(listerAcces());
  } catch {
    return undefined;
  }
}

export const RAISON_SANS_CLE_OPENROUTER =
  'aucune clé OpenRouter : branchez votre compte dans les paramètres, rubrique « Services de création » (sinon la voix finale passe par l’espace OpenRouter de Beluga Build, fiche « OpenRouter — Haiko — relais IA » du coffre-fort)';

let prixEnCache: { a: number; prix: { parJetonAudio: number; parJetonTexte: number } } | null = null;

/** Le prix de la voix Gemini chez OpenRouter, relu toutes les dix minutes — jamais écrit en dur. */
export async function prixDeLaVoix(): Promise<{ parJetonAudio: number; parJetonTexte: number }> {
  if (prixEnCache && Date.now() - prixEnCache.a < 10 * 60_000) return prixEnCache.prix;
  const cle = cleOpenRouter();
  const reponse = await fetch(`${OPENROUTER}/models?output_modalities=speech`, { headers: cle ? { Authorization: `Bearer ${cle}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!reponse.ok) throw new Error(`liste des prix illisible (${reponse.status})`);
  const corps = (await reponse.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  const modele = corps.data?.find((m) => m.id === MODELE_VOIX_OPENROUTER);
  const audio = Number(modele?.pricing?.completion);
  const texte = Number(modele?.pricing?.prompt);
  if (!Number.isFinite(audio) || audio <= 0) throw new Error(`le prix de « ${MODELE_VOIX_OPENROUTER} » n’est pas publié`);
  prixEnCache = { a: Date.now(), prix: { parJetonAudio: audio, parJetonTexte: Number.isFinite(texte) ? texte : 0 } };
  return prixEnCache.prix;
}

/** LE PRIX ANNONCÉ D'UNE VOIX FINALE : la durée estimée (≈ 15 caractères par seconde) au tarif publié, ou `null`. */
export async function prixEstimeDeLaVoix(texte: string): Promise<number | null> {
  try {
    const prix = await prixDeLaVoix();
    const secondes = Math.max(1, texte.length / 15);
    return secondes * 25 * prix.parJetonAudio + (texte.length / 4) * prix.parJetonTexte;
  } catch {
    return null;
  }
}

/** UNE VOIX GEMINI PAR OPENROUTER, écrite en WAV dans `sortie`. Rend ce qui a été réellement débité. */
export async function voixParOpenRouter(voix: string, texte: string, sortie: string): Promise<number> {
  const cle = cleOpenRouter();
  if (!cle) throw new Error(RAISON_SANS_CLE_OPENROUTER);
  const prix = await prixDeLaVoix();
  const reponse = await fetch(`${OPENROUTER}/audio/speech`, {
    method: 'POST',
    // Une prise entière de plusieurs minutes se fabrique en ≈ 35 s (mesuré le 07/10/2026) : large marge.
    signal: AbortSignal.timeout(240_000),
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELE_VOIX_OPENROUTER, input: texteDeVoixFinale(texte), voice: voix, response_format: 'pcm' }),
  });
  if (!reponse.ok) {
    const t = await reponse.text().catch(() => '');
    throw new Error(`OpenRouter a refusé la voix (${reponse.status}) : ${t.slice(0, 160)}`);
  }
  const brut = Buffer.from(await reponse.arrayBuffer());
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, sonGeminiEnWav(brut, reponse.headers.get('content-type') ?? 'audio/pcm;rate=24000'));
  // Le montant RÉEL : la fiche de génération du fournisseur s'il la donne, sinon le tarif appliqué à la durée réelle.
  const generation = reponse.headers.get('x-generation-id');
  if (generation) {
    for (let essai = 0; essai < 4; essai++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const g = await fetch(`${OPENROUTER}/generation?id=${encodeURIComponent(generation)}`, { headers: { Authorization: `Bearer ${cle}` } });
        if (g.ok) {
          const corps = (await g.json()) as { data?: { total_cost?: number } };
          if (typeof corps.data?.total_cost === 'number') return corps.data.total_cost;
        }
      } catch {
        /* réessayer */
      }
    }
  }
  const duree = await dureeDuFichier(sortie);
  return duree * 25 * prix.parJetonAudio + (texte.length / 4) * prix.parJetonTexte;
}
