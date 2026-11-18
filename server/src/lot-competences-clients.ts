import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DOSSIER_COMPETENCES_FOURNIES,
  FICHIER_COMPETENCE,
  FICHIER_CONTENU_CHIFFRE,
  FICHIER_MANIFESTE_DU_LOT,
  FORMAT_DU_LOT_DE_COMPETENCES,
  MARQUE_DU_CONTENU_CHIFFRE,
  VARIABLE_CLE_COMPETENCES,
  cheminHorsDuLot,
  descriptionDUneLigne,
  jugerCompetencePourClients,
  manifesteDepuisTexte,
  champsDeLaFiche,
  teteDeFicheProtegee,
  texteAPublier,
  type ManifesteDuLot,
} from '@beluga/shared';

/**
 * LE LOT DE COMPÉTENCES DES SERVEURS CLIENTS — fabrication, chiffrement, et
 * lecture côté serveur loué. Règle pure (tri, contrat) : `shared/src/lot-competences-clients.ts`.
 * Contrat complet avec le central : `docs/mecaniques/lot-competences-clients.md`.
 *
 * Ce module ne dépend NI de la base NI de la configuration du démon : le script
 * `scripts/lot-competences-clients.mjs` l'importe tel quel depuis `server/dist`,
 * et le contrôle de bout en bout relit le lot avec le MÊME code que l'hôte.
 */

/* ------------------------------------------------------------------ */
/* La clé                                                              */
/* ------------------------------------------------------------------ */

/** La clé du lot depuis son texte (64 caractères hexadécimaux), ou `null`. */
export function cleDepuisTexte(texte: string | undefined): Buffer | null {
  const propre = String(texte ?? '').trim();
  return /^[a-f0-9]{64}$/i.test(propre) ? Buffer.from(propre, 'hex') : null;
}

