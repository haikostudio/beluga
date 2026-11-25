/**
 * LES ACCÈS CLIENTS — LE COMPTE ADMINISTRATEUR DU SITE, NOTÉ DANS BELUGA.
 *
 * Décision de l'utilisateur (cadrage du 25/11/2026, carte « Connexion Haiko pour les sites clients ») : la connexion
 * automatique d'un client à l'administration de son site est ABANDONNÉE. À la place :
 *
 *   - chaque version d'un site client (« Site en ligne » = `adresseProduction`, « Version de travail » = `devUrl`) qui a
 *     une administration porte UN compte administrateur, PARTAGÉ par les clients du projet ;
 *   - l'agent du projet le crée dans le site et le note dans Beluga (outil `coffre_fort`, paramètre `accesClient`) ;
 *   - un clic du client sur la version, dans « Voir mon site », ouvre une fenêtre avec l'adresse de connexion,
 *     l'identifiant et le mot de passe, et un bouton qui ouvre l'administration en copiant le mot de passe ;
 *   - Beluga pose d'office, SANS LA LANCER, la carte « Créer les accès administrateur du client » dans tout projet
 *     qui a un client et une version sans accès noté.
 *
 * Ici, les règles sans base ni disque : les versions, leurs libellés, l'état d'une version, le jugement d'un accès,
 * les versions à pourvoir, le nom et le dossier de la fiche du coffre, et le texte de la carte posée d'office. Le
 * stockage vit dans `server/src/acces-clients.ts` (fiches du coffre, colonne `acces_client`).
 */
import { adresseDeSite, hoteDuSite, sitesDuProjet } from './suivi-de-demande.js';

/** Les deux versions d'un site, dans l'ordre du menu « Voir mon site » : la version en ligne d'abord. */
export const VERSIONS_D_ACCES = ['production', 'dev'] as const;
export type VersionDAcces = (typeof VERSIONS_D_ACCES)[number];

export function estVersionDAcces(valeur: unknown): valeur is VersionDAcces {
  return typeof valeur === 'string' && (VERSIONS_D_ACCES as readonly string[]).includes(valeur);
}

/** Le nom de la version, tel que le menu « Voir mon site » le montre (clé du dictionnaire). */
export function libelleDeLaVersion(version: VersionDAcces): string {
  return version === 'production' ? 'Site en ligne' : 'Version de travail';
}

/** La clé de la version dans `SitesDuProjet` (`enLigne` / `travail`). */
export function cleDuSiteDeLaVersion(version: VersionDAcces): 'enLigne' | 'travail' {
  return version === 'production' ? 'enLigne' : 'travail';
}

/**
 * L'ADRESSE DU SITE pour cette version, ou rien. Passe par `sitesDuProjet` : un projet dont les deux réglages
 * désignent la même adresse (iMiel) n'a QU'UNE version, la version en ligne — la version de travail n'y est donc
 * jamais « à pourvoir ».
 */
export function adresseDeLaVersion(
  projet: { devUrl?: string | null; adresseProduction?: string | null } | null | undefined,
  version: VersionDAcces,
): string | undefined {
  return sitesDuProjet(projet)[cleDuSiteDeLaVersion(version)];
}

/** Les versions qu'un projet a réellement (une adresse réglée), dans l'ordre du menu. */
export function versionsDuProjet(
  projet: { devUrl?: string | null; adresseProduction?: string | null } | null | undefined,
): VersionDAcces[] {
  return VERSIONS_D_ACCES.filter((v) => Boolean(adresseDeLaVersion(projet, v)));
}

/* ------------------------------------------------------------------ */
/* L'accès lui-même                                                      */
/* ------------------------------------------------------------------ */

/** Ce que le client voit dans la fenêtre : trois valeurs, rien d'autre. */
export interface AccesClient {
  /** L'adresse de la page de connexion de l'administration (https). */
  adresse: string;
  identifiant: string;
  motDePasse: string;
}

export const IDENTIFIANT_ACCES_MAX = 200;
export const MOT_DE_PASSE_ACCES_MAX = 500;

