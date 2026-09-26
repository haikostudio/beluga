/**
 * UN SEUL RECHARGEMENT, ET JAMAIS DE BOUCLE.
 *
 * L'application se recharge d'elle-même dans DEUX situations, jusqu'ici
 * inconnues l'une de l'autre :
 *
 *  — une nouvelle version prend la main (le service worker cède la place, ou
 *    le filet de six secondes efface les caches d'une version qui refuse de
 *    céder) — `web/src/main.tsx` ;
 *  — l'écran se découvre en décalage de PROTOCOLE avec le démon —
 *    `web/src/lib/client.ts`.
 *
 * Les deux arrivent ensemble à chaque mise en ligne : une nouvelle version
 * apporte presque toujours un nouveau protocole. Chacun se croyait seul et
 * rechargeait, d'où l'impression de rechargements en chaîne.
 *
 * Ces deux chemins passent maintenant par le MÊME compteur, gardé pour la
 * durée de l'onglet. Trois règles, et rien d'autre :
 *
 *  — un motif donné (« version », « protocole ») ne recharge QU'UNE FOIS par
 *    valeur : deux fois le même numéro de version, c'est une boucle ;
 *  — deux rechargements ne se suivent jamais à moins de la fenêtre de repos,
 *    quel que soit leur motif : le second attend, ou renonce ;
 *  — au-delà du plafond, plus rien ne recharge du tout : mieux vaut un écran
 *    un peu vieux qu'une page qui clignote sans fin.
 *
 * La règle vit ici, sans navigateur ni stockage : l'appelant fournit l'état
 * gardé et reçoit l'état à garder. Elle se teste donc seule.
 */

/** Ce que l'onglet retient entre deux rechargements. */
export interface EtatDesRechargements {
  /** La valeur déjà servie pour chaque motif (numéro de version, de protocole). */
  servis?: Record<string, string>;
  /** L'instant du dernier rechargement déclenché. */
  dernier?: number;
  /** Combien de rechargements cet onglet a déjà déclenchés. */
  total?: number;
}

/** Deux rechargements ne se suivent jamais à moins de dix secondes. */
export const REPOS_ENTRE_RECHARGEMENTS_MS = 10_000;

/** Au-delà, on cesse de recharger : c'est une boucle, pas une mise à jour. */
export const PLAFOND_DE_RECHARGEMENTS = 3;

/**
 * Faut-il recharger ? Rend la décision ET l'état à garder. L'appelant
 * n'enregistre l'état que s'il recharge vraiment — sinon un refus consommerait
 * le droit d'un motif qui n'a rien obtenu.
 */
export function deciderDuRechargement(demande: {
  /** « version » ou « protocole » : ce qui réclame le rechargement. */
  motif: string;
  /** Ce qui a changé et justifie la demande (numéro de version, de protocole). */
  valeur: string;
  etat: EtatDesRechargements;
  maintenant: number;
}): { recharger: boolean; etat: EtatDesRechargements; raison: string } {
  const { motif, valeur, etat, maintenant } = demande;
  const servis = etat.servis ?? {};
  const total = etat.total ?? 0;

  if (servis[motif] === valeur) {
    return { recharger: false, etat, raison: 'déjà rechargé pour cette valeur' };
  }
  if (total >= PLAFOND_DE_RECHARGEMENTS) {
    return { recharger: false, etat, raison: 'plafond atteint : boucle probable' };
  }
  if (etat.dernier !== undefined && maintenant - etat.dernier < REPOS_ENTRE_RECHARGEMENTS_MS) {
    /*
     * UN RECHARGEMENT VIENT D'AVOIR LIEU. L'autre mécanisme a déjà fait le
     * travail : la page qui vient de repartir porte forcément le code neuf.
     * On note quand même la valeur servie, pour que ce motif ne revienne pas
     * frapper à la porte une seconde après.
     */
    return {
      recharger: false,
      etat: { ...etat, servis: { ...servis, [motif]: valeur } },
      raison: 'un rechargement vient d’avoir lieu',
    };
  }
  return {
    recharger: true,
    etat: { servis: { ...servis, [motif]: valeur }, dernier: maintenant, total: total + 1 },
    raison: 'rechargement autorisé',
  };
}
