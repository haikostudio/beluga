/*
 * LE FLUX « DISCUSSIONS » DE LA MÉMOIRE : les conversations vocales en direct avec Codex, gardées en GÉNÉRAL et
 * marquées des projets dont elles parlent (décision de l'utilisateur du 15/11/2026 : « la discussion doit se
 * stocker d'un point de vue général, mais avec un flag du projet en question »).
 *
 * Seul le texte FINALISÉ de chaque tour est écrit, borné (`tourAGarder`, `TOURS_MAX_PAR_DISCUSSION`) ; jamais le
 * son, jamais les fragments. La recherche est locale, sans quota : l'outil « memoire » la rend à la suite des
 * unités, sous l'identifiant « DISC-… », et « lire » ouvre une discussion entière.
 */
import {
  DISCUSSIONS_RENDUES_MAX,
  PERTINENCE_MIN_DISCUSSION,
  TOURS_MAX_PAR_DISCUSSION,
  FENETRE_DU_RECIT_MS,
  SIGNES_MAX_PAR_TOUR,
  TOURS_PAR_PAGE_D_HISTORIQUE,
  idDeDiscussion,
  pertinenceDUneDiscussion,
  quiParle,
  type RoleDUnTourVocal,
  reunirLesMarques,
  tourAGarder,
} from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

export interface DiscussionVocale {
  numero: number;
  id: string;
  debut: number;
  fin: number | null;
  projets: string[];
  tours: number;
}

interface Ligne {
  id: number;
  debut: number;
  fin: number | null;
  projets: string;
  tours: number;
}

