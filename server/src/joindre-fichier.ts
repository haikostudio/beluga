/**
 * RANGER UN FICHIER EN PIÈCE JOINTE — UNE SEULE FOIS POUR TOUS LES CHEMINS.
 *
 * L'outil `attach_file` (l'agent joint lui-même un fichier) et la détection
 * automatique des captures (`server/src/captures-auto.ts`) passent par cette
 * fonction : même plafond de poids, même dédoublonnage par empreinte, même
 * dossier de stockage, même événement vers l'interface. Un fichier déjà connu du
 * projet (même contenu) rend la pièce existante, sans second exemplaire.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Attachment, aliasDePieceJointe, mimeDuFichier, nomSansCollision, nomSurDisque, refusDeTaille } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { dossierDEcriture } from './pieces-jointes.js';

export type ResultatDeJointure =
  | { ok: true; attachment: Attachment; taille: number; nouvelle: boolean }
  | { ok: false; refus: string };

/** Un fichier encore en cours d'écriture grossit : on attend qu'il ne bouge plus. */
async function attendreUneTailleStable(fichier: string, essais = 10, pauseMs = 150): Promise<number> {
  let taille = (await fs.promises.stat(fichier)).size;
  for (let i = 0; i < essais; i++) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const maintenant = (await fs.promises.stat(fichier)).size;
    if (maintenant === taille) return taille;
    taille = maintenant;
  }
  return taille;
}

export async function joindreUnFichier(opts: {
  projectId: string;
  agentId: string;
  cardId?: string;
  /** Chemin absolu d'un fichier déjà vérifié par l'appelant (racines autorisées). */
  fichier: string;
  /** Le nom donné à la pièce ; à défaut, celui du fichier. */
  nom?: string;
  /** Attendre que le fichier cesse de grossir (capture détectée en plein tour). */
  attendreStable?: boolean;
}): Promise<ResultatDeJointure> {
  const { fichier } = opts;
  const mime = mimeDuFichier(fichier);
  /* LE SEUL REFUS EST LE POIDS : le fichier est recopié entier en mémoire. */
  const poids = opts.attendreStable ? await attendreUneTailleStable(fichier) : (await fs.promises.stat(fichier)).size;
  const refus = refusDeTaille(poids);
  if (refus) return { ok: false, refus };
  const data = await fs.promises.readFile(fichier);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const existant = store.findAttachmentBySha(opts.projectId, sha);
  if (existant) return { ok: true, attachment: existant, taille: data.length, nouvelle: false };

  const conversation = opts.cardId ?? opts.agentId;
  const dejaUtilises = store
    .listAttachments(opts.projectId)
    .filter((a) => (a.cardId ?? a.agentId) === conversation)
    .map((a) => a.name);
  const id = store.newId();
  const attachment = Attachment.parse({
    id,
    alias: aliasDePieceJointe(id, store.aliasDesPiecesJointes()),
    projectId: opts.projectId,
    name: nomSansCollision(opts.nom?.trim() || path.basename(fichier), dejaUtilises),
    mime,
    size: data.length,
    sha,
    cardId: opts.cardId,
    agentId: opts.agentId,
    createdAt: Date.now(),
  });
  await fs.promises.writeFile(path.join(dossierDEcriture(), nomSurDisque(attachment)), data);
  store.saveAttachment(attachment);
  bus.emit({ type: 'attachments', projectId: opts.projectId, items: store.listAttachments(opts.projectId) });
  return { ok: true, attachment, taille: data.length, nouvelle: true };
}
