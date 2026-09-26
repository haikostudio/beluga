import { CompteAClasser, compteQuiRecoitLeTravail } from './choix-de-compte.js';
import type { RepriseDeCompte } from './models.js';
import { aplatiLigne as aplati } from './mots.js';

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
 * Quand une relève sûre existe, le système la prend automatiquement. Le choix
 * manuel reste le filet du cas où aucun relevé ne permet de repartir.
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
  /*
   * LE MANQUE DE CRÉDITS EST UNE LIMITE COMME UNE AUTRE. « Fable 5.1 requires
   * usage credits. Switch to another model, or manage usage credits… » : le
   * moteur s'arrête net sur cette ligne, sans aucun événement structuré, et
   * l'arrêt passait pour une panne ordinaire — donc sans relève.
   */
  /requires usage credits/,
  /(insufficient|out of|no( more)?) (usage )?credits/,
  /credits? (are |is )?(exhausted|depleted)/,
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
export interface CompteConnu extends CompteAClasser {
  id: string;
  label: string;
  engine: string;
  /** Le fournisseur annonce-t-il encore du quota ? */
  disponible: boolean;
  /** Le dernier relevé a-t-il réellement abouti ? Obligatoire pour l'automatique. */
  releveFiable?: boolean;
  /** Compte coupé à la main : il ne sert plus, même s'il a du quota. */
  coupe?: boolean;
  /** Le pire des deux pourcentages consommés : sert à classer les candidats. */
  consommePct?: number;
  /** La remise à zéro la plus proche : ce qui permet de dire quand il reviendra. */
  resetsAt?: number;
}

/**
 * LA CHAÎNE DES RELÈVES, POUR QU'ELLE NE BOUCLE PLUS.
 *
 * Une relève automatique ne connaissait que le compte tombé au tour d'AVANT.
 * Quand le compte de relève tombait à son tour dès le premier message — un
 * relevé de quota qui dit « disponible » un compte que le moteur refuse, un
 * manque de crédits que le relevé ne voit pas —, la relève suivante repartait
 * sur le premier compte, qui retombait, et ainsi de suite : chaque tour
 * ouvrait un message, une reprise, un nouveau tour. Rien ne l'arrêtait.
 *
 * Deux garde-fous, portés par la reprise elle-même et donc écrits :
 *  - un compte tombé AUSSITÔT après une relève rejoint la liste des comptes
 *    déjà essayés, et aucun d'eux ne redevient candidat dans cette chaîne ;
 *  - au-delà de `RELEVES_EN_CHAINE_MAX` relèves automatiques d'affilée sur le
 *    même travail, la main est rendue : le bloc « Avec quel compte
 *    poursuivre ? » s'affiche, et l'utilisateur tranche.
 */
export const DUREE_TOUR_ECLAIR_MS = 3 * 60 * 1000;
export const RELEVES_EN_CHAINE_MAX = 3;

export interface ChaineDeReprise {
  /** Les comptes tombés d'affilée sur ce travail, le dernier compris. */
  comptesEssayes: string[];
  /** Combien de relèves automatiques ont précédé cet arrêt. */
  relevesEnChaine: number;
}

