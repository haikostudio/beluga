/**
 * LE MONTAGE D'UNE CARTE, CÔTÉ DÉMON (grand volet de montage, carte 3 du
 * chantier « Beluga Creative Studio », 24/10/2026).
 *
 * `ouvrirLeMontageDeLaCarte` rend la création du Studio liée à la carte — créée
 * au premier appel, en trois formats (vertical, carré, horizontal) — puis y
 * VERSE, en arrière-plan, les plans que la carte a livrés et qui n'y sont pas
 * encore : une vidéo se sépare en image muette et son (`separerImageEtSon`,
 * dans la file lourde), puis se pose à la suite des autres par `poserLExtrait`.
 * Chaque plan versé est UNE version (auteur « systeme ») : « Annuler » le
 * retire comme n'importe quel geste.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  compositionDuMontage,
  FORMATS_DU_MONTAGE,
  marqueDePlanVerse,
  plansAVerser,
  poserUnPlanDeLaCarte,
  titreDuMontage,
  type Creation,
  type MediaLivre,
  type PlanAPoser,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { mediasLivresDe } from './medias-livres.js';
import { dansLaFileLourde } from './studio-file.js';
import { ajouterMedia, compositionCourante, creationDeMontage, creerCreation, enregistrerVersion, lierLeMontageALaCarte, nouvelId } from './studio.js';

/** Les montages en train d'être nourris : deux ouvertures rapprochées ne versent pas deux fois. */
const enCours = new Map<string, Promise<number>>();

/** `versement` : le versement en cours (rend le nombre de plans versés) — l'écran n'attend pas, il se relit au signal du Studio. */
export async function ouvrirLeMontageDeLaCarte(cardId: string): Promise<{ creation: Creation; aVerser: number; versement?: Promise<number> }> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('carte introuvable');
  let creation = creationDeMontage(cardId);
  if (!creation) {
    const r = creerCreation({ projectId: carte.projectId, titre: titreDuMontage(carte.title), formats: [...FORMATS_DU_MONTAGE], composition: compositionDuMontage('9:16') });
    if (!r.ok) throw new Error(r.raison);
    lierLeMontageALaCarte(r.creation.id, cardId);
    creation = creationDeMontage(cardId)!;
  }
  const aVerser = plansAVerser(mediasLivresDe({ cardId }), plansDejaVerses(creation.id)).length;
  if (aVerser && !enCours.has(creation.id)) {
    const id = creation.id;
    const travail = verserLesPlans(id, cardId)
      .catch((err) => {
        log.warn(`montage : plans de la carte non versés (${(err as Error).message})`);
        return 0;
      })
      .finally(() => enCours.delete(id));
    enCours.set(id, travail);
  }
  const versement = enCours.get(creation.id);
  return { creation, aVerser, ...(versement ? { versement } : {}) };
}

function plansDejaVerses(creationId: string): Set<string> {
  const lignes = getDb().prepare("SELECT categorie FROM studio_medias WHERE creation_id = ? AND categorie LIKE 'plan:%'").all(creationId) as { categorie: string }[];
  return new Set(lignes.map((l) => l.categorie.slice('plan:'.length)));
}

/** Verse les plans manquants, un par un, chacun relu À CET INSTANT (un geste fait entre-temps n'est jamais écrasé). */
export async function verserLesPlans(creationId: string, cardId: string): Promise<number> {
  let verses = 0;
  for (const plan of plansAVerser(mediasLivresDe({ cardId }), plansDejaVerses(creationId))) {
    try {
      if (await verserUnPlan(creationId, plan)) verses++;
    } catch (err) {
      log.warn(`montage : plan « ${plan.sujet} » non versé (${(err as Error).message})`);
    }
  }
  return verses;
}

async function verserUnPlan(creationId: string, plan: MediaLivre): Promise<boolean> {
  const piece = store.getAttachment(plan.attachmentId);
  if (!piece) return false;
  const source = cheminDePieceJointe(piece);
  if (!fs.existsSync(source)) return false;
  const marque = marqueDePlanVerse(plan.attachmentId);
  const nom = plan.sujet || piece.name;
  const { mesurerMedia, separerImageEtSon } = await import('./studio-generation.js');
  const projectId = plan.projectId;

  let aPoser: PlanAPoser;
  if (plan.genre === 'video') {
    // L'IMAGE MUETTE ET LE SON SÉPARÉ : deux médias, deux pistes, calés au même instant.
    const { video, audio } = await dansLaFileLourde(() => separerImageEtSon(source));
    const ranger = async (chemin: string, genre: 'video' | 'audio') => {
      const jointe = await joindreUnFichier({ projectId, cardId: plan.cardId ?? undefined, fichier: chemin, nom: `${genre === 'video' ? 'image' : 'son'}-${path.parse(piece.name).name}${path.extname(chemin)}` });
      fs.rmSync(chemin, { force: true });
      if (!jointe.ok) throw new Error(jointe.refus);
      const mesure = await mesurerMedia(cheminDePieceJointe(jointe.attachment), genre);
      const media = ajouterMedia({
        projectId,
        creationId,
        genre,
        provenance: 'import',
        nom: `${genre === 'video' ? nom : `Son — ${nom}`}`,
        attachmentId: jointe.attachment.id,
        mime: genre === 'video' ? 'video/mp4' : 'audio/mp4',
        ...mesure,
        // Seule l'image porte la marque : c'est elle qui dit « ce plan est versé ».
        ...(genre === 'video' ? { categorie: marque } : {}),
        licence: 'Plan fabriqué par la carte',
      });
      return { media, duree: mesure.duree };
    };
    const image = await ranger(video, 'video');
    const son = audio ? await ranger(audio, 'audio') : null;
    aPoser = { genre: 'video', videoMediaId: image.media.id, ...(son ? { audioMediaId: son.media.id } : {}), duree: Math.round((image.duree ?? 4) * 100) / 100, nom };
  } else {
    const genre = plan.genre === 'son' ? 'audio' : 'image';
    const mesure = await mesurerMedia(source, genre);
    const media = ajouterMedia({ projectId, creationId, genre, provenance: 'import', nom, attachmentId: piece.id, mime: piece.mime, ...mesure, categorie: marque, licence: 'Plan fabriqué par la carte' });
    aPoser = genre === 'audio' ? { genre: 'son', mediaId: media.id, duree: mesure.duree ?? 4, nom } : { genre: 'image', mediaId: media.id, nom };
  }

  const actuelle = compositionCourante(creationId);
  if (!actuelle) return false;
  const r = poserUnPlanDeLaCarte(actuelle, aPoser, nouvelId);
  if (!r.ok) {
    log.warn(`montage : « ${nom} » rangé en bibliothèque mais pas posé (${r.raison})`);
    return false;
  }
  return enregistrerVersion(creationId, r.composition, `plan de la carte versé : ${r.resume}`, 'systeme').ok;
}
