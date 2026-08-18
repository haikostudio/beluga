/**
 * « Le fournisseur du moteur a renvoyé une 500 : on retente, on n'abandonne pas. »
 *
 * Constat qui a produit ce fichier : une tâche tombait en plein vol après
 * plusieurs dizaines d'étapes réussies, sur « API Error: 500 Internal server
 * error » ou « API Error: Server error mid-response ». Le moteur s'arrêtait en
 * code 1, le tour finissait en échec rouge, et le travail restait à moitié fait
 * — alors que la panne venait du FOURNISSEUR, passagèrement, et pas du travail.
 *
 * Les règles de ce fichier tranchent trois choses, sans base ni réseau, donc
 * testables seules :
 *   1. cet arrêt est-il une panne PASSAGÈRE du fournisseur (`motifDePannePassagere`) ;
 *   2. combien de fois retenter et après quelle attente (`ESSAIS_MAX`,
 *      `attenteAvantNouvelEssai`) ;
 *   3. ce qu'on dit à l'agent qui repart, et à l'utilisateur si tout échoue
 *      (`demandeDeRepriseApresPanne`, `messageDePanneDefinitive`).
 *
 * Elles ne décident JAMAIS à la place du quota : un arrêt reconnu comme une
 * limite de compte (`shared/src/reprise-compte.ts`) garde sa propre route, qui
 * demande à l'utilisateur avec quel compte poursuivre.
 */

/* ------------------------------------------------------------------ */
/* 1. Reconnaître une panne passagère du fournisseur                   */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut savoir d'un tour fini pour dire s'il est tombé sur une panne du fournisseur. */
export interface PanneAJuger {
  /** Le tour s'est-il terminé normalement ? Un tour réussi n'est jamais une panne. */
  ok: boolean;
  /** L'arrêt a-t-il été demandé à la main ? Le geste humain l'emporte sur tout. */
  arretDemande?: boolean;
  /** L'arrêt est-il déjà reconnu comme une limite de compte ? Alors ce n'est pas une panne. */
  limiteQuota?: boolean;
  /** Le message d'erreur remonté par l'adaptateur (souvent le stderr). */
  erreur?: string;
  /** Le texte écrit par le moteur pendant le tour : c'est là que la bannière apparaît. */
  texte?: string;
}

/** Comment la panne a été reconnue — c'est ce qui sera dit en clair à l'écran. */
export type MotifDePanne = 'erreur-serveur' | 'moteur-surcharge' | 'lien-coupe' | 'session-morte';

/**
 * Les tournures par lesquelles un moteur annonce une panne de SON fournisseur.
 * Comparées sur une ligne mise à plat, jamais sur le texte entier : c'est ce qui
 * distingue une bannière du moteur d'une phrase où un agent PARLE de ces
 * bannières — comme la carte qui a produit ce fichier.
 */
const TOURNURES_DE_PANNE: { motif: MotifDePanne; regex: RegExp }[] = [
  { motif: 'erreur-serveur', regex: /api error:? (500|502|503|504|529)\b/ },
  { motif: 'erreur-serveur', regex: /internal server error/ },
  { motif: 'erreur-serveur', regex: /server error mid.response/ },
  { motif: 'erreur-serveur', regex: /(bad gateway|service unavailable|gateway time.?out)/ },
  { motif: 'moteur-surcharge', regex: /overloaded(_error)?/ },
  { motif: 'moteur-surcharge', regex: /server is (temporarily )?(overloaded|busy)/ },
  { motif: 'lien-coupe', regex: /(socket hang up|econnreset|etimedout|enetunreach|fetch failed)/ },
  { motif: 'lien-coupe', regex: /(connection (reset|closed) by peer|premature close)/ },
];

/**
 * Le fil que le moteur connaissait a expiré CÔTÉ FOURNISSEUR — la compression
 * qui l'aurait remplacé n'a pas pu tourner, ou une purge est arrivée entre deux
 * tours. Le `--resume` retombe alors sur ce refus précis, à distinguer d'un
 * « not found » ordinaire (jeton, adresse) : celui-ci se retente, mais sur un
 * fil NEUF — retenter sur le même identifiant répéterait le même refus.
 */