export function chaineDeReprise(entree: {
  /** La reprise qui a lancé le tour qui vient de tomber, s'il en était un. */
  precedente?: Pick<RepriseDeCompte, 'choisi' | 'compteEpuise' | 'comptesEssayes' | 'relevesEnChaine' | 'abandonnee'> | null;
  /** Le compte qui vient de tomber. */
  compteEpuise: string;
  /** Combien de temps le tour tombé a tenu. */
  dureeDuTourMs: number;
}): ChaineDeReprise {
  const precedente = entree.precedente;
  /*
   * UNE RELÈVE RESTE UNE RELÈVE, MÊME SI LE TOUR EST REPARTI SUR UN AUTRE
   * COMPTE QUE CELUI QU'ON AVAIT CHOISI.
   *
   * La chaîne exigeait que le compte tombé soit CELUI qu'on avait retenu. Un
   * tour reparti sur le mauvais compte — un compte imposé perdu en chemin,
   * effacé, renommé — n'était donc jamais une relève : le compteur retombait à
   * zéro à chaque tour, les comptes déjà essayés étaient oubliés, et rien
   * n'arrêtait plus l'enchaînement. C'est exactement ce qui s'est vu le
   * 06.09.2026 : dix tours, un compte choisi à chaque fois, jamais celui qui
   * repartait.
   *
   * Le lien qui fait la chaîne est donc la DÉCISION, pas le compte qui l'a
   * suivie. Et les deux comptes rejoignent les essayés : celui qu'on avait
   * choisi comme celui qui est réellement tombé.
   */
  const estUneReleve = !!precedente && !precedente.abandonnee && !!precedente.choisi;
  if (!estUneReleve) return { comptesEssayes: [entree.compteEpuise], relevesEnChaine: 0 };
  const relevesEnChaine = (precedente.relevesEnChaine ?? 0) + 1;
  /*
   * UNE RELÈVE QUI A TENU N'EST PAS UNE BOUCLE : le tour a tourné pour de bon,
   * la chaîne REPART DE ZÉRO — les comptes d'avant redeviennent candidats et
   * le compteur de relèves ne grimpe plus sur un travail qui avance. Il ne
   * compte que les tours qui n'ont jamais vraiment commencé.
   */
  if (entree.dureeDuTourMs >= DUREE_TOUR_ECLAIR_MS) return { comptesEssayes: [entree.compteEpuise], relevesEnChaine: 0 };
  const deja = precedente.comptesEssayes?.length ? precedente.comptesEssayes : [precedente.compteEpuise];
  return {
    comptesEssayes: [...new Set([...deja, precedente.choisi!, entree.compteEpuise])],
    relevesEnChaine,
  };
}

/**
 * Le compte de relève automatique, selon la même règle que le prochain départ.
 * Il faut un relevé qui le dise disponible : une absence de mesure ne suffit
 * jamais à relancer automatiquement un travail déjà coupé. Et jamais un
 * compte déjà tombé dans cette chaîne, ni au-delà du nombre de relèves permis.
 */
export function compteDeRepriseAutomatique(
  engine: string,
  comptesEpuises: string | readonly string[],
  comptes: readonly CompteConnu[],
  relevesEnChaine = 0,
): CompteConnu | undefined {
  if (relevesEnChaine >= RELEVES_EN_CHAINE_MAX) return undefined;
  const exclus = new Set(typeof comptesEpuises === 'string' ? [comptesEpuises] : comptesEpuises);
  return compteQuiRecoitLeTravail(
    comptes.filter(
      (compte) =>
        compte.engine === engine &&
        !exclus.has(compte.id) &&
        !compte.coupe &&
        compte.disponible &&
        compte.releveFiable === true,
    ),
  );
}

/** Un compte proposé dans le composant « Avec quel compte poursuivre ? ». */
export interface ChoixDeCompte {
  id: string;
  label: string;
  /** Le moteur du compte : la reprise à la main peut changer de moteur. */
  engine: string;
  /** Faux : le compte est montré, mais il n'est pas cliquable. */
  disponible: boolean;
  consommePct?: number;
  resetsAt?: number;
}

/**
 * Les comptes proposés pour poursuivre : jamais celui qui vient de tomber,
 * jamais un compte coupé à la main. Les disponibles passent devant, puis ceux
 * du moteur du tour, puis le moins consommé.
 *
 * LE CHOIX À LA MAIN PEUT CHANGER DE MOTEUR (`tousMoteurs`). Avec un seul
 * compte Claude à sa limite, la liste du même moteur était vide et la carte
 * restait bloquée sans issue (constaté le 13/09/2026). La relève AUTOMATIQUE,
 * elle, ne change jamais de moteur (`compteDeRepriseAutomatique`).
 *
 * Les comptes indisponibles restent dans la liste, marqués comme tels : c'est
 * ce qui permet de dire « aucun compte libre pour l'instant » en nommant ceux
 * qu'on attend, plutôt que d'afficher un vide.
 */
