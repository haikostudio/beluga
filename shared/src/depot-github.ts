/**
 * AJOUTER UN PROJET DEPUIS GITHUB.
 *
 * La fenêtre « Projets du serveur » n'offrait que deux voies : un dossier DÉJÀ
 * préparé à la main sur le serveur, ou un projet NEUF monté de zéro. Un dépôt
 * qui existe déjà sur GitHub n'avait donc aucun chemin : il fallait ouvrir un
 * terminal, cloner, puis revenir l'inscrire.
 *
 * Ici, RIEN ne touche au réseau ni au disque : ce fichier ne fait que LIRE ce
 * qui a été saisi et NOMMER les refus. Le clone, l'adresse publique et
 * l'inscription restent dans le démon (`server/src/depots-github.ts`), qui
 * réemploie le même montage que les autres projets.
 */

/** Un dépôt GitHub désigné, une fois le lien compris. */
export interface DepotVise {
  /** Le compte ou l'organisation qui porte le dépôt. */
  proprietaire: string;
  /** Le nom du dépôt, sans le « .git ». */
  depot: string;
  /** « proprietaire/depot », la forme qu'attend l'outil GitHub. */
  slug: string;
  /** L'adresse de la page du dépôt. */
  url: string;
}

/** Un dépôt tel que le compte connecté le rend, pour l'afficher au choix. */
export interface DepotDuCompte {
  slug: string;
  nom: string;
  proprietaire: string;
  description?: string;
  prive: boolean;
  /** Le dernier moment où le dépôt a bougé (ISO), pour classer la liste. */
  majLe?: string;
  /** Vide sur GitHub : un dépôt sans le moindre enregistrement. */
  vide?: boolean;
}

/* ------------------------------------------------------------------ */
/* Les refus, dits en clair                                            */
/* ------------------------------------------------------------------ */

export const REFUS_LIEN_VIDE = "Aucun lien saisi : collez l'adresse du dépôt GitHub.";
export const REFUS_LIEN_MAL_FORME =
  "Ce lien n'est pas celui d'un dépôt GitHub. Attendu : https://github.com/compte/depot, ou simplement compte/depot.";
export const REFUS_AUTRE_HEBERGEUR =
  "Ce lien ne pointe pas vers GitHub. Seuls les dépôts GitHub peuvent être ajoutés ainsi pour l'instant.";
export const REFUS_DEPOT_INTROUVABLE =
  "Ce dépôt n'existe pas, ou le compte GitHub du serveur n'y a pas accès. Vérifiez le nom, ou donnez l'accès à ce compte.";
export const REFUS_ACCES_GITHUB =
  "GitHub a refusé l'accès à ce dépôt. Le compte connecté au serveur n'a pas le droit de le lire.";
export const REFUS_DEPOT_VIDE =
  "Ce dépôt est vide : il n'a pas encore le moindre enregistrement, il n'y a donc rien à récupérer.";
export const REFUS_PAS_DE_COMPTE =
  "Aucun compte GitHub n'est connecté à ce serveur : collez plutôt le lien du dépôt, ou identifiez l'outil GitHub.";

/** Le refus qui dit qu'un projet est DÉJÀ dans la colonne de gauche. */
export function refusDejaInscrit(nom: string): string {
  return `« ${nom} » est déjà inscrit dans votre liste de projets.`;
}

/** Le refus qui dit que le dossier d'arrivée existe déjà sur le serveur. */
export function refusDossierOccupe(dossier: string): string {
  return `Le dossier « ${dossier} » existe déjà sur le serveur : renommez-le, ou inscrivez-le par « Déjà sur le serveur ».`;
}

/* ------------------------------------------------------------------ */
/* Lire un lien                                                        */
/* ------------------------------------------------------------------ */

const NOM_VALIDE = /^[A-Za-z0-9._-]+$/;

/** Ce qu'on a compris d'un lien collé : un dépôt, ou une raison en français. */
export interface LectureDeLien {
  ok: boolean;
  depot?: DepotVise;
  erreur?: string;
}

/**
 * Comprend ce qui a été collé. On accepte ce qu'un utilisateur a réellement
 * sous la main : l'adresse de la page, celle d'un fichier ou d'une branche,
 * l'adresse de clone en https ou en ssh, et la forme courte « compte/depot ».
 * Tout le reste est refusé en le disant.
 */
