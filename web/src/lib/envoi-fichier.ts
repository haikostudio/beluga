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

/**
 * UN ENVOI COUPÉ PAR LE RÉSEAU OU RESTÉ SANS RÉPONSE — et donc à reprendre. À
 * distinguer d'un refus du serveur (fichier trop gros, projet inconnu), que
 * rejouer ne changerait pas.
 */
export class EnvoiInterrompu extends Error {}

/**
 * Après le dernier octet envoyé, le serveur enregistre le fichier puis répond.
 * Un serveur figé ne répondait jamais : la ligne restait sur « Enregistrement… »
 * pour toujours. Passé ce délai sans réponse, l'envoi est abandonné pour être
 * repris — le serveur dédoublonne par empreinte, le fichier ne sera pas doublé.
 */
export const DELAI_REPONSE_APRES_ENVOI_MS = 90_000;

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
  let sansReponse = false;
  let veille: number | undefined;
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
    requete.upload.onload = () => {
      veille = window.setTimeout(() => {
        sansReponse = true;
        requete.abort();
      }, DELAI_REPONSE_APRES_ENVOI_MS);
    };
    requete.onload = () => {
      window.clearTimeout(veille);
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
    requete.onerror = () => {
      window.clearTimeout(veille);
      rejeter(new EnvoiInterrompu(t("L'envoi a échoué.")));
    };
    requete.onabort = () => {
      window.clearTimeout(veille);
      rejeter(
        annule
          ? new EnvoiAnnule()
          : sansReponse
            ? new EnvoiInterrompu(t('Le serveur ne répond pas.'))
            : new Error(t('Envoi interrompu.')),
      );
    };
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

/**
 * ATTEND QUE LE LIEN AVEC LE SERVEUR REVIENNE avant de reprendre un envoi
 * (`gele` dit si les gestes sont encore gelés), puis laisse une courte pause :
 * un serveur qui vient de se réveiller n'a pas besoin d'un fichier de 2 Go
 * dans la même seconde. S'arrête de toute façon au bout de `maxMs`.
 */
export async function attendreLeLien(gele: () => boolean, maxMs = 120_000): Promise<void> {
  const debut = Date.now();
  while (gele() && Date.now() - debut < maxMs) await new Promise((r) => window.setTimeout(r, 500));
  await new Promise((r) => window.setTimeout(r, 800));
}