export function comptesDeReprise(
  engine: string,
  compteEpuise: string,
  comptes: readonly CompteConnu[],
  options: { tousMoteurs?: boolean } = {},
): ChoixDeCompte[] {
  return comptes
    .filter(
      (compte) => (options.tousMoteurs || compte.engine === engine) && compte.id !== compteEpuise && !compte.coupe,
    )
    .map((compte) => ({
      id: compte.id,
      label: compte.label,
      engine: compte.engine,
      disponible: compte.disponible,
      consommePct: compte.consommePct,
      resetsAt: compte.resetsAt,
    }))
    .sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if ((a.engine === engine) !== (b.engine === engine)) return a.engine === engine ? -1 : 1;
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
  | 'agent-deja-reparti'
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
  /**
   * L'AGENT EST DÉJÀ REPARTI — il travaille, prépare un tour, ou une reprise
   * attend déjà dans sa file. Un clic de plus injecterait un second compte
   * imposé par-dessus le premier : refusé, en le disant.
   */
  agentDejaReparti?: boolean;
  /** Le moteur du tour arrêté. */
  engine: string;
  /**
   * LE CLIC PEUT CHANGER DE MOTEUR : c'est un choix humain, la relève
   * automatique ne le pose jamais. Sans lui, un compte d'un autre moteur est
   * refusé comme avant.
   */
  moteurLibre?: boolean;
  /** Le compte qui vient d'atteindre sa limite. */
  compteEpuise: string;
  /** Le compte cliqué, tel que le relevé frais le connaît. */
  compte?: CompteConnu;
}): RefusDeReprise | null {
  if (entree.dejaChoisi) return 'deja-repris';
  if (entree.agentDejaReparti) return 'agent-deja-reparti';
  if (!entree.compte) return 'compte-inconnu';
  if (entree.compte.id === entree.compteEpuise) return 'meme-compte';
  if (!entree.moteurLibre && entree.compte.engine !== entree.engine) return 'autre-moteur';
  if (entree.compte.coupe) return 'compte-coupe';
  if (!entree.compte.disponible) return 'compte-epuise';
  return null;
}

