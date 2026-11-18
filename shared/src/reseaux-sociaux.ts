/**
 * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX — les règles pures, sans base ni réseau.
 *
 * L'atelier marketing publie lui-même, par les interfaces OFFICIELLES de chaque
 * réseau (décision du 18/10/2026 : refaire ce que fait Plugkit, réseau par
 * réseau, dans l'atelier existant ; Postiz, sous AGPL, n'a servi que
 * d'inspiration — aucune ligne n'en est reprise). Ici : ce que chaque réseau
 * sait faire, l'application développeur dont il dépend, l'état d'un compte
 * relié, l'heure où un contenu programmé part, l'état de publication PAR
 * COMPTE visé et le texte adapté à chaque réseau.
 *
 * Le serveur (`server/src/publication-sociale.ts`, `server/src/reseaux/`)
 * range les comptes, parle aux réseaux et tient le minuteur ; l'écran
 * (`web/src/components/marketing-reseaux.tsx`) montre les onglets « Comptes » et
 * « Messages ».
 *
 * DEUX RÈGLES QUI NE BOUGENT PAS.
 *  1. **RIEN NE PART SANS UN GESTE HUMAIN.** Un contenu ne part que s'il a été
 *     PROGRAMMÉ par l'utilisateur (à l'heure prévue) ou sur « Publier
 *     maintenant ». Une réponse à un commentaire ou à un message part sur le
 *     bouton « Envoyer » ; l'agent peut seulement en PROPOSER le texte.
 *  2. **UN COMPTE DÉJÀ PUBLIÉ N'EST JAMAIS REPUBLIÉ.** L'état se tient par
 *     compte visé (`EtatCible`) ; relancer ne rejoue que les échecs, et un envoi
 *     coupé en plein vol (redémarrage) devient un échec à vérifier, jamais un
 *     second envoi automatique (`cibleInterrompue`).
 */

/** Les réseaux reliables. La clé est celle du canal dans le catalogue de l'atelier (`CATALOGUE_CANAUX`). */
export const RESEAUX_SOCIAUX = ['instagram', 'facebook', 'linkedin', 'threads', 'youtube', 'tiktok', 'x', 'pinterest', 'google-business'] as const;
export type ReseauSocial = (typeof RESEAUX_SOCIAUX)[number];

/**
 * L'APPLICATION DÉVELOPPEUR dont dépend un réseau : une seule pour Facebook et
 * Instagram (Meta), une seule pour YouTube et la fiche Google (Google). Elle
 * vit au niveau de l'installation Beluga, jamais d'un projet : un même client
 * id sert à relier les comptes de tous les projets.
 */
export const APPLICATIONS_SOCIALES = ['meta', 'threads', 'linkedin', 'google', 'tiktok', 'x', 'pinterest'] as const;
export type ApplicationSociale = (typeof APPLICATIONS_SOCIALES)[number];

/** Ce qu'un contenu exige comme visuel pour partir sur ce réseau. */
export type MediaExige = 'aucun' | 'image' | 'video' | 'image-ou-video';

export interface FicheReseau {
  cle: ReseauSocial;
  libelle: string;
  application: ApplicationSociale;
  /** Ce que l'interface officielle permet, réellement. */
  publier: boolean;
  commentaires: boolean;
  messages: boolean;
  /** Le réseau donne-t-il ses chiffres (vues, réactions, abonnés) ? Vérifié contre les adaptateurs par un test. */
  chiffres: boolean;
  media: MediaExige;
  /** Le plafond de signes d'une publication. */
  limiteTexte: number;
  /** Le lien de suivi est-il cliquable dans le texte ? (Instagram, TikTok : non) */
  lienCliquable: boolean;
  /** Une réponse à un message privé n'est permise que dans cette fenêtre après le dernier message reçu (Meta : 24 h). */
  fenetreMessagesH?: number;
  /** Ce que l'écran doit dire de ce réseau, en une phrase (validation, coût, limite). */
  note: string;
}

