import { z } from 'zod';

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

export const SEUIL_COMPRESSION_CONTEXTE = 0.5;

/**
 * LE SEUIL NE PEUT PLUS DÉPENDRE DE LA SEULE FENÊTRE ANNONCÉE.
 *
 * Une PART de fenêtre paraissait raisonnable tant que les modèles annonçaient
 * 200 000 jetons : la moitié faisait 100 000, et la compression partait. Le
 * jour où les modèles sont passés à UN MILLION, le même 0,5 a mis le seuil à
 * 500 000 — hors de portée. Relevé du 17/08/2026 : sur 376 agents en fenêtre
 * d'un million, UNE seule compression en sept jours, pour des contextes qui
 * tournent entre 148 000 et 190 000 jetons de moyenne. La compression n'avait
 * pas été retirée ; elle s'était éteinte toute seule, en silence.
 *
 * Le seuil est donc le PLUS PETIT des deux : la part de la fenêtre (qui protège
 * les petites fenêtres) et un plafond en JETONS (qui survit au prochain modèle
 * à deux millions). 100 000 est la valeur que la règle visait à l'origine.
 */
export const PLAFOND_CONTEXTE_JETONS = 100_000;

/**
 * L'agent de CADRAGE a son propre plafond, plus bas : il discute un besoin sur
 * un modèle économe, sans ouvrir le projet. Un fil de discussion accumulé et
 * relu à CHAQUE message coûte plus cher que la compression qui l'évite — un
 * agent mesuré portait 107 155 jetons relus pour reformuler une phrase, soit
 * 28,8 % de tout le quota du serveur.
 */
export const PLAFOND_CONTEXTE_PAR_ROLE: Record<string, number> = {
  cadrage: 60_000,
};

/** Le plafond en jetons qui s'applique à un rôle. */
export function plafondDeContexte(role?: string): number {
  return (role && PLAFOND_CONTEXTE_PAR_ROLE[role]) || PLAFOND_CONTEXTE_JETONS;
}

/**
 * Le seuil RÉEL de compression, en jetons. Jamais au-dessus du plafond, jamais
 * au-dessus de la moitié de la fenêtre.
 */
export function seuilDeCompression(window: number, plafond = PLAFOND_CONTEXTE_JETONS): number {
  const fenetre = Number.isFinite(window) && window > 0 ? window : 0;
  return Math.min(fenetre * SEUIL_COMPRESSION_CONTEXTE, plafond);
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
  plafond = PLAFOND_CONTEXTE_JETONS,
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
    },
  };
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
  },
): EtatContexteAgent {
  const remplissage = remplissageContexte(options.tokens ?? 0, options.window ?? precedent.window) ?? {
    tokens: 0,
    window: precedent.window,
    ratio: 0,
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
    "Poursuis depuis cet état. La conversation visible reste intacte dans HaikoDev ; ce résumé remplace seulement l'ancien contexte interne du moteur.",
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
    lignes.push('Mémoire du projet — les seuls sujets utiles à cette carte (les autres ne sont PAS rechargés) :');
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
      `Autres sujets de mémoire, à demander avec « project_memory » seulement s'ils te servent : ${entree.memoire.autres.join(', ')}.`,
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