const TOURNURES_SESSION_MORTE: { motif: MotifDePanne; regex: RegExp }[] = [
  { motif: 'session-morte', regex: /no conversation found/ },
  { motif: 'session-morte', regex: /conversation not found/ },
  { motif: 'session-morte', regex: /no session found/ },
  { motif: 'session-morte', regex: /session not found/ },
  { motif: 'session-morte', regex: /unknown conversation/ },
  { motif: 'session-morte', regex: /unknown session/ },
];

/**
 * Les codes qui ne sont PAS une panne du fournisseur : demande refusée, jeton
 * périmé, adresse inconnue. Les retenter ne ferait que répéter le refus.
 */
const TOURNURES_DEFINITIVES: RegExp[] = [/api error:? 4\d\d\b/, /invalid api key/, /not found/, /unauthorized/];

/** Au-delà, ce n'est plus une bannière du moteur mais un paragraphe. */
export const LONGUEUR_BANNIERE_MAX = 200;

/** La tournure doit apparaître au DÉBUT de la ligne : au-delà, la ligne raconte. */
export const DEBUT_DE_BANNIERE = 60;

/** Les signes qui trahissent une CITATION : on ne prend pas un exemple pour un fait. */
const SIGNES_DE_CITATION = ['«', '»', '"', '`'];

/** Minuscules, apostrophes et espaces uniformisés : pour comparer sans se tromper. */
function aplati(ligne: string): string {
  return ligne
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Retire les marques de liste et de mise en forme qui précèdent la ligne. */
function sansDecor(ligne: string): string {
  return ligne.replace(/^[\s>*_\-–—•\d.)]+/, '').trim();
}

/** Cette ligne EST-ELLE l'annonce d'une panne du fournisseur ? Rend son motif, ou `null`. */
export function ligneDePanne(ligne: string): MotifDePanne | null {
  const propre = sansDecor(ligne);
  if (!propre || propre.length > LONGUEUR_BANNIERE_MAX) return null;
  // Une ligne qui cite (guillemets, code) parle d'une panne, elle n'en est pas une.
  if (SIGNES_DE_CITATION.some((signe) => propre.includes(signe))) return null;
  const plat = aplati(propre);
  // Vérifiée AVANT l'exclusion générale : « no conversation found » matche
  // aussi le motif générique `/not found/`, qui écarterait sinon ce cas précis.
  for (const { motif, regex } of TOURNURES_SESSION_MORTE) {
    const trouve = plat.match(regex);
    if (trouve?.index !== undefined && trouve.index <= DEBUT_DE_BANNIERE) return motif;
  }
  if (TOURNURES_DEFINITIVES.some((motif) => plat.match(motif))) return null;
  for (const { motif, regex } of TOURNURES_DE_PANNE) {
    const trouve = plat.match(regex);
    if (trouve?.index !== undefined && trouve.index <= DEBUT_DE_BANNIERE) return motif;
  }
  return null;
}

/** Les lignes non vides d'un texte, de la dernière vers la première. */
function dernieresLignes(texte: string | undefined, combien: number): string[] {
  if (!texte) return [];
  return texte
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean)
    .slice(-combien);
}

/**
 * Cet arrêt vient-il d'une panne passagère du fournisseur ? On rend le MOTIF, ou
 * `null` quand rien ne le prouve — dans le doute, l'échec reste un échec.
 *
 * Quatre garde-fous, tous nécessaires : un tour réussi n'est jamais concerné, un
 * arrêt demandé à la main non plus, un arrêt déjà reconnu comme une limite de
 * compte garde sa propre route, et le texte n'est jugé que sur ses DERNIÈRES
 * lignes — un agent qui écrit du code sur les erreurs 500 en parle au milieu de
 * sa réponse ; le moteur, lui, annonce sa panne en dernier.
 */