export const FICHES_RESEAUX: Readonly<Record<ReseauSocial, FicheReseau>> = {
  instagram: {
    cle: 'instagram',
    libelle: 'Instagram',
    application: 'meta',
    publier: true,
    commentaires: true,
    messages: true,
    chiffres: true,
    media: 'image-ou-video',
    limiteTexte: 2200,
    lienCliquable: false,
    fenetreMessagesH: 24,
    note: 'Compte professionnel relié à une page Facebook. Chaque publication a besoin d’une image ou d’une vidéo.',
  },
  facebook: {
    cle: 'facebook',
    libelle: 'Facebook',
    application: 'meta',
    publier: true,
    commentaires: true,
    messages: true,
    chiffres: true,
    media: 'aucun',
    limiteTexte: 63206,
    lienCliquable: true,
    fenetreMessagesH: 24,
    note: 'Publie sur une page Facebook. Meta doit valider l’application avant d’ouvrir les pages qui ne vous appartiennent pas.',
  },
  linkedin: {
    cle: 'linkedin',
    libelle: 'LinkedIn',
    application: 'linkedin',
    publier: true,
    commentaires: true,
    messages: false,
    chiffres: false,
    media: 'aucun',
    limiteTexte: 3000,
    lienCliquable: true,
    note: 'Profil personnel ou page d’entreprise. LinkedIn n’ouvre pas les messages privés aux applications.',
  },
  threads: {
    cle: 'threads',
    libelle: 'Threads',
    application: 'threads',
    publier: true,
    commentaires: true,
    messages: false,
    chiffres: true,
    media: 'aucun',
    limiteTexte: 500,
    lienCliquable: true,
    note: 'Messages courts de 500 signes. Threads n’a pas de messages privés.',
  },
  youtube: {
    cle: 'youtube',
    libelle: 'YouTube',
    application: 'google',
    publier: true,
    commentaires: true,
    messages: false,
    chiffres: true,
    media: 'video',
    limiteTexte: 5000,
    lienCliquable: true,
    note: 'Chaque publication est une vidéo du Studio. Tant que Google n’a pas vérifié l’application, les vidéos restent privées.',
  },
  tiktok: {
    cle: 'tiktok',
    libelle: 'TikTok',
    application: 'tiktok',
    publier: true,
    commentaires: false,
    messages: false,
    chiffres: false,
    media: 'video',
    limiteTexte: 2200,
    lienCliquable: false,
    note: 'Chaque publication est une vidéo. Avant l’audit de TikTok, elle n’est visible que par vous. Ni commentaires ni messages par l’interface officielle.',
  },
  x: {
    cle: 'x',
    libelle: 'X',
    application: 'x',
    publier: true,
    commentaires: true,
    messages: true,
    chiffres: false,
    media: 'aucun',
    limiteTexte: 280,
    lienCliquable: true,
    note: 'X facture à l’usage : chaque publication, lecture de réponse ou message puise dans des crédits achetés d’avance dans la console développeur de X.',
  },
  pinterest: {
    cle: 'pinterest',
    libelle: 'Pinterest',
    application: 'pinterest',
    publier: true,
    commentaires: false,
    messages: false,
    chiffres: false,
    media: 'image',
    limiteTexte: 500,
    lienCliquable: true,
    note: 'Chaque épingle a besoin d’une image et part sur votre premier tableau. Pinterest n’ouvre ni commentaires ni messages.',
  },
  'google-business': {
    cle: 'google-business',
    libelle: 'Fiche Google (Maps)',
    application: 'google',
    publier: true,
    commentaires: true,
    messages: false,
    chiffres: false,
    media: 'aucun',
    limiteTexte: 1500,
    lienCliquable: false,
    note: 'Publie des actualités sur la fiche et répond aux avis. Google doit d’abord ouvrir l’accès à son interface (une demande à remplir).',
  },
};

export function estReseauSocial(cle: unknown): cle is ReseauSocial {
  return typeof cle === 'string' && (RESEAUX_SOCIAUX as readonly string[]).includes(cle);
}

/** Le nom affiché de chaque application développeur. */
export const LIBELLE_APPLICATION: Readonly<Record<ApplicationSociale, string>> = {
  meta: 'Meta (Facebook et Instagram)',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  google: 'Google (YouTube et fiche Google)',
  tiktok: 'TikTok',
  x: 'X',
  pinterest: 'Pinterest',
};

/** La console où l'application développeur se crée et se fait valider. */
export const CONSOLE_APPLICATION: Readonly<Record<ApplicationSociale, string>> = {
  meta: 'https://developers.facebook.com/apps',
  threads: 'https://developers.facebook.com/apps',
  linkedin: 'https://www.linkedin.com/developers/apps',
  google: 'https://console.cloud.google.com/apis/credentials',
  tiktok: 'https://developers.tiktok.com/apps',
  x: 'https://developer.x.com/en/portal/dashboard',
  pinterest: 'https://developers.pinterest.com/apps',
};

