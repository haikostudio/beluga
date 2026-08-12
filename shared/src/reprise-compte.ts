/**
 * « Le compte est à sec au milieu du travail : sur lequel poursuivre ? »
 *
 * Le compte d'un tour est choisi AU LANCEMENT, jamais en plein vol. Quand la
 * limite tombe pendant l'exécution, le moteur s'arrête : jusqu'ici le tour
 * finissait comme une panne ordinaire — agent en échec, carte toujours « En
 * cours », message « Le moteur s'est arrêté (code 1) » — alors que le travail
 * n'a rien de cassé, il lui manque seulement du quota.
 *
 * Les règles de ce fichier tranchent trois choses, sans base ni réseau, donc
 * testables seules :
 *   1. cet arrêt vient-il VRAIMENT d'une limite de compte (`motifDArretQuota`) ;
 *   2. sur quels comptes peut-on poursuivre (`comptesDeReprise`) ;
 *   3. le compte cliqué est-il encore valable au moment du clic
 *      (`jugerRepriseSurCompte`).
 *
 * On ne choisit JAMAIS à la place de l'utilisateur : ces règles préparent le
 * choix, elles ne le prennent pas.
 */

/* ------------------------------------------------------------------ */
/* 1. Reconnaître un arrêt dû au quota                                 */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut savoir d'un tour fini pour dire s'il est tombé sur une limite. */
export interface ArretAJuger {
  /** Le tour s'est-il terminé normalement ? Un tour réussi n'est jamais un arrêt de quota. */
  ok: boolean;
  /** L'arrêt a-t-il été demandé à la main ? Le geste humain l'emporte sur tout. */
  arretDemande?: boolean;
  /**
   * Le moteur a-t-il annoncé la limite par un ÉVÉNEMENT structuré pendant le
   * tour (`rate_limit_event` avec un statut bloquant) ? C'est la preuve la plus
   * sûre : aucun texte à interpréter.
   */
  limiteSignalee?: boolean;
  /** Le message d'erreur remonté par l'adaptateur (souvent le stderr). */
  erreur?: string;
  /** Le texte écrit par le moteur pendant le tour. */
  texte?: string;
}

/** Comment l'arrêt a été reconnu. */
export type MotifDArretQuota = 'limite-structuree' | 'texte-de-limite';

/**
 * Les tournures par lesquelles un moteur annonce SA limite. Elles sont
 * comparées sur une ligne mise à plat (minuscules, apostrophes uniformisées),
 * jamais sur le texte entier : c'est ce qui distingue une bannière du moteur
 * d'une phrase où un agent PARLE de ces bannières.
 */
const TOURNURES_DE_LIMITE: RegExp[] = [
  /hit your (session|usage|weekly|5.hour|five.hour) limit/,
  /(session|usage|weekly|rate) limit reached/,
  /reached your (session|usage|weekly) limit/,
  /exceeded your (usage|rate) limit/,
  /rate.?limit exceeded/,
  /limite d utilisation atteinte/,
];

/**
 * Au-delà, ce n'est plus une bannière du moteur mais un paragraphe : une
 * annonce de limite tient sur une ligne courte.
 */
export const LONGUEUR_LIGNE_MAX = 200;

/**
 * La tournure doit apparaître au DÉBUT de la ligne. On tolère une étiquette
 * (« Error: », « Claude AI … ») devant, pas une phrase entière : au-delà, la
 * ligne raconte quelque chose, elle n'annonce pas.
 */
export const DEBUT_DE_LIGNE = 60;

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

