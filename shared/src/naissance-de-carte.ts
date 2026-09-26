/**
 * TOUTE CARTE NAÎT AVEC SA DEMANDE — la règle, écrite UNE FOIS (MEM-3555).
 *
 * Constaté le 26.09.2026 : l'atelier marketing posait « Installer le suivi
 * marketing anonyme » avec une description, et rien d'autre. Sa conversation
 * s'ouvrait VIDE — ni demande, ni cadrage —, on n'y voyait que les réglages de
 * l'agent et « Lancer maintenant ». Chaque auteur de carte (chef, nuit,
 * dépannage, espace client, porte extérieure, marketing) suivait son propre
 * chemin, et certains oubliaient la demande.
 *
 * LA RÈGLE : une carte qui porte quelque chose à dire (une description, ou un
 * auteur qui n'est pas l'utilisateur devant son « + ») porte une DEMANDE
 * lisible — le champ `briefing`, qui ouvre sa conversation
 * (`filAvecLaSynthese`). Faute de demande rédigée par son auteur, elle se
 * compose ici, depuis le titre et la description, en nommant QUI demande
 * (MEM-2495). Seule la carte vide du « + » n'en reçoit pas : c'est le premier
 * message de l'utilisateur qui sera sa demande.
 *
 * Règle PURE : aucun accès à la base ni au moteur, elle se teste seule.
 */

/** Qui pose la carte : c'est ce que la demande de secours nomme. */
export type AuteurDeCarte =
  | 'utilisateur'
  | 'chef'
  | 'nuit'
  | 'marketing'
  | 'depannage'
  | 'espace-client'
  | 'porte-externe'
  | 'agent';

export const LIBELLE_AUTEUR_DE_CARTE: Record<AuteurDeCarte, string> = {
  utilisateur: 'l’utilisateur',
  chef: 'le chef d’orchestre',
  nuit: 'l’agent d’amélioration de la nuit',
  marketing: 'l’atelier marketing du projet',
  depannage: 'la surveillance des sites',
  'espace-client': 'l’espace client',
  'porte-externe': 'un service extérieur',
  agent: 'un agent de Beluga Build',
};

export interface CarteANaitre {
  title: string;
  description?: string;
  briefing?: string;
  origin?: 'user' | 'agent';
}

/** L'auteur retenu quand l'appelant ne le dit pas : lu sur l'origine de la carte. */
export function auteurParDefaut(origin: CarteANaitre['origin']): AuteurDeCarte {
  return origin === 'agent' ? 'agent' : 'utilisateur';
}

/**
 * LA DEMANDE AVEC LAQUELLE LA CARTE NAÎT.
 *
 * - la demande rédigée par l'auteur, si elle existe, telle quelle ;
 * - sinon, dès qu'il y a quelque chose à dire (une description, ou une carte
 *   posée par un agent), une demande composée qui nomme l'auteur ;
 * - sinon rien : la carte vide du « + », dont l'utilisateur écrira la demande.
 */
export function demandeDeNaissance(carte: CarteANaitre, auteur?: AuteurDeCarte): string | undefined {
  const redigee = String(carte.briefing ?? '').trim();
  if (redigee) return redigee;
  const description = String(carte.description ?? '').trim();
  if (!description && carte.origin !== 'agent') return undefined;
  const qui = LIBELLE_AUTEUR_DE_CARTE[auteur ?? auteurParDefaut(carte.origin)];
  const titre = String(carte.title ?? '').trim();
  return [
    `Demande posée par ${qui} : ${titre || 'tâche sans titre'}.`,
    description || 'Aucun détail n’a été écrit avec cette demande : le cadrage le précise avec l’utilisateur.',
  ].join('\n\n');
}

/**
 * CETTE CARTE MANQUE-T-ELLE DE SA DEMANDE ? Vrai quand une demande AURAIT dû
 * naître avec elle (`demandeDeNaissance` en compose une) et qu'elle n'en porte
 * aucune. Sert au rattrapage des cartes posées avant la règle.
 */
export function carteSansDemande(carte: CarteANaitre): boolean {
  if (String(carte.briefing ?? '').trim()) return false;
  return demandeDeNaissance(carte) !== undefined;
}

/**
 * LE PREMIER TOUR DU CADRAGE D'UNE CARTE POSÉE PAR UN AGENT. Même déroulé que
 * la carte acceptée depuis le chat (`demandeDeCadrageDeProposition`) : le
 * cadrage part jusqu'à la compréhension, jamais jusqu'au plan, et RIEN ne se
 * lance. La demande est déjà affichée en tête de la conversation : ce tour
 * part en silence, il ne la redit pas en bulle.
 */
