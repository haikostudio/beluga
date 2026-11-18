import { fondsRetiresDuProjet } from './studio-fond.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  calerSurLeRythme,
  couperPartout,
  rythmeDeLEnveloppe,
  type MotHorodate,
  type RythmeDuSon,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { dansLaFileLourde } from './file-lourde.js';
import { mediasLivresDe } from './medias-livres.js';
import * as store from './store.js';
import {
  compositionCourante,
  dupliquerCreation,
  enregistrerVersion,
  fichierDuMedia,
  lireCreation,
  lireMedia,
  listerMedias,
  nouvelId,
  poserUnJalon,
  diffuserStudio,
  type Resultat,
} from './studio.js';

/**
 * LES GESTES AJOUTÉS AU RETOUR DU STUDIO (30/10/2026) : la bibliothèque commune du
 * projet, la coupe au texte, le rythme, la déclinaison et l'envoi vers Réseaux
 * sociaux. Les règles sont dans `shared/src/studio-montage-avance.ts`.
 */

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* La bibliothèque commune                                              */
/* ------------------------------------------------------------------ */

export interface LigneDeBibliotheque {
  /** La pièce jointe : importer un média ne la copie jamais. */
  attachmentId: string;
  genre: 'image' | 'video' | 'audio';
  nom: string;
  /** D'où il vient, en mots courants. */
  origine: string;
  /** Déjà dans la bibliothèque de cette création. */
  mediaId?: string;
  creeLe: number;
}

/**
 * TOUT CE QUE LE PROJET A FABRIQUÉ, AU MÊME ENDROIT : la bibliothèque du Studio et
 * les médias livrés par ses cartes (service Médias), sans doublon, le plus récent
 * d'abord. Une recherche et un genre filtrent.
 */