/** Cette ligne EST-ELLE l'annonce d'une limite par le moteur ? */
export function ligneDeLimite(ligne: string): boolean {
  const propre = sansDecor(ligne);
  if (!propre || propre.length > LONGUEUR_LIGNE_MAX) return false;
  // Une ligne qui cite (guillemets, code) parle d'une limite, elle n'en est pas une.
  if (SIGNES_DE_CITATION.some((signe) => propre.includes(signe))) return false;
  const plat = aplati(propre);
  return TOURNURES_DE_LIMITE.some((motif) => {
    const trouve = plat.match(motif);
    return trouve?.index !== undefined && trouve.index <= DEBUT_DE_LIGNE;
  });
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
 * Cet arrêt vient-il d'une limite de compte ? On rend le MOTIF, ou `null` quand
 * rien ne le prouve — dans le doute, l'échec reste un échec ordinaire.
 *
 * Trois garde-fous, tous nécessaires : un tour réussi n'est jamais concerné, un
 * arrêt demandé à la main non plus, et le texte n'est jugé que sur ses DEUX
 * dernières lignes — un agent qui écrit du code sur les quotas en parle au
 * milieu de sa réponse, le moteur, lui, annonce sa limite en dernier.
 */
export function motifDArretQuota(arret: ArretAJuger): MotifDArretQuota | null {
  if (arret.ok) return null;
  if (arret.arretDemande) return null;
  if (arret.limiteSignalee) return 'limite-structuree';

  const lignes = [...dernieresLignes(arret.erreur, 4), ...dernieresLignes(arret.texte, 2)];
  return lignes.some(ligneDeLimite) ? 'texte-de-limite' : null;
}

/** Raccourci de lecture : cet arrêt est-il dû au quota ? */
export function arretDuAuQuota(arret: ArretAJuger): boolean {
  return motifDArretQuota(arret) !== null;
}

/* ------------------------------------------------------------------ */
/* 2. Les comptes sur lesquels poursuivre                              */
/* ------------------------------------------------------------------ */

/** Un compte tel que le relevé de quota le connaît. */
export interface CompteConnu {
  id: string;
  label: string;
  engine: string;
  /** Le fournisseur annonce-t-il encore du quota ? */
  disponible: boolean;
  /** Compte coupé à la main : il ne sert plus, même s'il a du quota. */
  coupe?: boolean;
  /** Le pire des deux pourcentages consommés : sert à classer les candidats. */
  consommePct?: number;
  /** La remise à zéro la plus proche : ce qui permet de dire quand il reviendra. */
  resetsAt?: number;
}

/** Un compte proposé dans le composant « Avec quel compte poursuivre ? ». */
export interface ChoixDeCompte {
  id: string;
  label: string;
  /** Faux : le compte est montré, mais il n'est pas cliquable. */
  disponible: boolean;
  consommePct?: number;
  resetsAt?: number;
}

/**
 * Les comptes proposés pour poursuivre : le MÊME moteur — jamais un autre —,
 * jamais celui qui vient de tomber, jamais un compte coupé à la main. Les
 * disponibles passent devant, puis le moins consommé.
 *
 * Les comptes indisponibles restent dans la liste, marqués comme tels : c'est
 * ce qui permet de dire « aucun compte libre pour l'instant » en nommant ceux
 * qu'on attend, plutôt que d'afficher un vide.
 */
export function comptesDeReprise(
  engine: string,
  compteEpuise: string,
  comptes: readonly CompteConnu[],
): ChoixDeCompte[] {
  return comptes
    .filter((compte) => compte.engine === engine && compte.id !== compteEpuise && !compte.coupe)
    .map((compte) => ({
      id: compte.id,
      label: compte.label,
      disponible: compte.disponible,
      consommePct: compte.consommePct,
      resetsAt: compte.resetsAt,
    }))
    .sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      const conso = (a.consommePct ?? 0) - (b.consommePct ?? 0);
      if (conso) return conso;
      return a.label.localeCompare(b.label);
    });
}

/** Un choix est-il possible tout de suite ? */
export function choixPossible(choix: readonly ChoixDeCompte[]): boolean {
  return choix.some((compte) => compte.disponible);
}

/* ------------------------------------------------------------------ */
/* 3. Le clic : le compte choisi tient-il encore ?                     */
/* ------------------------------------------------------------------ */

/** Pourquoi une reprise est refusée. `null` = elle peut partir. */
export type RefusDeReprise =
  | 'deja-repris'
  | 'compte-inconnu'
  | 'autre-moteur'
  | 'compte-coupe'
  | 'compte-epuise'
  | 'meme-compte';

/**
 * Le compte cliqué est-il encore valable ? La question se repose AU CLIC, sur
 * un relevé frais : entre l'affichage et le geste, un compte a pu tomber, être
 * coupé, ou un autre navigateur a pu reprendre avant.
 *
 * Un `dejaChoisi` ferme la décision pour de bon : c'est ce qui rend le double
 * clic — et le rechargement de la page — sans effet.
 */