function lireMarques(brut: string): string[] {
  try {
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function enDiscussion(ligne: Ligne): DiscussionVocale {
  return {
    numero: ligne.id,
    id: idDeDiscussion(ligne.id),
    debut: ligne.debut,
    fin: ligne.fin,
    projets: lireMarques(ligne.projets),
    tours: ligne.tours,
  };
}

/** Ouvre une discussion neuve ; rend son numéro. */
export function ouvrirDiscussion(depart: { agentId?: string; threadId?: string; compte?: string }): number {
  const r = getDb()
    .prepare('INSERT INTO discussions_vocales (debut, agent_id, thread_id, compte) VALUES (?, ?, ?, ?)')
    .run(Date.now(), depart.agentId ?? null, depart.threadId ?? null, depart.compte ?? null);
  return Number(r.lastInsertRowid);
}

/** Une discussion reprise après une coupure : elle n'est plus close. */
export function rouvrirDiscussion(numero: number): void {
  getDb().prepare('UPDATE discussions_vocales SET fin = NULL WHERE id = ?').run(numero);
}

/** Ajoute des marques de projet à une discussion (sans doublon). */
export function marquerDiscussion(numero: number, projets: string[]): void {
  if (!projets.length) return;
  const ligne = getDb().prepare('SELECT projets FROM discussions_vocales WHERE id = ?').get(numero) as { projets: string } | undefined;
  if (!ligne) return;
  const avant = lireMarques(ligne.projets);
  const apres = reunirLesMarques(avant, projets);
  if (apres.length === avant.length) return;
  getDb().prepare('UPDATE discussions_vocales SET projets = ? WHERE id = ?').run(JSON.stringify(apres), numero);
}

/**
 * Écrit un tour FINALISÉ. Rend faux quand rien n'a été écrit (texte vide, discussion pleine ou inconnue) :
 * la session continue, seule l'écriture s'arrête.
 */
export function ajouterTour(numero: number, role: RoleDUnTourVocal, texte: string, projets: string[] = []): boolean {
  /* Une BULLE D'INFORMATION (« voix_montrer », 23/11/2026) garde ses retours à la ligne : c'est du Markdown (tableaux,
     listes) qu'on réaffiche tel quel en remontant dans la pile. */
  const propre = role === 'information' ? texteDUneInformation(texte) : tourAGarder(texte);
  if (!propre) return false;
  const ligne = getDb().prepare('SELECT tours FROM discussions_vocales WHERE id = ?').get(numero) as { tours: number } | undefined;
  if (!ligne || ligne.tours >= TOURS_MAX_PAR_DISCUSSION) return false;
  const db = getDb();
  db.transaction(() => {
    db.prepare('INSERT INTO discussions_vocales_tours (discussion_id, quand, role, texte) VALUES (?, ?, ?, ?)').run(numero, Date.now(), role, propre);
    db.prepare('UPDATE discussions_vocales SET tours = tours + 1 WHERE id = ?').run(numero);
  })();
  marquerDiscussion(numero, projets);
  return true;
}

function texteDUneInformation(texte: string): string | null {
  const net = (texte ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!net) return null;
  return net.length > SIGNES_MAX_PAR_TOUR ? `${net.slice(0, SIGNES_MAX_PAR_TOUR - 1)}…` : net;
}

/** Ferme une discussion. Une discussion sans aucun tour est retirée : il n'y a rien à retrouver. */
export function fermerDiscussion(numero: number): void {
  const db = getDb();
  const ligne = db.prepare('SELECT tours FROM discussions_vocales WHERE id = ?').get(numero) as { tours: number } | undefined;
  if (!ligne) return;
  if (!ligne.tours) {
    db.prepare('DELETE FROM discussions_vocales WHERE id = ?').run(numero);
    return;
  }
  db.prepare('UPDATE discussions_vocales SET fin = ? WHERE id = ?').run(Date.now(), numero);
}

export function lireDiscussion(numero: number): (DiscussionVocale & { echanges: { quand: number; role: string; texte: string }[] }) | null {
  const ligne = getDb().prepare('SELECT id, debut, fin, projets, tours FROM discussions_vocales WHERE id = ?').get(numero) as Ligne | undefined;
  if (!ligne) return null;
  const echanges = getDb()
    .prepare('SELECT quand, role, texte FROM discussions_vocales_tours WHERE discussion_id = ? ORDER BY id')
    .all(numero) as { quand: number; role: string; texte: string }[];
  return { ...enDiscussion(ligne), echanges };
}

/**
 * LES DERNIÈRES DISCUSSIONS D'UN AGENT, la plus récente d'abord, pour les souvenirs de la voix à l'ouverture
 * (17/11/2026). Seules celles qui ont des tours ; `sauf` écarte la discussion qu'une reprise rouvre (elle vit déjà
 * dans le fil). Filtrées par agent : la voix d'une carte ne reçoit pas les discussions de l'assistant, et l'inverse.
 */
export function dernieresDiscussions(agentId: string, limite = 3, sauf?: number): { debut: number; echanges: { quand: number; role: string; texte: string }[] }[] {
  const ids = getDb()
    .prepare('SELECT id FROM discussions_vocales WHERE agent_id = ? AND tours > 0 AND id != ? ORDER BY id DESC LIMIT ?')
    .all(agentId, sauf ?? -1, limite) as { id: number }[];
  return ids.map((l) => lireDiscussion(l.id)).filter((d): d is NonNullable<typeof d> => !!d);
}

/**
 * LES DISCUSSIONS QUI PARLENT D'UNE DEMANDE, les plus pertinentes d'abord. Toutes sont candidates (le flux est
 * général) ; celles marquées du projet de la demande passent devant à pertinence voisine. On ne lit que les
 * 300 dernières discussions : au-delà, la mémoire a déjà retenu ce qui comptait.
 */
export function chercherDiscussions(demande: string, projectId?: string, limite = DISCUSSIONS_RENDUES_MAX): (DiscussionVocale & { pertinence: number; extrait: string })[] {
  const lignes = getDb()
    .prepare('SELECT id, debut, fin, projets, tours FROM discussions_vocales WHERE tours > 0 ORDER BY id DESC LIMIT 300')
    .all() as Ligne[];
  const tours = getDb().prepare("SELECT group_concat(texte, ' ') AS texte FROM discussions_vocales_tours WHERE discussion_id = ?");
  const trouvees: (DiscussionVocale & { pertinence: number; extrait: string })[] = [];
  for (const ligne of lignes) {
    const discussion = enDiscussion(ligne);
    const texte = (tours.get(ligne.id) as { texte: string | null } | undefined)?.texte ?? '';
    const pertinence = pertinenceDUneDiscussion(demande, texte, !!projectId && discussion.projets.includes(projectId));
    if (pertinence < PERTINENCE_MIN_DISCUSSION) continue;
    trouvees.push({ ...discussion, pertinence, extrait: texte.slice(0, 220) });
  }
  return trouvees.sort((a, b) => b.pertinence - a.pertinence || b.debut - a.debut).slice(0, limite);
}

function nomsDesProjets(ids: string[]): string {
  const noms = ids.map((id) => store.getProject(id)?.name).filter(Boolean);
  return noms.length ? noms.join(', ') : 'aucun projet marqué';
}

function quand(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** Le bloc ajouté à une recherche de la mémoire : vide quand aucune discussion ne parle de la demande. */
export function rendreDiscussionsTrouvees(demande: string, projectId?: string): string {
  const trouvees = chercherDiscussions(demande, projectId);
  if (!trouvees.length) return '';
  const lignes = trouvees.map(
    (d) => `- ${d.id} · ${quand(d.debut)} · ${nomsDesProjets(d.projets)} · ${d.tours} tour(s)\n  ${d.extrait}${d.extrait.length >= 220 ? '…' : ''}`,
  );
  return `\n\nDISCUSSIONS VOCALES qui en parlent (flux « Discussions », non vérifiées — ce qui a été dit, pas un fait établi) :\n${lignes.join('\n')}\nOuvre une discussion entière avec « lire » et son « id » (DISC-…).`;
}

/** Une discussion entière, pour « memoire lire DISC-… ». */
export function texteDUneDiscussion(numero: number): string | null {
  const d = lireDiscussion(numero);
  if (!d) return null;
  const tete = `# ${d.id} — discussion vocale du ${quand(d.debut)}${d.fin ? ` au ${quand(d.fin)}` : ' (en cours)'}\nProjets : ${nomsDesProjets(d.projets)}\n`;
  const corps = d.echanges.map((e) => `${e.role === 'user' ? 'Utilisateur' : e.role === 'information' ? 'Assistant (bulle affichée)' : 'Assistant'} : ${e.texte}`).join('\n');
  return `${tete}\n${corps}`;
}

/* ------------------------------------------------------------------ */
/* Pour la voix (18/11/2026)                                            */
/* ------------------------------------------------------------------ */

/*
 * PAS DE RECHERCHE « PAR LE SENS » ICI (mesuré le 18/11/2026 sur les 60 dernières discussions de la base servie) : le
 * vectoriseur local (multilingual-e5-small) tasse tous les scores entre 0,82 et 0,86 sur des conversations parlées —
 * « la recette de la pâte à crêpes » sortait AUSSI haut qu'une vraie question (écart réduit 2,3), il aurait glissé du
 * faux contexte à Jarvis ; le modèle de tri (bge-reranker-v2-m3) distingue bien, mais met 3 à 6 s pour 20 discussions.
 * Les mots, ramenés à leur racine (`pertinenceDUneDiscussion`), restent la recherche de la voix.
 */

/** Les discussions qui parlent d'une demande, sans celle en cours (elle est déjà dans « CET APPEL, JUSQU'ICI »). */
export function chercherDiscussionsPourLaVoix(demande: string, o: { projectId?: string; limite?: number; sauf?: number } = {}): (DiscussionVocale & { pertinence: number; extrait: string })[] {
  const limite = o.limite ?? DISCUSSIONS_RENDUES_MAX;
  return chercherDiscussions(demande, o.projectId, limite + 1)
    .filter((d) => d.numero !== o.sauf)
    .slice(0, limite);
}

/** Le dernier mot d'une discussion compte : ses derniers tours, pour la note glissée à la voix. */
export function derniersEchanges(numero: number, signes = 600): string {
  const d = lireDiscussion(numero);
  if (!d) return '';
  const texte = d.echanges.map((e) => `${quiParle(e.role)} : ${e.texte}`).join(' / ');
  return texte.length > signes ? `…${texte.slice(-signes)}` : texte;
}

/* ------------------------------------------------------------------ */
/* L'historique des bulles et le récit des derniers jours (23/11/2026)  */
/* ------------------------------------------------------------------ */

export interface TourDHistorique {
  /** L'identifiant du tour (croissant dans toute la table : il sert de curseur). */
  id: number;
  discussion: number;
  /** Le début de sa discussion : la ligne de date de la pile. */
  debut: number;
  quand: number;
  role: string;
  texte: string;
}

/**
 * UNE PAGE DE L'HISTORIQUE DES BULLES (décision de l'utilisateur, 23/11/2026 : « quand je remonte, ça charge les
 * précédentes bulles ») : les tours des discussions de cet agent, du plus récent au plus ancien, avant le tour
 * `avant` (exclu). `sauf` écarte les tours de l'appel en cours (sa discussion, depuis son ouverture) : ils vivent déjà
 * dans la pile — une reprise rouvre la même discussion, dont le début reste, lui, dans l'historique. Un appel où
 * l'utilisateur n'a rien dit (le salut seul, une ouverture par erreur) n'encombre pas la pile.
 * Rendue dans l'ordre CHRONOLOGIQUE ; `fin` dit qu'il n'y a plus rien au-dessus.
 */
export function pageDHistorique(agentId: string, o: { avant?: number; limite?: number; sauf?: { discussion: number; depuis: number } } = {}): { tours: TourDHistorique[]; fin: boolean } {
  const limite = Math.max(1, Math.min(200, o.limite ?? TOURS_PAR_PAGE_D_HISTORIQUE));
  const lignes = getDb()
    .prepare(
      `SELECT t.id, t.discussion_id AS discussion, d.debut, t.quand, t.role, t.texte
         FROM discussions_vocales_tours t JOIN discussions_vocales d ON d.id = t.discussion_id
        WHERE d.agent_id = ? AND t.id < ? AND NOT (d.id = ? AND t.quand >= ?)
          AND EXISTS (SELECT 1 FROM discussions_vocales_tours u WHERE u.discussion_id = d.id AND u.role = 'user')
        ORDER BY t.id DESC LIMIT ?`,
    )
    .all(agentId, o.avant ?? Number.MAX_SAFE_INTEGER, o.sauf?.discussion ?? -1, o.sauf?.depuis ?? 0, limite + 1) as TourDHistorique[];
  const fin = lignes.length <= limite;
  return { tours: lignes.slice(0, limite).reverse(), fin };
}

/** Les discussions de cet agent ouvertes dans la fenêtre du récit (72 h), avec leurs échanges. */
export function discussionsDesDerniersJours(agentId: string, maintenant = Date.now()): { id: string; debut: number; echanges: { quand: number; role: string; texte: string }[] }[] {
  const ids = getDb()
    .prepare('SELECT id FROM discussions_vocales WHERE agent_id = ? AND tours > 0 AND debut >= ? ORDER BY id DESC LIMIT 40')
    .all(agentId, maintenant - FENETRE_DU_RECIT_MS) as { id: number }[];
  return ids.map((l) => lireDiscussion(l.id)).filter((d): d is NonNullable<typeof d> => !!d);
}
