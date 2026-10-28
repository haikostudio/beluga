/**
 * LES VISAGES REPÉRÉS SUR LES IMAGES D'UN PROJET (« Remplacer le visage »,
 * décision du 26/10/2026).
 *
 * Le navigateur détecte les visages d'une image une seule fois (le modèle de
 * détection tourne chez lui, à l'ouverture du panneau) et envoie le résultat ;
 * le démon le garde ici. La bibliothèque du panneau ne montre que les pièces
 * où au moins un visage a été repéré : jamais une capture de site. Une pièce
 * déjà analysée ne se redétecte pas.
 */
import { boiteDeVisage, type BoiteDeVisage } from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';

export interface VisagesDUnePiece {
  attachmentId: string;
  visages: number;
  boites: BoiteDeVisage[];
}

/** Ce qui est déjà connu pour les pièces d'un projet. */
export function visagesDuProjet(projectId: string): VisagesDUnePiece[] {
  const lignes = getDb()
    .prepare('SELECT attachment_id, visages, boites FROM visages_des_pieces WHERE project_id = ?')
    .all(projectId) as { attachment_id: string; visages: number; boites: string }[];
  return lignes.map((l) => {
    let boites: BoiteDeVisage[] = [];
    try {
      boites = (JSON.parse(l.boites) as unknown[]).map(boiteDeVisage).filter((b): b is BoiteDeVisage => !!b);
    } catch {
      /* Une ligne illisible compte pour son nombre seul. */
    }
    return { attachmentId: l.attachment_id, visages: l.visages, boites };
  });
}

/** Le navigateur a détecté : on garde, une ligne par pièce du projet (une pièce d'ailleurs est ignorée). */
export function enregistrerLesVisages(projectId: string, resultats: readonly { attachmentId: string; boites: unknown[] }[]): number {
  const db = getDb();
  const ecrire = db.prepare(
    `INSERT INTO visages_des_pieces (attachment_id, project_id, visages, boites, detecte_le) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(attachment_id) DO UPDATE SET visages = excluded.visages, boites = excluded.boites, detecte_le = excluded.detecte_le`,
  );
  let n = 0;
  db.transaction(() => {
    for (const r of resultats.slice(0, 200)) {
      const piece = store.getAttachment(r.attachmentId);
      if (!piece || piece.projectId !== projectId) continue;
      const boites = (Array.isArray(r.boites) ? r.boites : []).map(boiteDeVisage).filter((b): b is BoiteDeVisage => !!b).slice(0, 12);
      ecrire.run(r.attachmentId, projectId, boites.length, JSON.stringify(boites), Date.now());
      n += 1;
    }
  })();
  return n;
}