export function jugerRepriseSurCompte(entree: {
  /** Le compte déjà retenu pour cette décision, s'il y en a un. */
  dejaChoisi?: string;
  /** Le moteur du tour arrêté : on ne change jamais de moteur. */
  engine: string;
  /** Le compte qui vient d'atteindre sa limite. */
  compteEpuise: string;
  /** Le compte cliqué, tel que le relevé frais le connaît. */
  compte?: CompteConnu;
}): RefusDeReprise | null {
  if (entree.dejaChoisi) return 'deja-repris';
  if (!entree.compte) return 'compte-inconnu';
  if (entree.compte.id === entree.compteEpuise) return 'meme-compte';
  if (entree.compte.engine !== entree.engine) return 'autre-moteur';
  if (entree.compte.coupe) return 'compte-coupe';
  if (!entree.compte.disponible) return 'compte-epuise';
  return null;
}

/** Ce qu'on dit à l'écran quand la reprise est refusée. */
export function messageDeRefus(refus: RefusDeReprise): string {
  switch (refus) {
    case 'deja-repris':
      return 'Le travail a déjà repris sur un compte : rien de neuf n’a été lancé.';
    case 'compte-inconnu':
      return 'Ce compte n’existe plus : la liste des choix vient d’être rafraîchie.';
    case 'autre-moteur':
      return 'Ce compte appartient à un autre moteur : le travail ne change jamais de moteur.';
    case 'compte-coupe':
      return 'Ce compte a été coupé entre-temps : choisissez-en un autre.';
    case 'compte-epuise':
      return 'Ce compte n’a plus de quota : la liste des choix vient d’être rafraîchie.';
    case 'meme-compte':
      return 'C’est le compte qui vient d’atteindre sa limite : choisissez-en un autre.';
  }
}

/* ------------------------------------------------------------------ */
/* 4. Le texte de la reprise                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 5. La liste de tâches qui traverse la coupure                       */
/* ------------------------------------------------------------------ */

/** Une ligne de la liste de tâches, réduite à ce dont la règle a besoin. */
export interface TacheEnCours {
  label: string;
  state: 'todo' | 'running' | 'done';
  startedAt?: number;
  endedAt?: number;
}

/**
 * CE QUI RESTE À FAIRE, TEL QUE LA COUPURE L'A LAISSÉ.
 *
 * La liste de tâches d'un agent vit sur le MESSAGE du tour : un tour coupé par
 * la limite d'un compte emportait donc sa liste avec lui, et le tour de reprise
 * repartait avec une liste vide — plus rien à l'écran, plus rien dans le
 * décroché de la carte, jusqu'à ce que l'agent veuille bien en réécrire une.
 *
 * On la recopie donc ENTIÈRE sur le tour qui reprend : les lignes cochées
 * restent cochées avec leur durée, celles qui restaient à faire restent à
 * faire, et celle qui tournait au moment de la coupure repart sans fin — plus
 * personne ne travaillait dessus, son chronomètre n'a plus à courir. Quand
 * l'agent renverra sa propre liste, `mergeTodos` la rapprochera de celle-ci
 * ligne par ligne, par son libellé : rien ne se perd et rien ne se double.
 */
export function tachesAPoursuivre(todos: readonly TacheEnCours[]): TacheEnCours[] {
  return todos.map((todo) =>
    todo.state === 'running' ? { label: todo.label, state: 'running', startedAt: todo.startedAt } : { ...todo },
  );
}

/**
 * La demande envoyée à l'agent quand il repart. Elle ne redit PAS le travail :
 * l'agent garde son fil, sa branche, ses fichiers et sa liste de tâches. Elle
 * dit seulement pourquoi il s'était arrêté et qu'il continue — jamais qu'il
 * recommence.
 */
export function demandeDeReprise(compteEpuise: string, compteChoisi: string): string {
  return (
    `REPRISE APRÈS ÉPUISEMENT DU QUOTA. Ton tour précédent a été coupé net : le compte ` +
    `« ${compteEpuise} » avait atteint sa limite. Tu repars sur le compte « ${compteChoisi} », ` +
    `avec le même fil, la même branche et les mêmes fichiers.\n\n` +
    `CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ : reprends ta liste de tâches là où elle en était et ` +
    `finis les étapes qui restent. Ne recommence pas ce qui est déjà fait, ne repars pas de zéro, ` +
    `ne refais pas la lecture du projet que tu as déjà faite. Si tu ne sais plus où tu en étais, ` +
    `relis le dépôt et la liste de tâches avant de reprendre.`
  );
}