export function lireLienGithub(saisi: string | undefined | null): LectureDeLien {
  const brut = (saisi ?? '').trim();
  if (!brut) return { ok: false, erreur: REFUS_LIEN_VIDE };

  let reste = brut;

  // git@github.com:compte/depot.git
  const ssh = reste.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/i);
  if (ssh) {
    if (!estGithub(ssh[1])) return { ok: false, erreur: REFUS_AUTRE_HEBERGEUR };
    reste = ssh[2];
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(reste)) {
    // https://github.com/compte/depot/tree/main
    let hote = '';
    let chemin = '';
    try {
      const url = new URL(reste);
      hote = url.hostname;
      chemin = url.pathname;
    } catch {
      return { ok: false, erreur: REFUS_LIEN_MAL_FORME };
    }
    if (!estGithub(hote)) return { ok: false, erreur: REFUS_AUTRE_HEBERGEUR };
    reste = chemin;
  } else if (/^(?:www\.)?github\.com\//i.test(reste)) {
    // github.com/compte/depot, collé sans le protocole
    reste = reste.replace(/^(?:www\.)?github\.com/i, '');
  } else if (reste.includes('://') || /^[^/]+\.[^/]+\//.test(reste)) {
    // Une adresse d'un autre hébergeur, écrite sans protocole.
    return { ok: false, erreur: REFUS_AUTRE_HEBERGEUR };
  }

  const morceaux = reste
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0);
  if (morceaux.length < 2) return { ok: false, erreur: REFUS_LIEN_MAL_FORME };

  const proprietaire = morceaux[0];
  const depot = morceaux[1].replace(/\.git$/i, '');
  if (!NOM_VALIDE.test(proprietaire) || !NOM_VALIDE.test(depot) || depot === '.' || depot === '..') {
    return { ok: false, erreur: REFUS_LIEN_MAL_FORME };
  }

  return {
    ok: true,
    depot: {
      proprietaire,
      depot,
      slug: `${proprietaire}/${depot}`,
      url: `https://github.com/${proprietaire}/${depot}`,
    },
  };
}

function estGithub(hote: string): boolean {
  const nom = hote.toLowerCase().replace(/^www\./, '');
  return nom === 'github.com';
}

/** L'adresse de clone en https, la seule que le jeton du serveur sait ouvrir. */
export function adresseDeClone(depot: DepotVise): string {
  return `https://github.com/${depot.proprietaire}/${depot.depot}.git`;
}

/**
 * Le nom du dossier où le dépôt atterrit sur le serveur. Mêmes règles que pour
 * un projet neuf : minuscules, sans accent, sans signe exotique.
 */
export function dossierPourDepot(nom: string): string {
  return (
    nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'projet'
  );
}

/**
 * Ce qui empêche d'ajouter ce dépôt, avant même de toucher au réseau : il est
 * déjà inscrit dans la colonne de gauche, sous ce dépôt distant ou sous ce
 * dossier. Rien de trouvé : on peut y aller.
 */
export function refusAvantMontage(
  depot: DepotVise,
  projets: { name: string; path?: string; gitRemote?: string; archived?: boolean }[],
): string | undefined {
  const attendu = `${depot.proprietaire}/${depot.depot}`.toLowerCase();
  for (const projet of projets) {
    const remote = (projet.gitRemote ?? '').toLowerCase();
    if (!remote) continue;
    const lu = lireLienGithub(remote);
    if (lu.ok && lu.depot && lu.depot.slug.toLowerCase() === attendu) return refusDejaInscrit(projet.name);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Chercher parmi les dépôts du compte                                 */
/* ------------------------------------------------------------------ */

/**
 * Filtre la liste des dépôts du compte connecté sur ce qui est tapé. On cherche
 * dans le nom, le propriétaire et la description : c'est ce qu'un utilisateur a
 * en tête, pas seulement le nom exact.
 */
export function filtrerDepots(depots: DepotDuCompte[], recherche: string | undefined | null): DepotDuCompte[] {
  const mots = (recherche ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((mot) => mot.length > 0);
  if (!mots.length) return depots;
  return depots.filter((depot) => {
    const texte = `${depot.slug} ${depot.nom} ${depot.proprietaire} ${depot.description ?? ''}`.toLowerCase();
    return mots.every((mot) => texte.includes(mot));
  });
}