export function bibliothequeCommune(creationId: string, filtre: { recherche?: unknown; genre?: unknown } = {}): LigneDeBibliotheque[] {
  const creation = lireCreation(creationId);
  if (!creation) return [];
  const parPiece = new Map<string, LigneDeBibliotheque>();
  for (const m of listerMedias(creation.projectId, creation.id)) {
    if (!m.attachmentId || (m.genre !== 'image' && m.genre !== 'video' && m.genre !== 'audio')) continue;
    parPiece.set(m.attachmentId, { attachmentId: m.attachmentId, genre: m.genre, nom: m.nom, origine: 'Bibliothèque du Studio', mediaId: m.id, creeLe: m.creeLe });
  }
  const cartes = getDb().prepare('SELECT DISTINCT card_id AS id FROM medias_livres WHERE project_id = ? AND card_id IS NOT NULL ORDER BY livre_le DESC LIMIT 200').all(creation.projectId) as { id: string }[];
  for (const { id } of cartes) {
    const titre = store.getCard(id)?.title ?? 'une carte';
    for (const m of mediasLivresDe({ cardId: id })) {
      if (parPiece.has(m.attachmentId)) continue;
      const genre = m.genre === 'son' ? 'audio' : m.genre;
      parPiece.set(m.attachmentId, { attachmentId: m.attachmentId, genre, nom: m.sujet || 'Média', origine: `Carte « ${titre} »`, creeLe: m.livreLe });
    }
  }
  /* Le service Médias : ce que les cartes caméra du projet ont fabriqué, livré au fil ou non. */
  const fabriques = getDb()
    .prepare("SELECT attachment_id, genre, plan, card_id, cree_le FROM medias_realisation WHERE project_id = ? AND etat = 'fini' AND attachment_id IS NOT NULL ORDER BY cree_le DESC LIMIT 300")
    .all(creation.projectId) as { attachment_id: string; genre: string; plan: string; card_id: string; cree_le: number }[];
  for (const m of fabriques) {
    if (parPiece.has(m.attachment_id)) continue;
    const genreLu = m.genre === 'son' ? 'audio' : m.genre === 'video' ? 'video' : 'image';
    parPiece.set(m.attachment_id, { attachmentId: m.attachment_id, genre: genreLu, nom: m.plan || 'Média', origine: `Carte « ${store.getCard(m.card_id)?.title ?? 'sans titre'} »`, creeLe: m.cree_le });
  }
  /* UN SEUL EXEMPLAIRE PAR MÉDIA : sa version sans fond tant qu'elle est en service, sinon l'original remis. */
  for (const [detouree, f] of Object.entries(fondsRetiresDuProjet(creation.projectId))) parPiece.delete(f.remis ? detouree : f.original);
  const recherche = String(filtre.recherche ?? '').trim().toLowerCase();
  const genre = String(filtre.genre ?? '');
  return [...parPiece.values()]
    .filter((l) => (!genre || l.genre === genre) && (!recherche || `${l.nom} ${l.origine}`.toLowerCase().includes(recherche)))
    .sort((a, b) => b.creeLe - a.creeLe)
    .slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* La coupe au texte                                                    */
/* ------------------------------------------------------------------ */

/** Une coupe à travers toute la création : une seule version, annulable comme tout geste. */
export function couperAuTexte(creationId: string, passages: { de: number; a: number }[]): Resultat<{ numero: number; resume: string }> {
  const courante = compositionCourante(creationId);
  if (!courante) return { ok: false, raison: 'création introuvable' };
  if (!passages.length) return { ok: false, raison: 'aucun mot à couper' };
  let c = courante;
  let total = 0;
  /* De la fin vers le début : couper un passage ne décale pas ceux d'avant. */
  for (const p of [...passages].sort((x, y) => y.de - x.de)) {
    const r = couperPartout(c, p.de, p.a, nouvelId);
    if (!r.ok) return r;
    c = r.composition;
    total += p.a - p.de;
  }
  const resume = `${total.toFixed(1)} s coupées au texte`;
  const v = enregistrerVersion(creationId, c, resume, 'humain');
  return v.ok ? { ok: true, numero: v.numero, resume } : v;
}

/** Les mots d'un son ou d'une vidéo de la bibliothèque, reconnus une fois puis gardés (Whisper, dans la file lourde). */
export async function motsDuMedia(creationId: string, mediaId: string): Promise<Resultat<{ mots: MotHorodate[] }>> {
  const creation = lireCreation(creationId);
  const media = lireMedia(mediaId);
  if (!creation || !media || media.projectId !== creation.projectId) return { ok: false, raison: 'média introuvable' };
  const cle = `studio.mots.${mediaId}`;
  const deja = getMeta(cle);
  if (deja) return { ok: true, mots: JSON.parse(deja) as MotHorodate[] };
  const fichier = fichierDuMedia(media);
  if (!fichier) return { ok: false, raison: 'le fichier de ce média est introuvable' };
  const { motsReconnusDuFichier } = await import('./voix-de-realisation.js');
  const mots = await motsReconnusDuFichier(fichier);
  setMeta(cle, JSON.stringify(mots));
  return { ok: true, mots };
}

/* ------------------------------------------------------------------ */
/* Le rythme d'une musique                                              */
/* ------------------------------------------------------------------ */

const FENETRES_PAR_SECONDE = 100;
const FREQUENCE = 11025;

/** Le son d'un média ramené à son enveloppe d'énergie : ffmpeg, sans modèle, dans la file lourde. */
async function enveloppeDuFichier(fichier: string): Promise<number[]> {
  const { stdout } = await execFileAsync('ffmpeg', ['-v', 'error', '-i', fichier, '-ac', '1', '-ar', String(FREQUENCE), '-f', 's16le', '-'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const octets = stdout as unknown as Buffer;
  const parFenetre = Math.floor(FREQUENCE / FENETRES_PAR_SECONDE);
  const enveloppe: number[] = [];
  for (let debut = 0; debut + parFenetre * 2 <= octets.length; debut += parFenetre * 2) {
    let somme = 0;
    for (let i = 0; i < parFenetre; i++) {
      const v = octets.readInt16LE(debut + i * 2) / 32768;
      somme += v * v;
    }
    enveloppe.push(Math.sqrt(somme / parFenetre));
  }
  return enveloppe;
}

/** Le rythme d'un son de la création, lu une fois puis gardé. */
export async function rythmeDuMedia(creationId: string, mediaId: string): Promise<Resultat<{ rythme: RythmeDuSon }>> {
  const creation = lireCreation(creationId);
  const media = lireMedia(mediaId);
  if (!creation || !media || media.projectId !== creation.projectId) return { ok: false, raison: 'média introuvable' };
  const cle = `studio.rythme.${mediaId}`;
  const deja = getMeta(cle);
  if (deja) return { ok: true, rythme: JSON.parse(deja) as RythmeDuSon };
  const fichier = fichierDuMedia(media);
  if (!fichier) return { ok: false, raison: 'le fichier de ce média est introuvable' };
  const rythme = rythmeDeLEnveloppe(await dansLaFileLourde(() => enveloppeDuFichier(fichier)), FENETRES_PAR_SECONDE);
  setMeta(cle, JSON.stringify(rythme));
  return { ok: true, rythme };
}

/** Le premier son de la création qui a une pulsation : sa musique, en temps de la composition. */
export async function rythmeDeLaCreation(creationId: string): Promise<RythmeDuSon> {
  const composition = compositionCourante(creationId);
  if (!composition) return { bpm: 0, temps: [] };
  const sons = composition.pistes.filter((p) => p.genre === 'son').flatMap((p) => p.segments.filter((s) => s.genre === 'audio'));
  for (const son of sons) {
    if (son.genre !== 'audio' || !son.mediaId) continue;
    const r = await rythmeDuMedia(creationId, son.mediaId);
    if (!r.ok || !r.rythme.bpm) continue;
    const vitesse = son.vitesse || 1;
    const decalage = son.debutMedia ?? 0;
    const temps = r.rythme.temps.map((t) => son.debut + (t - decalage) / vitesse).filter((t) => t >= son.debut && t <= son.debut + son.duree);
    return { bpm: r.rythme.bpm, temps };
  }
  return { bpm: 0, temps: [] };
}

export async function calerLesPlansSurLeRythme(creationId: string, auteur: 'humain' | 'agent'): Promise<Resultat<{ numero: number; resume: string }>> {
  const composition = compositionCourante(creationId);
  if (!composition) return { ok: false, raison: 'création introuvable' };
  const { temps, bpm } = await rythmeDeLaCreation(creationId);
  if (!bpm) return { ok: false, raison: 'aucune musique à la pulsation nette dans cette création' };
  const actuelle = compositionCourante(creationId)!;
  const r = calerSurLeRythme(actuelle, temps);
  if (!r.ok) return r;
  const v = enregistrerVersion(creationId, r.composition, r.resume, auteur);
  return v.ok ? { ok: true, numero: v.numero, resume: r.resume } : v;
}

/* ------------------------------------------------------------------ */
/* Déclinaison                                                          */
/* ------------------------------------------------------------------ */

const NOMS_DES_LANGUES: Readonly<Record<string, string>> = { fr: 'français', en: 'anglais', de: 'allemand', es: 'espagnol', it: 'italien', pt: 'portugais', nl: 'néerlandais' };

/**
 * DÉCLINER DANS UNE AUTRE LANGUE : une copie de la création, et son directeur à qui
 * l'on demande de traduire textes et voix en gardant les images déjà payées. La
 * voix finale repasse par son bouton à prix. Rien ne se fabrique sans accord.
 */
export async function declinerEnLangue(creationId: string, langue: string): Promise<{ creationId: string }> {
  const source = lireCreation(creationId);
  if (!source) throw new Error('création introuvable');
  const nom = NOMS_DES_LANGUES[langue];
  if (!nom) throw new Error('langue inconnue');
  const copie = dupliquerCreation(creationId);
  if (!copie.ok) throw new Error(copie.raison);
  const titre = `${source.titre} — ${nom}`.slice(0, 120);
  getDb().prepare('UPDATE studio_creations SET titre = ? WHERE id = ?').run(titre, copie.creation.id);
  poserUnJalon(copie.creation.id, `Copie de « ${source.titre} » avant traduction`);
  const { lancerAgentStudio } = await import('./assistant-studio.js');
  await lancerAgentStudio({
    creationId: copie.creation.id,
    demande: `Décline cette création en ${nom}. Garde toutes les images et tous les plans déjà fabriqués. Traduis chaque texte affiché et le texte de chaque voix, refais les voix d’essai, recale les sous-titres, puis dis-moi ce qu’il reste à valider (la voix finale passe par son bouton à prix).`,
  });
  return { creationId: copie.creation.id };
}

/* ------------------------------------------------------------------ */
/* Vers Réseaux sociaux                                                 */
/* ------------------------------------------------------------------ */

/**
 * L'EXPORT PART EN BROUILLON DANS LE SERVICE RÉSEAUX SOCIAUX : un contenu du
 * projet relié à la création — ses exports prêts y paraissent d'eux-mêmes
 * (`visuels-marketing.ts`). Une création a un seul contenu : un second envoi rend
 * le même. Rien ne se publie.
 */
export async function envoyerVersReseaux(creationId: string): Promise<Resultat<{ contenuId: string; nouveau: boolean }>> {
  const creation = lireCreation(creationId);
  if (!creation) return { ok: false, raison: 'création introuvable' };
  const { creerContenu, lireContenu } = await import('./marketing.js');
  if (creation.contenuMarketingId && lireContenu(creation.contenuMarketingId)) return { ok: true, contenuId: creation.contenuMarketingId, nouveau: false };
  const r = creerContenu({
    projectId: creation.projectId,
    genre: 'post',
    canal: 'instagram',
    titre: creation.titre,
    texte: `Vidéo « ${creation.titre} » montée au Studio : le texte de publication reste à écrire.`,
    etape: 'brouillon',
    origine: 'humain',
  });
  if (!r.ok) return { ok: false, raison: r.raison };
  getDb().prepare('UPDATE studio_creations SET contenu_marketing_id = ? WHERE id = ?').run(r.contenu.id, creationId);
  diffuserStudio(creation.projectId, creationId);
  return { ok: true, contenuId: r.contenu.id, nouveau: true };
}
