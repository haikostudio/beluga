import type { FaceDetector } from '@mediapipe/tasks-vision';
import type { BoiteDeVisage } from '@beluga/shared';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';

/**
 * LA DÉTECTION DES VISAGES, DANS LE NAVIGATEUR (« Remplacer le visage »,
 * 26/10/2026).
 *
 * Le modèle de détection (BlazeFace, MediaPipe) et son moteur ne se
 * téléchargent qu'à la PREMIÈRE ouverture du panneau — jamais avec
 * l'application (contrat « un écran qu'on n'a pas ouvert ne se télécharge
 * pas ») — et viennent de l'application elle-même, sans aucun service
 * extérieur. Chaque image n'est analysée qu'une fois : le résultat part au
 * démon (`visages.ecrire`), qui le rend aux ouvertures suivantes
 * (`visages.lire`).
 *
 * Les cadres sont en FRACTIONS de l'image (0 à 1) : ils valent pour l'image
 * réduite analysée comme pour l'originale.
 */

let detecteur: Promise<FaceDetector> | null = null;

function leDetecteur(): Promise<FaceDetector> {
  if (!detecteur) {
    detecteur = (async () => {
      const [{ FaceDetector }, chargeur, binaire, modele] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        import('@mediapipe/tasks-vision/vision_wasm_internal.js?url'),
        import('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'),
        import('@/assets/modeles/blaze_face_short_range.tflite?url'),
      ]);
      return FaceDetector.createFromOptions(
        { wasmLoaderPath: chargeur.default, wasmBinaryPath: binaire.default },
        { baseOptions: { modelAssetPath: modele.default, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.55 },
      );
    })();
    /* Un échec de chargement se retente à l'ouverture suivante. */
    detecteur.catch(() => {
      detecteur = null;
    });
  }
  return detecteur;
}

function chargerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => ok(image);
    image.onerror = () => ko(new Error('image illisible'));
    image.src = src;
  });
}

/** Les visages d'une pièce jointe image, du plus à gauche au plus à droite. */
export async function detecterLesVisages(attachmentId: string): Promise<BoiteDeVisage[]> {
  const [d, image] = await Promise.all([leDetecteur(), chargerImage(adresseDePiece(attachmentId, false, 640))]);
  const l = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!l || !h) return [];
  const { detections } = d.detect(image);
  return detections
    .map((detection) => detection.boundingBox)
    .filter((b): b is NonNullable<typeof b> => !!b && b.width > 0 && b.height > 0)
    .map((b) => {
      const x = Math.max(0, b.originX / l);
      const y = Math.max(0, b.originY / h);
      return { x, y, largeur: Math.min(1 - x, b.width / l), hauteur: Math.min(1 - y, b.height / h) };
    })
    .sort((a, b) => a.x - b.x);
}

/** Ce que le démon sait déjà des pièces d'un projet. */
export async function visagesConnus(projectId: string): Promise<Map<string, BoiteDeVisage[]>> {
  const r = await client.call<{ pieces: { attachmentId: string; boites: BoiteDeVisage[] }[] }>({ type: 'visages.lire', projectId });
  return new Map((r.pieces ?? []).map((p) => [p.attachmentId, p.boites]));
}

/** Analyse les pièces encore inconnues, une à une, et garde les résultats au démon. */
export async function analyserLesPieces(
  projectId: string,
  pieces: readonly string[],
  surChaque?: (attachmentId: string, boites: BoiteDeVisage[]) => void,
  vivant: () => boolean = () => true,
): Promise<void> {
  const resultats: { attachmentId: string; boites: BoiteDeVisage[] }[] = [];
  const envoyer = async () => {
    if (!resultats.length) return;
    const lot = resultats.splice(0, resultats.length);
    await client.call({ type: 'visages.ecrire', projectId, resultats: lot }).catch(() => {});
  };
  for (const id of pieces) {
    if (!vivant()) break;
    const boites = await detecterLesVisages(id).catch(() => null);
    if (boites === null) continue;
    resultats.push({ attachmentId: id, boites });
    surChaque?.(id, boites);
    if (resultats.length >= 8) await envoyer();
  }
  await envoyer();
}