/**
 * UN ACCÈS CLIENT SE JUGE AVANT D'ÊTRE NOTÉ : une adresse web (https, ou http pour un essai local), un identifiant et
 * un mot de passe non vides. Un accès à moitié rempli ouvrirait une fenêtre où le client ne pourrait rien faire.
 */
export function jugerAccesClient(
  brut: unknown,
): { ok: true; acces: AccesClient } | { ok: false; raison: string } {
  const o = (brut ?? {}) as Record<string, unknown>;
  const adresseBrute = String(o.adresse ?? '').trim();
  if (!adresseBrute) return { ok: false, raison: 'Donnez l’adresse de la page de connexion de l’administration.' };
  const adresse = adresseDeSite(adresseBrute);
  if (!adresse) return { ok: false, raison: 'L’adresse de connexion doit être une adresse web (https://…).' };
  const identifiant = String(o.identifiant ?? '').trim();
  if (!identifiant) return { ok: false, raison: 'Donnez l’identifiant du compte administrateur.' };
  if (identifiant.length > IDENTIFIANT_ACCES_MAX) return { ok: false, raison: 'L’identifiant est trop long.' };
  const motDePasse = String(o.motDePasse ?? '');
  if (!motDePasse.trim()) return { ok: false, raison: 'Donnez le mot de passe du compte administrateur.' };
  if (motDePasse.length > MOT_DE_PASSE_ACCES_MAX) return { ok: false, raison: 'Le mot de passe est trop long.' };
  return { ok: true, acces: { adresse, identifiant, motDePasse } };
}

/* ------------------------------------------------------------------ */
/* L'état d'une version                                                  */
/* ------------------------------------------------------------------ */

/**
 * - `notes` : l'accès est noté, le clic du client ouvre la fenêtre ;
 * - `a-creer` : la version a une adresse mais aucun accès noté ;
 * - `sans-administration` : l'agent a déclaré que cette version n'a pas d'administration (la carte ne revient pas) ;
 * - `sans-objet` : la version n'a pas d'adresse.
 */
export type EtatDAccesClient = 'notes' | 'a-creer' | 'sans-administration' | 'sans-objet';

export function etatDeLaVersion(entree: { adresseDuSite?: string; note: boolean; sansAdministration: boolean }): EtatDAccesClient {
  if (!entree.adresseDuSite) return 'sans-objet';
  if (entree.note) return 'notes';
  if (entree.sansAdministration) return 'sans-administration';
  return 'a-creer';
}

/** Les versions notées, par clé de `SitesDuProjet` : ce que `espace.etat` envoie au client — des booléens, jamais un secret. */
export interface AccesNotesDuSite {
  enLigne?: boolean;
  travail?: boolean;
}

export function accesNotesDuSite(notees: readonly VersionDAcces[]): AccesNotesDuSite {
  return {
    ...(notees.includes('production') ? { enLigne: true } : {}),
    ...(notees.includes('dev') ? { travail: true } : {}),
  };
}

/**
 * LES VERSIONS À POURVOIR — celles pour lesquelles la carte doit être posée. Rien pour un projet archivé, sans dépôt
 * ou sans client ; sinon chaque version qui a une adresse, sans accès noté ni déclaration « pas d'administration ».
 */
export function versionsAPourvoir(
  projet: {
    devUrl?: string | null;
    adresseProduction?: string | null;
    archived?: boolean;
    marqueSansDepot?: boolean;
  },
  aUnClient: boolean,
  notees: readonly VersionDAcces[],
  sansAdministration: readonly VersionDAcces[] = [],
): VersionDAcces[] {
  if (!aUnClient || projet.archived || projet.marqueSansDepot) return [];
  return versionsDuProjet(projet).filter((v) => !notees.includes(v) && !sansAdministration.includes(v));
}

/* ------------------------------------------------------------------ */
/* La fiche du coffre                                                    */
/* ------------------------------------------------------------------ */

/** Le nom de la fiche : « Fishflow — Administration du site — Client (prod) » (convention MEM-2514). */
export function nomDeLaFicheDAccesClient(projet: string, version: VersionDAcces): string {
  return `${projet.trim()} — Administration du site — Client (${version === 'production' ? 'prod' : 'dev'})`;
}

