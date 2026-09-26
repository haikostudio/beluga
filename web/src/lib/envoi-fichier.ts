/**
 * L'ENVOI D'UN FICHIER, AVEC SA VRAIE PROGRESSION ET SON ANNULATION.
 *
 * `fetch` ne dit rien de l'avancement d'un téléversement : une barre nourrie
 * par lui serait une animation décorative. On passe donc par `XMLHttpRequest`,
 * dont l'événement `upload.onprogress` donne les octets réellement partis, et
 * dont `abort()` coupe la connexion — le démon efface alors son fichier
 * provisoire (`server/src/envoi-piece-jointe.ts`).
 *
 * Le plafond de 2 Go est jugé AVANT de partir : inutile de téléverser
 * 1,9 Go pour se voir refuser à l'arrivée.
 */
import type { Attachment } from '@beluga/shared';
import { jugerTaillePieceJointe } from '@beluga/shared';
import { t } from './langue';

export class EnvoiAnnule extends Error {
  constructor() {
    super(t('Envoi annulé.'));
  }
}

export interface EnvoiEnCours {
  promesse: Promise<Attachment>;
  annuler: () => void;
}

export function envoyerFichier(
  url: string,
  fichier: File,
  surProgression: (part: number, octets: number) => void,
): EnvoiEnCours {
  const requete = new XMLHttpRequest();
  let annule = false;
  const promesse = new Promise<Attachment>((resoudre, rejeter) => {
    const taille = jugerTaillePieceJointe(fichier.size);
    if (!taille.ok) {
      rejeter(new Error(t('Fichier trop volumineux ({nom}) : la limite est de 2 Go.', { nom: fichier.name })));
      return;
    }
    requete.open('POST', url);
    requete.setRequestHeader('content-type', fichier.type || 'application/octet-stream');
    requete.setRequestHeader('x-file-name', encodeURIComponent(fichier.name));
    requete.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) surProgression(e.loaded / e.total, e.loaded);
    };
    requete.onload = () => {
      let corps: { attachment?: Attachment; error?: string } = {};
      try {
        corps = JSON.parse(requete.responseText);
      } catch {
        /* réponse illisible : traitée plus bas */
      }
      if (requete.status < 200 || requete.status >= 300 || !corps.attachment) {
        rejeter(new Error(corps.error ?? t("L'envoi a échoué ({statut}).", { statut: requete.status })));
        return;
      }
      surProgression(1, fichier.size);
      resoudre(corps.attachment);
    };
    requete.onerror = () => rejeter(new Error(t("L'envoi a échoué.")));
    requete.onabort = () => rejeter(annule ? new EnvoiAnnule() : new Error(t('Envoi interrompu.')));
    requete.send(fichier);
  });
  return {
    promesse,
    annuler: () => {
      annule = true;
      requete.abort();
    },
  };
}
