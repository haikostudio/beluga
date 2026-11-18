/**
 * LES FICHIERS RANGÉS PAR PROJET, PUIS PAR SERVICE (carte « Fichiers rangés et captures pleine page », 05/11/2026).
 *
 * TROIS PIÈCES :
 *  1. LE REGISTRE (table `fichiers`) : une ligne par fichier créé par un projet ou un service — pièces jointes (et
 *     donc médias du Studio et de Communication), documents de cartes, journaux d'agents, mémoire rendue, stratégie,
 *     sauvegardes, fichiers déposés — avec sa place rangée `<Projet>/<Service>/…` (`chemin`) et l'endroit où il vit
 *     vraiment (`chemin_reel`). C'est lui que lisent la fenêtre « Fichiers », l'explorateur d'un projet et la recherche.
 *  2. LE MIROIR SUR DISQUE (`PATHS.fichiers`) : la même arborescence, en vrais dossiers. Chaque fichier y est un LIEN
 *     vers l'endroit où son service l'a écrit ; les fichiers DÉPOSÉS depuis la fenêtre y vivent pour de vrai.
 *  3. LE RANGEMENT (`rangerLesFichiers`) : relit chaque service et met registre et miroir d'accord. `essai: true`
 *     (l'essai à blanc) ne touche à rien et rend le rapport de ce qui bougerait.
 *
 * POURQUOI DES LIENS ET PAS UN DÉPLACEMENT (décision de la carte) : 17 500 pièces jointes (≈ 9 Go) vivent sur le disque
 * de stockage et sont lues par leur identifiant partout — conversations, Studio, Médiathèque, `piece:` dans les
 * textes, `/api/fichier-cite`, `--add-dir` des moteurs. Les déplacer obligeait à réécrire chacun de ces chemins ; un
 * lien range le fichier sans qu'aucun ancien chemin ne casse, et sans copier un octet. Les sauvegardes restent sur le
 * disque de stockage (règle de l'utilisateur) : l'arbre ne fait que les montrer.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DOSSIER_COMMUN,
  DOSSIER_CORBEILLE,
  DIMENSIONS_VECTEURS,
  FICHES_DES_SERVICES,
  MODELE_VECTEURS,
  PROJET_DU_COFFRE,
  SERVICES_DE_FICHIERS,
  aPurger,
  aliasDe,
  cheminRange,
  cosinus,
  demandeAVectoriser,
  disqueQuiPorte,
  dossierDuProjet as dossierDeMemoireDuProjet,
  dossiersDesProjets,
  estUnServiceDeFichiers,
  extraitAutour,
  fusionnerLesClassements,
  genreDeFichier,
  genreLisible,
  joursRestantsEnCorbeille,
  lireLesMontages,
  mimeDuFichier,
  morceauxDuDossier,
  nomLibreDansLeDossier,
  nomSur,
  passageDUnFichier,
  projetDuDossierDeMedias,
  peutFaireLeGeste,
  peutVoirLEntree,
  requeteDeFichiers,
  type CompteDeFichiers,
  type DisqueDUnFichier,
  type GenreDeFichier,
  type GesteSurUnFichier,
  type ServiceDeFichiers,
} from '@beluga/shared';
import { CONFIG, PATHS } from './config.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import { dossiersDeLecture } from './pieces-jointes.js';
import { listDir, safeJoin } from './files.js';
import { vectoriser, vectoriseurDisponible } from './vectoriseur.js';
import { apresUnePieceEnregistree } from './store.js';

/* ------------------------------------------------------------------ */
/* Les formes                                                           */
/* ------------------------------------------------------------------ */

/** Ce qu'un service déclare : une entrée voulue dans l'arbre. */
export interface EntreeVoulue {
  origine: string;
  projetId: string | null;
  service: ServiceDeFichiers;
  dossier: string;
  nom: string;
  cheminReel: string;
  mime: string | null;
  taille: number;
  creeLe: number;
  modifieLe: number;
  utilisePar: string[];
  /** Le texte cherché, déjà connu (légende, titre) ; le contenu d'un texte lisible s'y ajoute au rangement. */
  texte: string;
}

interface LigneDeFichier {
  rowid: number;
  id: string;
  origine: string;
  projet_id: string | null;
  service: string;
  dossier: string;
  nom: string;
  chemin: string;
  chemin_reel: string;
  genre: string;
  mime: string | null;
  taille: number;
  cree_le: number;
  modifie_le: number;
  utilise_par: string;
  renomme: number;
  supprime_le: number | null;
  purge_le: number | null;
  texte: string;
}

/** Une entrée telle que l'écran la reçoit. */
export interface FichierRange {
  id: string;
  origine: string;
  projetId: string | null;
  service: ServiceDeFichiers;
  nom: string;
  chemin: string;
  genre: GenreDeFichier;
  mime: string | null;
  taille: number;
  creeLe: number;
  modifieLe: number;
  utilisePar: string[];
  /** La pièce jointe que l'entrée désigne, pour la visionneuse et la vignette réduite. */
  pieceId: string | null;
  supprimeLe: number | null;
  joursRestants?: number;
  renommable: boolean;
  supprimable: boolean;
  /** Le disque qui garde VRAIMENT le fichier (son chemin réel), badgé à l'écran. */
  disque: DisqueDUnFichier;
}

export interface DossierRange {
  nom: string;
  chemin: string;
  nombre: number;
  taille: number;
  service?: ServiceDeFichiers;
  projetId?: string | null;
  /** Un dossier lu à la demande sur le disque (le code d'un projet). */
  paresseux?: boolean;
  /**
   * LE FICHIER LE PLUS RÉCENT DU DOSSIER (carte « Aperçu, chat, Agentik et vraie charte ») : l'écran montre son
   * aperçu réduit et un badge de type à la place de l'icône de dossier. Jamais l'original : la vignette passe par
   * la miniature du serveur.
   */
  apercu?: { id: string; pieceId: string | null; genre: GenreDeFichier; nom: string; mime: string | null };
  /** Le disque de tout ce qu'il contient ; absent quand le contenu est réparti sur les deux. */
  disque?: DisqueDUnFichier;
}

export interface RapportDeRangement {
  essai: boolean;
  total: number;
  nouveaux: number;
  misAJour: number;
  retires: number;
  nonClasses: number;
  parService: Record<string, number>;
  parProjet: { nom: string; nombre: number }[];
  exemples: { chemin: string; vers: string }[];
  liensCrees: number;
  liensRetires: number;
  dureeMs: number;
  at: number;
}

/* ------------------------------------------------------------------ */
/* Les petits outils                                                    */
/* ------------------------------------------------------------------ */

const TEXTE_MAX = 4000;
const LECTURE_MAX_OCTETS = 300 * 1024;

function idDeLOrigine(origine: string): string {
  return crypto.createHash('sha1').update(origine).digest('hex').slice(0, 24);
}

function json<T>(texte: string | null | undefined, secours: T): T {
  try {
    return texte ? (JSON.parse(texte) as T) : secours;
  } catch {
    return secours;
  }
}

function statOuNull(chemin: string): fs.Stats | null {
  try {
    return fs.statSync(chemin);
  } catch {
    return null;
  }
}

