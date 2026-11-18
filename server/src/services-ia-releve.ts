/**
 * LE RELEVÉ DES SERVICES D'IA CONNECTÉS (carte « Quotas des services d'IA », 08/11/2026). Lit le coffre,
 * reconnaît les services par la liste fermée de `shared/src/services-ia.ts`, demande UN solde par compte —
 * en parallèle, chaque appel borné à 10 s — et garde le résultat cinq minutes pour ne pas marteler les
 * services à chaque ouverture du volet.
 *
 * Ce relevé vit À PART de celui des moteurs : il n'est appelé que par le volet des quotas et par sa propre
 * tournée de fond (toutes les 30 min, minuteur `unref`), jamais sur le chemin d'un lancement (« le relevé des
 * quotas ne retient jamais un tour en otage »). Seuls des chiffres, un état et un lien public en sortent :
 * AUCUNE clé ne part vers l'interface.
 *
 * Après chaque relevé NEUF : diffusion de l'événement `servicesIa` à tous les écrans (point orange du pied
 * de colonne), puis notification « à sec » pour chaque service qui VIENT de tomber à zéro (`basculesASec`).
 * Le dernier niveau de chaque service est gardé en base (`meta`), pour qu'un redémarrage ne renotifie pas un
 * service déjà vide.
 */

import {
  basculesASec,
  comptesDeServicesIa,
  lireSoldeIa,
  requeteDeSoldeIa,
  soldeNonCommunique,
  type CompteDeServiceIa,
  type NiveauDuSolde,
  type SoldeDeServiceIa,
} from '@beluga/shared';
import { bus } from './bus.js';
import { listerAcces } from './coffre-fort.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import { getSettings } from './store.js';

const DELAI_PAR_APPEL_MS = 10_000;
export const DUREE_DU_CACHE_MS = 5 * 60_000;
/** La tournée de fond : assez souvent pour prévenir avant la panne, assez peu pour ne rien coûter. */
export const PERIODE_DE_LA_TOURNEE_MS = 30 * 60_000;
/** Le premier relevé attend que le démon ait fini de démarrer. */
const PREMIER_RELEVE_MS = 90_000;
const CLE_DES_NIVEAUX = 'servicesIa.niveaux';

let cache: { at: number; soldes: SoldeDeServiceIa[] } | null = null;
let enCours: Promise<SoldeDeServiceIa[]> | null = null;

type Appel = (adresse: string, init: RequestInit) => Promise<Response>;

/** Le solde d'UN compte : la première clé qui répond fait foi ; une clé refusée laisse sa chance à la suivante. */
async function soldeDuCompte(compte: CompteDeServiceIa, appel: Appel, maintenant: number): Promise<SoldeDeServiceIa> {
  const f = compte.fournisseur;
  const base = { id: f.id, nom: f.nom, lien: f.lien, unite: f.unite, releveLe: maintenant };
  let dernier: SoldeDeServiceIa | null = null;
  for (const cle of compte.cles) {
    const requete = requeteDeSoldeIa(f.id, cle, compte.cleDeCompte);
    if (!requete) return soldeNonCommunique(f, maintenant);
    try {
      const reponse = await appel(requete.adresse, {
        method: requete.methode,
        headers: requete.entetes,
        signal: AbortSignal.timeout(DELAI_PAR_APPEL_MS),
      });
      const corps = await reponse.json().catch(() => null);
      dernier = { ...base, ...lireSoldeIa(f.id, reponse.status, corps) };
    } catch (err: any) {
      const coupe = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      dernier = { ...base, etat: 'erreur', raison: coupe ? 'le service n’a pas répondu à temps' : 'le service est injoignable en ce moment' };
    }
    if (dernier.etat !== 'erreur') return dernier;
    // La clé de compte d'OpenRouter est la seule à lire le compte : une clé ordinaire n'y suppléerait pas.
    if (compte.cleDeCompte) return dernier;
  }
  return dernier ?? soldeNonCommunique(f, maintenant);
}

