/**
 * Le créneau conseillé d'une carte, côté démon.
 *
 * La RÈGLE vit dans `shared/src/heure-de-lancement.ts`, sans base ni disque.
 * Ici, on ne fait que lui apporter ce qu'elle demande : les heures creuses
 * réglées, le profil de consommation MESURÉ sur l'historique des relevés, et
 * l'état des comptes du moteur visé.
 *
 * AUCUN MOTEUR N'EST APPELÉ, ni ici ni ailleurs sur ce chemin : c'est la
 * contrainte de la demande — une carte proposée ne doit pas coûter un jeton de
 * plus pour porter son conseil. Tout vient de ce que le démon a déjà en base.
 *
 * Le profil est le seul calcul un peu lourd (sept jours de relevés, compte par
 * compte). Il est donc GARDÉ quelques minutes : entre deux propositions du chef
 * d'orchestre, il n'a aucune raison d'avoir bougé.
 */

import {
  creneauDeLancement,
  historiquePourProfil,
  profilHoraire,
  TRANCHES_JOURNEE,
  type CreneauConseille,
  type EngineId,
  type QuotaDuMoteur,
} from '@beluga/shared';
import { cachedQuotas } from './accounts.js';
import * as store from './store.js';

/** Le profil ne se recalcule pas plus souvent que cela. */
const FRAICHEUR_PROFIL_MS = 10 * 60 * 1000;

let profilsGardes: { calculeA: number; parMoteur: Map<EngineId, number[] | null> } | null = null;

/**
 * Le profil d'une journée type pour un moteur : la MOYENNE des profils de ses
 * comptes, chacun déjà ramené à une moyenne de 1.
 *
 * Moyenner des profils normalisés est légitime — ils sont sans unité et
 * décrivent la même chose : « cette heure-là consomme deux fois plus que la
 * moyenne ». Un compte sans profil (historique trop court, trop maigre ou
 * troué) est simplement absent du calcul, jamais compté comme plat : il
 * tirerait le creux vers la moyenne et effacerait la nuit.
 */
function profilDuMoteur(moteur: EngineId): number[] | null {
  const maintenant = store.now();
  if (profilsGardes && maintenant - profilsGardes.calculeA < FRAICHEUR_PROFIL_MS) {
    const deja = profilsGardes.parMoteur.get(moteur);
    if (deja !== undefined) return deja;
  } else {
    profilsGardes = { calculeA: maintenant, parMoteur: new Map() };
  }

  const histoire = store.quotaHistory(7);
  const resume = store.quotaResume();
  const profils = cachedQuotas()
    .filter((quota) => quota.engine === moteur)
    .map((quota) => profilHoraire(historiquePourProfil(resume[quota.id], histoire[quota.id])))
    .filter((profil): profil is number[] => !!profil && profil.length === TRANCHES_JOURNEE);

  const moyen = profils.length
    ? Array.from(
        { length: TRANCHES_JOURNEE },
        (_, heure) => profils.reduce((somme, profil) => somme + profil[heure], 0) / profils.length,
      )
    : null;

  profilsGardes.parMoteur.set(moteur, moyen);
  return moyen;
}

/**
 * L'état des comptes de ce moteur, réduit à ce que la règle regarde. On lit le
 * CACHE : une création de carte ne doit lancer aucun relevé réseau, et un
 * relevé pas encore arrivé n'est pas un refus (la règle sait quoi faire d'une
 * liste vide).
 *
 * Un compte COUPÉ à la main est écarté : il n'est pas épuisé, il est éteint —
 * l'inclure ferait annoncer un manque de quota qui n'existe pas.
 */
function quotasDuMoteur(moteur: EngineId): QuotaDuMoteur[] {
  return cachedQuotas()
    .filter((quota) => quota.engine === moteur && !quota.disabled)
    .map((quota) => ({
      disponible: quota.available !== false,
      reprendA: quota.session?.resetsAt ?? quota.weekly?.resetsAt,
    }));
}

/**
 * Le créneau conseillé pour une carte qu'on vient de poser. Rend `undefined`
 * plutôt qu'un conseil douteux si quoi que ce soit tombe : un tableau sans
 * suggestion reste exactement le tableau d'avant.
 */
export function creneauPourUneCarte(entree: {
  moteur: EngineId;
  ampleurSecondes?: number;
  maintenant?: number;
}): CreneauConseille | undefined {
  try {
    const reglages = store.getSettings();
    return creneauDeLancement({
      maintenant: entree.maintenant ?? store.now(),
      heuresCreuses: { debut: reglages.offPeakStart, fin: reglages.offPeakEnd },
      profil: profilDuMoteur(entree.moteur),
      quotas: quotasDuMoteur(entree.moteur),
      ampleurSecondes: entree.ampleurSecondes,
      seuilLourdSecondes: reglages.heavyTaskSeconds,
    });
  } catch {
    return undefined;
  }
}

