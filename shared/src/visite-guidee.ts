/**
 * LA VISITE GUIDÉE DU PREMIER DÉMARRAGE — les règles, sans écran.
 *
 * Décision de l'utilisateur (14/10/2026) : « un guide qui indique à
 * l'utilisateur où cliquer avec une petite bulle d'explication. Mais ça ne
 * remplit rien, c'est lui qui clique et remplit le texte ; il doit pouvoir
 * fermer le guide s'il n'en veut pas. »
 *
 * Une bulle à la fois, posée contre un repère de l'écran (`[data-…]`). Une étape
 * dont le repère n'est pas affiché est SAUTÉE : la visite ne bloque jamais
 * l'écran sur un bouton absent. Fermée ou finie, elle ne revient pas seule ;
 * elle se relance depuis Réglages, page « Installation ».
 */

export const ETAPES_DE_LA_VISITE = [
  { id: 'projet', selecteur: '[data-ouvrir-projets]' },
  { id: 'agent', selecteur: '[data-ligne-nouvel-agent]' },
  { id: 'tableau', selecteur: '[data-tableau]' },
  { id: 'publier', selecteur: '[data-geste-de-lot]' },
  { id: 'services', selecteur: '[data-navigation-compacte]' },
] as const;

export type IdDEtapeDeVisite = (typeof ETAPES_DE_LA_VISITE)[number]['id'];

/** Ce que la préférence du compte retient de la visite. */
export interface EtatDeLaVisite {
  statut: 'a-faire' | 'en-cours' | 'fermee' | 'terminee';
  /** Le rang de l'étape montrée, quand elle est en cours. */
  rang: number;
}

export const CLE_DE_LA_VISITE = 'visite-guidee';
export const VISITE_A_FAIRE: EtatDeLaVisite = { statut: 'a-faire', rang: 0 };

export function etatDeLaVisite(brut: unknown): EtatDeLaVisite {
  const v = (brut && typeof brut === 'object' ? brut : {}) as Partial<EtatDeLaVisite>;
  const statut = ['a-faire', 'en-cours', 'fermee', 'terminee'].includes(String(v.statut)) ? (v.statut as EtatDeLaVisite['statut']) : 'a-faire';
  const rang = typeof v.rang === 'number' && Number.isInteger(v.rang) && v.rang >= 0 ? v.rang : 0;
  return { statut, rang };
}

/**
 * LA VISITE DÉMARRE-T-ELLE TOUTE SEULE ? Seulement sur une installation SANS
 * projet, une fois l'état du serveur reçu et la mise en route refermée — une
 * installation qui a déjà ses projets ne la voit jamais sans la demander.
 */
export function visiteADemarrer(entree: { visite: EtatDeLaVisite; pret: boolean; assistantOuvert: boolean; projets: number }): boolean {
  return entree.visite.statut === 'a-faire' && entree.pret && !entree.assistantOuvert && entree.projets === 0;
}

/**
 * L'ÉTAPE À MONTRER, à partir du rang retenu : la première dont le repère est
 * affiché. `null` : plus aucune étape à montrer, la visite est finie.
 */
export function etapeAMontrer(rang: number, affichee: (selecteur: string) => boolean): number | null {
  for (let i = Math.max(0, rang); i < ETAPES_DE_LA_VISITE.length; i += 1) {
    if (affichee(ETAPES_DE_LA_VISITE[i].selecteur)) return i;
  }
  return null;
}
