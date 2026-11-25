/**
 * LE SUIVI D'UNE DEMANDE, VU PAR LE CLIENT — règles pures, sans base ni disque.
 *
 * Deux questions que l'espace client se pose à chaque affichage :
 *
 *   1. OÙ VOIR MON SITE ? Le client ne retient qu'une adresse : celle de son
 *      espace. Le bouton « Voir mon site » de l'entête lui ouvre la version en
 *      ligne (ce que voient ses visiteurs) et la version de travail (ce qui
 *      attend sa vérification), lues sur le projet (`adresseProduction`,
 *      `devUrl`). La version de travail est gardée (`garde-acces.ts`) mais
 *      laisse passer un client déjà connecté à son espace : un simple lien suffit.
 *
 *   2. OÙ EN EST MA DEMANDE ? La frise de la fiche (Reçue → En cours → À vérifier
 *      → En ligne) se calcule à partir de deux sources : la COLONNE de la demande,
 *      que Haiko déplace à la main, et l'AVANCEMENT de la carte liée, noté dans
 *      l'historique (`avancement` : demarree, terminee, en-ligne). Le signal le
 *      plus récent l'emporte — sauf la mise en ligne, qu'un simple rangement dans
 *      « Terminé » ou « Validé » n'efface pas.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* 1. Les deux versions du site                                          */
/* ------------------------------------------------------------------ */

export interface SitesDuProjet {
  /** Ce que voient les visiteurs. */
  enLigne?: string;
  /** Les changements à vérifier avant leur mise en ligne. */
  travail?: string;
  /**
   * LES VERSIONS DONT L'ACCÈS ADMINISTRATEUR EST NOTÉ (`shared/src/acces-clients.ts`) : de simples booléens, jamais
   * le secret. Vrai = le clic du client ouvre la fenêtre des accès au lieu du site. Ajoutés par `espace.etat`.
   */
  accesNotes?: { enLigne?: boolean; travail?: boolean };
}

/**
 * UNE ADRESSE PROPRE, OU RIEN. Un champ de réglage saisi à la main porte
 * parfois un espace, un « / » final ou pas de protocole : on rend toujours
 * `https://hote[/chemin]`, sans barre finale. Tout ce qui n'est pas du web
 * (mailto:, ftp:, texte libre) est écarté plutôt qu'offert en lien.
 */
