/**
 * LA COPIE D'APERÇU DES VIDÉOS TRANSPARENTES (Safari, iPhone).
 *
 * Ces navigateurs ne lisent pas la couche alpha d'un WebM VP9 : ils montrent son
 * fond noir, ou rien. Chaque vidéo transparente citée par une création reçoit donc
 * un média caché (`marqueDeCopieAlpha`), jamais en bibliothèque, jamais à l'export,
 * que seul l'aperçu lit (`shared/src/studio-page.ts`).
 *
 * LE RATTRAPAGE EST À LA DEMANDE : il part quand une création s'ouvre, passe par la
 * file lourde, et chaque vidéo n'est tentée qu'une fois par vie du démon — une vidéo
 * illisible ne se refabrique pas en boucle.
 */
import fs from 'node:fs';
import { marqueDeCopieAlpha } from '@beluga/shared';
import { dansLaFileLourde } from './file-lourde.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { log } from './logger.js';
import { copieAlphaDUneVideo, videoATransparence } from './studio-detourage.js';
import { ajouterMedia, diffuserStudio, fichierDuMedia, lireMedia } from './studio.js';
import { getDb } from './db.js';

export function copieAlphaExiste(videoMediaId: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM studio_medias WHERE categorie = ? LIMIT 1').get(marqueDeCopieAlpha(videoMediaId));
}

/** Fabrique et range la copie. `fichier` n'est ni déplacé ni retiré. Lève une erreur lisible en cas d'échec. */
export async function fabriquerCopieAlpha(o: { projectId: string; creationId?: string; videoMediaId: string; fichier: string; largeur?: number; hauteur?: number }): Promise<void> {
  const copie = await dansLaFileLourde(() => copieAlphaDUneVideo(o.fichier, o.largeur ?? 0, o.hauteur ?? 0));
  try {
    const jointe = await joindreUnFichier({ projectId: o.projectId, fichier: copie.chemin, nom: `copie-apercu-${o.videoMediaId}.mp4`, sansAlias: true });
    if (!jointe.ok) throw new Error(jointe.refus);
    /* Déjà là (fichier identique, deux demandes rapprochées) : rien de plus à ranger. */
    if (copieAlphaExiste(o.videoMediaId)) return;
    ajouterMedia({
      projectId: o.projectId,
      ...(o.creationId ? { creationId: o.creationId } : {}),
      genre: 'video',
      provenance: 'import',
      nom: `Copie d’aperçu — ${o.videoMediaId}`,
      attachmentId: jointe.attachment.id,
      mime: 'video/mp4',
      largeur: copie.largeur,
      hauteur: copie.hauteur,
      categorie: marqueDeCopieAlpha(o.videoMediaId),
    });
  } finally {
    fs.rmSync(copie.chemin, { force: true });
  }
}

/** Les vidéos déjà tentées, réussies ou non, opaques ou transparentes. */
const dejaVues = new Set<string>();

/** Lance en tâche de fond ce qui manque parmi les médias cités. Ne bloque jamais l'ouverture d'une création. */
export function assurerLesCopiesAlpha(creationId: string, projectId: string, mediasCites: Iterable<string>): void {
  for (const id of mediasCites) {
    if (dejaVues.has(id)) continue;
    const media = lireMedia(id);
    if (!media || media.genre !== 'video' || media.projectId !== projectId) continue;
    dejaVues.add(id);
    if (copieAlphaExiste(id)) continue;
    const fichier = fichierDuMedia(media);
    if (!fichier) continue;
    void (async () => {
      try {
        if (!(await videoATransparence(fichier))) return;
        await fabriquerCopieAlpha({ projectId, creationId, videoMediaId: id, fichier, ...(media.largeur ? { largeur: media.largeur } : {}), ...(media.hauteur ? { hauteur: media.hauteur } : {}) });
        diffuserStudio(projectId, creationId);
      } catch (err) {
        log.warn(`studio : copie d’aperçu de ${id} impossible (${String((err as Error)?.message ?? err).slice(0, 200)})`);
      }
    })();
  }
}