export function demandeDeCadrageDeNaissance(
  carte: { title: string; description?: string; briefing?: string },
  auteur: AuteurDeCarte,
): string {
  const demande = String(carte.briefing ?? '').trim() || String(carte.description ?? '').trim();
  return `CETTE CARTE A ÉTÉ POSÉE PAR ${LIBELLE_AUTEUR_DE_CARTE[auteur].toUpperCase()}, pas tapée par l'utilisateur. Sa demande ouvre déjà ta conversation : c'est ce besoin-là que tu cadres maintenant, exactement comme si l'utilisateur venait de te l'écrire. C'est un TRAVAIL À CADRER, pas une question : ce tour se termine par ta compréhension rendue.

TITRE POSÉ : ${carte.title}
${demande ? `\nLA DEMANDE :\n${demande}\n` : ''}
DÉROULE TON PROCESSUS HABITUEL DE CADRAGE, sans en sauter un temps : garde le titre s'il dit juste le besoin et affine-le sinon, écris la synthèse de cette demande (« resumeDemande »), ouvre la mémoire des sujets touchés, écris la carte (description et niveau), puis RENDS CE QUE TU AS COMPRIS avec « rendre_comprehension » — ET ARRÊTE-TOI LÀ. Rien ne se lance : c'est l'utilisateur qui décide.

VÉRIFIE D'ABORD QUE CETTE DEMANDE RELÈVE BIEN DE CE PROJET. Si elle vise clairement un autre projet, déplace la carte avec « deplacer_vers_projet » et arrête ton tour : le cadrage reprend là-bas.`;
}

/* ------------------------------------------------------------------ */
/* LE DÉPLACEMENT PAR L'AGENT DE CADRAGE                               */
/* ------------------------------------------------------------------ */

/**
 * SEUL L'AGENT DE CADRAGE DE LA CARTE PEUT LA DÉPLACER DE LUI-MÊME, ET
 * SEULEMENT PENDANT LE CADRAGE (décision de l'utilisateur du 26.09.2026). Une
 * carte lancée ne change jamais de projet : sa branche et sa copie de travail
 * appartiennent au dépôt d'origine (DEC-236). Le reste des refus — colonne,
 * trace de travail, demande client, projet archivé — reste celui de
 * `deplacementVersProjetPossible`, sans assouplissement.
 *
 * L'exception tient à UN point : l'agent qui appelle est lui-même « au
 * travail » (c'est son tour qui tourne). Il ne compte donc pas comme l'agent
 * actif qui bloque le déplacement — lui seul, jamais un autre.
 */
export function appelantPeutDeplacerLaCarte(appelant: {
  role: string;
  /** La carte de l'agent qui appelle. */
  cardId?: string;
  /** La carte visée. */
  cardIdVise: string;
}): boolean {
  return appelant.role === 'cadrage' && !!appelant.cardId && appelant.cardId === appelant.cardIdVise;
}

export const REFUS_DEPLACEMENT_HORS_CADRAGE =
  'Seul l’agent de cadrage de cette carte peut la déplacer, et seulement pendant son cadrage : une carte lancée reste dans son projet.';

/** La ligne du fil et du journal : d'où, vers où, par qui, pourquoi. */
export function phraseDeDeplacementParLeCadrage(depuis: string, vers: string, raison?: string): string {
  const pourquoi = String(raison ?? '').trim();
  return `Carte déplacée du projet « ${depuis} » vers « ${vers} » par l’agent de cadrage${pourquoi ? `, parce que ${pourquoi.replace(/^parce que\s+/i, '')}` : ''}.`;
}

/**
 * LE PREMIER TOUR DU CADRAGE DANS LE PROJET D'ACCUEIL. La session du moteur a
 * été refermée : l'agent repart sur l'accueil du NOUVEAU projet (règles,
 * mémoire, code), et ce tour lui redit d'où vient la carte et ce qui était déjà
 * compris, pour qu'il ne reparte pas de zéro.
 */
export function demandeDeCadrageApresDeplacement(etat: {
  depuis: string;
  vers: string;
  title: string;
  briefing?: string;
  description?: string;
  comprehension?: string;
  raison?: string;
}): string {
  const demande = String(etat.briefing ?? '').trim() || String(etat.description ?? '').trim();
  const compris = String(etat.comprehension ?? '').trim();
  return `CETTE CARTE VIENT D'ÊTRE DÉPLACÉE DU PROJET « ${etat.depuis} » VERS « ${etat.vers} » par son agent de cadrage${
    etat.raison ? ` (${etat.raison})` : ''
  }. Tu reprends son cadrage ICI, dans le projet « ${etat.vers} » : sa mémoire et son code sont ceux que tu dois ouvrir maintenant, pas ceux de l'ancien projet.

TITRE : ${etat.title}
${demande ? `\nLA DEMANDE :\n${demande}\n` : ''}${compris ? `\nCE QUI AVAIT DÉJÀ ÉTÉ COMPRIS (dans l'ancien projet — à revérifier ici) :\n${compris}\n` : ''}
DÉROULE TON PROCESSUS HABITUEL DE CADRAGE jusqu'à la compréhension rendue, et arrête-toi là : rien ne se lance sans l'utilisateur. Ne redéplace pas la carte, sauf erreur manifeste.`;
}