export function adresseDeSite(brute: string | null | undefined): string | undefined {
  const texte = (brute ?? '').trim();
  if (!texte) return undefined;
  const avecProtocole = /^[a-z][a-z0-9+.-]*:/i.test(texte) ? texte : `https://${texte}`;
  let url: URL;
  try {
    url = new URL(avecProtocole);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!url.hostname || !url.hostname.includes('.')) return undefined;
  const chemin = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${chemin}${url.search}`;
}

/** L'hôte seul, pour l'afficher sous le libellé : « projetd.com ». */
export function hoteDuSite(adresse: string): string {
  try {
    return new URL(adresse).host;
  } catch {
    return adresse;
  }
}

/**
 * LES DEUX VERSIONS D'UN PROJET. Quand les deux réglages désignent la même
 * adresse (un projet sans version de travail séparée), on n'en garde qu'une —
 * la version en ligne : deux entrées identiques dans le menu feraient croire à
 * deux sites.
 */
export function sitesDuProjet(projet: { devUrl?: string | null; adresseProduction?: string | null } | null | undefined): SitesDuProjet {
  if (!projet) return {};
  const enLigne = adresseDeSite(projet.adresseProduction);
  const travail = adresseDeSite(projet.devUrl);
  if (enLigne && travail && enLigne.toLowerCase() === travail.toLowerCase()) return { enLigne };
  return { ...(enLigne ? { enLigne } : {}), ...(travail ? { travail } : {}) };
}

/* ------------------------------------------------------------------ */
/* 2. L'étape d'une demande                                              */
/* ------------------------------------------------------------------ */

export const ETAPES_DE_DEMANDE = ['recue', 'en-cours', 'a-verifier', 'en-ligne'] as const;
export type EtapeDeDemande = (typeof ETAPES_DE_DEMANDE)[number];

export interface SuiviDeDemande {
  etape: EtapeDeDemande;
  /** La demande est dans « Validé » : l'étape « À vérifier » se lit « Validée », cochée. */
  validee: boolean;
  /** Depuis quand (ms) : la date du signal qui a décidé l'étape. */
  depuis: number;
}

/** Le rang de chaque colonne dans la frise. « Validé » reste au rang de la vérification, cochée. */
const RANG_DE_COLONNE: Record<string, number> = { 'a-faire': 0, 'en-cours': 1, termine: 2, valide: 2 };
/** Le rang de chaque étape de la carte liée (`ETAPES_CARTE_LIEE`). */
const RANG_D_AVANCEMENT: Record<string, number> = { demarree: 1, terminee: 2, 'en-ligne': 3 };

/**
 * L'ÉTAPE DE LA DEMANDE, pour la frise de sa fiche.
 *
 * - Sans aucun signal (ni déplacement, ni avancement) : la colonne décide.
 * - L'avancement le plus récent de la carte liée l'emporte sur un déplacement
 *   plus ancien : une carte lancée dit « En cours » même si personne n'a encore
 *   glissé la vignette.
 * - Un déplacement plus récent l'emporte sur l'avancement — un retour dans
 *   « À faire » ou « En cours » rouvre le travail —, SAUF la mise en ligne, que
 *   ranger la vignette dans « Terminé » ou « Validé » ne défait pas.
 */
export function suiviDeLaDemande(
  demande: { colonne: string; creeeLe: number },
  activites: readonly { genre: string; detail?: string; creeLe: number }[],
): SuiviDeDemande {
  const validee = demande.colonne === 'valide';
  const rangColonne = RANG_DE_COLONNE[demande.colonne] ?? 0;
  let dernierDeplacement: { creeLe: number } | null = null;
  let dernierAvancement: { rang: number; creeLe: number } | null = null;
  let miseEnLigne: { creeLe: number } | null = null;
  for (const activite of activites) {
    if (activite.genre === 'deplacement') {
      if (!dernierDeplacement || activite.creeLe >= dernierDeplacement.creeLe) dernierDeplacement = activite;
    } else if (activite.genre === 'avancement') {
      const rang = RANG_D_AVANCEMENT[activite.detail ?? ''];
      if (rang === undefined) continue;
      if (!dernierAvancement || activite.creeLe >= dernierAvancement.creeLe) dernierAvancement = { rang, creeLe: activite.creeLe };
      if (rang === 3 && (!miseEnLigne || activite.creeLe >= miseEnLigne.creeLe)) miseEnLigne = activite;
    }
  }

  let rang = rangColonne;
  let depuis = dernierDeplacement?.creeLe ?? demande.creeeLe;
  if (dernierAvancement && dernierAvancement.creeLe >= (dernierDeplacement?.creeLe ?? 0)) {
    rang = dernierAvancement.rang;
    depuis = dernierAvancement.creeLe;
  } else if (miseEnLigne && rangColonne >= 2) {
    rang = 3;
    depuis = miseEnLigne.creeLe;
  }
  return { etape: ETAPES_DE_DEMANDE[rang]!, validee, depuis };
}

/* ------------------------------------------------------------------ */
/* 3. Le résumé « Ce qui a changé »                                      */
/* ------------------------------------------------------------------ */

/*
 * LE RÉSUMÉ EST PRÉPARÉ, PUIS ENVOYÉ PAR HAIKO D'UN CLIC (décision de l'utilisateur, 24/11/2026 : « ça doit s'ajouter
 * dans la discussion de la tâche et je dois valider son envoi »). Il vit dans sa PROPRE table (`demande_resumes`),
 * jamais dans le bloc d'une demande : `espace.demande` est diffusé aux clients, un brouillon y fuirait. Seul un
 * administrateur le lit ; à l'envoi, il devient un commentaire ordinaire de la demande.
 */
export const ETATS_RESUME_CLIENT = ['pret', 'envoye', 'ecarte'] as const;
export const EtatResumeClient = z.enum(ETATS_RESUME_CLIENT);
export type EtatResumeClient = z.infer<typeof EtatResumeClient>;

export const ResumeClient = z.object({
  id: z.string(),
  demandeId: z.string(),
  carteId: z.string().optional(),
  texte: z.string(),
  etat: EtatResumeClient,
  creeLe: z.number(),
  modifieLe: z.number(),
  envoyeLe: z.number().optional(),
  messageId: z.string().optional(),
});
export type ResumeClient = z.infer<typeof ResumeClient>;

/** Un résumé tient en quelques phrases : au-delà, c'est un compte rendu technique qui s'est trompé de destinataire. */
export const RESUME_CLIENT_MAX = 1500;

/**
 * LE TEXTE DU BROUILLON, À LA FIN DU TRAVAIL D'UNE CARTE LIÉE : le résumé rédigé pour le client par l'agent s'il
 * existe, sinon l'explication du journal des changements (déjà écrite pour quelqu'un qui ne programme pas), sinon
 * rien — un brouillon vide que Haiko rédige lui-même.
 */
export function texteDuBrouillonDeResume(resumeClient?: string | null, explication?: string | null): string {
  const texte = (resumeClient ?? '').trim() || (explication ?? '').trim();
  return texte.slice(0, RESUME_CLIENT_MAX);
}
