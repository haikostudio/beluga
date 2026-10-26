/**
 * LE DERNIER ÉTAT CONNU SE REDESSINE TOUT DE SUITE, AVANT QUE LE SERVEUR PARLE.
 *
 * Sur un téléphone, l'application restait presque blanche 10, 20, 30 secondes :
 * rien ne se dessinait avant le premier message du serveur (`ready`, près de
 * 400 Ko), et un serveur qui se fige quelques secondes — il le fait, jusqu'à
 * 17 s mesurées — prolongeait l'attente d'autant. L'écran garde donc une COPIE
 * de ce qu'il a vu en dernier (projets, groupes, projet ouvert et ses cartes) et
 * la redessine à l'ouverture.
 *
 * Cette copie ne sert qu'à REGARDER : tant que le vrai premier état n'est pas
 * revenu, le lien est dit « en reconnexion » et tous les gestes restent gelés
 * (`gestesGeles`). Elle est jetée si elle vient d'un autre protocole (les
 * messages ont pu changer de forme) ou si elle est trop vieille.
 *
 * Règles PURES : ni stockage, ni horloge — l'appelant fournit tout.
 */

/** Une copie plus vieille ne rassure plus : mieux vaut la pause d'attente. */
export const VALIDITE_DU_DERNIER_ETAT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Au-delà, la copie ne s'écrit pas : un stockage plein ne doit rien casser, et
 * une copie relue d'un bloc au démarrage pèse sur un téléphone (26/10/2026 :
 * 1,5 million de signes → 800 000 ; un tableau ordinaire en fait ~400 000).
 */
export const POIDS_MAX_DU_DERNIER_ETAT = 800_000;

export const CLE_DU_DERNIER_ETAT = 'beluga.dernier-etat';

export interface DernierEtat<Projet = unknown, Groupe = unknown, Carte = unknown> {
  protocole: number;
  ecritA: number;
  projects: Projet[];
  groups: Groupe[];
  activeProjectId: string | null;
  /** Les cartes du projet ouvert, et seulement les siennes. */
  cards: Carte[];
  totaux: Record<string, number>;
}

/** Ce que l'écran garde : `null` quand il n'y a rien d'utile à redessiner. */
export function composerLeDernierEtat<Projet, Groupe, Carte extends { projectId: string }>(entree: {
  protocole: number;
  maintenant: number;
  projects: readonly Projet[];
  groups: readonly Groupe[];
  activeProjectId: string | null;
  cards: Readonly<Record<string, Carte>>;
  totaux: Readonly<Record<string, Record<string, number>>>;
}): DernierEtat<Projet, Groupe, Carte> | null {
  if (!entree.projects.length) return null;
  const projet = entree.activeProjectId;
  return {
    protocole: entree.protocole,
    ecritA: entree.maintenant,
    projects: [...entree.projects],
    groups: [...entree.groups],
    activeProjectId: projet,
    cards: projet ? Object.values(entree.cards).filter((carte) => carte.projectId === projet) : [],
    totaux: projet ? { ...(entree.totaux[projet] ?? {}) } : {},
  };
}

/**
 * Relit la copie, ou rend `null` : texte illisible, forme inattendue, autre
 * protocole, trop vieille. Jamais d'exception — une copie abîmée ne doit pas
 * empêcher l'application de démarrer.
 */
export function lireLeDernierEtat(
  brut: string | null,
  protocole: number,
  maintenant: number,
): DernierEtat | null {
  if (!brut) return null;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!lu || typeof lu !== 'object') return null;
  const etat = lu as Partial<DernierEtat>;
  if (etat.protocole !== protocole) return null;
  if (typeof etat.ecritA !== 'number' || maintenant - etat.ecritA > VALIDITE_DU_DERNIER_ETAT_MS) return null;
  if (!Array.isArray(etat.projects) || !etat.projects.length) return null;
  if (!Array.isArray(etat.groups) || !Array.isArray(etat.cards)) return null;
  if (etat.activeProjectId !== null && typeof etat.activeProjectId !== 'string') return null;
  if (!etat.totaux || typeof etat.totaux !== 'object') return null;
  return etat as DernierEtat;
}
