import { z } from 'zod';

/**
 * LE COÛT D'UN TOUR, EN FRANCS — ou rien.
 *
 * Un tour n'est chiffré que si DEUX conditions tiennent : le moteur a rendu sa
 * mesure (entrée, cache, sortie) ET le tarif du modèle qui a porté le tour est
 * connu. Sinon le coût est « indisponible » : jamais une moyenne, jamais un
 * tarif voisin appliqué à un modèle inconnu. Cette règle vit ici, sans base ni
 * disque, pour être lisible et rejouable par son test.
 *
 * Les tarifs sont ceux publiés par Anthropic, en dollars par million de jetons.
 * Le passage en francs se fait par un TAUX ÉCRIT ICI, jamais deviné ailleurs :
 * il se met à jour à un seul endroit, et le libellé affiché dit « environ ».
 */

/** Dollars vers francs. Un seul endroit à corriger quand le taux bouge. */
export const TAUX_USD_CHF = 0.8;

export const TarifModele = z.object({
  /** Entrée nouvelle, en dollars par million de jetons. */
  entree: z.number().nonnegative(),
  /** Jetons relus depuis le cache : nettement moins chers que l'entrée neuve. */
  cache: z.number().nonnegative(),
  /** Jetons produits par le modèle. */
  sortie: z.number().nonnegative(),
});
export type TarifModele = z.infer<typeof TarifModele>;

/**
 * Les tarifs connus, rangés par FAMILLE de modèle. La clé est cherchée dans
 * l'identifiant rendu par le moteur (`claude-sonnet-5`, `gpt-5.4`…), en
 * minuscules : un identifiant qui ne contient aucune de ces clés n'a pas de
 * tarif, et son tour reste sans coût.
 */
export const TARIFS: Record<string, TarifModele> = {
  opus: { entree: 5, cache: 0.5, sortie: 25 },
  sonnet: { entree: 3, cache: 0.3, sortie: 15 },
  haiku: { entree: 1, cache: 0.1, sortie: 5 },
};

/** Le tarif du modèle, ou rien s'il n'est pas connu. */
export function tarifDuModele(model?: string): TarifModele | undefined {
  if (!model) return undefined;
  const nom = model.toLowerCase();
  for (const [cle, tarif] of Object.entries(TARIFS)) {
    if (nom.includes(cle)) return tarif;
  }
  return undefined;
}

export interface MesureDeTour {
  /** Entrée nouvelle rendue par le moteur. */
  inputTokens?: number;
  /** Jetons relus depuis le cache, quand le moteur les communique. */
  cachedTokens?: number;
  /** Jetons produits. */
  outputTokens?: number;
  model?: string;
}

/**
 * Le coût du tour en francs, ou `undefined` quand il ne peut pas être établi
 * honnêtement : tarif inconnu, ou aucune mesure du moteur.
 */
export function coutDuTour(mesure: MesureDeTour): number | undefined {
  const tarif = tarifDuModele(mesure.model);
  if (!tarif) return undefined;

  const entree = mesure.inputTokens ?? 0;
  const cache = mesure.cachedTokens ?? 0;
  const sortie = mesure.outputTokens ?? 0;
  if (entree + cache + sortie <= 0) return undefined;

  const dollars =
    (entree * tarif.entree + cache * tarif.cache + sortie * tarif.sortie) / 1_000_000;
  return dollars * TAUX_USD_CHF;
}

/**
 * Un montant déjà calculé, écrit en francs — ou le mot qui dit qu'il manque.
 * Sert aussi bien à un tour qu'à la somme d'une couche : une seule écriture du
 * montant, donc un seul arrondi.
 */
export function montantEnFrancs(cout: number | undefined): string {
  if (cout === undefined) return 'indisponible';
  // Sous le centime, un arrondi à deux décimales n'afficherait que « 0.00 ».
  const decimales = cout < 0.1 ? 3 : 2;
  return `${cout.toLocaleString('fr-CH', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} CHF`;
}

/** Ce qui s'affiche dans la colonne « coût » : un montant, ou le mot qui le dit. */
export function coutEnClair(mesure: MesureDeTour): string {
  return montantEnFrancs(coutDuTour(mesure));
}
