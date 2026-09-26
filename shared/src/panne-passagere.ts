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

import { aplatiLigne as aplati } from './mots.js';

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
export type MotifDePanne =
  | 'erreur-serveur'
  | 'moteur-surcharge'
  | 'lien-coupe'
  | 'session-morte'
  | 'machine-saturee';

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
  // Codex : « Selected model is at capacity. Please try a different model. » Le
  // modèle demandé est plein CHEZ LE FOURNISSEUR, il repasse tout seul — un
  // essai réel du même modèle quelques minutes plus tard répond normalement.
  { motif: 'moteur-surcharge', regex: /(model|engine) is at capacity/ },
  { motif: 'moteur-surcharge', regex: /at capacity\b.*(try|choose) a different model/ },
  { motif: 'lien-coupe', regex: /(socket hang up|econnreset|etimedout|enetunreach|fetch failed)/ },
  { motif: 'lien-coupe', regex: /(connection (reset|closed) by peer|premature close)/ },
  { motif: 'lien-coupe', regex: /(epipe|write epipe|broken pipe)/ },
  /*
   * LE SOUS-PROCESSUS DU MOTEUR EST MORT SANS UN MOT. « Le moteur s'est arrêté
   * (code null) » : le processus a été emporté par un signal — mémoire épuisée,
   * balayage du système —, il n'a rien annoncé, et c'est la deuxième cause
   * d'interruption relevée en base (7 des 61 « Tour interrompu »).
   *
   * LE CODE 143 EN FAIT PARTIE, et il fut longtemps écarté d'ici au motif qu'il
   * serait « celui de notre propre bouton d'arrêt ». C'était une hypothèse, et
   * elle était fausse : 143, c'est 128 + 15, la signature de SIGTERM, quelle
   * qu'en soit la main. Or `systemctl restart` envoie SIGTERM à TOUT le groupe
   * de contrôle. Relevé le 30/08/2026 à 23:08:58 — « arrêt (SIGTERM) RETENU :
   * une publication est en cours, le serveur ne se coupe pas » — puis, CINQ
   * SECONDES plus tard, trois « tour de l'agent … coupé net par une erreur : Le
   * moteur s'est arrêté (code 143) ». Le démon avait refusé l'arrêt, et ses
   * trois moteurs étaient morts quand même : trois tours perdus, sans le
   * moindre nouvel essai, puisque 143 ne disait « panne » à personne.
   *
   * Le reprendre ici ne masque aucun arrêt volontaire : un arrêt DEMANDÉ à la
   * main est écarté bien plus haut (`arretDemande`, avant toute lecture de
   * ligne). Le démon SAIT quand il a appuyé sur le bouton ; il n'a pas à le
   * deviner d'un code de sortie qu'il ne contrôle pas.
   */
  { motif: 'lien-coupe', regex: /moteur s est arret. \(code (null|137|143)\)/ },
  /*
   * NOTRE PROPRE MACHINE NE PEUT PLUS LANCER DE PROCESSUS. Ce n'est pas le
   * fournisseur qui tombe, c'est le serveur qui refuse un `fork` de plus :
   * `EAGAIN: resource temporarily unavailable, posix_spawn '/usr/bin/node'`,
   * relevé le 08.09.2026 pendant que la mémoire d'échange frôlait les 7 Go sur
   * 8. Le moteur ne démarre pas, le pont d'outils non plus, et rien ne le
   * disait : le tour finissait en échec muet, la carte figée en « En cours ».
   *
   * C'est une panne PASSAGÈRE au même titre qu'une 500 : la pression retombe
   * quand un agent voisin finit. Elle se retente donc, avec les mêmes attentes
   * croissantes — et si elle résiste à tous les essais, la carte repart en file
   * avec un délai, jamais dans la boucle des quinze secondes suivantes
   * (`RAISON_MACHINE_SATUREE`).
   */
  { motif: 'machine-saturee', regex: /\beagain\b/ },
  { motif: 'machine-saturee', regex: /resource temporarily unavailable/ },
  { motif: 'machine-saturee', regex: /\benomem\b/ },
  { motif: 'machine-saturee', regex: /cannot allocate memory/ },
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
/* 1 bis. Ne pas laisser un bruit de fin effacer la vraie cause        */
/* ------------------------------------------------------------------ */

/**
 * Les fins de tour qui ne disent RIEN de la cause. Le tour en reçoit une à
 * chaque arrêt non nul, APRÈS l'erreur qui explique vraiment : sans ce tri, la
 * dernière écrase la première et il ne reste qu'un code de sortie.
 *
 * Deux cas constatés sur `codex-cli` 0.146 : le code de sortie nu, et
 * « Reading additional input from stdin… » — une note de démarrage que le CLI
 * écrit sur sa sortie d'erreur À CHAQUE lancement, y compris quand le tour
 * réussit. Elle arrivait en dernier et remplaçait « Selected model is at
 * capacity », c'est-à-dire la seule ligne qui disait ce qui s'était passé.
 */