/** Le début d'un fichier texte, pour la recherche. Jamais plus de 300 Ko lus. */
function debutDuTexte(chemin: string): string {
  try {
    const fd = fs.openSync(chemin, 'r');
    try {
      const tampon = Buffer.alloc(LECTURE_MAX_OCTETS);
      const lus = fs.readSync(fd, tampon, 0, LECTURE_MAX_OCTETS, 0);
      return tampon.subarray(0, lus).toString('utf8').replace(/\s+/g, ' ').slice(0, TEXTE_MAX);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function tableExiste(nom: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(nom);
}

/** Tous les fichiers d'un dossier, chemins relatifs, sans suivre les liens. */
function fichiersDuDossier(racine: string, max = 20_000): string[] {
  const sortie: string[] = [];
  const pile = [''];
  while (pile.length && sortie.length < max) {
    const rel = pile.pop()!;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(path.join(racine, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      if (e.name.startsWith('.')) continue;
      const enfant = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) pile.push(enfant);
      else if (e.isFile()) sortie.push(enfant);
    }
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* Les projets                                                          */
/* ------------------------------------------------------------------ */

interface ProjetLu {
  id: string;
  nom: string;
  chemin: string;
  dossier: string;
}

let cacheDesProjets: { a: number; liste: ProjetLu[] } | null = null;

/** Les projets et le nom de leur dossier rangé (le coffre-fort n'a jamais de dossier). */
export function projetsRanges(): ProjetLu[] {
  if (cacheDesProjets && Date.now() - cacheDesProjets.a < 30_000) return cacheDesProjets.liste;
  const lignes = getDb().prepare('SELECT id, name, path, created_at FROM projects WHERE id != ?').all(PROJET_DU_COFFRE) as { id: string; name: string; path: string; created_at: number }[];
  const noms = dossiersDesProjets(lignes.map((l) => ({ id: l.id, nom: l.name, creeLe: l.created_at })));
  const liste = lignes.map((l) => ({ id: l.id, nom: l.name, chemin: l.path, dossier: noms.get(l.id)! }));
  cacheDesProjets = { a: Date.now(), liste };
  return liste;
}

function dossierDuProjetRange(projetId: string | null): string | null {
  if (!projetId) return null;
  return projetsRanges().find((p) => p.id === projetId)?.dossier ?? null;
}

/* ------------------------------------------------------------------ */
/* Ce que chaque service déclare                                        */
/* ------------------------------------------------------------------ */

const LIBELLES_DES_ROLES: Record<string, string> = {
  task: 'Tâches',
  cadrage: 'Cadrage',
  deploy: 'Publication',
  analysis: 'Analyse',
  chef: 'Assistant',
  assistant: 'Assistant',
};

function titresDesCartes(): Map<string, { titre: string; projetId: string }> {
  const lignes = getDb().prepare('SELECT id, project_id, title FROM cards').all() as { id: string; project_id: string; title: string }[];
  return new Map(lignes.map((l) => [l.id, { titre: l.title, projetId: l.project_id }]));
}

/**
 * LES PIÈCES JOINTES, et à travers elles les médias du Studio, de la Médiathèque et du mode Réalisation. Le service
 * se lit à ce qui s'en SERT : un export ou un média du Studio → Studio, un média livré → Communication, le reste →
 * Conversations, rangé sous le titre de sa carte. Le disque n'est lu qu'UNE fois par dossier (un `readdir`, pas
 * 17 000 `stat` sur un montage réseau).
 */
export function piecesVoulues(cartes = titresDesCartes(), seulement?: readonly string[]): EntreeVoulue[] {
  const db = getDb();
  const noms = new Map<string, string>();
  for (const dossier of dossiersDeLecture()) {
    try {
      for (const nom of fs.readdirSync(dossier)) if (!noms.has(nom)) noms.set(nom, path.join(dossier, nom));
    } catch {
      /* dossier absent */
    }
  }
  const creations = tableExiste('studio_creations')
    ? new Map((db.prepare('SELECT id, titre FROM studio_creations').all() as { id: string; titre: string }[]).map((c) => [c.id, c.titre]))
    : new Map<string, string>();
  const studio = new Map<string, { dossier: string; usage: string }>();
  if (tableExiste('studio_exports')) {
    for (const e of db.prepare('SELECT attachment_id, creation_id FROM studio_exports WHERE attachment_id IS NOT NULL').all() as { attachment_id: string; creation_id: string }[]) {
      const titre = nomSur(creations.get(e.creation_id), 'Création');
      studio.set(e.attachment_id, { dossier: `${titre}/Exports`, usage: `Studio · ${titre}` });
    }
  }
  if (tableExiste('studio_medias')) {
    for (const m of db.prepare('SELECT attachment_id, creation_id FROM studio_medias WHERE attachment_id IS NOT NULL').all() as { attachment_id: string; creation_id: string | null }[]) {
      if (studio.has(m.attachment_id)) continue;
      const titre = m.creation_id ? nomSur(creations.get(m.creation_id), 'Création') : 'Bibliothèque';
      studio.set(m.attachment_id, { dossier: titre, usage: `Studio · ${titre}` });
    }
  }
  if (tableExiste('medias_realisation')) {
    for (const m of db.prepare('SELECT attachment_id, card_id FROM medias_realisation WHERE attachment_id IS NOT NULL').all() as { attachment_id: string; card_id: string }[]) {
      if (studio.has(m.attachment_id)) continue;
      const titre = nomSur(cartes.get(m.card_id)?.titre, 'Carte');
      studio.set(m.attachment_id, { dossier: `Réalisations/${titre}`, usage: `Réalisation · ${titre}` });
    }
  }
  const livres = new Map<string, { sujet: string; legende: string }>();
  if (tableExiste('medias_livres')) {
    for (const m of db.prepare('SELECT attachment_id, sujet, groupe, legende FROM medias_livres').all() as { attachment_id: string; sujet: string; groupe: string; legende: string }[]) {
      livres.set(m.attachment_id, { sujet: m.sujet || m.groupe || '', legende: m.legende || '' });
    }
  }
  /* Les pièces de l'outil de captures (`server/src/plaquettes.ts`) : rangées sous « Captures/<genre> ». */
  const captures = tableExiste('captures')
    ? new Map((db.prepare('SELECT attachment_id, genre FROM captures').all() as { attachment_id: string; genre: string }[]).map((c) => [c.attachment_id, c.genre]))
    : new Map<string, string>();
  const DOSSIERS_DE_CAPTURES: Record<string, string> = { capture: 'Images', video: 'Vidéos', maquette: 'Maquettes', plaquette: 'Plaquettes' };
  const agents = new Map((db.prepare('SELECT id, role, card_id FROM agents').all() as { id: string; role: string; card_id: string | null }[]).map((a) => [a.id, a]));
  const requete = seulement?.length
    ? db.prepare(`SELECT id, project_id, data, created_at FROM attachments WHERE id IN (${seulement.map(() => '?').join(',')})`).all(...seulement)
    : db.prepare('SELECT id, project_id, data, created_at FROM attachments WHERE project_id != ?').all(PROJET_DU_COFFRE);
  const voulues: EntreeVoulue[] = [];
  for (const l of requete as { id: string; project_id: string; data: string; created_at: number }[]) {
    if (l.project_id === PROJET_DU_COFFRE) continue;
    const d = json<{ id: string; name?: string; alias?: string; mime?: string; size?: number; cardId?: string; agentId?: string }>(l.data, { id: l.id });
    const nom = d.name || 'fichier';
    const piece = { id: l.id, name: nom, ...(d.alias ? { alias: d.alias } : {}) };
    const reel = noms.get(`${aliasDe(piece)}-${nom}`) ?? noms.get(`${l.id}-${nom}`);
    if (!reel) continue;
    const s = studio.get(l.id);
    const livre = livres.get(l.id);
    let service: ServiceDeFichiers;
    let dossier: string;
    const utilisePar: string[] = [];
    const genreDeCapture = captures.get(l.id);
    if (genreDeCapture) {
      service = 'captures';
      dossier = DOSSIERS_DE_CAPTURES[genreDeCapture] ?? 'Images';
      utilisePar.push('Captures');
    } else if (s) {
      service = 'studio';
      dossier = s.dossier;
      utilisePar.push(s.usage);
    } else if (livre) {
      service = 'communication';
      dossier = `Médiathèque${livre.sujet ? `/${nomSur(livre.sujet)}` : ''}`;
      utilisePar.push('Médiathèque');
    } else {
      service = 'conversations';
      /* La carte de la pièce, sinon celle de l'agent qui l'a reçue (un cadrage porte sa carte), sinon le rôle de l'agent. */
      const agent = d.agentId ? agents.get(d.agentId) : undefined;
      const carte = (d.cardId ? cartes.get(d.cardId) : undefined) ?? (agent?.card_id ? cartes.get(agent.card_id) : undefined);
      dossier = carte ? nomSur(carte.titre, 'Carte') : agent ? (LIBELLES_DES_ROLES[agent.role] ?? 'Discussions') : 'Divers';
    }
    if (livre && s) utilisePar.push('Médiathèque');
    voulues.push({
      origine: `piece:${l.id}`,
      projetId: l.project_id,
      service,
      dossier,
      nom,
      cheminReel: reel,
      mime: d.mime ?? null,
      taille: d.size ?? 0,
      creeLe: l.created_at,
      modifieLe: l.created_at,
      utilisePar,
      texte: [livre?.legende, livre?.sujet, `#${aliasDe(piece)}`].filter(Boolean).join(' '),
    });
  }
  return voulues;
}

/** LES DOCUMENTS DE CARTES (`data/documents/<slug>-<8 premiers signes de la carte>.md`), retrouvés par leur carte. */
export function documentsVoulus(cartes = titresDesCartes()): EntreeVoulue[] {
  const parDebut = new Map<string, { id: string; titre: string; projetId: string }>();
  for (const [id, c] of cartes) parDebut.set(id.slice(0, 8), { id, ...c });
  const voulues: EntreeVoulue[] = [];
  let noms: string[] = [];
  try {
    noms = fs.readdirSync(PATHS.docs).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  for (const nom of noms) {
    const reel = path.join(PATHS.docs, nom);
    const s = statOuNull(reel);
    if (!s?.isFile()) continue;
    const debut = /-([0-9a-f]{8})\.md$/.exec(nom)?.[1];
    const carte = debut ? parDebut.get(debut) : undefined;
    voulues.push({
      origine: `document:${nom}`,
      projetId: carte?.projetId ?? null,
      service: 'cartes',
      dossier: carte ? '' : 'Non classés',
      nom: carte ? `${nomSur(carte.titre, 'Carte')}.md` : nom,
      cheminReel: reel,
      mime: 'text/markdown',
      taille: s.size,
      creeLe: Math.round(s.birthtimeMs || s.mtimeMs),
      modifieLe: Math.round(s.mtimeMs),
      utilisePar: carte ? [`Carte · ${carte.titre}`] : [],
      texte: '',
    });
  }
  return voulues;
}

/** LES JOURNAUX DES AGENTS (`data/logs/<agent>.log`), rangés sous la carte de l'agent, sinon sous son rôle. */
export function journauxVoulus(cartes = titresDesCartes()): EntreeVoulue[] {
  const agents = new Map(
    (getDb().prepare('SELECT id, project_id, card_id, role, created_at FROM agents').all() as { id: string; project_id: string; card_id: string | null; role: string; created_at: number }[]).map((a) => [a.id, a]),
  );
  let noms: string[] = [];
  try {
    noms = fs.readdirSync(PATHS.logs).filter((n) => n.endsWith('.log'));
  } catch {
    return [];
  }
  const voulues: EntreeVoulue[] = [];
  for (const nom of noms) {
    const agent = agents.get(nom.slice(0, -4));
    const reel = path.join(PATHS.logs, nom);
    const s = statOuNull(reel);
    if (!s?.isFile()) continue;
    const carte = agent?.card_id ? cartes.get(agent.card_id) : undefined;
    const role = LIBELLES_DES_ROLES[agent?.role ?? ''] ?? 'Agents';
    voulues.push({
      origine: `journal:${nom}`,
      projetId: agent?.project_id ?? null,
      service: 'journaux',
      dossier: carte ? nomSur(carte.titre, 'Carte') : agent ? role : 'Démon',
      nom: agent ? `${role} · ${new Date(agent.created_at).toISOString().slice(0, 10)}.log` : nom,
      cheminReel: reel,
      mime: 'text/plain',
      taille: s.size,
      creeLe: Math.round(s.birthtimeMs || s.mtimeMs),
      modifieLe: Math.round(s.mtimeMs),
      utilisePar: [],
      texte: carte?.titre ?? '',
    });
  }
  return voulues;
}

/** LA MÉMOIRE RENDUE EN FICHIERS (`data/MEMORY`) : la base reste la source, ces fichiers en sont la copie lisible. */
export function memoireVoulue(): EntreeVoulue[] {
  const racine = path.join(CONFIG.dataDir, 'MEMORY');
  const parDossier = new Map(projetsRanges().map((p) => [dossierDeMemoireDuProjet(p.nom, p.id), p.id]));
  const parSuffixe = new Map(projetsRanges().map((p) => [p.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6), p.id]));
  const voulues: EntreeVoulue[] = [];
  for (const rel of fichiersDuDossier(racine, 5000)) {
    const morceaux = rel.split('/');
    let projetId: string | null = null;
    let dossier = morceaux.slice(0, -1).join('/');
    if (morceaux[0] === 'PROJECTS' && morceaux.length > 2) {
      projetId = parDossier.get(morceaux[1]!) ?? parSuffixe.get(morceaux[1]!.split('-').pop() ?? '') ?? null;
      dossier = projetId ? morceaux.slice(2, -1).join('/') : `Projets/${morceaux.slice(1, -1).join('/')}`;
    } else if (morceaux[0] === 'GLOBAL') dossier = `Global${morceaux.length > 2 ? `/${morceaux.slice(1, -1).join('/')}` : ''}`;
    const reel = path.join(racine, rel);
    const s = statOuNull(reel);
    if (!s) continue;
    voulues.push({
      origine: `memoire:${rel}`,
      projetId,
      service: 'memoire',
      dossier,
      nom: morceaux[morceaux.length - 1]!,
      cheminReel: reel,
      mime: mimeDuFichier(rel),
      taille: s.size,
      creeLe: Math.round(s.birthtimeMs || s.mtimeMs),
      modifieLe: Math.round(s.mtimeMs),
      utilisePar: ['Mémoire du projet'],
      texte: '',
    });
  }
  return voulues;
}

/** LA STRATÉGIE (`data/strategie/<dossier>/…`), rangée sous le projet que le dossier étudie. */
export function strategieVoulue(): EntreeVoulue[] {
  const racine = path.join(CONFIG.dataDir, 'strategie');
  const dossiers = tableExiste('strategie_dossiers')
    ? new Map((getDb().prepare('SELECT id, data FROM strategie_dossiers').all() as { id: string; data: string }[]).map((d) => [d.id, json<{ sujet?: { projectId?: string; nom?: string } }>(d.data, {}).sujet ?? {}]))
    : new Map<string, { projectId?: string; nom?: string }>();
  const voulues: EntreeVoulue[] = [];
  for (const rel of fichiersDuDossier(racine, 5000)) {
    const [dossierId, ...reste] = rel.split('/');
    const sujet = dossiers.get(dossierId!) ?? {};
    const reel = path.join(racine, rel);
    const s = statOuNull(reel);
    if (!s) continue;
    voulues.push({
      origine: `strategie:${rel}`,
      projetId: sujet.projectId ?? null,
      service: 'strategie',
      dossier: [nomSur(sujet.nom, 'Étude'), ...reste.slice(0, -1)].join('/'),
      nom: reste[reste.length - 1] ?? dossierId!,
      cheminReel: reel,
      mime: mimeDuFichier(rel),
      taille: s.size,
      creeLe: Math.round(s.birthtimeMs || s.mtimeMs),
      modifieLe: Math.round(s.mtimeMs),
      utilisePar: ['Stratégie marketing'],
      texte: sujet.nom ?? '',
    });
  }
  const illustrations = path.join(CONFIG.dataDir, 'strategie-illustrations-sources');
  for (const rel of fichiersDuDossier(illustrations, 500)) {
    const reel = path.join(illustrations, rel);
    const s = statOuNull(reel);
    if (!s) continue;
    voulues.push({
      origine: `strategie-illustration:${rel}`,
      projetId: null,
      service: 'strategie',
      dossier: 'Illustrations',
      nom: path.basename(rel),
      cheminReel: reel,
      mime: mimeDuFichier(rel),
      taille: s.size,
      creeLe: Math.round(s.birthtimeMs || s.mtimeMs),
      modifieLe: Math.round(s.mtimeMs),
      utilisePar: [],
      texte: '',
    });
  }
  return voulues;
}

/** LES SAUVEGARDES : chaque archive réussie, MONTRÉE où elle est (disque de stockage), jamais copiée. */
export function sauvegardesVoulues(): EntreeVoulue[] {
  if (!tableExiste('backup_points') || !tableExiste('backup_sites')) return [];
  const lignes = getDb()
    .prepare(
      `SELECT p.id, p.chemin_archive, p.taille, p.debut, s.project_id, s.nom FROM backup_points p JOIN backup_sites s ON s.id = p.site_id
        WHERE p.chemin_archive IS NOT NULL AND p.chemin_archive != ''`,
    )
    .all() as { id: string; chemin_archive: string; taille: number; debut: number; project_id: string | null; nom: string }[];
  return lignes.map((l) => ({
    origine: `sauvegarde:${l.id}`,
    projetId: l.project_id,
    service: 'sauvegardes' as const,
    dossier: nomSur(l.nom, 'Site'),
    nom: path.basename(l.chemin_archive),
    cheminReel: l.chemin_archive,
    mime: mimeDuFichier(l.chemin_archive),
    taille: l.taille,
    creeLe: l.debut,
    modifieLe: l.debut,
    utilisePar: ['Backup'],
    texte: l.nom,
  }));
}

/* ------------------------------------------------------------------ */
/* Les médias fabriqués (disque de stockage)                            */
/* ------------------------------------------------------------------ */

/*
 * LES MÉDIAS FABRIQUÉS PAR LES AGENTS (08/11/2026) — vidéos, images, captures et étapes intermédiaires, écrits sous
 * `PATHS.medias/<projet>/…` sur le disque de stockage (DEC-442) — n'apparaissaient dans l'explorateur d'AUCUN projet :
 * aucun service ne les déclarait. Ils sont désormais MONTRÉS sous `<Projet>/Médias/<sous-dossiers d'origine>/…`,
 * lus là où ils sont, jamais copiés.
 *
 * Le parcours passe par le montage sshfs (≈ 6 600 fichiers, 1 300 dossiers) : il est ASYNCHRONE et INCRÉMENTAL.
 * Un dossier dont la date n'a pas bougé depuis le relevé précédent garde ses fichiers tels quels (même liste, mêmes
 * tailles et dates) : seuls les dossiers où quelque chose est apparu ou a disparu sont relus fichier par fichier.
 */
interface FichierDeMedias {
  relatif: string;
  taille: number;
  modifieLe: number;
}
const relevesDesDossiersDeMedias = new Map<string, { date: number; fichiers: FichierDeMedias[]; sous: string[] }>();
let mediasRelevesLe = 0;
let releveDesMediasEnCours: Promise<void> | null = null;

async function releverUnDossierDeMedias(racine: string, relatif: string, vus: Set<string>): Promise<void> {
  const absolu = relatif ? path.join(racine, relatif) : racine;
  const info = await fs.promises.stat(absolu).catch(() => null);
  if (!info?.isDirectory()) return;
  vus.add(relatif);
  const garde = relevesDesDossiersDeMedias.get(relatif);
  let releve = garde;
  if (!garde || garde.date !== info.mtimeMs) {
    const entrees = await fs.promises.readdir(absolu, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    const fichiers: FichierDeMedias[] = [];
    const sous: string[] = [];
    for (const e of entrees) {
      if (e.name.startsWith('.')) continue;
      const enfant = relatif ? `${relatif}/${e.name}` : e.name;
      if (e.isDirectory()) sous.push(enfant);
      else if (e.isFile()) {
        const ancien = garde?.fichiers.find((f) => f.relatif === enfant);
        const st = await fs.promises.stat(path.join(racine, enfant)).catch(() => null);
        if (st) fichiers.push({ relatif: enfant, taille: st.size, modifieLe: Math.round(st.mtimeMs) });
        else if (ancien) fichiers.push(ancien);
      }
    }
    releve = { date: info.mtimeMs, fichiers, sous };
    relevesDesDossiersDeMedias.set(relatif, releve);
  }
  for (const enfant of releve!.sous) await releverUnDossierDeMedias(racine, enfant, vus);
}

/** Relit le dossier des médias (en douceur, sans bloquer le démon) ; une seule lecture à la fois. */
export function releverLesMedias(racine = PATHS.medias): Promise<void> {
  releveDesMediasEnCours ??= (async () => {
    const vus = new Set<string>();
    await releverUnDossierDeMedias(racine, '', vus);
    // Le disque de stockage ne répond pas : on garde le relevé précédent plutôt que de vider « Médias ».
    if (!vus.size) return;
    for (const cle of [...relevesDesDossiersDeMedias.keys()]) if (!vus.has(cle)) relevesDesDossiersDeMedias.delete(cle);
    mediasRelevesLe = Date.now();
  })().finally(() => {
    releveDesMediasEnCours = null;
  });
  return releveDesMediasEnCours;
}

/** Le projet d'une carte, par le début de son identifiant (« carte-c483e718 »). */
function projetDUneCarteParSonDebut(debut: string): string | null {
  const ligne = getDb().prepare("SELECT project_id FROM cards WHERE id >= ? AND id < ? LIMIT 1").get(debut, `${debut}\uffff`) as { project_id: string } | undefined;
  return ligne?.project_id ?? null;
}

/**
 * LES MÉDIAS, tels que le dernier relevé les a vus : un dossier de premier niveau = un projet
 * (`projetDuDossierDeMedias`), ses sous-dossiers d'origine gardés tels quels sous « Médias ».
 */
export function mediasVoulus(racine = PATHS.medias): EntreeVoulue[] {
  if (!mediasRelevesLe) return [];
  const tete = relevesDesDossiersDeMedias.get('');
  if (!tete) return [];
  const projets = projetsRanges().map((p) => ({ id: p.id, nom: p.nom, chemin: p.chemin, regroupement: p.chemin.includes('/regroupements/') }));
  const voulues: EntreeVoulue[] = [];
  const parcourir = (relatif: string, rendre: (f: FichierDeMedias) => void) => {
    const r = relevesDesDossiersDeMedias.get(relatif);
    if (!r) return;
    for (const f of r.fichiers) rendre(f);
    for (const sous of r.sous) parcourir(sous, rendre);
  };
  for (const dossierDeProjet of tete.sous) {
    const sous = (relevesDesDossiersDeMedias.get(dossierDeProjet)?.sous ?? []).map((s) => s.slice(dossierDeProjet.length + 1));
    const projetId = projetDuDossierDeMedias(dossierDeProjet, projets, sous, projetDUneCarteParSonDebut);
    parcourir(dossierDeProjet, (f) => {
      const dansLeProjet = f.relatif.slice(dossierDeProjet.length + 1);
      const coupe = dansLeProjet.lastIndexOf('/');
      // Sans projet, le nom du dossier d'origine reste en tête : on sait d'où il vient.
      const dossier = projetId ? (coupe > 0 ? dansLeProjet.slice(0, coupe) : '') : coupe > 0 ? `${dossierDeProjet}/${dansLeProjet.slice(0, coupe)}` : dossierDeProjet;
      const cheminReel = path.join(racine, f.relatif);
      voulues.push({
        origine: `media:${f.relatif}`,
        projetId,
        service: 'medias',
        dossier,
        nom: dansLeProjet.slice(coupe + 1),
        cheminReel,
        mime: mimeDuFichier(cheminReel),
        taille: f.taille,
        creeLe: f.modifieLe,
        modifieLe: f.modifieLe,
        utilisePar: ['Médias'],
        texte: f.relatif.replace(/[/_-]+/g, ' '),
      });
    });
  }
  // Un fichier posé à la racine des médias (sans dossier de projet) : non classé.
  for (const f of tete.fichiers) {
    const cheminReel = path.join(racine, f.relatif);
    voulues.push({ origine: `media:${f.relatif}`, projetId: null, service: 'medias', dossier: '', nom: f.relatif, cheminReel, mime: mimeDuFichier(cheminReel), taille: f.taille, creeLe: f.modifieLe, modifieLe: f.modifieLe, utilisePar: ['Médias'], texte: f.relatif });
  }
  return voulues;
}

/** Tout ce que les services déclarent, sauf les dépôts (qui ne vivent que dans le registre). */
export function toutCeQuiEstVoulu(): EntreeVoulue[] {
  const cartes = titresDesCartes();
  return [...piecesVoulues(cartes), ...documentsVoulus(cartes), ...journauxVoulus(cartes), ...memoireVoulue(), ...strategieVoulue(), ...sauvegardesVoulues(), ...mediasVoulus()];
}

/* ------------------------------------------------------------------ */
/* Le disque qui porte un fichier                                       */
/* ------------------------------------------------------------------ */

let montagesExternesGardes: { a: number; liste: string[] } | null = null;

/** Les points de montage des disques externes (le disque de stockage sous `/mnt`), relus une fois la minute. */
function montagesExternes(): string[] {
  if (montagesExternesGardes && Date.now() - montagesExternesGardes.a < 60_000) return montagesExternesGardes.liste;
  let liste: string[] = [];
  try {
    liste = lireLesMontages(fs.readFileSync('/proc/mounts', 'utf8'))
      .filter((m) => /^\/(mnt|media)\//.test(m.point) || /^(fuse\.sshfs|nfs4?|cifs|smb3|fuse\.rclone)$/.test(m.type))
      .map((m) => m.point);
  } catch {
    /* pas de /proc/mounts : tout est sur le serveur */
  }
  montagesExternesGardes = { a: Date.now(), liste };
  return liste;
}

function disqueDe(cheminReel: string): DisqueDUnFichier {
  return disqueQuiPorte(cheminReel, montagesExternes());
}

/* ------------------------------------------------------------------ */
/* Le registre                                                          */
/* ------------------------------------------------------------------ */

function lignes(sql: string, ...params: unknown[]): LigneDeFichier[] {
  return getDb().prepare(sql).all(...params) as LigneDeFichier[];
}

function journal(geste: string, detail: Record<string, unknown>): void {
  try {
    getDb().prepare('INSERT INTO fichiers_journal (at, geste, detail) VALUES (?, ?, ?)').run(Date.now(), geste, JSON.stringify(detail));
  } catch {
    /* le journal ne fait jamais tomber un geste */
  }
}

/** Les chemins rangés, uniques dans chaque dossier (« photo (2).png »), pour un lot d'entrées d'un même dossier ou pas. */
function attribuerLesChemins(entrees: { cle: string; base: string; renomme?: boolean }[], pris: Map<string, Set<string>>): Map<string, string> {
  const resultat = new Map<string, string>();
  for (const e of entrees) {
    const coupe = e.base.lastIndexOf('/');
    const dossier = e.base.slice(0, coupe);
    const nom = e.base.slice(coupe + 1);
    let deja = pris.get(dossier);
    if (!deja) pris.set(dossier, (deja = new Set()));
    const final = nomLibreDansLeDossier(nom, deja);
    deja.add(final);
    resultat.set(e.cle, `${dossier}/${final}`);
  }
  return resultat;
}

let rangementEnCours: Promise<RapportDeRangement> | null = null;

/**
 * LE RANGEMENT : relit chaque service et met le registre d'accord, puis le miroir. Idempotent : relancé, il ne
 * change que ce qui a bougé. `essai` : l'essai à blanc, qui rend le rapport sans rien écrire.
 */
export function rangerLesFichiers(opts: { essai?: boolean } = {}): Promise<RapportDeRangement> {
  if (rangementEnCours && !opts.essai) return rangementEnCours;
  const travail = (async () => {
    const debut = Date.now();
    const essai = !!opts.essai;
    // Les médias se relisent d'abord, en douceur : le reste du relevé est synchrone.
    await releverLesMedias().catch((err) => log.warn(`rangement des fichiers : médias non relus — ${(err as Error).message}`));
    const voulues = toutCeQuiEstVoulu();
    await new Promise<void>((r) => setImmediate(r));
    const existantes = new Map(lignes('SELECT rowid, * FROM fichiers').map((l) => [l.origine, l]));
    const projets = new Map(projetsRanges().map((p) => [p.id, p]));
    const parService: Record<string, number> = {};
    const parProjet = new Map<string, number>();
    let nouveaux = 0;
    let misAJour = 0;
    let nonClasses = 0;
    const exemples: { chemin: string; vers: string }[] = [];
    /* Les chemins : ceux déjà attribués se gardent (une entrée ne change pas de nom d'un rangement à l'autre). */
    const pris = new Map<string, Set<string>>();
    const reserver = (chemin: string) => {
      const coupe = chemin.lastIndexOf('/');
      const d = chemin.slice(0, coupe);
      if (!pris.has(d)) pris.set(d, new Set());
      pris.get(d)!.add(chemin.slice(coupe + 1));
    };
    const voulusParOrigine = new Map(voulues.map((v) => [v.origine, v]));
    for (const l of existantes.values()) if (l.origine.startsWith('ajout:') || voulusParOrigine.has(l.origine)) reserver(l.chemin);
    const aEcrire: { v: EntreeVoulue; chemin: string; ancienne?: LigneDeFichier }[] = [];
    const sansChemin: { cle: string; base: string }[] = [];
    for (const v of voulues) {
      const dossierProjet = v.projetId ? (projets.get(v.projetId)?.dossier ?? null) : null;
      if (v.projetId && !dossierProjet) v.projetId = null;
      if (!v.projetId) nonClasses++;
      parService[v.service] = (parService[v.service] ?? 0) + 1;
      const nomDuProjet = dossierProjet ?? DOSSIER_COMMUN;
      parProjet.set(nomDuProjet, (parProjet.get(nomDuProjet) ?? 0) + 1);
      const ancienne = existantes.get(v.origine);
      const nom = ancienne?.renomme ? ancienne.nom : v.nom;
      const base = cheminRange({ dossierProjet, service: v.service, dossier: v.dossier, nom });
      const memePlace = ancienne && ancienne.chemin.slice(0, ancienne.chemin.lastIndexOf('/')) === base.slice(0, base.lastIndexOf('/')) && (ancienne.renomme || ancienne.nom === nom);
      if (memePlace) {
        const change = ancienne.chemin_reel !== v.cheminReel || ancienne.taille !== v.taille || ancienne.modifie_le !== v.modifieLe || ancienne.utilise_par !== JSON.stringify(v.utilisePar) || ancienne.projet_id !== v.projetId;
        if (change) aEcrire.push({ v, chemin: ancienne.chemin, ancienne });
        continue;
      }
      if (ancienne) pris.get(ancienne.chemin.slice(0, ancienne.chemin.lastIndexOf('/')))?.delete(ancienne.chemin.slice(ancienne.chemin.lastIndexOf('/') + 1));
      sansChemin.push({ cle: v.origine, base });
    }
    const chemins = attribuerLesChemins(sansChemin, pris);
    for (const { cle } of sansChemin) {
      const v = voulusParOrigine.get(cle)!;
      const ancienne = existantes.get(cle);
      aEcrire.push({ v, chemin: chemins.get(cle)!, ancienne });
      if (exemples.length < 25 && !ancienne) exemples.push({ chemin: path.relative(CONFIG.dataDir, v.cheminReel).startsWith('..') ? v.cheminReel : path.relative(CONFIG.dataDir, v.cheminReel), vers: chemins.get(cle)! });
    }
    for (const e of aEcrire) if (e.ancienne) misAJour++;
    else nouveaux++;
    const aRetirer = [...existantes.values()].filter((l) => !l.origine.startsWith('ajout:') && !voulusParOrigine.has(l.origine));
    let liens = { crees: 0, retires: 0 };
    if (!essai) {
      const poser = getDb().prepare(
        `INSERT INTO fichiers (id, origine, projet_id, service, dossier, nom, chemin, chemin_reel, genre, mime, taille, cree_le, modifie_le, utilise_par, texte)
         VALUES (@id, @origine, @projet_id, @service, @dossier, @nom, @chemin, @chemin_reel, @genre, @mime, @taille, @cree_le, @modifie_le, @utilise_par, @texte)
         ON CONFLICT(origine) DO UPDATE SET projet_id = excluded.projet_id, service = excluded.service, dossier = excluded.dossier,
           nom = CASE WHEN fichiers.renomme = 1 THEN fichiers.nom ELSE excluded.nom END, chemin = excluded.chemin, chemin_reel = excluded.chemin_reel,
           genre = excluded.genre, mime = excluded.mime, taille = excluded.taille, modifie_le = excluded.modifie_le, utilise_par = excluded.utilise_par,
           texte = CASE WHEN excluded.modifie_le != fichiers.modifie_le OR fichiers.texte = '' THEN excluded.texte ELSE fichiers.texte END`,
      );
      const retirer = getDb().prepare('DELETE FROM fichiers WHERE origine = ?');
      for (let i = 0; i < aEcrire.length; i += 500) {
        const lot = aEcrire.slice(i, i + 500);
        const prets = lot.map(({ v, chemin, ancienne }) => {
          const genre = genreDeFichier(v.nom, v.mime);
          const relire = genreLisible(genre) && v.taille <= LECTURE_MAX_OCTETS * 4 && (!ancienne || ancienne.modifie_le !== v.modifieLe || !ancienne.texte);
          const texte = `${v.texte} ${relire ? debutDuTexte(v.cheminReel) : ''}`.trim().slice(0, TEXTE_MAX);
          return {
            id: idDeLOrigine(v.origine),
            origine: v.origine,
            projet_id: v.projetId,
            service: v.service,
            dossier: v.dossier,
            nom: ancienne?.renomme ? ancienne.nom : v.nom,
            chemin,
            chemin_reel: v.cheminReel,
            genre,
            mime: v.mime,
            taille: v.taille,
            cree_le: v.creeLe,
            modifie_le: v.modifieLe,
            utilise_par: JSON.stringify(v.utilisePar),
            texte: relire || !ancienne ? texte : ancienne.texte,
          };
        });
        getDb().transaction(() => prets.forEach((p) => poser.run(p)))();
        await new Promise<void>((r) => setImmediate(r));
      }
      getDb().transaction(() => aRetirer.forEach((l) => retirer.run(l.origine)))();
      liens = await refaireLeMiroir();
    }
    const rapport: RapportDeRangement = {
      essai,
      total: voulues.length,
      nouveaux,
      misAJour,
      retires: aRetirer.length,
      nonClasses,
      parService,
      parProjet: [...parProjet.entries()].map(([nom, nombre]) => ({ nom, nombre })).sort((a, b) => b.nombre - a.nombre),
      exemples,
      liensCrees: liens.crees,
      liensRetires: liens.retires,
      dureeMs: Date.now() - debut,
      at: Date.now(),
    };
    if (!essai) {
      getDb().prepare("INSERT INTO meta (key, value) VALUES ('fichiers.rangement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(rapport));
      journal('rangement', { ...rapport, exemples: rapport.exemples.slice(0, 5) });
      if (nouveaux || misAJour || aRetirer.length) log.info('fichiers', `rangement : ${nouveaux} nouveau(x), ${misAJour} mis à jour, ${aRetirer.length} retiré(s), ${liens.crees} lien(s) posé(s) en ${rapport.dureeMs} ms`);
      void completerLesVecteursDesFichiers();
    }
    return rapport;
  })();
  if (!opts.essai) {
    rangementEnCours = travail;
    void travail.finally(() => {
      rangementEnCours = null;
    });
  }
  return travail;
}

/** Le dernier rangement appliqué, ou `null` si les fichiers existants n'ont jamais été rangés. */
export function dernierRangement(): RapportDeRangement | null {
  try {
    const l = getDb().prepare("SELECT value FROM meta WHERE key = 'fichiers.rangement'").get() as { value: string } | undefined;
    return l ? json<RapportDeRangement | null>(l.value, null) : null;
  } catch {
    return null;
  }
}

/**
 * UNE PIÈCE NEUVE ARRIVE DIRECTEMENT À SA PLACE : appelée après l'enregistrement d'une pièce jointe, une fois le
 * premier rangement fait. Le service se relit en entier au rangement suivant (un média qui rejoint le Studio
 * quitte alors « Conversations »).
 */
export function rangerLesPieces(ids: readonly string[]): void {
  if (!ids.length || !dernierRangement()) return;
  setTimeout(() => {
    try {
      const voulues = piecesVoulues(undefined, ids);
      if (!voulues.length) return;
      const pris = new Map<string, Set<string>>();
      for (const v of voulues) {
        const dossierProjet = dossierDuProjetRange(v.projetId);
        const base = cheminRange({ dossierProjet, service: v.service, dossier: v.dossier, nom: v.nom });
        const dossier = base.slice(0, base.lastIndexOf('/'));
        if (!pris.has(dossier)) pris.set(dossier, new Set((lignes('SELECT nom, chemin FROM fichiers WHERE chemin >= ? AND chemin < ?', `${dossier}/`, `${dossier}0`) as LigneDeFichier[]).map((l) => l.chemin.slice(dossier.length + 1))));
        const chemin = attribuerLesChemins([{ cle: v.origine, base }], pris).get(v.origine)!;
        getDb()
          .prepare(
            `INSERT INTO fichiers (id, origine, projet_id, service, dossier, nom, chemin, chemin_reel, genre, mime, taille, cree_le, modifie_le, utilise_par, texte)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origine) DO NOTHING`,
          )
          .run(idDeLOrigine(v.origine), v.origine, v.projetId, v.service, v.dossier, v.nom, chemin, v.cheminReel, genreDeFichier(v.nom, v.mime), v.mime, v.taille, v.creeLe, v.modifieLe, JSON.stringify(v.utilisePar), v.texte);
        poserUnLien(chemin, v.cheminReel);
      }
      void completerLesVecteursDesFichiers();
    } catch (err) {
      log.warn('fichiers', `pièce non rangée : ${(err as Error).message}`);
    }
  }, 50).unref?.();
}

/* ------------------------------------------------------------------ */
/* Le miroir sur disque                                                 */
/* ------------------------------------------------------------------ */

function cheminSurDisque(chemin: string): string | null {
  return safeJoin(PATHS.fichiers, chemin);
}

function poserUnLien(chemin: string, cible: string): boolean {
  const ou = cheminSurDisque(chemin);
  if (!ou) return false;
  try {
    const actuel = fs.lstatSync(ou);
    if (!actuel.isSymbolicLink()) return false;
    if (fs.readlinkSync(ou) === cible) return false;
    fs.unlinkSync(ou);
  } catch {
    /* rien encore */
  }
  try {
    fs.mkdirSync(path.dirname(ou), { recursive: true });
    fs.symlinkSync(cible, ou);
    return true;
  } catch (err) {
    log.warn('fichiers', `lien non posé (${chemin}) : ${(err as Error).message}`);
    return false;
  }
}

/**
 * LE MIROIR REFAIT DEPUIS LE REGISTRE : un lien par entrée visible, au bon nom ; les liens qui ne correspondent plus
 * à rien s'en vont, les dossiers vidés aussi. Un VRAI fichier (dépôt, corbeille) n'est jamais effacé ici.
 */
export async function refaireLeMiroir(): Promise<{ crees: number; retires: number }> {
  fs.mkdirSync(PATHS.fichiers, { recursive: true });
  const voulus = new Map<string, string>();
  for (const l of lignes("SELECT chemin, chemin_reel FROM fichiers WHERE supprime_le IS NULL AND origine NOT LIKE 'ajout:%'")) voulus.set(l.chemin, l.chemin_reel);
  let retires = 0;
  let crees = 0;
  const pile = [''];
  const dossiers: string[] = [];
  let compte = 0;
  while (pile.length) {
    const rel = pile.pop()!;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(path.join(PATHS.fichiers, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entrees) {
      const enfant = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === DOSSIER_CORBEILLE) continue;
      if (e.isDirectory()) {
        pile.push(enfant);
        dossiers.push(enfant);
      } else if (e.isSymbolicLink()) {
        const cible = voulus.get(enfant);
        let actuelle = '';
        try {
          actuelle = fs.readlinkSync(path.join(PATHS.fichiers, enfant));
        } catch {
          /* disparu */
        }
        if (cible && cible === actuelle) voulus.delete(enfant);
        else {
          try {
            fs.unlinkSync(path.join(PATHS.fichiers, enfant));
            retires++;
          } catch {
            /* déjà parti */
          }
        }
      }
      if (++compte % 2000 === 0) await new Promise<void>((r) => setImmediate(r));
    }
  }
  for (const [chemin, cible] of voulus) {
    if (poserUnLien(chemin, cible)) crees++;
    if (++compte % 2000 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  for (const d of dossiers.sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(path.join(PATHS.fichiers, d));
    } catch {
      /* pas vide */
    }
  }
  return { crees, retires };
}

/* ------------------------------------------------------------------ */
/* La lecture de l'arbre                                                */
/* ------------------------------------------------------------------ */

function versFichier(l: LigneDeFichier, maintenant = Date.now()): FichierRange {
  const service = estUnServiceDeFichiers(l.service) ? l.service : 'ajouts';
  const fiche = FICHES_DES_SERVICES[service];
  return {
    id: l.id,
    origine: l.origine,
    projetId: l.projet_id,
    service,
    /* Le nom MONTRÉ est celui de l'arbre (« maquette (2).png » pour le second homonyme), pas le nom d'origine. */
    nom: l.chemin.slice(l.chemin.lastIndexOf('/') + 1),
    chemin: l.chemin,
    genre: l.genre as GenreDeFichier,
    mime: l.mime,
    taille: l.taille,
    creeLe: l.cree_le,
    modifieLe: l.modifie_le,
    utilisePar: json<string[]>(l.utilise_par, []),
    pieceId: l.origine.startsWith('piece:') ? l.origine.slice(6) : null,
    supprimeLe: l.supprime_le,
    ...(l.supprime_le ? { joursRestants: joursRestantsEnCorbeille(l.supprime_le, maintenant) } : {}),
    renommable: fiche.renommable,
    supprimable: fiche.supprimable,
    disque: disqueDe(l.chemin_reel),
  };
}

/** Le projet et le service que désigne un chemin rangé (« Beluga/Studio/… »). */
export function porteeDuChemin(chemin: string): { projetId: string | null; projet: ProjetLu | null; service: ServiceDeFichiers | null; commun: boolean } {
  const [tete, second] = chemin.split('/');
  const commun = tete === DOSSIER_COMMUN;
  const projet = commun ? null : (projetsRanges().find((p) => p.dossier === tete) ?? null);
  const service = second ? (SERVICES_DE_FICHIERS.find((s) => FICHES_DES_SERVICES[s].libelle === second) ?? null) : null;
  return { projetId: projet?.id ?? null, projet, service, commun };
}

function voitLeProjet(compte: CompteDeFichiers, projetId: string | null): boolean {
  return compte.role === 'admin' || (!!projetId && compte.projets.includes(projetId));
}

/**
 * LE CONTENU D'UN DOSSIER RANGÉ, borné aux droits du compte : la racine liste les projets visibles (et « Commun » pour
 * l'administrateur), un projet liste ses services, un service ses sous-dossiers et fichiers. « Code » se lit à la
 * demande dans le dépôt du projet.
 */
export function lireLeDossier(compte: CompteDeFichiers, chemin: string): { chemin: string; dossiers: DossierRange[]; fichiers: FichierRange[]; rangement: RapportDeRangement | null } | null {
  const propre = morceauxDuDossier(chemin).join('/');
  const rangement = dernierRangement();
  if (!propre) {
    const comptes = new Map<string, { nombre: number; taille: number }>();
    for (const l of getDb().prepare('SELECT projet_id, service, COUNT(*) n, SUM(taille) t FROM fichiers WHERE supprime_le IS NULL GROUP BY projet_id, service').all() as { projet_id: string | null; service: ServiceDeFichiers; n: number; t: number }[]) {
      if (!peutVoirLEntree(compte, { projetId: l.projet_id, service: l.service })) continue;
      const cle = l.projet_id ?? '';
      const c = comptes.get(cle) ?? { nombre: 0, taille: 0 };
      comptes.set(cle, { nombre: c.nombre + l.n, taille: c.taille + (l.t ?? 0) });
    }
    const dossiers: DossierRange[] = projetsRanges()
      .filter((p) => voitLeProjet(compte, p.id))
      .map((p) => ({ nom: p.dossier, chemin: p.dossier, nombre: comptes.get(p.id)?.nombre ?? 0, taille: comptes.get(p.id)?.taille ?? 0, projetId: p.id }))
      .sort((a, b) => b.nombre - a.nombre || a.nom.localeCompare(b.nom));
    if (compte.role === 'admin') dossiers.push({ nom: DOSSIER_COMMUN, chemin: DOSSIER_COMMUN, nombre: comptes.get('')?.nombre ?? 0, taille: comptes.get('')?.taille ?? 0, projetId: null });
    return { chemin: '', dossiers, fichiers: [], rangement };
  }
  const portee = porteeDuChemin(propre);
  if (!portee.commun && !portee.projet) return null;
  if (portee.commun ? compte.role !== 'admin' : !voitLeProjet(compte, portee.projetId)) return null;
  const morceaux = propre.split('/');
  if (morceaux.length === 1) {
    const parService = new Map(
      (getDb().prepare('SELECT service, COUNT(*) n, SUM(taille) t FROM fichiers WHERE supprime_le IS NULL AND projet_id IS ? GROUP BY service').all(portee.projetId) as { service: ServiceDeFichiers; n: number; t: number }[]).map((l) => [l.service, l]),
    );
    const dossiers: DossierRange[] = [];
    // Le disque de chaque service : celui de tout son contenu, ou aucun badge quand il est réparti sur les deux.
    const disquesDesServices = new Map<string, Set<DisqueDUnFichier>>();
    for (const l of getDb().prepare('SELECT service, chemin_reel FROM fichiers WHERE supprime_le IS NULL AND projet_id IS ?').all(portee.projetId) as { service: string; chemin_reel: string }[]) {
      if (!disquesDesServices.has(l.service)) disquesDesServices.set(l.service, new Set());
      disquesDesServices.get(l.service)!.add(disqueDe(l.chemin_reel));
    }
    const disqueUnique = (d: Set<DisqueDUnFichier> | undefined) => (d?.size === 1 ? { disque: [...d][0] } : {});
    for (const service of SERVICES_DE_FICHIERS) {
      if (!peutVoirLEntree(compte, { projetId: portee.projetId ?? (compte.role === 'admin' ? null : '__'), service })) continue;
      const n = parService.get(service);
      const code = service === 'code' && !!portee.projet?.chemin && fs.existsSync(portee.projet.chemin);
      const toujours = service === 'ajouts' && !portee.commun;
      if (!n && !code && !toujours) continue;
      const disqueDuService = code ? { disque: disqueDe(portee.projet!.chemin) } : disqueUnique(disquesDesServices.get(service));
      dossiers.push({ nom: FICHES_DES_SERVICES[service].libelle, chemin: `${propre}/${FICHES_DES_SERVICES[service].libelle}`, nombre: n?.n ?? 0, taille: n?.t ?? 0, service, projetId: portee.projetId, ...(code ? { paresseux: true } : {}), ...disqueDuService });
    }
    return { chemin: propre, dossiers, fichiers: [], rangement };
  }
  if (!portee.service || !peutVoirLEntree(compte, { projetId: portee.projetId ?? (compte.role === 'admin' ? null : '__'), service: portee.service })) return null;
  if (portee.service === 'code') return lireLeCode(portee.projet, propre, morceaux.slice(2).join('/'), rangement);
  const dedans = lignes('SELECT rowid, * FROM fichiers WHERE supprime_le IS NULL AND chemin >= ? AND chemin < ?', `${propre}/`, `${propre}0`);
  const sous = new Map<string, { nombre: number; taille: number; apercu?: DossierRange['apercu']; recent: number; disques: Set<DisqueDUnFichier> }>();
  const fichiers: FichierRange[] = [];
  for (const l of dedans) {
    const reste = l.chemin.slice(propre.length + 1);
    const coupe = reste.indexOf('/');
    if (coupe < 0) fichiers.push(versFichier(l));
    else {
      const nom = reste.slice(0, coupe);
      const c = sous.get(nom) ?? { nombre: 0, taille: 0, recent: -1, disques: new Set<DisqueDUnFichier>() };
      c.disques.add(disqueDe(l.chemin_reel));
      const entree = { nombre: c.nombre + 1, taille: c.taille + l.taille, apercu: c.apercu, recent: c.recent, disques: c.disques };
      if (l.modifie_le > c.recent) {
        const f = versFichier(l);
        entree.apercu = { id: f.id, pieceId: f.pieceId, genre: f.genre, nom: f.nom, mime: f.mime };
        entree.recent = l.modifie_le;
      }
      sous.set(nom, entree);
    }
  }
  const dossiers = [...sous.entries()]
    .map(([nom, c]) => ({ nom, chemin: `${propre}/${nom}`, nombre: c.nombre, taille: c.taille, ...(c.apercu ? { apercu: c.apercu } : {}), service: portee.service!, projetId: portee.projetId, ...(c.disques.size === 1 ? { disque: [...c.disques][0] } : {}) }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  fichiers.sort((a, b) => b.modifieLe - a.modifieLe);
  return { chemin: propre, dossiers, fichiers, rangement };
}

/** LE CODE D'UN PROJET : lu dans son dépôt, jamais copié (les dossiers lourds `node_modules`, `.git`… sont tus). */
function lireLeCode(projet: ProjetLu | null, chemin: string, relatif: string, rangement: RapportDeRangement | null) {
  if (!projet?.chemin) return null;
  const noeuds = listDir(projet.chemin, relatif);
  const dossiers: DossierRange[] = [];
  const fichiers: FichierRange[] = [];
  // Le code vit tout entier sur le disque de son dépôt.
  const disque = disqueDe(projet.chemin);
  for (const n of noeuds) {
    if (n.kind === 'dir') dossiers.push({ nom: n.name, chemin: `${chemin}/${n.name}`, nombre: 0, taille: 0, service: 'code', projetId: projet.id, paresseux: true, disque });
    else
      fichiers.push({
        id: `code:${projet.id}:${n.path}`,
        origine: `code:${projet.id}:${n.path}`,
        projetId: projet.id,
        service: 'code',
        nom: n.name,
        chemin: `${chemin}/${n.name}`,
        genre: genreDeFichier(n.name),
        mime: mimeDuFichier(n.name),
        taille: n.size ?? 0,
        creeLe: n.mtime ?? 0,
        modifieLe: n.mtime ?? 0,
        utilisePar: [],
        pieceId: null,
        supprimeLe: null,
        renommable: false,
        supprimable: false,
        disque,
      });
  }
  return { chemin, dossiers, fichiers, rangement };
}

/** Une entrée du registre, si le compte la voit. */
function entreeVisible(compte: CompteDeFichiers, id: string): LigneDeFichier | null {
  const l = lignes('SELECT rowid, * FROM fichiers WHERE id = ?', id)[0];
  if (!l || !estUnServiceDeFichiers(l.service)) return null;
  return peutVoirLEntree(compte, { projetId: l.projet_id, service: l.service }) ? l : null;
}

/**
 * LE FICHIER RÉEL À SERVIR pour `/api/fichiers/contenu`, droits vérifiés : une entrée du registre, ou un fichier du
 * code d'un projet (`code:<projet>:<chemin relatif>`).
 */
export function fichierAServir(compte: CompteDeFichiers, id: string): { chemin: string; nom: string; mime: string } | null {
  if (id.startsWith('code:')) {
    const [, projetId, ...reste] = id.split(':');
    const projet = projetsRanges().find((p) => p.id === projetId);
    if (!projet || !peutVoirLEntree(compte, { projetId: projet.id, service: 'code' })) return null;
    const plein = safeJoin(projet.chemin, reste.join(':'));
    if (!plein || !statOuNull(plein)?.isFile()) return null;
    return { chemin: plein, nom: path.basename(plein), mime: mimeDuFichier(plein) };
  }
  const l = entreeVisible(compte, id);
  if (!l || l.purge_le) return null;
  if (!statOuNull(l.chemin_reel)?.isFile()) return null;
  return { chemin: l.chemin_reel, nom: l.nom, mime: l.mime || mimeDuFichier(l.nom) };
}

/* ------------------------------------------------------------------ */
/* Les gestes                                                           */
/* ------------------------------------------------------------------ */

function exigerLeGeste(compte: CompteDeFichiers, l: LigneDeFichier | null, geste: GesteSurUnFichier): LigneDeFichier {
  if (!l || !estUnServiceDeFichiers(l.service) || !peutFaireLeGeste(compte, { projetId: l.projet_id, service: l.service }, geste)) throw new Error('Cette action ne vous est pas ouverte.');
  return l;
}

/** RENOMMER : le nom affiché change (le rangement ne le réécrit plus) ; un fichier déposé change aussi sur le disque. */
export function renommerUnFichier(compte: CompteDeFichiers, id: string, nouveau: string): FichierRange {
  const l = exigerLeGeste(compte, entreeVisible(compte, id), 'renommer');
  const nom = nomSur(nouveau, l.nom);
  const dossier = l.chemin.slice(0, l.chemin.lastIndexOf('/'));
  const pris = new Set((lignes('SELECT chemin FROM fichiers WHERE chemin >= ? AND chemin < ? AND id != ?', `${dossier}/`, `${dossier}0`, id) as LigneDeFichier[]).map((x) => x.chemin.slice(dossier.length + 1)).filter((x) => !x.includes('/')));
  const final = nomLibreDansLeDossier(nom, pris);
  const chemin = `${dossier}/${final}`;
  let reel = l.chemin_reel;
  if (l.origine.startsWith('ajout:')) {
    const vers = cheminSurDisque(chemin);
    if (!vers) throw new Error('nom refusé');
    fs.mkdirSync(path.dirname(vers), { recursive: true });
    fs.renameSync(l.chemin_reel, vers);
    reel = vers;
  } else {
    const ancien = cheminSurDisque(l.chemin);
    if (ancien) {
      try {
        if (fs.lstatSync(ancien).isSymbolicLink()) fs.unlinkSync(ancien);
      } catch {
        /* pas de lien */
      }
    }
  }
  getDb().prepare('UPDATE fichiers SET nom = ?, chemin = ?, chemin_reel = ?, renomme = 1 WHERE id = ?').run(final, chemin, reel, id);
  if (!l.origine.startsWith('ajout:')) poserUnLien(chemin, reel);
  journal('renommer', { id, de: l.chemin, vers: chemin });
  return versFichier(lignes('SELECT rowid, * FROM fichiers WHERE id = ?', id)[0]!);
}

/**
 * À LA CORBEILLE : l'entrée quitte l'arbre (et son lien le miroir) ; un fichier DÉPOSÉ part dans `.corbeille/`.
 * Rien n'est effacé avant trente jours, et « Restaurer » remet tout à sa place.
 */
export function mettreALaCorbeille(compte: CompteDeFichiers, id: string): FichierRange {
  const l = exigerLeGeste(compte, entreeVisible(compte, id), 'supprimer');
  if (l.supprime_le) return versFichier(l);
  let reel = l.chemin_reel;
  if (l.origine.startsWith('ajout:')) {
    const vers = path.join(PATHS.fichiers, DOSSIER_CORBEILLE, `${l.id}-${path.basename(l.chemin_reel)}`);
    fs.mkdirSync(path.dirname(vers), { recursive: true });
    fs.renameSync(l.chemin_reel, vers);
    reel = vers;
  } else {
    const lien = cheminSurDisque(l.chemin);
    try {
      if (lien && fs.lstatSync(lien).isSymbolicLink()) fs.unlinkSync(lien);
    } catch {
      /* pas de lien */
    }
  }
  getDb().prepare('UPDATE fichiers SET supprime_le = ?, chemin_reel = ? WHERE id = ?').run(Date.now(), reel, id);
  journal('corbeille', { id, chemin: l.chemin });
  return versFichier(lignes('SELECT rowid, * FROM fichiers WHERE id = ?', id)[0]!);
}

export function restaurerUnFichier(compte: CompteDeFichiers, id: string): FichierRange {
  const l = exigerLeGeste(compte, entreeVisible(compte, id), 'supprimer');
  if (!l.supprime_le || l.purge_le) throw new Error('Ce fichier n’est plus dans la corbeille.');
  let reel = l.chemin_reel;
  if (l.origine.startsWith('ajout:')) {
    const vers = cheminSurDisque(l.chemin);
    if (!vers) throw new Error('chemin refusé');
    fs.mkdirSync(path.dirname(vers), { recursive: true });
    fs.renameSync(l.chemin_reel, vers);
    reel = vers;
  } else poserUnLien(l.chemin, reel);
  getDb().prepare('UPDATE fichiers SET supprime_le = NULL, chemin_reel = ? WHERE id = ?').run(reel, id);
  journal('restaurer', { id, chemin: l.chemin });
  return versFichier(lignes('SELECT rowid, * FROM fichiers WHERE id = ?', id)[0]!);
}

/** LA CORBEILLE du compte : ce qu'il a le droit de voir, le plus récent d'abord. */
export function lireLaCorbeille(compte: CompteDeFichiers): FichierRange[] {
  const maintenant = Date.now();
  return lignes('SELECT rowid, * FROM fichiers WHERE supprime_le IS NOT NULL AND purge_le IS NULL ORDER BY supprime_le DESC LIMIT 500')
    .filter((l) => estUnServiceDeFichiers(l.service) && peutVoirLEntree(compte, { projetId: l.projet_id, service: l.service }))
    .map((l) => versFichier(l, maintenant));
}

/**
 * LA PURGE DES TRENTE JOURS : un fichier DÉPOSÉ est effacé ; une pièce jointe que plus rien n'utilise, un document de
 * carte ou un journal l'est aussi. Une pièce encore utilisée (média du Studio, de la Médiathèque) reste sur le disque,
 * seulement retirée de l'arbre pour de bon : effacer ce qui sert casserait la publication.
 */
export function purgerLaCorbeille(maintenant = Date.now()): number {
  const aPasser = lignes('SELECT rowid, * FROM fichiers WHERE supprime_le IS NOT NULL AND purge_le IS NULL').filter((l) => aPurger(l.supprime_le, maintenant));
  let n = 0;
  for (const l of aPasser) {
    const utilise = json<string[]>(l.utilise_par, []).length > 0;
    const effacable = l.origine.startsWith('ajout:') || l.origine.startsWith('journal:') || l.origine.startsWith('document:') || (l.origine.startsWith('piece:') && !utilise);
    if (effacable) {
      try {
        fs.unlinkSync(l.chemin_reel);
      } catch {
        /* déjà parti */
      }
    }
    if (l.origine.startsWith('ajout:')) getDb().prepare('DELETE FROM fichiers WHERE id = ?').run(l.id);
    else getDb().prepare('UPDATE fichiers SET purge_le = ? WHERE id = ?').run(maintenant, l.id);
    journal('purge', { id: l.id, chemin: l.chemin, efface: effacable });
    n++;
  }
  return n;
}

/**
 * DÉPOSER UN FICHIER dans un dossier rangé : il y vit pour de vrai (`PATHS.fichiers/<chemin>`). Un dépôt directement
 * sous un projet ou dans un service qui n'en prend pas va dans « Ajouts ».
 */
export function deposerUnFichier(compte: CompteDeFichiers, dossier: string, nom: string, contenu: Buffer): FichierRange {
  const morceaux = morceauxDuDossier(dossier);
  const portee = porteeDuChemin(morceaux.join('/'));
  if (!portee.projet) throw new Error('Choisissez d’abord le dossier d’un projet.');
  let service: ServiceDeFichiers = portee.service ?? 'ajouts';
  let sous = morceaux.slice(2);
  if (!FICHES_DES_SERVICES[service].depot) {
    service = 'ajouts';
    sous = [];
  }
  if (!peutFaireLeGeste(compte, { projetId: portee.projetId, service }, 'deposer')) throw new Error('Cette action ne vous est pas ouverte.');
  const base = cheminRange({ dossierProjet: portee.projet.dossier, service, dossier: sous.join('/'), nom });
  const parent = base.slice(0, base.lastIndexOf('/'));
  const pris = new Set((lignes('SELECT chemin FROM fichiers WHERE chemin >= ? AND chemin < ?', `${parent}/`, `${parent}0`) as LigneDeFichier[]).map((x) => x.chemin.slice(parent.length + 1)));
  try {
    for (const n of fs.readdirSync(path.join(PATHS.fichiers, parent))) pris.add(n);
  } catch {
    /* dossier neuf */
  }
  const final = nomLibreDansLeDossier(base.slice(base.lastIndexOf('/') + 1), pris);
  const chemin = `${parent}/${final}`;
  const reel = cheminSurDisque(chemin);
  if (!reel) throw new Error('nom refusé');
  fs.mkdirSync(path.dirname(reel), { recursive: true });
  fs.writeFileSync(reel, contenu);
  const origine = `ajout:${crypto.randomUUID()}`;
  const mime = mimeDuFichier(final);
  const genre = genreDeFichier(final, mime);
  const maintenant = Date.now();
  getDb()
    .prepare(
      `INSERT INTO fichiers (id, origine, projet_id, service, dossier, nom, chemin, chemin_reel, genre, mime, taille, cree_le, modifie_le, utilise_par, texte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
    )
    .run(idDeLOrigine(origine), origine, portee.projetId, service, sous.join('/'), final, chemin, reel, genre, mime, contenu.length, maintenant, maintenant, genreLisible(genre) ? contenu.subarray(0, LECTURE_MAX_OCTETS).toString('utf8').replace(/\s+/g, ' ').slice(0, TEXTE_MAX) : '');
  journal('depot', { chemin, taille: contenu.length });
  void completerLesVecteursDesFichiers();
  return versFichier(lignes('SELECT rowid, * FROM fichiers WHERE origine = ?', origine)[0]!);
}

/* ------------------------------------------------------------------ */
/* La recherche                                                         */
/* ------------------------------------------------------------------ */

export interface ResultatDeRecherche extends FichierRange {
  extrait: string;
  score: number;
}

let cacheDesVecteurs: { id: string; vecteur: Float32Array }[] | null = null;

function vecteursDesFichiers(): { id: string; vecteur: Float32Array }[] {
  if (cacheDesVecteurs) return cacheDesVecteurs;
  try {
    const l = getDb().prepare('SELECT id, vecteur FROM fichier_vecteurs WHERE modele = ?').all(MODELE_VECTEURS) as { id: string; vecteur: Buffer }[];
    cacheDesVecteurs = l
      .filter((x) => x.vecteur.length === DIMENSIONS_VECTEURS * 4)
      .map((x) => {
        const copie = new Uint8Array(x.vecteur.length);
        copie.set(x.vecteur);
        return { id: x.id, vecteur: new Float32Array(copie.buffer) };
      });
  } catch {
    cacheDesVecteurs = [];
  }
  return cacheDesVecteurs;
}

let vecteursEnCours: Promise<number> | null = null;

/**
 * LES VECTEURS DES FICHIERS, calculés par lots de 16 par le vectoriseur local (aucun quota), seulement pour ce qui a
 * changé ; il s'arrête seul au repos. Un seul calcul à la fois.
 */
export function completerLesVecteursDesFichiers(): Promise<number> {
  if (vecteursEnCours) return vecteursEnCours;
  if (!vectoriseurDisponible()) return Promise.resolve(0);
  vecteursEnCours = (async () => {
    const page = getDb().prepare(
      `SELECT f.rowid, f.id, f.nom, f.chemin, f.texte, v.empreinte FROM fichiers f LEFT JOIN fichier_vecteurs v ON v.id = f.id
        WHERE f.rowid > ? AND f.purge_le IS NULL ORDER BY f.rowid LIMIT 500`,
    );
    const poser = getDb().prepare(
      `INSERT INTO fichier_vecteurs (id, empreinte, modele, vecteur, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET empreinte = excluded.empreinte, modele = excluded.modele, vecteur = excluded.vecteur, at = excluded.at`,
    );
    let faits = 0;
    for (let depuis = 0; ; ) {
      const lot = page.all(depuis) as { rowid: number; id: string; nom: string; chemin: string; texte: string; empreinte: string | null }[];
      if (!lot.length) break;
      depuis = lot[lot.length - 1]!.rowid;
      const manquants = lot
        .map((l) => {
          const texte = passageDUnFichier({ cheminLogique: l.chemin, nom: l.nom, texte: l.texte });
          return { id: l.id, texte, empreinte: crypto.createHash('sha1').update(`${MODELE_VECTEURS}\n${texte}`).digest('hex'), avant: l.empreinte };
        })
        .filter((x) => x.empreinte !== x.avant);
      for (let i = 0; i < manquants.length; i += 16) {
        const sous = manquants.slice(i, i + 16);
        const vecteurs = await vectoriser(sous.map((x) => x.texte));
        getDb().transaction(() => sous.forEach((x, j) => poser.run(x.id, x.empreinte, MODELE_VECTEURS, Buffer.from(vecteurs[j]!.buffer), Date.now())))();
        faits += sous.length;
      }
      await new Promise<void>((r) => setImmediate(r));
    }
    if (faits) {
      cacheDesVecteurs = null;
      log.info('fichiers', `${faits} fichier(s) vectorisé(s) pour la recherche`);
    }
    return faits;
  })()
    .catch((err) => {
      log.warn('fichiers', `vecteurs interrompus (${(err as Error).message})`);
      return 0;
    })
    .finally(() => {
      vecteursEnCours = null;
    });
  return vecteursEnCours;
}

/**
 * LA RECHERCHE INTELLIGENTE : le plein texte (nom, emplacement, contenu, sans accents, le dernier mot en préfixe) et
 * le SENS (vectoriseur local, la demande comparée à chaque fichier), fusionnés par rang ; puis les droits du compte,
 * et un projet si l'explorateur d'un projet la pose. Sans vectoriseur, le plein texte seul répond.
 */
export async function chercherDesFichiers(compte: CompteDeFichiers, demande: string, opts: { projetId?: string | null; limite?: number } = {}): Promise<{ resultats: ResultatDeRecherche[]; parLeSens: boolean }> {
  const limite = Math.min(opts.limite ?? 40, 100);
  const visible = (l: Pick<LigneDeFichier, 'projet_id' | 'service'>) => estUnServiceDeFichiers(l.service) && peutVoirLEntree(compte, { projetId: l.projet_id, service: l.service }) && (!opts.projetId || l.projet_id === opts.projetId);
  const requete = requeteDeFichiers(demande);
  const plein: string[] = [];
  if (requete) {
    try {
      const l = getDb()
        .prepare(
          `SELECT f.id, f.projet_id, f.service FROM fichiers_fts JOIN fichiers f ON f.rowid = fichiers_fts.rowid
            WHERE fichiers_fts MATCH ? AND f.supprime_le IS NULL ORDER BY bm25(fichiers_fts, 6.0, 2.0, 1.0) LIMIT 400`,
        )
        .all(requete) as { id: string; projet_id: string | null; service: string }[];
      for (const x of l) if (visible(x)) plein.push(x.id);
    } catch {
      /* demande illisible pour FTS : le sens répond seul */
    }
  }
  let sens: string[] = [];
  let parLeSens = false;
  const memoire = vectoriseurDisponible() ? vecteursDesFichiers() : [];
  if (memoire.length && demande.trim().length >= 3) {
    try {
      const [v] = await vectoriser([demandeAVectoriser(demande)], 6_000);
      /* CALIBRÉ SUR multilingual-e5-small (05/11/2026) : le bon fichier sort vers 0,85, le bruit entre 0,78 et 0,82.
         On garde ce qui dépasse 0,81 ET reste à moins de 0,03 du meilleur : une question sans réponse ne rend rien. */
      const notes = memoire.map((x) => ({ id: x.id, cos: cosinus(v!, x.vecteur) })).sort((a, b) => b.cos - a.cos);
      const meilleur = notes[0]?.cos ?? 0;
      const proches = notes.filter((x) => x.cos >= 0.81 && x.cos >= meilleur - 0.03).slice(0, 400);
      if (proches.length) {
        const portees = new Map(
          (getDb().prepare(`SELECT id, projet_id, service, supprime_le FROM fichiers WHERE id IN (${proches.map(() => '?').join(',')})`).all(...proches.map((p) => p.id)) as { id: string; projet_id: string | null; service: string; supprime_le: number | null }[]).map((x) => [x.id, x]),
        );
        sens = proches.filter((p) => {
          const x = portees.get(p.id);
          return x && !x.supprime_le && visible(x);
        }).map((p) => p.id);
        parLeSens = true;
      }
    } catch {
      /* le vectoriseur tarde : le plein texte suffit */
    }
  }
  /* Une QUESTION en mots courants (trois mots ou plus) se juge d'abord au sens ; un mot-clé, d'abord au mot exact. */
  const question = demande.trim().split(/\s+/).length >= 3;
  const classement = fusionnerLesClassements([plein, sens], 60, question ? [1, 2] : [1.5, 1]).slice(0, limite);
  if (!classement.length) return { resultats: [], parLeSens };
  const parId = new Map(lignes(`SELECT rowid, * FROM fichiers WHERE id IN (${classement.map(() => '?').join(',')})`, ...classement.map((c) => c.id)).map((l) => [l.id, l]));
  const resultats: ResultatDeRecherche[] = [];
  for (const c of classement) {
    const l = parId.get(c.id);
    if (!l) continue;
    resultats.push({ ...versFichier(l), extrait: extraitAutour(l.texte, demande), score: c.score });
  }
  return { resultats, parLeSens };
}

/* ------------------------------------------------------------------ */
/* Le service de fond                                                   */
/* ------------------------------------------------------------------ */

let minuteur: NodeJS.Timeout | null = null;

/**
 * LE RANGEMENT TOURNE SEUL — une fois les fichiers existants rangés une première fois par l'administrateur (essai à
 * blanc, puis « Ranger ») : 2 minutes après le démarrage, puis toutes les 30 minutes, avec la purge de la corbeille.
 * Les pièces neuves, elles, se rangent dès leur dépôt (`rangerLesPieces`).
 */
export function demarrerLeRangementDesFichiers(): void {
  if (minuteur || process.env.BELUGA_SANS_RANGEMENT === '1') return;
  apresUnePieceEnregistree.push((id) => rangerLesPieces([id]));
  const tour = () => {
    if (!dernierRangement()) return;
    void rangerLesFichiers()
      .then(() => purgerLaCorbeille())
      .catch((err) => log.warn('fichiers', `rangement interrompu : ${(err as Error).message}`));
  };
  setTimeout(tour, 2 * 60_000).unref?.();
  minuteur = setInterval(tour, 30 * 60_000);
  minuteur.unref?.();
}