export function motifDePannePassagere(panne: PanneAJuger): MotifDePanne | null {
  if (panne.ok) return null;
  if (panne.arretDemande) return null;
  if (panne.limiteQuota) return null;

  const lignes = [...dernieresLignes(panne.erreur, 4), ...dernieresLignes(panne.texte, 3)];
  for (const ligne of lignes) {
    const motif = ligneDePanne(ligne);
    if (motif) return motif;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Combien d'essais, et après quelle attente                        */
/* ------------------------------------------------------------------ */

/**
 * Le nombre de NOUVEAUX essais après le premier. Borné : une panne qui dure
 * n'est plus passagère, et un agent qui retente sans fin brûle du quota sans
 * jamais le dire.
 */
export const ESSAIS_MAX = 3;

/** La première attente. Les suivantes triplent : 5 s, 15 s, 45 s. */
export const ATTENTE_INITIALE_MS = 5_000;

/** Personne n'attend plus de deux minutes : au-delà, mieux vaut rendre la main. */
export const ATTENTE_MAX_MS = 120_000;

/**
 * L'attente avant le n-ième nouvel essai (1 = le premier). Croissante : une
 * panne de fournisseur passe rarement dans la seconde, et marteler l'API pendant
 * qu'elle tombe ne fait qu'ajouter au problème.
 */
export function attenteAvantNouvelEssai(essai: number): number {
  const rang = Math.max(1, Math.floor(essai));
  return Math.min(ATTENTE_MAX_MS, ATTENTE_INITIALE_MS * Math.pow(3, rang - 1));
}

/* ------------------------------------------------------------------ */
/* 3. Ce qui se dit — à l'agent, puis à l'utilisateur                  */
/* ------------------------------------------------------------------ */

/** L'identifiant de l'étape affichée dans la conversation pendant les essais. */
export const ETAPE_PANNE_ID = 'panne-moteur';

/** La cause, dite pour un lecteur non informaticien. */
export function causeEnClair(motif: MotifDePanne): string {
  switch (motif) {
    case 'erreur-serveur':
      return 'le fournisseur du moteur a renvoyé une erreur de son côté (erreur 500)';
    case 'moteur-surcharge':
      return 'le moteur était surchargé chez le fournisseur';
    case 'lien-coupe':
      return 'le lien avec le moteur a été coupé en cours de route';
    case 'session-morte':
      return 'la session de conversation avec le moteur avait expiré';
  }
}

/** Ce que la conversation affiche pendant qu'on retente. */
export function libelleDeLEtape(motif: MotifDePanne, essai: number, attenteMs: number): string {
  const secondes = Math.round(attenteMs / 1000);
  return `Panne passagère du moteur : ${causeEnClair(motif)} — nouvel essai ${essai}/${ESSAIS_MAX} dans ${secondes} s`;
}

/** Ce que la conversation affiche quand un nouvel essai a repris la main. */
export function libelleDeLaReprise(essai: number): string {
  return `Travail repris après la panne du moteur (essai ${essai}/${ESSAIS_MAX})`;
}

/**
 * La demande envoyée à l'agent qui repart. Elle ne redit PAS le travail :
 * l'agent garde son fil, sa branche, ses fichiers et sa liste de tâches. Elle
 * dit seulement pourquoi il s'est arrêté et qu'il CONTINUE — jamais qu'il
 * recommence.
 */
export function demandeDeRepriseApresPanne(motif: MotifDePanne, essai: number): string {
  return (
    `REPRISE APRÈS UNE PANNE DU MOTEUR (essai ${essai}/${ESSAIS_MAX}). Ton tour précédent a été coupé net : ` +
    `${causeEnClair(motif)}. La panne vient du fournisseur, pas de ton travail : rien de ce que tu as fait n'est perdu.\n\n` +
    `CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ : reprends ta liste de tâches là où elle en était et finis les étapes ` +
    `qui restent. Ne recommence pas ce qui est déjà fait, ne repars pas de zéro, ne refais pas la lecture du projet ` +
    `que tu as déjà faite. Si tu ne sais plus où tu en étais, relis le dépôt et ta liste de tâches avant de reprendre.`
  );
}

/**
 * Ce qui s'affiche quand TOUS les essais ont échoué. La tâche est INTERROMPUE,
 * pas ratée : la cause réelle est nommée, et l'on dit où en est le travail.
 */
export function messageDePanneDefinitive(motif: MotifDePanne, essais: number): string {
  return (
    `Travail interrompu : ${causeEnClair(motif)}. ` +
    `${essais > 1 ? `${essais} nouveaux essais ont` : '1 nouvel essai a'} été tenté${essais > 1 ? 's' : ''}, sans succès. ` +
    `Ce n'est pas un échec de la tâche : le travail déjà fait est intact, et il repartira où il s'était arrêté ` +
    `dès que le fournisseur répondra de nouveau.`
  );
}