/** Une empreinte courte de la clé : elle entre dans la version, jamais la clé elle-même. */
export function empreinteDeCle(cle: Buffer): string {
  return crypto.createHash('sha256').update('beluga-lot-competences').update(cle).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Les fichiers d'une fiche                                            */
/* ------------------------------------------------------------------ */

/** Un fichier plus lourd ne voyage pas : un cerveau n'embarque pas ses environnements. */
const FICHIER_MAX_OCTETS = 25 * 1024 * 1024;
/** Un fichier TEXTE plus lourd ne peut pas être contrôlé en entier : il ne part pas. */
const TEXTE_CONTROLE_MAX_OCTETS = 8 * 1024 * 1024;

export interface FichierDeFiche {
  relatif: string;
  plein: string;
  mode: number;
  taille: number;
}

/**
 * Les fichiers d'une fiche qui VOYAGENT : tout sauf le caché (`.git`, `.venv`,
 * `.raw/` des cerveaux…), l'outillage reconstruit sur place et les liens (un
 * lien pourrait pointer hors de la fiche). Triés, pour une empreinte stable.
 */
export function fichiersDeLaFiche(dossier: string): FichierDeFiche[] {
  const trouves: FichierDeFiche[] = [];
  const parcourir = (courant: string, relatif: string) => {
    let entrees: fs.Dirent[] = [];
    try {
      entrees = fs.readdirSync(courant, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      const suite = relatif ? `${relatif}/${entree.name}` : entree.name;
      if (cheminHorsDuLot(suite)) continue;
      const plein = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        parcourir(plein, suite);
        continue;
      }
      if (!entree.isFile()) continue;
      const etat = fs.statSync(plein);
      if (etat.size > FICHIER_MAX_OCTETS) continue;
      trouves.push({ relatif: suite, plein, mode: etat.mode & 0o777, taille: etat.size });
    }
  };
  parcourir(dossier, '');
  return trouves.sort((a, b) => (a.relatif < b.relatif ? -1 : a.relatif > b.relatif ? 1 : 0));
}

/**
 * Le TEXTE de chaque fichier, pour le filtre de contenu. Un binaire n'est pas
 * contrôlable (il part tel quel) ; un texte trop lourd pour être contrôlé est
 * dit, et la fiche reste.
 */
function textesAControler(fichiers: readonly FichierDeFiche[]): { annexes: Record<string, string>; tropLourd?: string } {
  const annexes: Record<string, string> = {};
  for (const fichier of fichiers) {
    if (fichier.relatif === FICHIER_COMPETENCE) continue;
    const contenu = fs.readFileSync(fichier.plein);
    if (contenu.subarray(0, 8000).includes(0)) continue;
    if (fichier.taille > TEXTE_CONTROLE_MAX_OCTETS) return { annexes, tropLourd: fichier.relatif };
    annexes[fichier.relatif] = contenu.toString('utf8');
  }
  return { annexes };
}

/* ------------------------------------------------------------------ */
/* Le chiffrement d'une fiche protégée                                 */
/* ------------------------------------------------------------------ */

interface ContenuEnClair {
  fichiers: { relatif: string; mode: number; contenu: string }[];
}

/**
 * LE CONTENU CHIFFRÉ D'UNE FICHE : « BLC1 » | iv (12) | étiquette (16) | données,
 * en AES-256-GCM. Les données : le JSON gzippé de ses fichiers (chemin, mode,
 * contenu en base64). Le NOM de la fiche est la donnée associée : un contenu
 * déplacé sous un autre nom ne se déchiffre pas.
 */
export function chiffrerLaFiche(nom: string, fichiers: readonly FichierDeFiche[], cle: Buffer): Buffer {
  const clair: ContenuEnClair = {
    fichiers: fichiers.map((f) => ({ relatif: f.relatif, mode: f.mode, contenu: fs.readFileSync(f.plein).toString('base64') })),
  };
  const donnees = zlib.gzipSync(Buffer.from(JSON.stringify(clair), 'utf8'));
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv('aes-256-gcm', cle, iv);
  chiffre.setAAD(Buffer.from(nom, 'utf8'));
  const corps = Buffer.concat([chiffre.update(donnees), chiffre.final()]);
  return Buffer.concat([Buffer.from(MARQUE_DU_CONTENU_CHIFFRE, 'ascii'), iv, chiffre.getAuthTag(), corps]);
}

/** Déchiffre et rend les fichiers ; lève une erreur si la clé, le nom ou le contenu ne vont pas. */
export function dechiffrerLaFiche(nom: string, blob: Buffer, cle: Buffer): { relatif: string; mode: number; contenu: Buffer }[] {
  if (blob.subarray(0, 4).toString('ascii') !== MARQUE_DU_CONTENU_CHIFFRE) throw new Error('contenu chiffré illisible (marque)');
  const iv = blob.subarray(4, 16);
  const etiquette = blob.subarray(16, 32);
  const dechiffre = crypto.createDecipheriv('aes-256-gcm', cle, iv);
  dechiffre.setAAD(Buffer.from(nom, 'utf8'));
  dechiffre.setAuthTag(etiquette);
  const donnees = Buffer.concat([dechiffre.update(blob.subarray(32)), dechiffre.final()]);
  const clair = JSON.parse(zlib.gunzipSync(donnees).toString('utf8')) as ContenuEnClair;
  return clair.fichiers.map((f) => {
    const relatif = path.posix.normalize(f.relatif);
    if (relatif.startsWith('..') || path.posix.isAbsolute(relatif)) throw new Error(`chemin refusé dans le contenu chiffré : ${f.relatif}`);
    return { relatif, mode: f.mode & 0o755, contenu: Buffer.from(f.contenu, 'base64') };
  });
}

/* ------------------------------------------------------------------ */
/* La fabrication du lot (machine de l'auteur)                         */
/* ------------------------------------------------------------------ */

export interface VerdictDuLot {
  nom: string;
  part: boolean;
  protegee: boolean;
  raison: string;
}

export interface LotFabrique {
  version: string;
  manifeste: ManifesteDuLot;
  /** `<sortie>/<version>/` : `lot.tar.gz` et `manifeste.json`. */
  dossier: string;
  archive: string;
  verdicts: VerdictDuLot[];
  /** Vrai si cette version existait déjà : rien n'a été refait. */
  dejaFabrique: boolean;
}

export const NOM_DE_L_ARCHIVE_DU_LOT = 'lot.tar.gz';

/**
 * FABRIQUE LE LOT : trie le pool, calcule l'empreinte, et n'écrit que si elle
 * est nouvelle. Les fiches non protégées partent en clair ; chaque fiche
 * protégée part en une tête réduite (nom, une ligne) et un contenu chiffré —
 * aucun de ses fichiers en clair.
 */
export function fabriquerLeLot(entree: {
  pool: string;
  sortie: string;
  cle: Buffer;
  nomsPrives: readonly string[];
  /** Les noms de dossier des fiches d'une bibliothèque protégée. */
  protegees: ReadonlySet<string>;
  /**
   * Un contrôle de plus, appliqué à chaque fichier texte d'une fiche qui part
   * (le filtre des valeurs sensibles de la machine, comme pour le public).
   * Rend la raison d'un refus, ou `null`.
   */
  controleEnPlus?: (chemin: string, contenu: string) => string | null;
  maintenant?: number;
  garder?: number;
}): LotFabrique {
  const verdicts: VerdictDuLot[] = [];
  const retenues: { nom: string; description: string; protegee: boolean; fichiers: FichierDeFiche[] }[] = [];
  const empreinte = crypto.createHash('sha256');
  empreinte.update(`format ${FORMAT_DU_LOT_DE_COMPETENCES}\ncle ${empreinteDeCle(entree.cle)}\n`);

  const noms = fs.existsSync(entree.pool) ? fs.readdirSync(entree.pool).sort() : [];
  for (const nom of noms) {
    if (nom.startsWith('.')) continue;
    const dossier = path.join(entree.pool, nom);
    let etat: fs.Stats;
    try {
      etat = fs.statSync(dossier);
    } catch {
      continue;
    }
    const tete = path.join(dossier, FICHIER_COMPETENCE);
    if (!etat.isDirectory() || !fs.existsSync(tete)) continue;
    const texte = fs.readFileSync(tete, 'utf8');
    const fichiers = fichiersDeLaFiche(dossier);
    const { annexes, tropLourd } = textesAControler(fichiers);
    let verdict = tropLourd
      ? { part: false, protegee: entree.protegees.has(nom), raison: `${tropLourd} : texte trop lourd pour être contrôlé` }
      : jugerCompetencePourClients({ nom, texte, annexes }, entree.nomsPrives, { protegee: entree.protegees.has(nom) });
    if (verdict.part && entree.controleEnPlus) {
      for (const [chemin, contenu] of [[FICHIER_COMPETENCE, texteAPublier(texte)], ...Object.entries(annexes)]) {
        const refus = entree.controleEnPlus(`${nom}/${chemin}`, contenu);
        if (refus) {
          verdict = { part: false, protegee: verdict.protegee, raison: `filtre de contenu — ${chemin} : ${refus}` };
          break;
        }
      }
    }
    verdicts.push({ nom, ...verdict });
    if (!verdict.part) continue;
    const champs = champsDeLaFiche(texte);
    const description = descriptionDUneLigne(champs.description || 'compétence sans description');
    retenues.push({ nom, description, protegee: verdict.protegee, fichiers });
    empreinte.update(`fiche ${nom} ${verdict.protegee ? 'protegee' : 'claire'}\n`);
    for (const f of fichiers) {
      empreinte.update(`${f.relatif} ${f.mode} ${crypto.createHash('sha256').update(fs.readFileSync(f.plein)).digest('hex')}\n`);
    }
  }

  const version = empreinte.digest('hex').slice(0, 32);
  const manifeste: ManifesteDuLot = {
    format: FORMAT_DU_LOT_DE_COMPETENCES,
    version,
    fabriqueLe: entree.maintenant ?? Date.now(),
    fiches: retenues.map((r) => ({ nom: r.nom, description: r.description, protegee: r.protegee })),
  };
  const dossierFinal = path.join(entree.sortie, version);
  const archive = path.join(dossierFinal, NOM_DE_L_ARCHIVE_DU_LOT);
  if (fs.existsSync(archive) && fs.existsSync(path.join(dossierFinal, FICHIER_MANIFESTE_DU_LOT))) {
    const deja = manifesteDepuisTexte(fs.readFileSync(path.join(dossierFinal, FICHIER_MANIFESTE_DU_LOT), 'utf8'));
    return { version, manifeste: deja ?? manifeste, dossier: dossierFinal, archive, verdicts, dejaFabrique: true };
  }

  fs.mkdirSync(entree.sortie, { recursive: true, mode: 0o700 });
  const chantier = fs.mkdtempSync(path.join(entree.sortie, `.${version}-`));
  try {
    const arbre = path.join(chantier, 'arbre');
    fs.mkdirSync(arbre, { mode: 0o755 });
    for (const r of retenues) {
      const cible = path.join(arbre, r.nom);
      fs.mkdirSync(cible, { recursive: true });
      if (r.protegee) {
        fs.writeFileSync(path.join(cible, FICHIER_COMPETENCE), teteDeFicheProtegee(r.nom, r.description));
        fs.writeFileSync(path.join(cible, FICHIER_CONTENU_CHIFFRE), chiffrerLaFiche(r.nom, r.fichiers, entree.cle));
        continue;
      }
      for (const f of r.fichiers) {
        const vers = path.join(cible, f.relatif);
        fs.mkdirSync(path.dirname(vers), { recursive: true });
        fs.copyFileSync(f.plein, vers);
        fs.chmodSync(vers, f.mode & 0o755);
      }
    }
    const texteDuManifeste = `${JSON.stringify(manifeste, null, 2)}\n`;
    fs.writeFileSync(path.join(arbre, FICHIER_MANIFESTE_DU_LOT), texteDuManifeste);
    fs.writeFileSync(path.join(chantier, FICHIER_MANIFESTE_DU_LOT), texteDuManifeste);
    execFileSync('tar', ['-czf', path.join(chantier, NOM_DE_L_ARCHIVE_DU_LOT), '--owner=0', '--group=0', '-C', arbre, '.'], {
      stdio: 'ignore',
    });
    fs.rmSync(arbre, { recursive: true, force: true });
    fs.rmSync(dossierFinal, { recursive: true, force: true });
    fs.renameSync(chantier, dossierFinal);
  } catch (err) {
    fs.rmSync(chantier, { recursive: true, force: true });
    throw err;
  }
  rangerLesAnciensLots(entree.sortie, entree.garder ?? 2);
  return { version, manifeste, dossier: dossierFinal, archive, verdicts, dejaFabrique: false };
}

/** Ne garde que les N lots les plus récents (et aucun chantier abandonné). */
function rangerLesAnciensLots(sortie: string, garder: number): void {
  const lots = fs
    .readdirSync(sortie, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ nom: e.name, date: fs.statSync(path.join(sortie, e.name)).mtimeMs }))
    .sort((a, b) => b.date - a.date);
  let gardes = 0;
  for (const lot of lots) {
    const chantierAbandonne = lot.nom.startsWith('.') && Date.now() - lot.date > 6 * 3600 * 1000;
    if (lot.nom.startsWith('.') && !chantierAbandonne) continue;
    if (!chantierAbandonne && gardes < garder) {
      gardes++;
      continue;
    }
    fs.rmSync(path.join(sortie, lot.nom), { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Côté serveur loué : le lot FOURNI                                   */
/* ------------------------------------------------------------------ */

/**
 * LA CLÉ NE RESTE PAS DANS L'ENVIRONNEMENT. Tout ce que le démon lance (moteurs,
 * terminal, scripts) hérite de `process.env` : la clé en est donc RETIRÉE au
 * démarrage et gardée ici seulement. Repli : `/etc/beluga.env`, où l'agent
 * d'hôte la pose (un lot reçu après le démarrage du démon s'ouvre sans
 * redémarrage).
 */
let cleRetenue: string | undefined;

export function retenirLaCleDesCompetences(env: NodeJS.ProcessEnv = process.env): void {
  const valeur = env[VARIABLE_CLE_COMPETENCES];
  if (valeur) cleRetenue = valeur;
  delete env[VARIABLE_CLE_COMPETENCES];
}

function cleDesCompetencesFournies(): Buffer | null {
  const directe = cleDepuisTexte(cleRetenue);
  if (directe) return directe;
  const fichier = process.env.BELUGA_FICHIER_ENV_HOTE || '/etc/beluga.env';
  try {
    for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
      const m = new RegExp(`^\\s*(?:export\\s+)?${VARIABLE_CLE_COMPETENCES}\\s*=\\s*["']?([a-fA-F0-9]{64})["']?\\s*$`).exec(ligne);
      if (m) return cleDepuisTexte(m[1]);
    }
  } catch {
    /* pas de fichier d'hôte : pas de clé */
  }
  return null;
}

/** Le dossier du lot fourni, à côté du pool (`data/competences-fournies`). */
export function dossierDesCompetencesFournies(dossierDuPool: string): string {
  return process.env.BELUGA_COMPETENCES_FOURNIES || path.join(path.dirname(dossierDuPool), DOSSIER_COMPETENCES_FOURNIES);
}

const manifestesLus = new Map<string, { date: number; taille: number; manifeste: ManifesteDuLot | null }>();

/** Le manifeste du lot fourni, relu seulement quand il change (taille, date) — un lot neuf se voit sans redémarrage. */
export function manifesteFourni(dossier: string): ManifesteDuLot | null {
  const fichier = path.join(dossier, FICHIER_MANIFESTE_DU_LOT);
  let etat: fs.Stats;
  try {
    etat = fs.statSync(fichier);
  } catch {
    manifestesLus.delete(fichier);
    return null;
  }
  const connu = manifestesLus.get(fichier);
  if (connu && connu.date === etat.mtimeMs && connu.taille === etat.size) return connu.manifeste;
  const manifeste = manifesteDepuisTexte(fs.readFileSync(fichier, 'utf8'));
  manifestesLus.set(fichier, { date: etat.mtimeMs, taille: etat.size, manifeste });
  return manifeste;
}

/* ------------------------------------------------------------------ */
/* Le contenu ouvert le temps d'un tour                                */
/* ------------------------------------------------------------------ */

/** La racine des contenus déchiffrés : hors de toute copie de travail et des pièces jointes. */
export function racineDesDechiffrements(): string {
  return process.env.BELUGA_DECHIFFREMENTS || path.join(os.tmpdir(), `beluga-competences-ouvertes-${process.getuid?.() ?? 'x'}`);
}

/** Ce chemin est-il dans un contenu déchiffré ? (aucune pièce jointe, aucune archive n'en sort) */
export function cheminDansUnDechiffrement(chemin: string): boolean {
  const racine = path.resolve(racineDesDechiffrements());
  let reel = path.resolve(chemin);
  try {
    reel = fs.realpathSync(reel);
  } catch {
    /* fichier absent : on juge le chemin donné */
  }
  return reel === racine || reel.startsWith(`${racine}${path.sep}`);
}

const nomDeDossierSur = (texte: string) => texte.replace(/[^\w-]/g, '_').slice(0, 80) || 'agent';

/**
 * OUVRE UNE FICHE PROTÉGÉE POUR UN TOUR : la déchiffre dans un dossier propre à
 * l'agent (0700), et rend le chemin de son mode d'emploi. `null` si la fiche
 * n'est pas protégée dans le lot fourni, ou si la clé manque.
 */
export function ouvrirLaFicheProtegee(dossierFourni: string, nom: string, agentId: string): { fichier: string; dossier: string } | null {
  const manifeste = manifesteFourni(dossierFourni);
  if (!manifeste?.fiches.some((f) => f.nom === nom && f.protegee)) return null;
  const cle = cleDesCompetencesFournies();
  if (!cle) throw new Error('clé des compétences protégées absente sur ce serveur');
  const blob = fs.readFileSync(path.join(dossierFourni, nom, FICHIER_CONTENU_CHIFFRE));
  const fichiers = dechiffrerLaFiche(nom, blob, cle);
  const racine = racineDesDechiffrements();
  fs.mkdirSync(racine, { recursive: true, mode: 0o700 });
  fs.chmodSync(racine, 0o700);
  balayerLesDechiffrementsOublies(racine);
  const dossierAgent = path.join(racine, nomDeDossierSur(agentId));
  fs.mkdirSync(dossierAgent, { recursive: true, mode: 0o700 });
  const cible = path.join(dossierAgent, nom);
  fs.rmSync(cible, { recursive: true, force: true });
  for (const f of fichiers) {
    const vers = path.join(cible, f.relatif);
    if (!vers.startsWith(`${cible}${path.sep}`)) continue;
    fs.mkdirSync(path.dirname(vers), { recursive: true, mode: 0o700 });
    fs.writeFileSync(vers, f.contenu, { mode: f.mode & 0o700 || 0o600 });
  }
  return { fichier: path.join(cible, FICHIER_COMPETENCE), dossier: cible };
}

/** Un filet de plus : un dossier d'agent vieux de plus de 12 h n'a plus de tour vivant. */
function balayerLesDechiffrementsOublies(racine: string, maintenant = Date.now()): void {
  try {
    for (const nom of fs.readdirSync(racine)) {
      const plein = path.join(racine, nom);
      if (maintenant - fs.statSync(plein).mtimeMs > 12 * 3600 * 1000) fs.rmSync(plein, { recursive: true, force: true });
    }
  } catch {
    /* rien à balayer */
  }
}

/** Le tour est refermé : ce qui a été déchiffré pour cet agent disparaît. */
export function effacerLesDechiffrementsDeLAgent(agentId: string): void {
  try {
    fs.rmSync(path.join(racineDesDechiffrements(), nomDeDossierSur(agentId)), { recursive: true, force: true });
  } catch {
    /* rien à effacer */
  }
}

/** Au démarrage du démon : aucun contenu d'un tour passé ne survit à une panne. */
export function effacerTousLesDechiffrements(): void {
  try {
    fs.rmSync(racineDesDechiffrements(), { recursive: true, force: true });
  } catch {
    /* rien à effacer */
  }
}
