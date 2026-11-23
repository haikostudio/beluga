/*
 * LE TRANSFERT D'UNE INSTALLATION GRATUITE VERS L'OFFRE HÉBERGÉE (carte « Fin de la version gratuite », 21/11/2026).
 *
 * LOGICIEL LIBRE (23/11/2026) : l'installation gratuite reste complète et reçoit les nouveautés ; le transfert est un
 * CHOIX. La section « Passer à Beluga Cloud » (réglages › Mise à jour), ouverte d'un clic, mesure l'espace, affiche la
 * formule que le CENTRAL conseille, puis — une fois l'abonnement payé — emballe tout l'espace et l'envoie vers le serveur
 * hébergé du client.
 *
 * C'EST UN CONTRAT AVEC LE CENTRAL (dépôt belugabuild, `central/src/relais.ts`), servi sur la même adresse que le relais
 * des installations : l'installation s'y présente par SON numéro et SON secret de relais (`relais-installations.ts`),
 * jamais par un compte. Les deux côtés tiennent ces routes et ces formes à l'identique :
 *
 *  1. `POST /relais/transfert/proposition` — `DemandeDeProposition` → `PropositionDuCentral` : la formule conseillée
 *     (la plus petite où tiennent les projets actifs et le volume), son prix, le lien d'abonnement et un jeton de
 *     transfert. Le calcul de la formule vit au central (`regles/formules.ts`, `projetsTiennent`) ; l'écran n'affiche
 *     que ce qu'il rend.
 *  2. `POST /relais/transfert/etat` — `LectureDuTransfert` → `EtatDuTransfert` : « attente-paiement » tant que
 *     l'abonnement n'est pas payé, puis « pret » (le serveur hébergé est monté et attend le paquet), « recu », « echec ».
 *  3. `POST /relais/transfert/morceau?jeton=…&rang=…&total=…` — le paquet, par morceaux de `TAILLE_D_UN_MORCEAU`
 *     octets (corps brut), entêtes `x-beluga-installation` et `x-beluga-secret`. Un morceau déjà reçu se renvoie sans
 *     dommage (même rang = même contenu).
 *  4. `POST /relais/transfert/fin` — `FinDuTransfert` → `{ adresse }` : la taille et l'empreinte SHA-256 du paquet
 *     entier ; le central les vérifie avant de le poser sur le serveur hébergé.
 *
 * LE PAQUET est le format INVERSE de « Emporter mon espace » (`central/src/hote/agent.py`, `_fabriquer_archive`) : un
 * `.tar` qui contient `manifeste.json` (`ManifesteDuTransfert`, `format: 1`, `origine: "installation-gratuite"`),
 * la base recopiée à chaud, cohérente (`manifeste.contenu.base`, à poser dans `data/`), et `espace.tar.gz`, où `data/`
 * est le dossier des données SANS la base vive et `projets/<dossier>/` chaque dossier de projet rangé hors de `data/`. Le serveur hébergé remet `data/` à sa place et les projets sous son
 * dossier des projets, en suivant `manifeste.contenu.projets`. Le logiciel ne voyage pas : il est déjà sur le serveur.
 */

import { z } from 'zod';

export const ROUTES_DU_TRANSFERT = {
  proposition: '/relais/transfert/proposition',
  etat: '/relais/transfert/etat',
  morceau: '/relais/transfert/morceau',
  fin: '/relais/transfert/fin',
} as const;

/** 8 Mio par morceau : assez gros pour aller vite, assez petit pour qu'un raté ne coûte presque rien. */
export const TAILLE_D_UN_MORCEAU = 8 * 1024 * 1024;

/** L'attente du paiement, au plus : au-delà, le travail s'arrête et le bouton se reclique. */
export const ATTENTE_DU_PAIEMENT_MS = 2 * 60 * 60 * 1000;

/** Ce que l'installation mesure d'elle-même, avant toute proposition. */
export const MesureDeLEspace = z.object({
  /** Les projets ACTIFS (ni archivés, ni mis de côté), hors projet de l'outil lui-même. */
  projetsActifs: z.number().int().min(0),
  /** Le volume à transférer, en octets : les données et les dossiers des projets actifs. */
  octets: z.number().int().min(0),
});
export type MesureDeLEspace = z.infer<typeof MesureDeLEspace>;

