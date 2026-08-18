/**
 * LE CHEF D'ORCHESTRE NE PAIE PAS UN MODÈLE DE RAISONNEMENT POUR TRIER.
 *
 * Le code épingle depuis longtemps un modèle ÉCONOME pour le chef (Haiku 4.5
 * sous Claude) : il ne fait qu'un tri — reformuler une demande en carte courte
 * et choisir le niveau de l'agent qui l'exécutera. Il n'ouvre pas le projet, ne
 * chiffre pas.
 *
 * Mais un choix fait UNE FOIS à l'écran était retenu dans les réglages
 * généraux, sans date et sans fin : il l'emportait ensuite sur tous les
 * projets, définitivement. Relevé du 17/08/2026 : 305 des 404 tours de chef
 * tournaient sur Opus 5 en réflexion haute, pour 533,6 points de fenêtre —
 * **25 % de toute la consommation Claude du serveur**, dépensés à reformuler
 * des demandes.
 *
 * La règle ne fige pas un modèle : elle pose un PLAFOND. Un modèle GOURMAND est
 * refusé au chef et ramené sur l'épinglé ; la réflexion est ramenée au cran
 * « medium ». Un choix économe fait à l'écran, lui, est respecté tel quel — on
 * ne retire pas la main à l'utilisateur, on l'empêche seulement de payer une
 * analyse à chaque message sans le savoir.
 *
 * Règle PURE : elle ne lit ni base ni disque, et ne dépense rien.
 */

/** Du plus léger au plus lourd. Un cran inconnu est traité comme le plus lourd. */
export const ORDRE_DE_REFLEXION = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Le cran de réflexion que le chef ne dépasse jamais. */
export const REFLEXION_MAX_DU_CHEF = 'medium';

/**
 * Les familles reconnues comme gourmandes quand le catalogue n'annonce pas
 * d'appétit. On ne devine RIEN d'autre : un modèle inconnu passe pour économe,
 * faute de quoi on refuserait des modèles neufs et bon marché.
 */
const FAMILLES_GOURMANDES = [/opus/i];

export interface ModeleDuCatalogue {
  id: string;
  appetite?: string;
}

/** Ce modèle est-il trop gourmand pour un travail de tri ? */
export function modeleTropGourmandPourLeChef(modele: ModeleDuCatalogue | undefined): boolean {
  if (!modele) return false;
  if (modele.appetite) return modele.appetite === 'heavy';
  return FAMILLES_GOURMANDES.some((famille) => famille.test(modele.id));
}

function rangDeReflexion(cran: string | undefined): number {
  if (!cran) return -1;
  const rang = ORDRE_DE_REFLEXION.indexOf(cran.toLowerCase() as (typeof ORDRE_DE_REFLEXION)[number]);
  return rang === -1 ? ORDRE_DE_REFLEXION.length : rang;
}

/**
 * La réflexion ramenée sous le plafond du chef. Un cran déjà en dessous ne
 * bouge pas ; un cran absent laisse le moteur décider comme avant.
 */
export function reflexionDuChef(cran: string | undefined): string | undefined {
  if (cran === undefined) return undefined;
  return rangDeReflexion(cran) > rangDeReflexion(REFLEXION_MAX_DU_CHEF) ? REFLEXION_MAX_DU_CHEF : cran;
}

export interface ChoixRamene {
  /** Le modèle réellement retenu. */
  model: string | undefined;
  /** Le cran de réflexion réellement retenu. */
  thinking: string | undefined;
  /** Ce qui a été ramené, pour le dire au journal. Absent si rien n'a bougé. */
  ramene?: string;
}

/**
 * Le choix du chef, plafond appliqué. `epingle` est le modèle économe que le
 * code a choisi pour ce moteur ; c'est lui qui reprend la main quand le souvenir
 * est trop cher.
 */
export function choixDuChefSousPlafond(entree: {
  modeleRetenu: string | undefined;
  reflexionRetenue: string | undefined;
  epingle: string | undefined;
  catalogue: readonly ModeleDuCatalogue[];
}): ChoixRamene {
  const modele = entree.catalogue.find((m) => m.id === entree.modeleRetenu);
  const tropGourmand = modeleTropGourmandPourLeChef(modele);

  const model = tropGourmand && entree.epingle ? entree.epingle : entree.modeleRetenu;
  const thinking = reflexionDuChef(entree.reflexionRetenue);

  const causes: string[] = [];
  if (model !== entree.modeleRetenu) causes.push(`modèle ${entree.modeleRetenu} → ${model} (trop gourmand pour un tri)`);
  if (thinking !== entree.reflexionRetenue) causes.push(`réflexion ${entree.reflexionRetenue} → ${thinking}`);

  return { model, thinking, ramene: causes.length ? causes.join(', ') : undefined };
}
