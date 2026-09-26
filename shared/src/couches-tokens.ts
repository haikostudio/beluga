import type { SentContextBlock } from './models.js';

/**
 * SIGNES PAR JETON — MESURÉ, PAS SUPPOSÉ.
 *
 * L'estimation maison comptait QUATRE signes par jeton. C'est à peu près vrai
 * d'un texte anglais ordinaire ; ça ne l'est pas du tout de la documentation de
 * ce projet, dense en identifiants, en chemins de fichiers et en accents.
 * Mesuré le 17/08/2026 sur `CLAUDE.md` par deux tours réels du moteur : 158 743
 * signes pour 73 423 jetons, soit **2,16 signes par jeton** — le compteur
 * sous-évaluait donc de 45 %, et toutes les économies annoncées avec lui
 * étaient d'autant plus optimistes qu'elles portaient sur ce type de texte.
 *
 * On prend 2,2, la valeur mesurée arrondie prudemment vers le haut : mieux vaut
 * annoncer un peu moins d'économie que promettre ce qu'on ne tient pas.
 * Refaire la mesure (`node scripts/audit-quota-claude.mjs --socle`) avant de
 * retoucher ce nombre.
 */
export const SIGNES_PAR_JETON = 2.2;

/**
 * Estimation maison — la même que `scripts/mesure-jetons.mjs` — quand aucune
 * mesure du moteur n'existe pour une part du contexte.
 */
export function jetonsApproches(caracteres: number): number {
  return Math.max(0, Math.round(caracteres / SIGNES_PAR_JETON));
}

/**
 * LE POIDS DE CE MESSAGE, PAS DU TOUR QUI A SUIVI. La mesure rendue par le
 * moteur (`usage.inputTokens`) cumule TOUT le tour agentique déclenché par ce
 * message — chaque aller-retour d'outil interne renvoie sa part fraîche, et le
 * total grossit avec le nombre d'étapes, pas avec ce que ce message a
 * réellement fait partir. On revient donc à ce qui est VRAIMENT propre à ce
 * message : la taille de ce qui a été assemblé et envoyé pour le déclencher,
 * en écartant ce qui n'est qu'un préfixe relu au cache.
 */
export function jetonsMessageEnvoye(contexte: { prompt: string; blocks: SentContextBlock[] }): number {
  const caracteres =
    contexte.prompt.length +
    contexte.blocks.filter((bloc) => !bloc.cached).reduce((total, bloc) => total + bloc.characters, 0);
  return jetonsApproches(caracteres);
}

/**
 * CE QUI REMPLACE LES PASSAGES, dit en clair sous la bulle de mémoire.
 *
 * Plus rien n'est « retrouvé » : la mémoire part sous forme de CARTE de son
 * arbre, et l'agent ouvre lui-même ce qui le concerne. Une case vide sans
 * explication se lirait comme une panne — c'est une décision.
 */
export const RAISON_ARBRE =
  "La mémoire du projet est une BASE DE CONNAISSANCES : au lancement partent la tête du projet, les unités P0 et P1 et le changelog récent, sous un plafond, " +
  "plus des PISTES (des identifiants d'unités, sous un seuil de pertinence) ; l'agent ouvre le reste lui-même avec l'outil « memoire ».";

/* ------------------------------------------------------------------ */
/* CE QUI VIENT DE LA PLATEFORME, CE QUI VIENT DU PROJET               */
/* ------------------------------------------------------------------ */

/** Les trois origines possibles d'un bloc envoyé au moteur. */
export type OrigineDeBloc = 'plateforme' | 'projet' | 'demande';

/**
 * L'ORIGINE D'UN BLOC, telle qu'elle a été posée à l'envoi — ou DÉDUITE de son
 * genre pour les tours enregistrés avant que ce partage existe.
 *
 * La déduction est volontairement grossière : elle ne cherche pas à deviner ce
 * qu'un vieux briefing contenait, elle range chaque genre du côté où il tombe
 * neuf fois sur dix. Un tour ancien affiche donc un partage approché, pas un
 * faux partage précis.
 */
export function origineDuBloc(bloc: Pick<SentContextBlock, 'kind' | 'origine'>): OrigineDeBloc {
  if (bloc.origine) return bloc.origine;
  switch (bloc.kind) {
    case 'request':
    case 'attachment':
      return 'demande';
    case 'format':
    case 'system':
      return 'plateforme';
    default:
      // Briefing, mémoire, carte, extra : tout cela décrivait le projet.
      return 'projet';
  }
}

/** Ce que pèse chaque origine dans un tour, en signes. */
export interface PartsDuContexte {
  plateforme: number;
  projet: number;
  demande: number;
  total: number;
}

/** Le partage d'un tour, additionné une seule fois, en SIGNES. */
export function partsDuContexte(blocs: SentContextBlock[]): PartsDuContexte {
  const parts: PartsDuContexte = { plateforme: 0, projet: 0, demande: 0, total: 0 };
  for (const bloc of blocs) {
    const signes = Math.max(0, bloc.characters);
    parts[origineDuBloc(bloc)] += signes;
    parts.total += signes;
  }
  return parts;
}

/**
 * LE PARTAGE ÉCRIT POUR L'ŒIL — « plateforme 58 % · projet 35 % · demande 7 % ».
 *
 * Les pourcentages sont arrondis puis RATTRAPÉS sur la plus grosse part, sinon
 * trois arrondis donnent 99 % ou 101 % et le lecteur se demande ce qui manque.
 * Un tour vide ne rend rien : une ligne de zéros n'apprend rien.
 */
export function partagePourLOeil(parts: PartsDuContexte): { cle: OrigineDeBloc; nom: string; part: number; signes: number }[] {
  if (parts.total <= 0) return [];
  const noms: Record<OrigineDeBloc, string> = {
    plateforme: 'plateforme',
    projet: 'projet',
    demande: 'demande',
  };
  const lignes = (['plateforme', 'projet', 'demande'] as OrigineDeBloc[]).map((cle) => ({
    cle,
    nom: noms[cle],
    signes: parts[cle],
    part: Math.round((parts[cle] / parts.total) * 100),
  }));
  const somme = lignes.reduce((n, l) => n + l.part, 0);
  if (somme !== 100) {
    const plusGrosse = lignes.reduce((a, b) => (b.signes > a.signes ? b : a));
    plusGrosse.part += 100 - somme;
  }
  return lignes.filter((l) => l.signes > 0);
}
