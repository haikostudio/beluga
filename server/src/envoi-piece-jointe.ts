/**
 * RECEVOIR UNE PIÈCE JOINTE AU FIL DE L'EAU.
 *
 * Une vidéo de 2 Go ne tient pas en mémoire : le corps de la requête est donc
 * écrit MORCEAU PAR MORCEAU dans un fichier provisoire (`.envoi-<id>.part`) du
 * dossier d'écriture, pendant que son empreinte se calcule en passant. Ce n'est
 * qu'à la fin, corps reçu en entier, que le fichier prend son vrai nom — un
 * envoi annulé ou coupé ne laisse donc jamais de pièce à moitié écrite : le
 * provisoire est effacé.
 *
 * Le plafond (`TAILLE_MAX_PIECE_JOINTE`) se juge deux fois : sur la taille
 * annoncée, avant de lire quoi que ce soit, puis au fil de la lecture.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { TAILLE_MAX_PIECE_JOINTE, jugerTaillePieceJointe, tailleAnnoncee, tailleLisible } from '@beluga/shared';

export type Reception =
  | { ok: true; provisoire: string; taille: number; sha: string }
  | { ok: false; statut: number; raison: string };

export const PREFIXE_PROVISOIRE = '.envoi-';

export async function recevoirAuFilDeLEau(
  req: http.IncomingMessage,
  dossier: string,
  id: string,
  max = TAILLE_MAX_PIECE_JOINTE,
): Promise<Reception> {
  const annonce = jugerTaillePieceJointe(tailleAnnoncee(req.headers['content-length']), max);
  if (!annonce.ok) {
    req.resume();
    return { ok: false, statut: 413, raison: annonce.raison };
  }

  const provisoire = path.join(dossier, `${PREFIXE_PROVISOIRE}${id}.part`);
  const empreinte = crypto.createHash('sha256');
  let taille = 0;
  let depasse = false;
  const compteur = new Transform({
    transform(morceau: Buffer, _enc, suite) {
      taille += morceau.length;
      if (taille > max) {
        depasse = true;
        suite(new Error('plafond dépassé'));
        return;
      }
      empreinte.update(morceau);
      suite(null, morceau);
    },
  });

  try {
    await pipeline(req, compteur, fs.createWriteStream(provisoire));
  } catch (err: any) {
    fs.rmSync(provisoire, { force: true });
    if (depasse) {
      return { ok: false, statut: 413, raison: `Fichier trop volumineux : la limite est de ${tailleLisible(max)}.` };
    }
    // Un envoi annulé par l'écran coupe la connexion : rien à répondre de plus.
    return { ok: false, statut: 499, raison: `envoi interrompu (${err?.code ?? err?.message ?? 'inconnu'})` };
  }
  return { ok: true, provisoire, taille, sha: empreinte.digest('hex') };
}

/**
 * Les provisoires orphelins (démon coupé en plein envoi) de plus d'un jour
 * sont effacés au démarrage. Aucun envoi ne dure vingt-quatre heures.
 */
export function effacerProvisoiresOublies(dossiers: string[], maintenant = Date.now()): number {
  let effaces = 0;
  for (const dossier of dossiers) {
    let noms: string[] = [];
    try {
      noms = fs.readdirSync(dossier).filter((nom) => nom.startsWith(PREFIXE_PROVISOIRE));
    } catch {
      continue;
    }
    for (const nom of noms) {
      const chemin = path.join(dossier, nom);
      try {
        if (maintenant - fs.statSync(chemin).mtimeMs > 24 * 3600_000) {
          fs.rmSync(chemin, { force: true });
          effaces += 1;
        }
      } catch {
        /* déjà parti */
      }
    }
  }
  return effaces;
}
