/*
 * LES BLOCAGES D'UN SITE, RECONNUS ET TRAITÉS COMME UNE PERSONNE LE FERAIT (13/11/2026, décision de l'utilisateur :
 * « l'extension doit savoir passer plus facilement les blocages comme X et TikTok »).
 *
 * Ni camouflage ni ruse : la page qui bloque est NOMMÉE (trop d'essais, code par courriel, image à déchiffrer, appli
 * exigée, compte suspendu, connexion refusée), et la conduite d'une personne y répond — attendre, aller chercher le
 * code, lire l'image, passer par le téléphone, s'arrêter. Jamais de boucle : un seul nouvel essai, plus lent, puis on
 * passe la main (iPhone recopié sur le Mac, ou la personne).
 *
 * Règles PURES : ni base, ni horloge.
 */

export type GenreDeBlocage =
  | 'trop-d-essais'
  | 'code-par-mail'
  | 'image-a-dechiffrer'
  | 'appli-exigee'
  | 'compte-suspendu'
  | 'connexion-refusee'
  | 'debogueur-detache';

export interface BlocageReconnu {
  genre: GenreDeBlocage;
  /** Ce qu'une personne ferait, dit à l'agent. */
  conduite: string;
}

interface Motif {
  genre: GenreDeBlocage;
  /** L'hôte visé (« x.com », « tiktok.com ») ; absent : tous les sites. */
  hote?: RegExp;
  url?: RegExp;
  texte?: RegExp;
}