/** Relève tous les services, sans jamais échouer en bloc : un service muet n'empêche pas les autres. */
export async function releverServicesIa(opts: { appel?: Appel; maintenant?: number } = {}): Promise<SoldeDeServiceIa[]> {
  const appel = opts.appel ?? ((adresse, init) => fetch(adresse, init));
  const maintenant = opts.maintenant ?? Date.now();
  const comptes = comptesDeServicesIa(listerAcces().map((a) => ({ nom: a.nom, type: a.type, champs: a.champs })));
  const issues = await Promise.allSettled(comptes.map((c) => soldeDuCompte(c, appel, maintenant)));
  return issues.map((issue, i) =>
    issue.status === 'fulfilled'
      ? issue.value
      : { ...soldeNonCommunique(comptes[i].fournisseur, maintenant), etat: 'erreur' as const, raison: 'relevé impossible' },
  );
}

/** Le relevé gardé cinq minutes ; `force` (bouton « Actualiser ») relit tout de suite. Deux demandes simultanées partagent le même relevé. */
export async function soldesDesServicesIa(
  force = false,
  maintenant = Date.now(),
  /** Pour les tests : l'appel réseau piégé. */
  appel?: Appel,
): Promise<{ soldes: SoldeDeServiceIa[]; releveLe: number }> {
  if (!force && cache && maintenant - cache.at < DUREE_DU_CACHE_MS) return { soldes: cache.soldes, releveLe: cache.at };
  if (!enCours) {
    enCours = releverServicesIa({ maintenant, appel })
      .then((soldes) => {
        cache = { at: maintenant, soldes };
        apresUnReleve(soldes, maintenant);
        return soldes;
      })
      .finally(() => {
        enCours = null;
      });
  }
  const soldes = await enCours;
  return { soldes, releveLe: cache?.at ?? maintenant };
}

/** Le dernier relevé gardé, sans rien demander : c'est ce que reçoit un écran qui se connecte. */
export function dernierReleveDesServicesIa(): { soldes: SoldeDeServiceIa[]; releveLe: number } | null {
  return cache ? { soldes: cache.soldes, releveLe: cache.at } : null;
}

function niveauxGardes(): Record<string, NiveauDuSolde> {
  try {
    const brut = JSON.parse(getMeta(CLE_DES_NIVEAUX) ?? '{}');
    return brut && typeof brut === 'object' ? brut : {};
  } catch {
    return {};
  }
}

/** Diffuse le relevé, puis notifie chaque service qui VIENT de tomber à sec. Rien ici ne peut faire échouer le relevé. */
function apresUnReleve(soldes: SoldeDeServiceIa[], releveLe: number): void {
  try {
    bus.emit({ type: 'servicesIa', soldes, releveLe });
  } catch (err) {
    log.warn('services d’IA : diffusion du relevé impossible', err);
  }
  try {
    const { aSec, niveaux } = basculesASec(niveauxGardes(), soldes, getSettings().seuilsServicesIa);
    setMeta(CLE_DES_NIVEAUX, JSON.stringify(niveaux));
    for (const solde of aSec) {
      log.warn(`services d’IA : ${solde.nom} est à sec`);
      notify({
        motif: 'service-ia-a-sec',
        title: `${solde.nom} est à sec`,
        body: `Le solde de ${solde.nom} est épuisé : rechargez-le avant la prochaine génération qui s’en sert.`,
        reference: `service-ia:${solde.id}`,
        element: solde.nom,
      });
    }
  } catch (err) {
    log.warn('services d’IA : contrôle des soldes à sec impossible', err);
  }
}

/**
 * LA TOURNÉE DE FOND : un premier relevé 90 s après le démarrage, puis toutes les 30 min. Minuteurs `unref` :
 * ils ne retiennent jamais le démon, et ne touchent ni l'ordonnanceur ni le relevé des moteurs.
 */
export function demarrerTourneeDesServicesIa(): NodeJS.Timeout {
  const tour = () => {
    void soldesDesServicesIa(true).catch((err) => log.warn('services d’IA : tournée impossible', err));
  };
  setTimeout(tour, PREMIER_RELEVE_MS).unref();
  const minuteur = setInterval(tour, PERIODE_DE_LA_TOURNEE_MS);
  minuteur.unref();
  return minuteur;
}

