/**
 * LE CRÉDIT DÉPENSÉ CHEZ CURSOR — les règles pures, sans réseau ni disque.
 *
 * Cursor ne publie ni fenêtre de cinq heures ni plafond hebdomadaire : il
 * FACTURE À LA DÉPENSE. Sa ligne de compte n'a donc pas de jauge
 * (`moteurSansQuota`, `shared/src/moteur-cursor.ts`), et ce qu'il faut lire à la
 * place est un MONTANT.
 *
 * Ce montant ne s'invente pas. Trois sources ont été éprouvées le 14/08/2026,
 * et deux ne donnent rien :
 *
 *  - l'événement de fin du CLI (`type: "result"`) ne porte que des jetons —
 *    `inputTokens`, `outputTokens`, `cacheReadTokens` — et aucun prix ;
 *  - `GET /v1/me` ne rend que le nom de la clé et son propriétaire ;
 *  - `POST /teams/spend` rend bien la dépense du cycle en cours, mais n'accepte
 *    qu'une clé d'ADMINISTRATION d'équipe : une clé personnelle y reçoit
 *    « Invalid Team API Key » (401).
 *
 * D'où la règle : on DEMANDE le montant à Cursor, et quand la clé ne peut pas
 * le lire, on le DIT en clair au lieu d'afficher un chiffre reconstitué depuis
 * des jetons et un tarif deviné. Une mesure inventée est exactement ce que
 * HaikoDev refuse ailleurs.
 */

/** La route de la dépense, sur l'API de Cursor. Elle n'accepte qu'une clé d'équipe. */
export const ROUTE_DEPENSE_CURSOR = '/teams/spend';

/**
 * Ce qui s'affiche quand la clé configurée n'est pas une clé d'administration
 * d'équipe. Ce n'est pas une panne : c'est une information que Cursor ne donne
 * pas à cette clé-là, et la phrase dit quoi faire pour l'obtenir.
 */
export const CREDIT_HORS_DE_PORTEE =
  "Cursor ne donne le montant dépensé qu'à une clé d'administration d'équipe. " +
  'La clé configurée est une clé personnelle : le montant reste lisible sur le tableau de bord de Cursor.';

/** Le crédit d'un compte Cursor, tel que les réglages l'affichent. */
export interface CreditCursor {
  /** Ce qui a été dépensé sur le cycle en cours, en centimes de dollar. */
  centimes?: number;
  /** Le début du cycle de facturation, en millisecondes, quand Cursor le donne. */
  debutDuCycle?: number;
  /** Combien de membres composent le total, quand il en compte plus d'un. */
  membres?: number;
  /** Pourquoi le montant n'a pas pu être lu, en français. */
  indisponible?: string;
}

function nombre(valeur: unknown): number | undefined {
  const n = typeof valeur === 'string' ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * LE MONTANT, LU DANS LA RÉPONSE DE CURSOR. La route rend une ligne par membre
 * de l'équipe (`teamMemberSpend[].spendCents`) : la dépense du compte est leur
 * SOMME, jamais la première ligne — sur une équipe, un seul membre ne dit rien
 * de ce qui est facturé. Une réponse qu'on ne sait pas lire ne rend pas zéro :
 * elle rend « indisponible », car zéro serait un chiffre, donc une affirmation.
 */
export function creditDepuisReponseCursor(corps: unknown): CreditCursor {
  if (!corps || typeof corps !== 'object') {
    return { indisponible: "Cursor n'a pas rendu de montant lisible." };
  }
  const data = corps as Record<string, any>;
  const lignes: any[] = Array.isArray(data.teamMemberSpend) ? data.teamMemberSpend : [];
  if (!lignes.length) {
    return { indisponible: "Cursor n'a rendu aucune ligne de dépense pour ce compte." };
  }

  let centimes = 0;
  let lisible = false;
  for (const ligne of lignes) {
    const part = nombre(ligne?.spendCents);
    if (part === undefined) continue;
    centimes += part;
    lisible = true;
  }
  if (!lisible) return { indisponible: "Cursor n'a pas rendu de montant lisible." };

  const debut = nombre(data.subscriptionCycleStart);
  return {
    centimes: Math.round(centimes),
    debutDuCycle: debut,
    membres: lignes.length > 1 ? lignes.length : undefined,
  };
}

/**
 * LE MONTANT EN CLAIR, en dollars — la devise de Cursor, jamais convertie : un
 * taux de change appliqué ici serait une seconde mesure inventée par-dessus la
 * première.
 */
export function montantCursorEnClair(centimes: number): string {
  const dollars = centimes / 100;
  return `${dollars.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

/**
 * LA PHRASE QUI ACCOMPAGNE LE MONTANT : depuis quand il court. Sans date de
 * début, on ne prétend pas connaître la période.
 */
export function periodeDuCreditCursor(debutDuCycle: number | undefined): string {
  if (!debutDuCycle || !Number.isFinite(debutDuCycle)) return 'Dépense du cycle de facturation en cours.';
  const date = new Date(debutDuCycle);
  if (Number.isNaN(date.getTime())) return 'Dépense du cycle de facturation en cours.';
  return `Dépense depuis le ${date.toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' })}.`;
}