const ARRETS_SANS_CAUSE: RegExp[] = [
  /^le moteur s.est arrete( avant la fin)?\.?$/,
  /^le moteur s.est arrete \(code -?\d+\)\.?$/,
  /^reading additional input from stdin/,
  /^le tour a echoue\.?$/,
  /^erreur du moteur\.?$/,
];

/** Ce message explique-t-il l'arrêt, ou n'est-il qu'un bruit de fin de course ? */
export function diseLaCause(message: string | undefined): boolean {
  const propre = (message ?? '').trim();
  if (!propre) return false;
  return !propre
    .split('\n')
    .map((ligne) => aplati(sansDecor(ligne)))
    .filter(Boolean)
    .every((ligne) => ARRETS_SANS_CAUSE.some((bruit) => bruit.test(ligne)));
}

/**
 * Entre la cause déjà retenue et celle qui arrive, garde celle qui EXPLIQUE.
 * Une cause déjà connue ne se laisse pas remplacer par un bruit de fin ; à
 * défaut de cause connue, le bruit vaut mieux que rien.
 */
export function causeLaPlusParlante(actuelle: string | undefined, nouvelle: string | undefined): string | undefined {
  if (!nouvelle?.trim()) return actuelle;
  if (diseLaCause(actuelle) && !diseLaCause(nouvelle)) return actuelle;
  return nouvelle;
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
 * LA MARGE QUI PROTÈGE LA REPRISE DU FILET DE FERMETURE.
 *
 * Pendant l'attente d'un nouvel essai, le processus du moteur est mort : la
 * veille des tours bloqués y voyait un tour abandonné et le refermait, si bien
 * que le nouvel essai repartait dans un tour déjà mort (§ 7 de
 * `shared/src/fin-de-tour.ts`). Le démon écarte donc ce tour du jugement
 * jusqu'à `attenteAvantNouvelEssai(n) + MARGE_DE_REPRISE_MS` — l'attente elle-
 * même, plus de quoi laisser le moteur suivant démarrer et poser son numéro de
 * processus.
 *
 * C'est une ÉCHÉANCE, pas une dispense : une reprise qui ne viendrait jamais
 * rend la main au filet passé ce délai, et le tour se referme comme avant.
 */
export const MARGE_DE_REPRISE_MS = 60_000;

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
    case 'machine-saturee':
      return 'le serveur n’avait plus assez de mémoire pour lancer un programme de plus';
  }
}

/**
 * Cette panne vient-elle de NOTRE machine, et non du fournisseur ? La nuance
 * change ce qu'on fait ensuite : changer de compte ou de modèle n'y peut rien,
 * seul le temps — celui qu'un agent voisin mette à finir — la fait passer.
 */
export function panneDeLaMachine(motif: MotifDePanne | null | undefined): boolean {
  return motif === 'machine-saturee';
}

/**
 * CETTE ERREUR DE COMMANDE EST-ELLE UNE MACHINE PLEINE ?
 *
 * `ligneDePanne` juge une BANNIÈRE de moteur : une ligne courte, en tête de
 * message, sans citation. La sortie brute d'un `git worktree add` n'a rien de
 * tout cela — c'est un pavé d'erreurs — et la saturation y passait donc
 * inaperçue : « impossible d'ouvrir la copie de travail de cette carte :
 * spawn git EAGAIN » finissait en échec DÉFINITIF, la carte arrêtée net,
 * alors que la même cause côté moteur est depuis longtemps une panne
 * passagère qui se retente toute seule.
 *
 * Elle se reconnaît sur le message ENTIER, aux mêmes tournures : la table des
 * processus pleine (`EAGAIN`), la mémoire épuisée (`ENOMEM`), ou le refus
 * système en toutes lettres. Rien d'autre : une erreur git ordinaire (branche
 * occupée, dépôt absent) reste un refus définitif, et doit le rester.
 */
export function machinePleine(erreur: string | undefined): boolean {
  const plat = aplati(erreur ?? '');
  if (!plat) return false;
  return TOURNURES_DE_PANNE.some(({ motif, regex }) => motif === 'machine-saturee' && regex.test(plat));
}

/** Ce que la conversation affiche pendant qu'on retente. */
export function libelleDeLEtape(motif: MotifDePanne, essai: number, attenteMs: number): string {
  const secondes = Math.round(attenteMs / 1000);
  // Une saturation de NOTRE serveur ne se dit pas « panne du moteur » : le
  // moteur n'y est pour rien, et l'utilisateur qui lit cherchera au mauvais
  // endroit.
  const entete = panneDeLaMachine(motif) ? 'Serveur saturé' : 'Panne passagère du moteur';
  return `${entete} : ${causeEnClair(motif)} — nouvel essai ${essai}/${ESSAIS_MAX} dans ${secondes} s`;
}

