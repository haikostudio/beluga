import { z } from 'zod';
import type { EntreeCompression, RaisonDeRepli } from './models.js';

/**
 * La place réellement occupée dans le contexte d'un agent. Les trois nombres
 * voyagent ensemble : sans mesure ou sans capacité, le contexte entier reste
 * absent — jamais transformé en un faux 0 %.
 */
export const AgentContextUsage = z.object({
  usedTokens: z.number().int().nonnegative(),
  capacityTokens: z.number().int().positive(),
  percentage: z.number().int().min(0).max(100),
  measuredAt: z.number(),
});
export type AgentContextUsage = z.infer<typeof AgentContextUsage>;

/** Calcule un pourcentage lisible, borné à 100 %, seulement à partir d'une vraie mesure. */
export function mesurerContexte(
  usedTokens: number | undefined,
  capacityTokens: number | undefined,
  measuredAt = Date.now(),
): AgentContextUsage | undefined {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(capacityTokens)) return undefined;
  if ((usedTokens as number) < 0 || (capacityTokens as number) <= 0) return undefined;

  const utilises = Math.round(usedTokens as number);
  const capacite = Math.round(capacityTokens as number);
  if (capacite <= 0) return undefined;

  return AgentContextUsage.parse({
    usedTokens: utilises,
    capacityTokens: capacite,
    percentage: Math.min(100, Math.max(0, Math.round((utilises / capacite) * 100))),
    measuredAt,
  });
}

/**
 * REMPLISSAGE DU CONTEXTE D'UN AGENT.
 *
 * Le contexte du modèle n'est ni le total facturé du tour, ni le quota du
 * compte. C'est la taille du DERNIER appel au modèle, rapportée à la fenêtre
 * du modèle qui porte le fil. Cette règle reste pure pour être partagée par
 * Claude, Codex et leurs tests.
 */

/** Le remplissage de la fenêtre à partir duquel le contexte se compresse : 80 %. */
export const SEUIL_COMPRESSION_CONTEXTE = 0.8;

/**
 * UN AGENT DE TÂCHE SE COMPRESSE À 80 % DE SA FENÊTRE, SANS PLAFOND EN JETONS.
 *
 * C'est le chiffre que l'anneau affiche : l'utilisateur voit « 80 % » et la
 * compression part là. Elle remplace la règle DEC-119 (le plus petit entre
 * 0,5 de la fenêtre et 100 000 jetons), posée parce que 0,5 d'une fenêtre d'un
 * million (500 000) n'était jamais atteint — UNE compression en sept jours sur
 * 376 agents. Revenir à une part de fenêtre pure rouvre ce piège : sur un
 * million de jetons le seuil monte à 800 000, hors de portée des contextes qui
 * tournent autour de 150 000. Le choix est assumé (carte « Compression auto du
 * contexte à 80 % ») ; le relevé de quota (section 5 bis) dit si la compression
 * s'éteint de nouveau.
 */

/**
 * Le plafond en jetons propre à un RÔLE, quand il en a un. L'agent de CADRAGE
 * garde le sien, plus bas : il discute un besoin sur un modèle économe, sans
 * ouvrir le projet, et un fil accumulé relu à CHAQUE message coûte plus cher
 * que la compression qui l'évite — un agent mesuré portait 107 155 jetons
 * relus pour reformuler une phrase, soit 28,8 % de tout le quota du serveur.
 */
export const PLAFOND_CONTEXTE_PAR_ROLE: Record<string, number> = {
  cadrage: 60_000,
};

/** Le plafond en jetons d'un rôle ; `Infinity` quand il n'en a pas (agent de tâche). */
export function plafondDeContexte(role?: string): number {
  return (role && PLAFOND_CONTEXTE_PAR_ROLE[role]) || Infinity;
}

/**
 * Le seuil RÉEL de compression, en jetons : 80 % de la fenêtre, jamais
 * au-dessus du plafond du rôle quand il en a un.
 */
export function seuilDeCompression(window: number, plafond = Infinity): number {
  const fenetre = Number.isFinite(window) && window > 0 ? window : 0;
  return Math.min(fenetre * SEUIL_COMPRESSION_CONTEXTE, plafond);
}

/** Combien d'entrées garde l'historique des compressions d'un agent. */
export const LIMITE_HISTORIQUE_COMPRESSIONS = 50;

/**
 * Classe l'échec de la compression native. Un moteur qui ne rend pas la main ou
 * dont le compte a touché sa limite ne rendra pas davantage la main pour un
 * résumé : ces deux causes ne paient PAS un second appel.
 */