/** Ce qu'on dit à l'écran quand la reprise est refusée. */
export function messageDeRefus(refus: RefusDeReprise): string {
  switch (refus) {
    case 'deja-repris':
      return 'Le travail a déjà repris sur un compte : rien de neuf n’a été lancé.';
    case 'agent-deja-reparti':
      return 'L’agent est déjà reparti : attendez la fin de son tour, rien de neuf n’a été lancé.';
    case 'compte-inconnu':
      return 'Ce compte n’existe plus : la liste des choix vient d’être rafraîchie.';
    case 'autre-moteur':
      return 'Ce compte appartient à un autre moteur : une relève automatique ne change jamais de moteur.';
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
  state: 'todo' | 'running' | 'done' | 'unfinished';
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
 *
 * Le tour coupé a été REFERMÉ avant d'être repris (`cloturerLesTaches`) : ses
 * lignes ouvertes portent donc « non faite ». Sur le tour qui reprend, elles
 * redeviennent SIMPLEMENT à faire — c'est bien ce qui reste à mener à bout, et
 * un travail qui repart n'a pas à s'annoncer perdu d'avance.
 */
export function tachesAPoursuivre(todos: readonly TacheEnCours[]): TacheEnCours[] {
  return todos.map((todo) => {
    if (todo.state === 'running') return { label: todo.label, state: 'running', startedAt: todo.startedAt };
    if (todo.state === 'unfinished') return { label: todo.label, state: 'todo' };
    return { ...todo };
  });
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

/* ------------------------------------------------------------------ */
/* 6. Reprendre sur un autre moteur ou un autre modèle                 */
/* ------------------------------------------------------------------ */

/**
 * LA REPRISE CHANGE-T-ELLE DE FIL ? Un autre moteur ne relit jamais la
 * conversation d'un autre ; un autre modèle, si (Claude) ou non (Codex) — la
 * clé de session le tranche d'elle-même (`cleDeSession`). Ici on ne dit que
 * s'il faut une PASSATION écrite : dès que le moteur change.
 */
export function repriseSurUnAutreMoteur(avant: { engine: string }, apres: { engine: string }): boolean {
  return avant.engine !== apres.engine;
}

/** Ce qu'un fil neuf doit savoir pour continuer, sans avoir vu le fil d'avant. */
export interface Passation {
  compteEpuise: string;
  compteChoisi: string;
  moteurAvant: string;
  moteurApres: string;
  modele?: string;
  branche?: string;
  dossier?: string;
  /** Le plan retenu, en Markdown. */
  plan?: string;
  taches: readonly TacheEnCours[];
  /** Les derniers textes rendus par l'agent, du plus ancien au plus récent. */
  derniersEchanges: readonly string[];
}

/** Au-delà, un texte de passation noierait la consigne : on garde la fin. */
export const PASSATION_EXTRAIT_MAX = 2500;

function extrait(texte: string, max = PASSATION_EXTRAIT_MAX): string {
  const propre = texte.trim();
  return propre.length > max ? `…${propre.slice(-max)}` : propre;
}

/**
 * LA DEMANDE D'UN FIL NEUF QUI POURSUIT. L'agent n'a pas la conversation
 * d'avant : on lui écrit ce qu'il en faut — la branche et le dossier, le plan,
 * la liste des étapes faites et restantes, les derniers textes rendus. Il
 * continue sur la même branche, sans recommencer ce qui est fait.
 */
export function demandeDePassation(p: Passation): string {
  const faites = p.taches.filter((t) => t.state === 'done').map((t) => `- [x] ${t.label}`);
  const restantes = p.taches.filter((t) => t.state !== 'done').map((t) => `- [ ] ${t.label}`);
  const blocs = [
    `REPRISE SUR UN AUTRE MOTEUR APRÈS ÉPUISEMENT DU QUOTA. Le travail tournait sous ${p.moteurAvant} ` +
      `sur le compte « ${p.compteEpuise} », qui a atteint sa limite. Tu le poursuis sous ${p.moteurApres}` +
      `${p.modele ? ` (modèle ${p.modele})` : ''}, sur le compte « ${p.compteChoisi} ». Tu n'as pas la ` +
      `conversation d'avant : voici ce qu'il faut en savoir.`,
    p.branche || p.dossier
      ? `DÉPÔT : ${p.dossier ? `dossier « ${p.dossier} »` : ''}${p.branche && p.dossier ? ', ' : ''}${p.branche ? `branche « ${p.branche} »` : ''}. ` +
        `Reste dessus : le travail déjà fait y est, enregistré ou non.`
      : '',
    p.plan ? `PLAN RETENU :\n${extrait(p.plan)}` : '',
    faites.length ? `ÉTAPES DÉJÀ FAITES :\n${faites.join('\n')}` : '',
    restantes.length ? `ÉTAPES QUI RESTENT :\n${restantes.join('\n')}` : '',
    p.derniersEchanges.length
      ? `DERNIERS TEXTES RENDUS AVANT LA COUPURE :\n${p.derniersEchanges.map((texte) => extrait(texte, 1200)).join('\n\n---\n\n')}`
      : '',
    `CONTINUE OÙ LE TRAVAIL S'EST ARRÊTÉ : relis l'état du dépôt (git status, git log, diff) pour ` +
      `constater ce qui est fait, reprends la liste de tâches ci-dessus et finis les étapes qui restent. ` +
      `Ne recommence pas ce qui est déjà fait, ne repars pas de zéro.`,
  ];
  return blocs.filter(Boolean).join('\n\n');
}
