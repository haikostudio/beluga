/**
 * LES MÉDIAS LIVRÉS, CÔTÉ DÉMON : la trace DURABLE de chaque média fini.
 *
 * Les blocs de fabrication (`medias-en-fabrication.ts`) vivent en mémoire et ne
 * restent au bas du fil que jusqu'au message suivant. Ici, chaque image, vidéo
 * ou son terminé avec sa pièce jointe est écrit en base, rattaché à sa carte ou
 * à son agent, avec son groupe (le plan, le sujet), sa version et la phrase de
 * l'agent : l'écran en fait une ligne du fil chacun, à son heure
 * (`shared/src/medias-livres.ts`), après un redémarrage comme des semaines
 * plus tard.
 */
import { groupeDuMedia, mediasLivres, type MediaEnFabrication, type MediaLivre } from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

interface Ligne {
  id: string;
  project_id: string;
  card_id: string | null;
  agent_id: string | null;
  attachment_id: string;
  genre: MediaLivre['genre'];
  groupe: string;
  version: number;
  sujet: string;
  outil: string;
  legende: string | null;
  livre_le: number;
}

const versMedia = (l: Ligne): MediaLivre => ({
  id: l.id,
  projectId: l.project_id,
  cardId: l.card_id,
  agentId: l.agent_id,
  attachmentId: l.attachment_id,
  genre: l.genre,
  groupe: l.groupe,
  version: l.version,
  sujet: l.sujet,
  outil: l.outil,
  legende: l.legende ?? '',
  livreLe: l.livre_le,
});

/**
 * Un média vient d'être fini : il entre dans la liste de sa discussion. Une
 * même pièce n'entre qu'une fois. Jamais bloquant : une panne d'écriture se
 * journalise, la fabrication reste réussie.
 */
export function enregistrerUnMediaLivre(m: MediaEnFabrication): MediaLivre | null {
  if (m.etat !== 'fini' || !m.attachmentId || (!m.cardId && !m.agentId)) return null;
  try {
    const db = getDb();
    const deja = db.prepare('SELECT * FROM medias_livres WHERE attachment_id = ?').get(m.attachmentId) as Ligne | undefined;
    if (deja) return versMedia(deja);
    const groupe = groupeDuMedia(m.sujet);
    const { n } = (
      m.cardId
        ? db.prepare('SELECT COUNT(*) AS n FROM medias_livres WHERE card_id = ? AND groupe = ?').get(m.cardId, groupe)
        : db.prepare('SELECT COUNT(*) AS n FROM medias_livres WHERE card_id IS NULL AND agent_id = ? AND groupe = ?').get(m.agentId, groupe)
    ) as { n: number };
    const ligne: Ligne = {
      id: store.newId(),
      project_id: m.projectId,
      card_id: m.cardId ?? null,
      agent_id: m.agentId ?? null,
      attachment_id: m.attachmentId,
      genre: m.genre,
      groupe,
      version: n + 1,
      sujet: m.sujet,
      outil: m.outil,
      legende: m.legende ?? '',
      livre_le: m.fin ?? Date.now(),
    };
    db.prepare(
      `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le)
       VALUES (@id, @project_id, @card_id, @agent_id, @attachment_id, @genre, @groupe, @version, @sujet, @outil, @legende, @livre_le)`,
    ).run(ligne);
    return versMedia(ligne);
  } catch (err) {
    log.warn(`médias livrés : « ${m.sujet} » non enregistré (${(err as Error).message})`);
    return null;
  }
}

/** Les médias livrés d'une carte, ou d'une conversation d'agent sans carte, rangés. */
export function mediasLivresDe(ou: { cardId?: string; agentId?: string }): MediaLivre[] {
  try {
    const lignes = (
      ou.cardId
        ? getDb().prepare('SELECT * FROM medias_livres WHERE card_id = ? ORDER BY livre_le LIMIT 500').all(ou.cardId)
        : ou.agentId
          ? getDb().prepare('SELECT * FROM medias_livres WHERE card_id IS NULL AND agent_id = ? ORDER BY livre_le LIMIT 500').all(ou.agentId)
          : []
    ) as Ligne[];
    return mediasLivres(lignes.map(versMedia));
  } catch {
    return [];
  }
}
