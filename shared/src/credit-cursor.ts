/**
 * L'USAGE D'UN COMPTE CURSOR — les règles pures, sans réseau ni disque.
 *
 * Cursor ne publie ni fenêtre de cinq heures ni plafond hebdomadaire : il vend
 * un FORFAIT mensuel, dont il mesure la part consommée en deux paniers (« modèles
 * Cursor » et « autres modèles »), puis facture le dépassement À LA DEMANDE,
 * sous une limite mensuelle. Ce sont exactement les chiffres de son tableau de
 * bord, et ce sont eux que la carte du compte affiche.
 *
 * LA VOIE QUI MARCHE (éprouvée le 14/09/2026, avec la clé personnelle d'un
 * compte) :
 *
 *  1. `POST api2.cursor.sh/auth/exchange_user_api_key`, la clé en `Bearer`,
 *     corps `{}` → `{ accessToken, refreshToken }` : un jeton d'environ une
 *     heure. La clé passée DIRECTEMENT à api2 rend `ERROR_NOT_LOGGED_IN` —
 *     l'échange est obligatoire. Une clé inventée rend 401 « Invalid User API Key ».
 *  2. `POST …/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, le jeton en
 *     `Bearer`, corps `{}` → dates du cycle, `planUsage` (pourcentages) et
 *     `spendLimitUsage` (dépense à la demande, en centimes).
 *  3. `POST …/DashboardService/GetPlanInfo` → nom et prix du forfait.
 *
 * Cette voie n'est pas documentée publiquement : elle peut changer sans
 * prévenir. D'où la règle, inchangée : une réponse qu'on ne sait pas lire rend
 * « indisponible », jamais zéro — zéro serait un chiffre, donc une affirmation.
 *
 * Abandonnées : `POST api.cursor.com/teams/spend` (clé d'administration d'équipe
 * seulement, « Invalid Team API Key » pour une clé personnelle), `GET /v1/me`
 * (nom de la clé seulement), l'événement de fin du CLI (des jetons, aucun prix),
 * et `cursor.com/api/*` (cookie de session, 401).
 */

/** Le serveur du tableau de bord de Cursor — distinct de `API_CURSOR`. */
export const API2_CURSOR = 'https://api2.cursor.sh';
/** Échange la clé personnelle contre un jeton d'environ une heure. */
export const ROUTE_ECHANGE_CLE_CURSOR = '/auth/exchange_user_api_key';
/** La part consommée du cycle en cours et la dépense à la demande. */
export const ROUTE_USAGE_CURSOR = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
/** Le nom et le prix du forfait. */
export const ROUTE_FORFAIT_CURSOR = '/aiserver.v1.DashboardService/GetPlanInfo';

/** L'usage d'un compte Cursor, tel que la carte du compte l'affiche. */
export interface CreditCursor {
  /** Le nom du forfait (« Pro »). */
  forfait?: string;
  /** Son prix, tel que Cursor l'écrit (« $20/mo »). */
  prix?: string;
  /** Part consommée des « modèles Cursor », en pour cent. */
  cursorPct?: number;
  /** Part consommée des « autres modèles », en pour cent. */
  autresPct?: number;
  /** Part consommée au total, en pour cent. */
  totalPct?: number;
  /** Début du cycle de facturation, en millisecondes. */
  debutDuCycle?: number;
  /** Fin du cycle — la remise à zéro —, en millisecondes. */
  finDuCycle?: number;
  /** Dépensé à la demande sur le cycle, en centimes de dollar. */
  demandeCentimes?: number;
  /** Limite mensuelle de la dépense à la demande, en centimes de dollar. */
  demandeLimiteCentimes?: number;
  /** Pourquoi l'usage n'a pas pu être lu, en français. */
  indisponible?: string;
}

