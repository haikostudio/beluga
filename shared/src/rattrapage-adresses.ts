/**
 * LE RATTRAPAGE DES ADRESSES DE CONTRÔLE (30/09/2026).
 *
 * Les rubriques « Déploiement » et « Mise en production » doivent toujours
 * porter l'adresse que l'étape contrôle : `devUrl` (le site de travail, sur ce
 * serveur) et `adresseProduction` (le site public). La plupart des projets
 * n'en avaient aucune. Le démon les remplit UNE fois au démarrage
 * (`server/src/rattrapage-adresses.ts`) ; ensuite, l'agent de configuration les
 * tient à jour en écrivant son processus (`adresseDeControleAEcrire`).
 *
 * Règle PURE : ce qu'un projet reçoit, sans base ni réseau.
 *   - un réglage déjà rempli n'est JAMAIS touché ;
 *   - l'adresse publique rattrapée porte la marque `adresseProductionRattrapee`,
 *     qui n'ouvre aucun suivi des visites (choix de l'utilisateur : le suivi ne
 *     part que pour une adresse saisie ou changée ensuite) ;
 *   - Beluga Build lui-même (`isSelf`) ne reçoit pas d'adresse publique : sa
 *     vitrine a son propre projet.
 */
export type AdressesARattraper = { dev?: string; production?: string };

export type PatchDeRattrapage = {
  devUrl?: string;
  adresseProduction?: string;
  adresseProductionRattrapee?: true;
};

export function patchDeRattrapage(
  projet: { devUrl?: string; adresseProduction?: string; isSelf?: boolean } | undefined,
  adresses: AdressesARattraper | undefined,
  joignable: (adresse: string) => boolean = () => true,
): PatchDeRattrapage | null {
  if (!projet || !adresses) return null;
  const patch: PatchDeRattrapage = {};
  if (adresses.dev && !projet.devUrl?.trim() && joignable(adresses.dev)) patch.devUrl = adresses.dev;
  if (adresses.production && !projet.isSelf && !projet.adresseProduction?.trim() && joignable(adresses.production)) {
    patch.adresseProduction = adresses.production;
    patch.adresseProductionRattrapee = true;
  }
  return Object.keys(patch).length ? patch : null;
}
