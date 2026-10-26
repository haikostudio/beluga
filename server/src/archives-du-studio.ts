import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { rangerLaCarte } from './deplacement-carte.js';

/**
 * LES ARCHIVES DU STUDIO (décision de l'utilisateur du 26/10/2026) : le Studio
 * est retiré, ses créations ne sont jamais effacées. UNE fois, au démarrage, le
 * démon pose dans le projet de l'application une carte « Archives du Studio »
 * qui porte, dans un commentaire, chaque vidéo exportée PRÊTE (une pièce jointe
 * par fichier, même fichier jamais deux fois) et la liste des créations, puis la range dans
 * « Archivé » — geste de code assumé, sans date de mise en ligne
 * (`beluga-aucune-archive-automatique`). Les tables `studio_*` restent en base,
 * lues ici seulement.
 */

const CLE = 'archives-du-studio';

interface LigneExport {
  attachment_id: string;
  format: string;
  titre: string;
  projet: string | null;
  cree_le: number;
}

/** Le projet de l'application elle-même : celui qui vit dans le dépôt du démon. */
function projetDeLApplication() {
  const depot = path.resolve(CONFIG.depotDuDemon);
  return store.listProjects().find((p) => path.resolve(p.path) === depot) ?? null;
}

export async function rangerLesArchivesDuStudio(): Promise<{ cardId: string; videos: number } | null> {
  if (getMeta(CLE)) return null;
  let lignes: LigneExport[] = [];
  let creations: { titre: string; projet: string | null; exports: number }[] = [];
  try {
    const db = getDb();
    lignes = db
      .prepare(
        `SELECT e.attachment_id, e.format, c.titre, p.name AS projet, e.cree_le
           FROM studio_exports e JOIN studio_creations c ON c.id = e.creation_id LEFT JOIN projects p ON p.id = c.project_id
          WHERE e.etat = 'pret' AND e.attachment_id IS NOT NULL ORDER BY e.cree_le`,
      )
      .all() as LigneExport[];
    creations = db
      .prepare(
        `SELECT c.titre, p.name AS projet, (SELECT COUNT(*) FROM studio_exports e WHERE e.creation_id = c.id AND e.etat = 'pret') AS exports
           FROM studio_creations c LEFT JOIN projects p ON p.id = c.project_id ORDER BY c.cree_le`,
      )
      .all() as { titre: string; projet: string | null; exports: number }[];
  } catch {
    setMeta(CLE, 'aucune table');
    return null;
  }
  if (!creations.length) {
    setMeta(CLE, 'rien a archiver');
    return null;
  }
  const projet = projetDeLApplication();
  if (!projet) return null;
  const { createCard } = await import('./tools.js');
  const carte = createCard(projet.id, {
    title: 'Archives du Studio',
    description: [
      'Le Studio a été retiré le 26/10/2026 : ses créations sont gardées ici. Chaque vidéo exportée est jointe à cette carte et se télécharge d’un clic.',
      '',
      ...creations.map((c) => `- « ${c.titre} » (${c.projet ?? 'projet retiré'}) : ${c.exports} vidéo(s) exportée(s)`),
      '',
      'Les créations, leurs versions et leurs réglages restent en base, intacts. Les vidéos se créent désormais avec le directeur artistique d’une carte (bouton caméra).',
    ].join('\n'),
    origin: 'agent',
  } as Parameters<typeof createCard>[1]);
  const jointes: string[] = [];
  const dejaVues = new Set<string>();
  for (const l of lignes) {
    if (dejaVues.has(l.attachment_id)) continue;
    dejaVues.add(l.attachment_id);
    const piece = store.getAttachment(l.attachment_id);
    const fichier = piece ? cheminDePieceJointe(piece) : null;
    if (!fichier || !fs.existsSync(fichier)) continue;
    try {
      const nom = `${l.titre} — ${l.projet ?? 'projet'} — ${l.format.replace(':', 'x')}${path.extname(piece!.name) || '.mp4'}`;
      const j = await joindreUnFichier({ projectId: projet.id, cardId: carte.id, fichier, nom, deLAgent: true });
      if (j.ok && !jointes.includes(j.attachment.id)) jointes.push(j.attachment.id);
    } catch (err) {
      log.warn('archives du Studio : une vidéo n’a pas pu être jointe', String((err as Error)?.message ?? err));
    }
  }
  /* LES VIDÉOS DANS L'ONGLET « COMMENTAIRES » de la carte : chacune s'y ouvre et s'y télécharge d'un clic. */
  store.addCardComment({
    id: store.newId(),
    cardId: carte.id,
    projectId: projet.id,
    text: `Les ${jointes.length} vidéo(s) exportée(s) par le Studio avant son retrait.`,
    attachmentIds: jointes,
    createdAt: Date.now(),
  });
  const rangee = rangerLaCarte(store.getCard(carte.id) ?? carte, 'archived', undefined, Date.now());
  bus.emit({ type: 'card.upsert', card: rangee });
  setMeta(CLE, rangee.id);
  log.info(`archives du Studio : carte ${rangee.id} rangée avec ${jointes.length} vidéo(s)`);
  return { cardId: rangee.id, videos: jointes.length };
}
