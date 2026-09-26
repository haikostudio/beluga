import { deciderDuRechargement, type EtatDesRechargements } from '@beluga/shared';

/**
 * LA PORTE UNIQUE DU RECHARGEMENT AUTOMATIQUE.
 *
 * Les deux mécanismes qui rechargeaient la page — l'arrivée d'une nouvelle
 * version et le décalage de protocole avec le démon — passent par ici. La règle
 * elle-même vit dans `shared/src/verrou-de-rechargement.ts` ; ce fichier ne fait
 * que la brancher sur le stockage de session et sur le navigateur.
 *
 * L'ENDROIT N'EST PAS PERDU : un rechargement garde le fragment de l'adresse
 * (« #coffre/<id> », « #projet/<id>/tache/<id> »), qui décrit désormais l'écran
 * exact. On revient donc où l'on était, et non à l'écran de départ.
 */
const CLE = 'beluga.rechargements';

function lire(): EtatDesRechargements {
  try {
    const brut = sessionStorage.getItem(CLE);
    return brut ? (JSON.parse(brut) as EtatDesRechargements) : {};
  } catch {
    /* Navigation privée ou stockage refusé : on repart d'un état vide. Le
       plafond ne protège alors plus, mais le repos entre deux rechargements
       tient encore dans la même page. */
    return {};
  }
}

function ecrire(etat: EtatDesRechargements): void {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    /* idem : on recharge sans mémoire plutôt que pas du tout. */
  }
}

/**
 * Recharge la page si c'est utile ET si ce n'est pas une boucle. Rend `true`
 * quand le rechargement est lancé, pour que l'appelant s'arrête là.
 *
 * `avant` sert au chemin qui doit d'abord faire le ménage (désinscrire le
 * service worker, vider les caches) : on ne le fait que si l'on recharge.
 */
export function rechargerUneFois(
  motif: 'version' | 'protocole',
  valeur: string,
  avant?: () => Promise<unknown>,
): boolean {
  const decision = deciderDuRechargement({ motif, valeur, etat: lire(), maintenant: Date.now() });
  ecrire(decision.etat);
  if (!decision.recharger) return false;
  if (avant) void avant().then(() => location.reload());
  else location.reload();
  return true;
}