/** Les droits demandés à la connexion, par réseau : ce que les dossiers de validation doivent justifier. */
export const DROITS_DEMANDES: Readonly<Record<ReseauSocial, readonly string[]>> = {
  facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content', 'pages_messaging', 'business_management', 'read_insights'],
  instagram: [
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'instagram_manage_insights',
  ],
  threads: ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights'],
  linkedin: ['openid', 'profile', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'],
  'google-business': ['https://www.googleapis.com/auth/business.manage'],
  tiktok: ['user.info.basic', 'video.publish', 'video.upload'],
  x: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write', 'dm.read', 'dm.write'],
  pinterest: ['user_accounts:read', 'boards:read', 'pins:read', 'pins:write'],
};

/* ------------------------------------------------------------------ */
/* L'application développeur et le compte relié                        */
/* ------------------------------------------------------------------ */

/**
 * OÙ EN EST L'APPLICATION DÉVELOPPEUR :
 *  - absente : rien n'existe encore, seul « Créer » est possible ;
 *  - en_creation : un agent l'ouvre en ce moment ;
 *  - en_validation : ses identifiants sont là, le réseau ne l'a pas encore
 *    validée — on peut déjà relier les comptes dont on est administrateur ou
 *    testeur de l'application ;
 *  - validee : le réseau l'a acceptée.
 */
export const ETATS_APPLICATION = ['absente', 'en_creation', 'en_validation', 'validee'] as const;
export type EtatApplication = (typeof ETATS_APPLICATION)[number];

export interface ApplicationDeveloppeur {
  application: ApplicationSociale;
  etat: EtatApplication;
  /** L'identifiant public de l'application (pas un secret). */
  clientId?: string;
  /** Le secret est rangé au coffre : ici, seulement s'il existe. */
  aUnSecret: boolean;
  /** Ce qu'il reste à faire, dit par l'agent de création ou à la main. */
  note?: string;
  /** La carte de l'agent qui l'ouvre (état « en_creation »). */
  cardId?: string;
  /** Meta : l'ID de la configuration de connexion unifiée — Instagram se relie alors aussi sans page Facebook. */
  configConnexion?: string;
  majLe: number;
}

/** Peut-on lancer la connexion d'un compte sur ce réseau ? Rend null si oui, sinon la raison. */
export function raisonReliureImpossible(app: Pick<ApplicationDeveloppeur, 'etat' | 'clientId' | 'aUnSecret'> | null | undefined): string | null {
  if (!app || app.etat === 'absente') return 'L’application de ce réseau n’existe pas encore : lancez « Créer ».';
  if (app.etat === 'en_creation' && (!app.clientId || !app.aUnSecret)) return 'L’agent ouvre encore l’application de ce réseau.';
  if (!app.clientId || !app.aUnSecret) return 'Il manque l’identifiant ou le secret de l’application.';
  return null;
}

/**
 * L'ÉTAT D'UN COMPTE RELIÉ :
 *  - relie : il publie ;
 *  - a_relier : son accès a expiré ou a été retiré chez le réseau, il faut
 *    refaire la connexion ;
 *  - erreur : le réseau refuse autre chose (droits manquants, compte suspendu).
 */
export const ETATS_COMPTE = ['relie', 'a_relier', 'erreur'] as const;
export type EtatCompte = (typeof ETATS_COMPTE)[number];

export interface CompteSocial {
  id: string;
  projectId: string;
  reseau: ReseauSocial;
  /** L'identifiant du compte chez le réseau (page, utilisateur, chaîne, établissement). */
  distantId: string;
  nom: string;
  avatar?: string;
  etat: EtatCompte;
  /** L'échéance de l'accès, s'il en a une. */
  expireLe?: number;
  /** Un accès renouvelable sans l'utilisateur ? */
  renouvelable: boolean;
  erreur?: string;
  creeLe: number;
  majLe: number;
  /** Comment il publie : par l'interface officielle (défaut), ou par un agent dans Chrome (`connexion-des-reseaux.ts`). */
  mode?: 'officiel' | 'chrome';
}

/** Un accès qui expire dans moins de ce délai est renouvelé par le minuteur. */
export const AVANCE_RENOUVELLEMENT_MS = 10 * 60_000;

/**
 * L'ÉTAT TEL QU'IL SE LIT MAINTENANT : un accès échu sans renouvellement
 * possible vaut « à relier », même si le minuteur n'est pas encore passé.
 */
export function etatDuCompte(c: Pick<CompteSocial, 'etat' | 'expireLe' | 'renouvelable'>, maintenant = Date.now()): EtatCompte {
  if (c.etat !== 'relie') return c.etat;
  if (c.expireLe && c.expireLe <= maintenant && !c.renouvelable) return 'a_relier';
  return 'relie';
}

/** L'accès doit-il être renouvelé à ce tour du minuteur ? */
export function aRenouveler(c: Pick<CompteSocial, 'etat' | 'expireLe' | 'renouvelable'>, maintenant = Date.now()): boolean {
  return c.etat === 'relie' && c.renouvelable && !!c.expireLe && c.expireLe - maintenant <= AVANCE_RENOUVELLEMENT_MS;
}

/* ------------------------------------------------------------------ */
/* Publier un contenu sur plusieurs comptes                            */
/* ------------------------------------------------------------------ */

/**
 * L'ÉTAT DE PUBLICATION D'UN CONTENU SUR UN COMPTE :
 *  - en_attente : pas encore parti ;
 *  - en_cours : l'envoi est en route (posé AVANT d'appeler le réseau) ;
 *  - publie : le réseau l'a accepté, avec son adresse ;
 *  - echec : refusé, avec la raison — seul ce qui est en échec se relance.
 */
export const ETATS_CIBLE = ['en_attente', 'en_cours', 'publie', 'echec'] as const;
export type EtatCible = (typeof ETATS_CIBLE)[number];

export interface CibleSociale {
  compteId: string;
  reseau: ReseauSocial;
  etat: EtatCible;
  /** L'adresse publiée chez le réseau. */
  url?: string;
  raison?: string;
  tenteLe?: number;
  publieLe?: number;
}

/** Un envoi « en cours » depuis plus longtemps a été coupé (redémarrage du démon). */
export const DUREE_ENVOI_MAX_MS = 15 * 60_000;

/** Une cible restée « en cours » trop longtemps : on ne sait pas si elle est partie. */
export function cibleInterrompue(c: Pick<CibleSociale, 'etat' | 'tenteLe'>, maintenant = Date.now()): boolean {
  return c.etat === 'en_cours' && (!c.tenteLe || maintenant - c.tenteLe > DUREE_ENVOI_MAX_MS);
}

/** Les cibles à envoyer : jamais celles déjà publiées ni celles en route. */
export function ciblesAEnvoyer<C extends Pick<CibleSociale, 'etat'>>(cibles: readonly C[]): C[] {
  return cibles.filter((c) => c.etat === 'en_attente' || c.etat === 'echec');
}

export type BilanDePublication = 'aucune' | 'en_attente' | 'en_cours' | 'publie' | 'partiel' | 'echec';

/** Le bilan d'un contenu sur l'ensemble de ses comptes. */
export function bilanDePublication(cibles: readonly Pick<CibleSociale, 'etat'>[]): BilanDePublication {
  if (!cibles.length) return 'aucune';
  if (cibles.some((c) => c.etat === 'en_cours')) return 'en_cours';
  /* UN ENVOI QUI ATTEND ENCORE (un compte publié par Chrome, Chrome fermé : il part à la réouverture) n'est pas fini :
     le contenu reste programmé tant qu'un de ses comptes attend, même si un autre est déjà parti. */
  if (cibles.some((c) => c.etat === 'en_attente') && cibles.some((c) => c.etat !== 'en_attente')) return 'en_cours';
  const publies = cibles.filter((c) => c.etat === 'publie').length;
  const echecs = cibles.filter((c) => c.etat === 'echec').length;
  if (publies === cibles.length) return 'publie';
  if (echecs && publies) return 'partiel';
  if (echecs) return 'echec';
  return publies ? 'partiel' : 'en_attente';
}

/** La raison d'échec d'un contenu, en une phrase : combien sont partis, et le premier refus. */
export function raisonDuBilan(cibles: readonly Pick<CibleSociale, 'etat' | 'reseau' | 'raison'>[]): string | null {
  const echecs = cibles.filter((c) => c.etat === 'echec');
  if (!echecs.length) return null;
  const publies = cibles.filter((c) => c.etat === 'publie').length;
  const premier = echecs[0];
  const debut = publies ? `${publies} sur ${cibles.length} publiés. ` : '';
  return `${debut}${FICHES_RESEAUX[premier.reseau].libelle} : ${premier.raison ?? 'refusé'}`.slice(0, 600);
}

/** L'heure de départ quand le contenu n'en a pas : neuf heures, heure du serveur. */
export const HEURE_PAR_DEFAUT = '09:00';

/** L'instant prévu d'un contenu (heure locale du serveur), ou null sans date. */
export function instantPrevu(datePrevue: string | null | undefined, heurePrevue: string | null | undefined): number | null {
  if (!datePrevue || !/^\d{4}-\d{2}-\d{2}$/.test(datePrevue)) return null;
  const heure = heurePrevue && /^([01]\d|2[0-3]):[0-5]\d$/.test(heurePrevue) ? heurePrevue : HEURE_PAR_DEFAUT;
  const t = new Date(`${datePrevue}T${heure}:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * UN CONTENU DOIT-IL PARTIR MAINTENANT ? Seulement s'il est « Programmé » par
 * l'utilisateur, que son heure est venue, et qu'au moins un compte attend.
 * Un contenu programmé SANS compte coché reste un repère de calendrier.
 */
export function contenuAPublier(
  c: { etape: string; datePrevue?: string | null; heurePrevue?: string | null },
  cibles: readonly Pick<CibleSociale, 'etat'>[],
  maintenant = Date.now(),
): boolean {
  if (c.etape !== 'programme') return false;
  const prevu = instantPrevu(c.datePrevue, c.heurePrevue);
  if (prevu === null || prevu > maintenant) return false;
  return cibles.some((x) => x.etat === 'en_attente');
}

/** Ce qu'un visuel joint permet. */
export interface MediaDisponible {
  image: boolean;
  video: boolean;
}

/** Ce contenu peut-il partir sur ce réseau avec les visuels qu'il a ? Rend null si oui, sinon la raison. */
export function raisonMediaManquant(reseau: ReseauSocial, media: MediaDisponible): string | null {
  const exige = FICHES_RESEAUX[reseau].media;
  if (exige === 'image' && !media.image) return 'Ce réseau a besoin d’une image : créez le visuel dans le Studio.';
  if (exige === 'video' && !media.video) return 'Ce réseau a besoin d’une vidéo : créez-la dans le Studio.';
  if (exige === 'image-ou-video' && !media.image && !media.video) return 'Ce réseau a besoin d’une image ou d’une vidéo : créez le visuel dans le Studio.';
  return null;
}

/**
 * LE TEXTE QUI PART SUR CE RÉSEAU : le lien de suivi ajouté en fin de texte là
 * où il est cliquable (il compte les visites et les ventes de ce contenu), puis
 * coupé proprement à la limite du réseau — sans jamais couper le lien.
 */
export function texteDuReseau(reseau: ReseauSocial, texte: string, lien?: string | null): string {
  const fiche = FICHES_RESEAUX[reseau];
  const propre = String(texte ?? '').trim();
  const ajout = lien && fiche.lienCliquable && !propre.includes(lien) ? `\n\n${lien}` : '';
  const place = fiche.limiteTexte - ajout.length;
  if (propre.length + ajout.length <= fiche.limiteTexte) return propre + ajout;
  if (place <= 1) return propre.slice(0, fiche.limiteTexte);
  return `${propre.slice(0, place - 1).trimEnd()}…${ajout}`;
}

/* ------------------------------------------------------------------ */
/* Commentaires et messages                                             */
/* ------------------------------------------------------------------ */

export const GENRES_MESSAGE = ['commentaire', 'message'] as const;
export type GenreMessage = (typeof GENRES_MESSAGE)[number];

export interface MessageSocial {
  id: string;
  projectId: string;
  compteId: string;
  reseau: ReseauSocial;
  genre: GenreMessage;
  /** La publication commentée, ou la conversation privée. */
  fil: string;
  auteur: string;
  texte: string;
  instant: number;
  /** Écrit par nous (une réponse envoyée depuis Beluga ou depuis le réseau). */
  sortant: boolean;
  lu: boolean;
  /** Le contenu de l'atelier dont c'est un commentaire. */
  contenuId?: string;
  /** Le texte proposé par l'agent : jamais envoyé sans le bouton « Envoyer ». */
  brouillon?: string;
  /** L'adresse du commentaire ou de la publication chez le réseau. */
  url?: string;
  /** Masqué au public par la marque (`modererCommentaire`) : l'instant du geste. */
  masqueLe?: number;
}

export const REPONSE_SOCIALE_MAX = 2000;

/**
 * UNE RÉPONSE PEUT-ELLE PARTIR ? Rend null si oui, sinon la raison. Un message
 * privé Meta ne se répond que dans les 24 heures qui suivent le dernier message
 * reçu de la personne : au-delà, le réseau refuse — on le dit avant.
 */
export function raisonReponseRefusee(entree: {
  reseau: ReseauSocial;
  genre: GenreMessage;
  texte: string;
  dernierRecuLe?: number | null;
  maintenant?: number;
}): string | null {
  const texte = String(entree.texte ?? '').trim();
  if (!texte) return 'La réponse est vide.';
  if (texte.length > REPONSE_SOCIALE_MAX) return `Une réponse tient en ${REPONSE_SOCIALE_MAX} signes.`;
  const fiche = FICHES_RESEAUX[entree.reseau];
  if (entree.genre === 'commentaire' && !fiche.commentaires) return 'Ce réseau ne permet pas de répondre aux commentaires.';
  if (entree.genre === 'message' && !fiche.messages) return 'Ce réseau ne permet pas de répondre aux messages privés.';
  if (entree.genre === 'message' && fiche.fenetreMessagesH && entree.dernierRecuLe) {
    const maintenant = entree.maintenant ?? Date.now();
    if (maintenant - entree.dernierRecuLe > fiche.fenetreMessagesH * 3600_000) {
      return `Ce réseau n’accepte une réponse que dans les ${fiche.fenetreMessagesH} heures qui suivent le dernier message reçu.`;
    }
  }
  return null;
}

/** Les messages à lire en premier : non lus d'abord, puis les plus récents. */
export function trierMessages<M extends Pick<MessageSocial, 'lu' | 'instant' | 'sortant'>>(messages: readonly M[]): M[] {
  return [...messages].sort((a, b) => Number(a.lu || a.sortant) - Number(b.lu || b.sortant) || b.instant - a.instant);
}

export function messagesNonLus(messages: readonly Pick<MessageSocial, 'lu' | 'sortant'>[]): number {
  return messages.filter((m) => !m.lu && !m.sortant).length;
}

/* ------------------------------------------------------------------ */
/* La demande de l'agent de création                                    */
/* ------------------------------------------------------------------ */

/**
 * LA DEMANDE DE L'AGENT « CRÉER » : ouvrir le compte du projet sur ce réseau
 * s'il n'existe pas, créer l'application développeur si elle manque, remplir
 * les dossiers de validation, puis rendre l'identifiant et le secret à l'atelier.
 * Il passe la main à l'utilisateur pour tout ce que lui seul peut fournir —
 * code reçu par SMS, pièce d'identité, captcha — et le demande TOUT DE SUITE.
 */
export function demandeDeCreationDeCompte(entree: {
  reseau: ReseauSocial;
  nomProjet: string;
  adresseRetour: string;
  adresseProduit?: string | null;
  application: Pick<ApplicationDeveloppeur, 'etat' | 'clientId' | 'aUnSecret'> | null;
}): string {
  const fiche = FICHES_RESEAUX[entree.reseau];
  const app = fiche.application;
  const appPrete = !raisonReliureImpossible(entree.application);
  if (app === 'meta') return demandeMetaParLeVraiCompte(entree, appPrete);
  return [
    `OUVRIR ${fiche.libelle.toUpperCase()} POUR « ${entree.nomProjet} » ET Y DONNER ACCÈS À L'ATELIER MARKETING.`,
    '',
    `L'atelier publie par l'interface OFFICIELLE de ${fiche.libelle}. Ton travail : que le projet ait son compte sur ce réseau et que l'application développeur « ${LIBELLE_APPLICATION[app]} » existe, avec ses identifiants rendus à l'atelier.`,
    '',
    'MARCHE À SUIVRE :',
    '1. Ouvre d’abord le coffre-fort (outil « coffre_fort », geste « lister ») : un compte, un courriel ou un mot de passe du réseau existe peut-être déjà. Tu ne demandes rien à l’utilisateur que le coffre sait déjà.',
    `2. ${appPrete ? `L'application développeur existe déjà (identifiant ${entree.application?.clientId}) : passe directement au compte du projet.` : `Crée l'application développeur sur ${CONSOLE_APPLICATION[app]} (un compte développeur au besoin). Adresse de retour à déclarer, exactement : ${entree.adresseRetour}. Droits à demander : ${DROITS_DEMANDES[entree.reseau].join(', ')}.`}`,
    `3. Si le projet n'a pas encore de compte ${fiche.libelle}${entree.reseau === 'instagram' ? ' (professionnel, relié à une page Facebook)' : entree.reseau === 'facebook' ? ' (une page)' : ''}, crée-le au nom de « ${entree.nomProjet} »${entree.adresseProduit ? `, avec le site ${entree.adresseProduit}` : ''}.`,
    '4. Remplis les dossiers de validation que le réseau exige (politique de confidentialité, description de l’usage de chaque droit, captures, vidéo de démonstration si demandée) et envoie-les.',
    `5. Rends le résultat à l'atelier avec l'outil « marketing », action « application » : reseau « ${entree.reseau} », clientId, secret (rangé au coffre par l'atelier, ne l'écris nulle part ailleurs), etat « en_validation » tant que le réseau n'a pas accepté (« validee » sinon), et une note qui dit ce qui reste à faire.`,
    '',
    'RÈGLES :',
    '- Le navigateur : le Chrome du système, par playwright (`channel: \'chrome\'`), jamais un navigateur téléchargé. Un PROFIL DE NAVIGATEUR GARDÉ sur le serveur porte peut-être déjà la session du compte (outil « memoire », geste « chercher » : « profil navigateur ») : rouvre-le avant toute connexion, il évite un nouveau code SMS.',
    '- Tu FAIS le travail toi-même, du début à la fin : la personne ne suit aucune marche à suivre. Tu ne lui demandes que ce que toi seul ne peux pas obtenir.',
    '- Chaque identifiant obtenu (courriel, mot de passe, clé, secret) s’enregistre aussitôt au coffre, une fiche par secret.',
    '- Un code reçu par SMS ou par courriel, une pièce d’identité, un paiement : déclenche l’envoi PUIS pose la question avec « ask_user » dans le même tour — jamais un point laissé « à vérifier ».',
    '- Un captcha ou un contrôle anti-robot : ne force jamais. Demande à l’utilisateur, avec « ask_user », de faire ce pas lui-même et de te dire quand c’est fait.',
    '- Le réseau doit encore VALIDER (profil, selfie, application en revue) : pose une veille avec « veille_poser » sur une page qui le montre, lue dans le profil connecté du compte (navigateur dev-browser). Tu seras relancé quand la validation passe ; ne demande pas « relancez-moi ».',
    '- Tu ne publies rien sur le compte : la publication reste un geste de l’utilisateur dans l’atelier.',
    '- Termine par un compte rendu court : ce qui existe, ce qui attend la validation du réseau, et ce que l’utilisateur doit encore faire (bouton « Relier » dans l’onglet Comptes).',
  ].join('\n');
}

/**
 * FACEBOOK ET INSTAGRAM PAR LE VRAI COMPTE DE L'UTILISATEUR (décision du 03/11/2026 ; Threads a sa propre application et garde sa marche) : un compte Facebook créé
 * par un robot depuis le serveur est vérifié puis bloqué sans appel. Plus aucun compte créé, plus aucune connexion au
 * compte personnel : l'agent GUIDE l'utilisateur pour créer UNE application Meta (une fois, pour toutes les marques),
 * PRÉPARE la page de chaque marque que l'utilisateur crée lui-même, puis « Relier » (connexion officielle) ramène
 * toutes ses pages et ses comptes Instagram professionnels d'un coup.
 */
export const RESEAUX_PAR_LE_VRAI_COMPTE: readonly ReseauSocial[] = ['facebook', 'instagram'];

function demandeMetaParLeVraiCompte(
  entree: { reseau: ReseauSocial; nomProjet: string; adresseRetour: string; adresseProduit?: string | null; application: Pick<ApplicationDeveloppeur, 'etat' | 'clientId' | 'aUnSecret'> | null },
  appPrete: boolean,
): string {
  const fiche = FICHES_RESEAUX[entree.reseau];
  const instagram = entree.reseau === 'instagram';
  return [
    `PRÉPARER ${fiche.libelle.toUpperCase()} POUR « ${entree.nomProjet} », PAR LE VRAI COMPTE DE L'UTILISATEUR.`,
    '',
    `${fiche.libelle} passe par l'application Meta de l'utilisateur, UNE seule pour toutes ses marques. Tu ne crées AUCUN compte Facebook ou Instagram, tu ne te connectes JAMAIS à son compte personnel, aucun navigateur du serveur n'ouvre facebook.com : un compte ouvert par un robot est vérifié puis bloqué sans appel.`,
    '',
    'MARCHE À SUIVRE :',
    '1. Ouvre d’abord le coffre-fort (outil « coffre_fort », geste « lister ») : l’identifiant et le secret de l’application Meta y sont peut-être déjà.',
    appPrete
      ? `2. L'application Meta existe déjà (identifiant ${entree.application?.clientId}) : passe à l'étape 3.`
      : [
          "2. L'APPLICATION META, UNE FOIS POUR TOUTES : guide l'utilisateur pas à pas, UN ÉCRAN À LA FOIS, avec « ask_user » (il répond « C'est fait » ou colle ce qu'on lui demande). Donne à chaque fois l'adresse exacte et les valeurs EXACTES à coller :",
          '   a. developers.facebook.com → « Mes apps » → « Créer une app » ; cas d’usage : « Gérer tout sur votre Page » (et « Gérer les messages et le contenu sur Instagram ») ; nom de l’app : celui de son entreprise.',
          `   b. Produit « Facebook Login » → Paramètres → « URI de redirection OAuth valides » : ${entree.adresseRetour}`,
          `   c. Autorisations à ajouter : ${DROITS_DEMANDES.facebook.concat(DROITS_DEMANDES.instagram).filter((d, i, t) => t.indexOf(d) === i).join(', ')}.`,
          "   d. Paramètres → Général : il te colle l'« ID de l'app » puis la « Clé secrète ».",
          "   L'application reste en mode développement : l'utilisateur en est administrateur, l'accès standard suffit pour SES propres pages — aucune revue Meta à demander.",
          `   Rends-la à l'atelier : outil « marketing », action « application », reseau « ${entree.reseau} », clientId, secret (rangé au coffre par l'atelier, jamais écrit ailleurs), etat « validee », et une note.`,
        ].join('\n'),
    `3. LA PAGE DE LA MARQUE : prépare tout ce qu'il faut pour que l'utilisateur la crée en deux minutes sur son téléphone (application Facebook → Menu → Pages → Créer) — nom « ${entree.nomProjet} », catégorie, description courte, site${entree.adresseProduit ? ` ${entree.adresseProduit}` : ''}, photo de profil et photo de couverture tirées du kit de la marque (fabrique-les au Studio s'il n'y en a pas, prix d'abord). Remets-les dans un message, prêtes à copier et à télécharger.`,
    instagram
      ? '4. INSTAGRAM : le compte Instagram de la marque passe en compte PROFESSIONNEL (application Instagram → Paramètres → Type de compte). Il n’a PAS besoin d’être relié à la page : « Relier » passe par la connexion unifiée de Meta (« Continuer avec Instagram », le compte connecté sur instagram.com) dès que sa configuration est réglée, et le compte doit d’abord être invité « Testeur(se) Instagram » de l’application Meta (Rôles) puis accepter (instagram.com → Paramètres → Applications et sites Web → Invitations à tester) tant que l’application n’est pas publiée.'
      : '4. Rien d’autre à créer : la page suffit.',
    "5. RELIER : quand la page existe, propose le bouton « Relier » (geste « compte.relier ») : la connexion officielle de Meta ramène TOUTES ses pages et leurs comptes Instagram ; s'il y en a plusieurs, demande avec « ask_user » laquelle va à quelle marque.",
    '',
    'RÈGLES :',
    "- Un identifiant reçu (ID et clé secrète de l'application) s'enregistre aussitôt au coffre, une fiche par secret.",
    '- Une question à la fois, « ask_user », et les valeurs exactes à coller dans la question elle-même.',
    '- Tu ne publies rien : la publication reste un geste de l’utilisateur.',
    '- Termine par un compte rendu court : ce qui est prêt, ce que l’utilisateur doit encore faire (créer la page, puis « Relier »).',
  ].join('\n');
}

const nomSimple = (nom: string) =>
  nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * LE MÊME COMPTE, QUELLE QUE SOIT SA VOIE (12/11/2026) : un compte relié « par Chrome » faute de mieux (@belugabuild,
 * sans page Facebook) porte le même nom que celui que la voie officielle rend ensuite. Quand la voie officielle le
 * relie, la ligne « par Chrome » de même réseau et de même nom (sans @, accents, espaces ni casse) lui cède la place :
 * jamais deux fois la même marque sur un réseau, l'une publiant par Chrome.
 */
export function memeCompteSocial(a: string, b: string): boolean {
  const x = nomSimple(a.replace(/^@/, ''));
  return !!x && x === nomSimple(b.replace(/^@/, ''));
}

/**
 * LES NOMS QUE « Relier » COMPARE AUX PAGES META (12/11/2026) : ranger par nom de PROJET envoyait la page « ProjetA »
 * sur le dossier de regroupement « ProjetA » et l'Instagram @projeta.app sur « ProjetA app », alors que Communication
 * montre la MARQUE (son projet de référence) — ces comptes n'y paraissaient pas. Un regroupement n'est plus un
 * candidat ; un projet rangé dans une marque renvoie au projet de référence de cette marque ; le nom de la marque
 * s'ajoute comme candidat, vers ce même projet.
 */
export function candidatsDesPagesMeta(
  projets: readonly { id: string; nom: string; regroupement?: boolean }[],
  marques: readonly { nom: string; principal: string | null; projets: readonly string[] }[],
): { id: string; nom: string }[] {
  const reference = new Map<string, string>();
  for (const m of marques) {
    if (!m.principal) continue;
    for (const p of m.projets) reference.set(p, m.principal);
  }
  const reels = projets.filter((p) => !p.regroupement);
  const existe = new Set(reels.map((p) => p.id));
  return [
    ...reels.map((p) => ({ id: reference.get(p.id) ?? p.id, nom: p.nom })),
    ...marques.filter((m) => m.principal && existe.has(m.principal)).map((m) => ({ id: m.principal!, nom: m.nom })),
  ];
}

/** Le projet que le NOM d'une page Meta désigne, ou null si aucun ne s'y reconnaît (voir `projetDUnePageMeta`). */
export function projetNommeParLaPage(nomDeLaPage: string, projets: readonly { id: string; nom: string }[], projetDuClic: string): string | null {
  const page = nomSimple(nomDeLaPage.replace(/^@/, ''));
  if (!page) return null;
  const candidats = projets
    .map((p) => ({ id: p.id, nom: nomSimple(p.nom) }))
    .filter((p) => p.nom.length >= 3 && (page === p.nom || page.includes(p.nom) || p.nom.includes(page)))
    .sort((a, b) => (a.id === projetDuClic ? -1 : 0) - (b.id === projetDuClic ? -1 : 0) || b.nom.length - a.nom.length);
  const exact = candidats.find((p) => p.nom === page);
  return (exact ?? candidats[0])?.id ?? null;
}

/**
 * À QUELLE MARQUE VA UNE PAGE META (03/11/2026) : « Relier » ramène TOUTES les pages et les comptes Instagram de
 * l'utilisateur d'un coup. Chacun va au projet dont il porte le nom (sans accents, espaces ni casse ; le nom du projet
 * contenu dans celui de la page, ou l'inverse) ; le projet d'où l'on a cliqué « Relier » l'emporte à égalité. Le nom le
 * plus long l'emporte (« Haiko Studio » avant « Haiko »).
 *
 * CE QU'AUCUN NOM NE DÉSIGNE (12/11/2026) : le projet du clic ne le garde que si Meta n'a rendu QU'UN compte — c'est
 * alors celui qu'on vient de choisir. Quand Meta en rend plusieurs, un compte sans projet à son nom est écarté (null) :
 * relier l'Instagram de Beluga Build avait posé @studhunt.ch sur Beluga Build, qui y aurait publié.
 */
export function projetDUnePageMeta(nomDeLaPage: string, projets: readonly { id: string; nom: string }[], projetDuClic: string, seulCompteRendu = true): string | null {
  return projetNommeParLaPage(nomDeLaPage, projets, projetDuClic) ?? (seulCompteRendu ? projetDuClic : null);
}