export function raisonDeRepli(erreur: string | undefined | null): RaisonDeRepli {
  const texte = (erreur ?? '').toLowerCase();
  if (/ne rendait pas la main|timeout|délai|delai/.test(texte)) return 'delai';
  if (/session limit|usage limit|limit reached|rate.?limit|quota/.test(texte)) return 'quota';
  if (/enoent|introuvable|not found|indisponible/.test(texte)) return 'indisponible';
  if (/mesur/.test(texte)) return 'mesure';
  return 'refus';
}

/** Le résumé sémantique fait un second appel au moteur : inutile s'il vient d'échouer ainsi. */
export function repliSansSecondAppel(raison: RaisonDeRepli): boolean {
  return raison === 'delai' || raison === 'quota' || raison === 'indisponible';
}

function pourcent(tokens: number, window: number): number {
  return window > 0 ? Math.min(100, Math.max(0, Math.round((tokens / window) * 100))) : 0;
}

export interface EtatContexteAgent {
  tokens: number;
  window: number;
  ratio: number;
  /** Une compression ne peut partir qu'après un passage sous le seuil. */
  armed: boolean;
  /** Vrai entre le franchissement et la fin de la compression. */
  pending: boolean;
  lastCompressionAt?: number;
  lastCompressionTokens?: number;
  lastCompressionMethod?: 'native' | 'summary';
  compressionCount?: number;
  /** Les compressions passées, la plus récente en premier, bornées à `LIMITE_HISTORIQUE_COMPRESSIONS`. */
  historiqueCompressions?: EntreeCompression[];
  /** Résumé à remettre au premier tour de la nouvelle session de repli. */
  continuitySummary?: string;
}

export interface ObservationContexte {
  state: EtatContexteAgent;
  shouldCompress: boolean;
}