/** Le dossier du coffre, sous la racine du projet : celui des dossiers déjà rangés (« Production », « Développement et essai »). */
export function sousDossierDesAccesClients(version: VersionDAcces): string {
  return `${version === 'production' ? 'Production' : 'Développement et essai'}/Accès clients`;
}

export const NOTE_DE_LA_FICHE_D_ACCES_CLIENT =
  'Compte administrateur du site, partagé par les clients du projet : montré au client quand il ouvre cette version depuis « Voir mon site ».';

/* ------------------------------------------------------------------ */
/* La carte posée d'office                                               */
/* ------------------------------------------------------------------ */

/** L'étiquette de la carte : une seule ouverte par projet. */
export const LABEL_ACCES_CLIENTS = 'acces-clients';
export const TITRE_CARTE_ACCES_CLIENTS = 'Créer les accès administrateur du client';

export interface VersionAPourvoir {
  version: VersionDAcces;
  adresse: string;
}

function lignesDesVersions(versions: readonly VersionAPourvoir[]): string {
  return versions.map((v) => `- ${libelleDeLaVersion(v.version)} — ${v.adresse}`).join('\n');
}

/** La description de la carte, lue sur le tableau : ce qui manque, en mots courants. */
export function descriptionDeLaCarteDAccesClients(projet: string, versions: readonly VersionAPourvoir[]): string {
  const quoi = versions.map((v) => `« ${libelleDeLaVersion(v.version)} » (${hoteDuSite(v.adresse)})`).join(' et ');
  return (
    `Les clients de ${projet} n'ont pas encore leurs accès administrateur pour ${quoi}. ` +
    "Créer dans le site un compte administrateur par version, partagé par les clients, puis le noter dans Beluga : " +
    "le client le retrouvera en cliquant sur « Voir mon site » dans son espace."
  );
}

/** La consigne complète de l'agent qui exécutera la carte. */
export function consigneDeLaCarteDAccesClients(projet: string, versions: readonly VersionAPourvoir[]): string {
  return [
    `Créer les accès administrateur du client pour le projet ${projet}.`,
    '',
    'Versions à pourvoir :',
    lignesDesVersions(versions),
    '',
    "BUT : les clients de ce projet voient, dans leur espace Haiko (« Voir mon site »), l'adresse de connexion, " +
      "l'identifiant et le mot de passe de l'administration de chaque version de leur site. Beluga les leur montre " +
      'dès que tu les as notés.',
    '',
    'À FAIRE, version par version :',
    "1. Trouve l'administration du site (page de connexion de l'espace d'administration) dans le dépôt de ce projet. " +
      "Si cette version n'a AUCUNE administration, déclare-le avec l'outil « coffre_fort » : action « enregistrer », " +
      `« accesClient » = « production » ou « dev », « sansAdministration » = true — la carte ne reviendra plus.`,
    "2. Crée UN compte administrateur pour cette version, PARTAGÉ par les clients du projet : un identifiant générique " +
      "propre au site (par exemple « client@<domaine> » ou « client »), un mot de passe fort généré par toi. Passe par " +
      "les moyens du site (commande, script, interface d'administration), jamais en contournant ses règles.",
    "3. LA VERSION EN LIGNE EST LA PRODUCTION : respecte les règles de mise en production du projet (procédure, " +
      "registre, serveur de production) — compétence « copie-de-test-et-registre-de-production » et sa nuance de " +
      'garde de production si le projet en a une. Aucune autre modification du site en ligne.',
    "4. Vérifie la connexion dans un vrai navigateur, avec l'identifiant et le mot de passe créés, sur la page de " +
      'connexion de cette version.',
    "5. Note l'accès avec l'outil « coffre_fort » : action « enregistrer », « accesClient » = « production » (site en " +
      "ligne) ou « dev » (version de travail), et « champs » = { « adresse » : l'adresse de la page de connexion, " +
      "« identifiant », « motDePasse » }. Beluga range la fiche au bon endroit et remplace l'ancienne s'il y en avait une.",
    '',
    "N'écris JAMAIS le mot de passe dans la conversation, un fichier du dépôt ou un journal : il ne vit que dans le " +
      "coffre. Si tu changes plus tard l'adresse de connexion ou le mot de passe de ce compte, mets l'accès à jour de la " +
      'même façon.',
  ].join('\n');
}