function nombre(valeur: unknown): number | undefined {
  const n = typeof valeur === 'string' && valeur.trim() ? Number(valeur) : valeur;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function pourcentage(valeur: unknown): number | undefined {
  const n = nombre(valeur);
  return n === undefined ? undefined : Math.max(0, Math.min(100, n));
}

/**
 * L'USAGE, LU DANS LA RÉPONSE DE `GetCurrentPeriodUsage`. Les nombres arrivent
 * parfois en chaînes (les dates en millisecondes, toujours). Sans aucun des
 * trois chiffres utiles, la réponse est « indisponible ».
 */
export function usageDepuisReponseCursor(corps: unknown): CreditCursor {
  if (!corps || typeof corps !== 'object') {
    return { indisponible: "Cursor n'a pas rendu d'usage lisible." };
  }
  const data = corps as Record<string, any>;
  const plan = data.planUsage && typeof data.planUsage === 'object' ? data.planUsage : {};
  const depense = data.spendLimitUsage && typeof data.spendLimitUsage === 'object' ? data.spendLimitUsage : {};

  const credit: CreditCursor = {
    cursorPct: pourcentage(plan.autoPercentUsed),
    autresPct: pourcentage(plan.apiPercentUsed),
    totalPct: pourcentage(plan.totalPercentUsed),
    debutDuCycle: nombre(data.billingCycleStart),
    finDuCycle: nombre(data.billingCycleEnd),
    demandeCentimes: nombre(depense.individualUsed ?? depense.totalSpend),
    demandeLimiteCentimes: nombre(depense.individualLimit ?? depense.pooledLimit),
  };
  if (credit.cursorPct === undefined && credit.autresPct === undefined && credit.demandeCentimes === undefined) {
    return { indisponible: "Cursor n'a pas rendu d'usage lisible." };
  }
  return retirerLesVides(credit);
}

/** LE FORFAIT, lu dans la réponse de `GetPlanInfo`. Rien de lisible : rien. */
export function forfaitDepuisReponseCursor(corps: unknown): Pick<CreditCursor, 'forfait' | 'prix'> {
  const info = (corps as any)?.planInfo;
  if (!info || typeof info !== 'object') return {};
  return retirerLesVides({
    forfait: typeof info.planName === 'string' && info.planName.trim() ? info.planName.trim() : undefined,
    prix: typeof info.price === 'string' && info.price.trim() ? info.price.trim() : undefined,
  });
}

function retirerLesVides<T extends object>(objet: T): T {
  return Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as T;
}

/**
 * JUSQU'À QUAND LE JETON ÉCHANGÉ SERT, lu dans sa charge (`exp`, en secondes).
 * Un jeton illisible rend `undefined` : l'appelant ne le garde alors pas.
 */
export function expirationDuJetonCursor(jeton: string): number | undefined {
  const charge = jeton.split('.')[1];
  if (!charge) return undefined;
  try {
    const base64 = charge.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(charge.length / 4) * 4, '=');
    const exp = nombre(JSON.parse(atob(base64))?.exp);
    return exp === undefined ? undefined : exp * 1000;
  } catch {
    return undefined;
  }
}

/**
 * UN MONTANT EN DOLLARS, la devise de Cursor, jamais convertie : « 0,69 $ »,
 * « 1 $ ». Les centimes ne s'écrivent que s'il y en a.
 */
export function montantCursorEnClair(centimes: number, format = 'fr-CH'): string {
  const dollars = centimes / 100;
  const entier = Number.isInteger(dollars);
  return `${dollars.toLocaleString(format, {
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: 2,
  })} $`;
}

/**
 * CE QUE BELUGA A MESURÉ ICI, en minutes et en tours. Distinct de l'usage
 * demandé à Cursor : l'un est le compteur de Cursor, l'autre le travail vu par
 * l'application. Rien à dire tant qu'aucun tour n'a été enregistré.
 */
export function usageCursorEnClair(seconds: number, tours: number): string | null {
  if (!Number.isFinite(seconds) || !Number.isFinite(tours) || tours <= 0) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  const duree = minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
  const toursDit = tours === 1 ? '1 tour' : `${tours} tours`;
  return `Travail enregistré ici : ${duree} · ${toursDit}`;
}