/** Ce que la conversation affiche quand un nouvel essai a repris la main. */
export function libelleDeLaReprise(essai: number): string {
  return `Travail repris après la panne du moteur (essai ${essai}/${ESSAIS_MAX})`;
}

/** L'intitulé qui sépare l'en-tête de reprise de la demande recopiée. */
export const SEPARATEUR_DEMANDE = '----- DEMANDE DE CE TOUR (à traiter) -----';

/** Ce qu'il faut savoir du tour pour écrire la demande d'un nouvel essai. */
export interface RepriseApresPanne {
  /** Comment la panne a été reconnue. */
  motif: MotifDePanne;
  /** Le numéro du nouvel essai (1, 2, 3). */
  essai: number;
  /**
   * LE PROMPT ENTIER DU TOUR, tel qu'il est parti au premier essai — briefing,
   * contexte et demande comprises. C'est lui qui repart, TOUJOURS : sans lui, le
   * moteur ne reçoit qu'une consigne de reprise et va chercher tout seul « ce
   * qu'il faisait », c'est-à-dire la demande PRÉCÉDENTE de la conversation.
   */
  promptDuTour: string;
  /** Le moteur avait-il déjà écrit ou franchi une étape avant de tomber ? */
  travailCommence: boolean;
  /** Le fil du moteur repart-il à neuf (session oubliée) ? Il ne sait alors plus rien. */
  filNeuf: boolean;
}

/**
 * LA DEMANDE D'UN NOUVEL ESSAI EMPORTE TOUJOURS CELLE DE SON TOUR.
 *
 * Elle ne disait que « continue exactement où tu t'es arrêté ». Sur un fil
 * VIVANT dont le moteur était tombé AVANT d'avoir lu la demande de ce tour-là,
 * la dernière chose que le moteur voyait était la demande PRÉCÉDENTE : il la
 * reprenait donc, et proposait une carte pour elle. Sur un fil NEUF (session
 * expirée, oubliée pour ne pas retomber sur le même refus), il ne voyait plus
 * rien du tout et répondait « je continue, en attente de ta demande ».
 *
 * Le prompt du tour est donc RECOPIÉ à chaque essai, sous un intitulé qui le
 * désigne comme LA demande à traiter. Seul l'en-tête change : ce qui est déjà
 * fait ne se refait pas, mais ce qui est demandé ne se devine plus.
 */
export function demandeDeRepriseApresPanne(reprise: RepriseApresPanne): string {
  const { motif, essai, promptDuTour, travailCommence, filNeuf } = reprise;
  const entete =
    `REPRISE APRÈS UNE PANNE DU MOTEUR (essai ${essai}/${ESSAIS_MAX}). Ton tour précédent a été coupé net : ` +
    `${causeEnClair(motif)}. La panne vient du fournisseur, pas de ton travail : rien de ce que tu as fait n'est perdu.`;

  const consigne = filNeuf
    ? "TON FIL PRÉCÉDENT N'EXISTE PLUS : tu repars sur une conversation vide et tu ne te souviens de rien. " +
      'Tout ce dont tu as besoin est recopié ci-dessous, en entier — traite-le comme un premier tour, ' +
      'et va chercher dans le projet ce qui te manque.'
    : travailCommence
      ? "CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ : reprends ta liste de tâches là où elle en était et finis les étapes " +
        'qui restent. Ne recommence pas ce qui est déjà fait, ne refais pas la lecture du projet que tu as déjà faite.'
      : "TU ES TOMBÉ AVANT D'AVOIR TRAITÉ LA DEMANDE : il n'y a donc rien à reprendre, tout est à faire. " +
        'Traite-la depuis le début.';

  return (
    `${entete}\n\n${consigne}\n\n` +
    'LA DEMANDE DE CE TOUR EST CELLE RECOPIÉE CI-DESSOUS, ET AUCUNE AUTRE. Ne reprends jamais une demande PLUS ' +
    "ANCIENNE de la conversation, même si c'est la dernière dont tu te souviennes : elle a déjà eu sa réponse.\n\n" +
    `${SEPARATEUR_DEMANDE}\n${promptDuTour}`
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
    // Le fournisseur n'est pas en cause quand c'est NOTRE serveur qui étouffe :
    // ce qui doit se libérer, ce sont les agents qui tournent à côté.
    (panneDeLaMachine(motif)
      ? `dès que le serveur aura de nouveau de la place.`
      : `dès que le fournisseur répondra de nouveau.`)
  );
}
