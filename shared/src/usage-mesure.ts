/* ------------------------------------------------------------------ */
/* La barre du MOIS de Xiaomi MiMo (abonnement Token Plan)             */
/* ------------------------------------------------------------------ */

/**
 * Un abonnement MiMo n'a ni fenêtre de cinq heures ni semaine : il a UN
 * plafond de jetons par mois, qui repart à zéro à sa date de renouvellement.
 * Xiaomi ne le rend par aucune interface lisible avec une clé : l'utilisateur
 * saisit dans les réglages du compte le plafond, la date de renouvellement et,
 * quand il veut recaler, ce que sa console Xiaomi affiche déjà comme consommé.
 * Beluga y ajoute les jetons qu'il a lui-même envoyés depuis ce relevé.
 *
 * Le chiffre est une ESTIMATION, et l'écran le dit : la même clé peut servir
 * ailleurs (HaikoBill), et Beluga ne voit pas ce trafic. Sans plafond saisi,
 * aucune barre n'est fabriquée.
 *
 * Les règles vivent ici, sans base ni disque : elles se testent seules.
 */

import type { ForfaitMensuel } from './models.js';

/** Un mois de forfait qui ne dit pas sa date de renouvellement : trente jours. */
export const MOIS_PAR_DEFAUT_MS = 30 * 24 * 3600 * 1000;
/** Jusqu'où remonter chercher des tours : un cycle dure 31 jours au plus. */
export const HISTOIRE_DU_MOIS_MS = 35 * 24 * 3600 * 1000;

/** Un tour enregistré : quand il s'est terminé, et ce qu'il a consommé. */
export interface EvenementDUsage {
  at: number;
  valeur: number;
}

/** La barre du mois : pourcentage, durée du cycle et prochaine remise à zéro. */
export interface FenetreMesuree {
  usedPct: number;
  durationSeconds: number;
  resetsAt?: number;
}

/**
 * Ajoute `n` mois à une date (UTC) en gardant le jour du mois quand il existe :
 * le 31 janvier + 1 mois donne le dernier jour de février, jamais mars.
 */
export function ajouterMois(ms: number, n: number): number {
  const d = new Date(ms);
  const mois = d.getUTCMonth() + n;
  const annee = d.getUTCFullYear() + Math.floor(mois / 12);
  const m = ((mois % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(annee, m + 1, 0)).getUTCDate();
  return Date.UTC(
    annee,
    m,
    Math.min(d.getUTCDate(), dernierJour),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/**
 * LE CYCLE EN COURS à `maintenant`, d'après une date de renouvellement — passée
 * ou à venir, la même règle : les renouvellements tombent chaque mois, au même
 * jour. Chaque borne se calcule depuis la date saisie, jamais de proche en
 * proche : un forfait renouvelé le 31 reste au 31 quand le mois le permet.
 */
export function cycleDuMois(renouvellement: number, maintenant: number): { debut: number; fin: number } {
  const ecart = new Date(maintenant);
  const ancre = new Date(renouvellement);
  let k = (ecart.getUTCFullYear() - ancre.getUTCFullYear()) * 12 + (ecart.getUTCMonth() - ancre.getUTCMonth());
  while (ajouterMois(renouvellement, k) > maintenant) k -= 1;
  while (ajouterMois(renouvellement, k + 1) <= maintenant) k += 1;
  return { debut: ajouterMois(renouvellement, k), fin: ajouterMois(renouvellement, k + 1) };
}

/** La somme des jetons envoyés dans `]depuis, maintenant]`. */
function somme(evenements: readonly EvenementDUsage[], depuis: number, maintenant: number): number {
  return evenements.filter((e) => e.at > depuis && e.at <= maintenant).reduce((s, e) => s + Math.max(0, e.valeur), 0);
}

/**
 * LA BARRE DU MOIS. `undefined` sans plafond saisi : une barre à 0 % dirait
 * « rien consommé » quand on n'en sait rien. Un compte que le fournisseur a
 * refusé faute de forfait est plein, quoi qu'on ait saisi ou mesuré : c'est le
 * seul chiffre RÉEL qu'on ait.
 *
 * Le consommé part du dernier relevé saisi SI ce relevé date du cycle en cours
 * — les jetons envoyés depuis s'y ajoutent —, sinon (relevé d'un mois révolu,
 * ou jamais fait) il repart de zéro au début du cycle, avec les seuls tours
 * mesurés depuis.
 */
export function barreMensuelle(
  forfait: ForfaitMensuel | undefined,
  evenements: readonly EvenementDUsage[],
  maintenant: number,
  soldeEpuise = false,
): FenetreMesuree | undefined {
  const cycle = forfait?.renouvellement !== undefined ? cycleDuMois(forfait.renouvellement, maintenant) : undefined;
  const duree = cycle ? (cycle.fin - cycle.debut) / 1000 : MOIS_PAR_DEFAUT_MS / 1000;
  const resetsAt = cycle?.fin;
  if (soldeEpuise) return { usedPct: 100, durationSeconds: duree, ...(resetsAt !== undefined ? { resetsAt } : {}) };

  const plafond = forfait?.plafond;
  if (plafond === undefined || !Number.isFinite(plafond) || !(plafond > 0)) return undefined;

  const releveAt = forfait?.releveAt;
  const releveDuCycle = releveAt !== undefined && (!cycle || releveAt >= cycle.debut);
  const base = releveDuCycle ? Math.max(0, forfait?.consommeAuReleve ?? 0) : 0;
  const depuis = releveDuCycle ? (releveAt as number) : (cycle ? cycle.debut - 1 : maintenant - MOIS_PAR_DEFAUT_MS);
  const consomme = base + somme(evenements, depuis, maintenant);

  return {
    usedPct: Math.min(100, Math.max(0, (consomme / plafond) * 100)),
    durationSeconds: duree,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}