export const DemandeDeProposition = MesureDeLEspace.extend({
  installation: z.string(),
  secret: z.string(),
  version: z.string().max(80).default(''),
  /** Seulement si l'administrateur a accepté de la partager (`courrielAPartager`). */
  courriel: z.string().max(200).optional(),
});
export type DemandeDeProposition = z.infer<typeof DemandeDeProposition>;

export const PropositionDuCentral = z.object({
  formule: z.object({
    id: z.string(),
    nom: z.string(),
    /** Prix mensuel en euros, TTC, tel que le central l'affiche. */
    prixMensuel: z.number(),
    projets: z.number(),
    /** Le stockage compris, en Go. */
    go: z.number(),
  }),
  /** L'option de stockage ajoutée quand le volume dépasse la formule. */
  stockage: z.object({ to: z.number(), prixMensuel: z.number() }).optional(),
  /** L'adresse où l'on s'abonne : elle porte déjà le jeton. */
  lien: z.string().url(),
  jeton: z.string().min(16).max(200),
});
export type PropositionDuCentral = z.infer<typeof PropositionDuCentral>;

export const LectureDuTransfert = z.object({ installation: z.string(), secret: z.string(), jeton: z.string() });

export const EtatDuTransfert = z.object({
  etat: z.enum(['attente-paiement', 'pret', 'recu', 'echec']),
  /** L'adresse du nouvel espace hébergé, dès qu'elle est connue. */
  adresse: z.string().optional(),
  message: z.string().optional(),
});
export type EtatDuTransfert = z.infer<typeof EtatDuTransfert>;

export const FinDuTransfert = LectureDuTransfert.extend({
  taille: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  morceaux: z.number().int().min(1),
});
export type FinDuTransfert = z.infer<typeof FinDuTransfert>;

export interface ManifesteDuTransfert {
  format: 1;
  origine: 'installation-gratuite';
  cree: number;
  version: string;
  installation: string;
  tailleDonnees: number;
  contenu: {
    /** Le dossier des données de l'installation d'origine, tel qu'il était. */
    data: string;
    /** Le nom du fichier de la base, posé à la racine du paquet : il retourne dans `data/`. */
    base: string;
    /** Chaque projet : son identifiant, son nom, le chemin d'origine et son dossier dans `projets/`. */
    projets: { id: string; nom: string; chemin: string; dossier: string }[];
  };
}

/** Le nombre de morceaux d'un paquet de `taille` octets. */
export function nombreDeMorceaux(taille: number): number {
  return Math.max(1, Math.ceil(taille / TAILLE_D_UN_MORCEAU));
}

/** Un nom de dossier sûr et unique pour un projet dans le paquet : son nom lisible, puis le début de son identifiant. */
export function dossierDuProjetDansLePaquet(projet: { id: string; nom: string }): string {
  const lisible =
    projet.nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'projet';
  return `${lisible}-${projet.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`;
}

/**
 * Les dossiers de projets à emporter : ceux qui existent hors du dossier des données (un projet rangé DANS `data/`
 * part déjà avec lui), sans doublon et sans dossier contenu dans un autre.
 */
export function dossiersDeProjetsAEmporter<T extends { chemin: string }>(projets: readonly T[], dossierDesDonnees: string): T[] {
  const propre = (c: string) => c.replace(/\/+$/, '');
  const data = propre(dossierDesDonnees);
  const gardes: T[] = [];
  const tries = [...projets].filter((p) => p.chemin && p.chemin.startsWith('/')).sort((a, b) => propre(a.chemin).length - propre(b.chemin).length);
  for (const p of tries) {
    const c = propre(p.chemin);
    if (c === data || c.startsWith(`${data}/`) || data.startsWith(`${c}/`)) continue;
    if (gardes.some((g) => c === propre(g.chemin) || c.startsWith(`${propre(g.chemin)}/`))) continue;
    gardes.push(p);
  }
  return gardes;
}

/** « 1,2 Go », « 340 Mo » — le volume tel que la page l'affiche. */
export function volumeLisible(octets: number, langue = 'fr-FR'): string {
  const go = octets / 1e9;
  if (go >= 1) return `${go.toLocaleString(langue, { maximumFractionDigits: 1 })} Go`;
  return `${Math.max(1, Math.round(octets / 1e6)).toLocaleString(langue)} Mo`;
}