/* L'ordre compte : le plus grave d'abord (un compte suspendu n'est pas « trop d'essais »). */
const MOTIFS: readonly Motif[] = [
  { genre: 'compte-suspendu', texte: /\b(account (has been )?suspended|your account is suspended|compte (a été )?suspendu|we suspended your account|this account has been (locked|banned)|compte (bloqué|banni))\b/i },
  { genre: 'appli-exigee', hote: /(^|\.)tiktok\.com$/i, url: /\/login\/download-app|\/download\b/i },
  { genre: 'appli-exigee', texte: /\b(download (the )?app to (continue|sign up)|t[ée]l[ée]charge[rz]? l['’]appli(cation)? pour continuer|only available (in|on) the app|continue in the app)\b/i },
  { genre: 'trop-d-essais', texte: /\b(too many (attempts|requests)|maximum number of attempts|rate limit(ed)?|try again later|r[ée]essaye[rz]? plus tard|trop de tentatives|nombre maximal de tentatives)\b/i },
  { genre: 'trop-d-essais', hote: /(^|\.)(x|twitter)\.com$/i, texte: /something went wrong\.?\s*try reloading/i },
  { genre: 'image-a-dechiffrer', texte: /\b(captcha|arkose|funcaptcha|verify you are (a )?human|prove you['’]re (not a robot|human)|drag the (slider|puzzle)|faites glisser la pi[eè]ce|je ne suis pas un robot|i['’]m not a robot)\b/i },
  { genre: 'code-par-mail', texte: /\b(verification code|code de (v[ée]rification|confirmation|s[ée]curit[ée])|we sent (you )?a code|enter the code|nous (vous )?avons envoy[ée] un code|confirm your email|v[ée]rifie[rz]? (votre|ton) (adresse e-?mail|courriel)|verify your identity|v[ée]rifie[rz]? (votre|ton) identit[ée])\b/i },
  { genre: 'connexion-refusee', texte: /\b(unusual (activity|login)|activit[ée] inhabituelle|we couldn['’]t verify|login (attempt )?blocked|connexion bloqu[ée]e|suspicious (activity|login))\b/i },
  { genre: 'debogueur-detache', texte: /\b(debugger (is )?(detached|not attached)|Cannot access a chrome-extension:\/\/ URL of different extension)\b/i },
];

const CONDUITES: Record<GenreDeBlocage, string> = {
  'trop-d-essais':
    'Le site freine : comme une personne, ATTENDS (au moins deux minutes, plus la fois suivante) puis fais UN SEUL nouvel essai, plus lentement. Jamais de boucle : au second blocage du même genre, passe par l’iPhone recopié (outil « iphone ») ou rends la main.',
  'code-par-mail':
    'Un code ou un lien a été envoyé : ouvre toi-même la boîte mail de la personne dans un nouvel onglet (pense aux indésirables), récupère le code et saisis-le. Code par SMS : « demander_la_main ».',
  'image-a-dechiffrer':
    'Une vérification en image : « capturer », lis l’image et réponds-y toi-même, calmement. Échouée deux fois : rends la main, ne force pas.',
  'appli-exigee':
    'Le site exige son application : passe par le vrai iPhone recopié sur le Mac (outil « iphone », geste « etat » d’abord). Relais absent ou iPhone indisponible : prépare tout puis envoie à la personne, par ask_user, la liste numérotée des gestes à faire sur son téléphone, avec « C’est fait » / « Plus tard ».',
  'compte-suspendu':
    'Le compte est suspendu ou bloqué : ARRÊTE-TOI et dis-le. Ne recrée jamais un compte et ne réessaie pas ; une contestation se fait seulement si la personne la demande.',
  'connexion-refusee':
    'Le site trouve la connexion inhabituelle : suis sa vérification (code par mail, confirmation) une seule fois ; s’il refuse encore, rends la main.',
  'debogueur-detache':
    'Une autre extension (menu d’un gestionnaire de mots de passe) a pris la page : appuie sur Échap ou ferme son menu, puis relis — ne réessaie pas en boucle.',
};

function hoteDeLAdresse(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** LA PAGE BLOQUE-T-ELLE ? Lue sur son adresse, son titre et son texte ; `null` sur une page saine. */
export function blocageDeLaPage(page: { url?: string | null; titre?: string | null; texte?: string | null }): BlocageReconnu | null {
  const url = page.url ?? '';
  const hote = hoteDeLAdresse(url);
  /* Le début du texte suffit : une page de blocage le dit d'emblée, et un long article qui cite « captcha » plus bas
     ne doit pas passer pour un blocage. */
  const texte = `${page.titre ?? ''}\n${(page.texte ?? '').slice(0, 1500)}`;
  for (const motif of MOTIFS) {
    if (motif.hote && !motif.hote.test(hote)) continue;
    if (motif.url && !motif.url.test(url)) continue;
    if (motif.texte && !motif.texte.test(texte)) continue;
    if (!motif.url && !motif.texte) continue;
    return { genre: motif.genre, conduite: CONDUITES[motif.genre] };
  }
  return null;
}

/** Combien de fois un même blocage peut être rencontré, sur un même site et dans un même tour, avant de passer la main. */
export const ESSAIS_PAR_BLOCAGE = 2;

/** La ligne ajoutée au résultat de l'outil : le blocage nommé, sa conduite, et le passage de main au second. */
export function ligneDuBlocage(blocage: BlocageReconnu, rencontres: number): string {
  if (rencontres >= ESSAIS_PAR_BLOCAGE) {
    return `BLOCAGE RECONNU : ${blocage.genre} — rencontré ${rencontres} fois sur ce site dans ce tour. PLUS AUCUN ESSAI ici : passe par l’iPhone recopié (outil « iphone ») si le site a une appli, sinon « demander_la_main » ou dis à la personne ce qui bloque.`;
  }
  return `BLOCAGE RECONNU : ${blocage.genre} — conduite : ${blocage.conduite}`;
}

/** Le sujet de la base de connaissances qui tient le carnet de pièges d'un site (« site:x.com »). */
export function sujetDuCarnet(hote: string): string {
  return `site:${hote.replace(/^www\./i, '').toLowerCase()}`;
}

/**
 * LE CARNET DE DÉPART, ce qu'on sait déjà des sites qui bloquent (MEM-7223, MEM-6744, MEM-7222). Il est lu à la
 * première visite d'un domaine dans un tour, avec les unités de la base de connaissances du sujet `site:<hôte>`.
 */
const CARNET_DE_DEPART: Record<string, readonly string[]> = {
  'tiktok.com': [
    'L’inscription est refusée sur ordinateur (renvoi vers /login/download-app) : un compte TikTok se crée depuis l’appli du téléphone.',
    'Sans compte, seules /discover et les pages de vidéo se lisent.',
  ],
  'x.com': [
    'Jamais deux inscriptions de suite depuis le même Chrome : X suspend le compte.',
    'Une suspension se conteste d’abord ; ne jamais recréer un compte à la place.',
  ],
  'facebook.com': ['Le nom d’une Page est bloqué 60 jours après un changement : le confirmer avant de valider.'],
  'linkedin.com': ['Les listes « Taille » et « Type » de la création de page sont des listes natives : à faire à la main si le geste échoue.'],
};

export function carnetDeDepart(hote: string): readonly string[] {
  const propre = hote.replace(/^www\./i, '').toLowerCase();
  const cle = propre === 'twitter.com' ? 'x.com' : Object.keys(CARNET_DE_DEPART).find((c) => propre === c || propre.endsWith(`.${c}`));
  return cle ? (CARNET_DE_DEPART[cle] ?? []) : [];
}

/* ------------------------------------------------------------------ */
/* UN NOM PEUT-ÊTRE DÉFINITIF                                          */
/* ------------------------------------------------------------------ */

/**
 * UN CHAMP DE NOM DÉFINITIF : nom de page, pseudo, nom d'utilisateur, adresse personnalisée, nom de chaîne. Sert à
 * RAPPELER la règle à l'agent quand il y écrit : s'il n'est pas sûr du nom exact (pas dicté mot pour mot, pas dans la
 * fiche du coffre, variante nécessaire, ou délai de changement annoncé), il demande d'abord (ask_user).
 */
const CHAMP_DE_NOM_DEFINITIF =
  /\b(user ?name|username|screen[ _]?name|handle|vanity|pseudo|nom d['’]utilisateur|nom de (la )?page|page name|nom du compte|account name|nom de (la )?cha[îi]ne|channel name|adresse personnalis[ée]e|custom url|@?nom d['’]affichage unique)\b/i;

export function champDeNomDefinitif(libelle: string | null | undefined): boolean {
  return CHAMP_DE_NOM_DEFINITIF.test((libelle ?? '').slice(0, 200));
}

export const RAPPEL_NOM_DEFINITIF =
  'RAPPEL — NOM PEUT-ÊTRE DÉFINITIF : si ce nom ne vient pas MOT POUR MOT de la personne ou de la fiche du coffre, s’il a fallu une variante, ou si le site annonce un délai de changement, demande d’abord confirmation (ask_user : le nom proposé, la contrainte du site, deux à quatre variantes libres vérifiées) — puis valide avec « intention » : « nom-definitif ». Un nom dicté exactement ne se redemande pas.';