function entierPositif(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function remplissageContexte(tokens: number, window: number): Pick<EtatContexteAgent, 'tokens' | 'window' | 'ratio'> | null {
  const capacite = entierPositif(window);
  if (!capacite) return null;
  const presents = entierPositif(tokens);
  return { tokens: presents, window: capacite, ratio: presents / capacite };
}

/** Observe un tour fini et arme une seule compression au franchissement. */
export function observerContexte(
  precedent: EtatContexteAgent | undefined,
  tokens: number,
  window: number,
  plafond = Infinity,
): ObservationContexte | null {
  const remplissage = remplissageContexte(tokens, window);
  if (!remplissage) return null;

  // Le seuil se compte en JETONS, pas en part de fenêtre : sinon un modèle qui
  // annonce un million éteint la compression sans que personne ne le voie.
  const seuil = seuilDeCompression(remplissage.window, plafond);

  // Après une compression, il faut d'abord VOIR le contexte sous le seuil
  // avant de pouvoir en déclencher une autre. C'est le garde-fou anti-boucle.
  const armed = precedent?.armed === false ? remplissage.tokens < seuil : true;
  const shouldCompress = armed && remplissage.tokens >= seuil;

  return {
    shouldCompress,
    state: {
      ...precedent,
      ...remplissage,
      armed,
      pending: shouldCompress,
      continuitySummary: precedent?.continuitySummary,
      historiqueCompressions: completerLeNiveauApres(precedent?.historiqueCompressions, remplissage),
    },
  };
}

/**
 * Après un résumé de repli, la nouvelle session n'a pas de mesure : le niveau
 * d'après se lit à la PREMIÈRE mesure qui suit, et complète l'entrée restée
 * ouverte. Une entrée déjà complète ne bouge plus.
 */
function completerLeNiveauApres(
  historique: EntreeCompression[] | undefined,
  remplissage: Pick<EtatContexteAgent, 'tokens' | 'window'>,
): EntreeCompression[] | undefined {
  const derniere = historique?.[0];
  if (!historique || !derniere || derniere.tokensApres !== undefined) return historique;
  return [
    { ...derniere, tokensApres: remplissage.tokens, pourcentageApres: pourcent(remplissage.tokens, remplissage.window) },
    ...historique.slice(1),
  ];
}

/** Grave la compression et abaisse immédiatement le remplissage retenu. */
export function contexteApresCompression(
  precedent: EtatContexteAgent,
  options: {
    at: number;
    method: 'native' | 'summary';
    tokens?: number;
    window?: number;
    summary?: string;
    /** Pour un résumé de repli : pourquoi la compression native n'a pas abouti. */
    raison?: RaisonDeRepli;
  },
): EtatContexteAgent {
  const remplissage = remplissageContexte(options.tokens ?? 0, options.window ?? precedent.window) ?? {
    tokens: 0,
    window: precedent.window,
    ratio: 0,
  };
  // Un niveau d'après n'est connu que si le moteur l'a mesuré : un résumé
  // repart sans mesure (tokens à 0), ce qui n'est PAS un contexte vide.
  const apresConnu = options.method === 'native' && (options.tokens ?? 0) > 0;
  const entree: EntreeCompression = {
    at: options.at,
    method: options.method,
    tokensAvant: precedent.tokens,
    pourcentageAvant: pourcent(precedent.tokens, precedent.window),
    ...(apresConnu
      ? { tokensApres: remplissage.tokens, pourcentageApres: pourcent(remplissage.tokens, remplissage.window) }
      : {}),
    window: precedent.window,
    ...(options.raison ? { raison: options.raison } : {}),
  };
  return {
    ...precedent,
    ...remplissage,
    armed: false,
    pending: false,
    lastCompressionAt: options.at,
    lastCompressionTokens: precedent.tokens,
    lastCompressionMethod: options.method,
    compressionCount: (precedent.compressionCount ?? 0) + 1,
    historiqueCompressions: [entree, ...(precedent.historiqueCompressions ?? [])].slice(0, LIMITE_HISTORIQUE_COMPRESSIONS),
    continuitySummary: options.summary,
  };
}

/**
 * La part de MÉMOIRE d'une reprise : les seuls sujets utiles à la carte et au
 * rôle en cours, jamais la mémoire entière. Les autres sont NOMMÉS, pour que
 * l'agent sache qu'ils existent et aille les chercher s'il en a besoin.
 */
export interface MemoireDeReprise {
  sujets: { id: string; libelle: string; faits: string[] }[];
  autres?: string[];
}

/**
 * POURQUOI le fil du moteur repart à neuf. Les trois causes ne se disent pas de
 * la même façon : après une compression, l'agent a « oublié » un contexte trop
 * lourd ; après un changement de compte, il n'a rien oublié du tout — son fil
 * est simplement resté dans le coffre de l'autre compte, et le travail, lui,
 * n'a pas bougé d'un pouce ; « fil-neuf » couvre tout le reste (session expirée
 * côté moteur, changement de modèle ou de moteur, démon relancé sans fil
 * repris) — la conversation VISIBLE, elle, n'a pas bougé d'une ligne.
 */
export type MotifDeContinuite = 'compression' | 'changement-de-compte' | 'fil-neuf';

const TITRE_DE_CONTINUITE: Record<MotifDeContinuite, string> = {
  compression: 'RÉSUMÉ DE CONTINUITÉ APRÈS COMPRESSION',
  'changement-de-compte': 'RÉSUMÉ DE CONTINUITÉ — TU REPARS SUR UN AUTRE COMPTE',
  'fil-neuf': "RÉSUMÉ DE CONTINUITÉ — CE QUI A DÉJÀ ÉTÉ DIT DANS CETTE CONVERSATION",
};

const CLOTURE_DE_CONTINUITE: Record<MotifDeContinuite, string> = {
  compression:
    "Poursuis depuis cet état. La conversation visible reste intacte dans Beluga Build ; ce résumé remplace seulement l'ancien contexte interne du moteur.",
  'changement-de-compte':
    "POURSUIS EXACTEMENT OÙ TU T'ES ARRÊTÉ. Le compte précédent avait atteint sa limite : seul le fil interne du moteur repart à neuf, car il appartenait au coffre de ce compte. Ton travail, lui, n'a pas bougé — même branche, mêmes fichiers, mêmes étapes. Reprends la liste de tâches ci-dessus là où elle en était, ne recommence rien de ce qui est déjà fait, ne relis pas ce que tu as déjà lu et ne repose pas une question déjà tranchée.",
  'fil-neuf':
    "CE RÉSUMÉ EST LE SUJET EN COURS, PAS UNE ARCHIVE. Ton fil interne repart à neuf, mais la conversation ci-dessus est celle que l'utilisateur a sous les yeux : pour lui, rien n'a été coupé. Le message qui suit peut donc s'y référer sans la nommer — « ça », « cette idée », « ce qu'on vient de dire », « fais-en une carte », « vas-y ». Va CHERCHER le sujet dans les échanges ci-dessus au lieu de demander de quoi il s'agit, et nomme-le en toutes lettres dans ta réponse comme dans toute carte que tu proposes. Ne redis pas bonjour, ne recommence pas la conversation, et ne traite pas comme un sujet neuf ce qui a déjà été discuté.",
};

/**
 * FAUT-IL RAPPELER LE FIL À UN AGENT DONT LA SESSION REPART À NEUF ?
 *
 * Le défaut constaté sur le chef d'orchestre : sa conversation ne meurt jamais,
 * mais le fil du MOTEUR, lui, meurt souvent (session expirée côté fournisseur,
 * modèle changé, moteur changé). Le tour suivant repartait alors avec le seul
 * message qu'on venait d'écrire — « fais-en une carte » n'a plus aucun sujet —,
 * et le chef demandait de quoi on parlait alors que l'écran l'affichait juste
 * au-dessus.
 *
 * Deux cas ont déjà leur résumé et passent avant : la compression
 * (`resumeDeCompression`) et le changement de compte (`filSurUnAutreCompte`).
 * Ce troisième couvre le reste — et il se TAIT sur une conversation réellement
 * neuve : sans échange visible d'avant, il n'y a rien à rappeler.
 */
export function filARappeler(etat: {
  /** Le fil du moteur repart-il de zéro sur ce tour ? */
  nouvelleSession: boolean;
  /** Le résumé posé par une compression, s'il y en a un. */
  resumeDeCompression?: string;
  /** Un fil du même moteur existe-t-il dans le coffre d'un autre compte ? */
  filSurUnAutreCompte?: boolean;
  /** Les échanges déjà visibles dans la conversation, hors demande du tour. */
  echangesVisibles: number;
}): boolean {
  if (!etat.nouvelleSession) return false;
  if (etat.resumeDeCompression?.trim()) return false;
  if (etat.filSurUnAutreCompte) return false;
  return etat.echangesVisibles > 0;
}

export interface EntreeResumeContinuite {
  project: string;
  workdir: string;
  role: string;
  title: string;
  card?: { title: string; description?: string; column: string };
  exchanges: { role: string; content: string }[];
  decisions?: string[];
  todos?: string[];
  attachments?: string[];
  memoire?: MemoireDeReprise;
  /** Pourquoi ce résumé existe ; « compression » par défaut. */
  motif?: MotifDeContinuite;
}

const LIMITE_ECHANGES = 12_000;

/** Une reprise ne réinjecte pas des milliers de signes de mémoire. */
const LIMITE_MEMOIRE = 6_000;

function couper(texte: string, limite: number): string {
  const propre = texte.trim();
  return propre.length <= limite ? propre : `${propre.slice(0, limite - 1)}…`;
}

/**
 * Résumé déterministe de repli : les champs indispensables ont chacun leur
 * place et les échanges récents sont bornés pour que le nouveau contexte soit
 * réellement plus petit que l'ancien.
 */
export function resumeContinuite(entree: EntreeResumeContinuite): string {
  const motif = entree.motif ?? 'compression';
  const lignes = [
    TITRE_DE_CONTINUITE[motif],
    `Projet : ${entree.project}`,
    `Dossier de travail : ${entree.workdir}`,
    `Agent : ${entree.role} — ${entree.title}`,
  ];

  if (entree.card) {
    lignes.push(
      `Carte : ${entree.card.title}`,
      `Colonne : ${entree.card.column}`,
      `Demande de la carte : ${couper(entree.card.description ?? '(sans description)', 4_000)}`,
    );
  }

  /*
   * LA MÉMOIRE D'UNE REPRISE SE CHOISIT. Recharger tous les faits du projet à
   * chaque compression, c'est repayer la mémoire entière à chaque fois — et
   * pousser vers la compression suivante. On ne remet donc que les fichiers de
   * SUJET que touche la carte en cours ; les autres sont nommés, à la demande.
   */
  if (entree.memoire?.sujets.length) {
    lignes.push('Base de connaissances — les unités utiles à cette carte, par identifiant (rouvre-les avec l’outil « memoire », geste « lire ») :');
    let place = 0;
    for (const sujet of entree.memoire.sujets) {
      lignes.push(`${sujet.libelle} :`);
      for (const fait of sujet.faits) {
        const ligne = `- ${couper(fait, 600)}`;
        if (place + ligne.length > LIMITE_MEMOIRE) break;
        lignes.push(ligne);
        place += ligne.length;
      }
    }
  }
  if (entree.memoire?.autres?.length) {
    lignes.push(
      `Autres thèmes de mémoire, à chercher avec l’outil « memoire » seulement s'ils te servent : ${entree.memoire.autres.join(', ')}.`,
    );
  }

  lignes.push(
    `Décisions : ${entree.decisions?.length ? entree.decisions.join(' | ') : 'aucune décision explicite retenue'}`,
    `Liste de tâches : ${entree.todos?.length ? entree.todos.join(' | ') : 'aucune liste active'}`,
    `Pièces jointes utiles : ${entree.attachments?.length ? entree.attachments.join(', ') : 'aucune'}`,
    'Échanges récents :',
  );

  const retenus: string[] = [];
  let taille = 0;
  for (const echange of [...entree.exchanges].reverse()) {
    const ligne = `${echange.role.toUpperCase()} : ${couper(echange.content, 2_400)}`;
    if (!echange.content.trim() || taille + ligne.length > LIMITE_ECHANGES) continue;
    retenus.unshift(ligne);
    taille += ligne.length;
  }
  lignes.push(...(retenus.length ? retenus : ['(aucun échange textuel)']));
  lignes.push(CLOTURE_DE_CONTINUITE[motif]);
  return lignes.join('\n');
}
