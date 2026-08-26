/*
 * L'ÉTAT DE LA VERSION EN PRODUCTION, DIT EN CLAIR.
 *
 * La colonne « En production » racontait la production par ses CARTES : celles
 * qui étaient passées par le déploiement s'y empilaient, et il fallait les lire
 * une à une pour deviner ce qui tournait réellement chez le client. Ce n'était
 * pas la bonne question. Ce qu'on veut savoir tient en deux nombres : QUEL
 * enregistrement est en ligne en production, et de COMBIEN le dépôt l'a
 * dépassé depuis.
 *
 * Ces deux nombres sont lus dans le dépôt et dans la dernière mise en
 * production réussie (`server/src/deploy.ts`). Les PHRASES, elles, vivent ici :
 * règles PURES, ni base, ni dépôt, ni disque — donc testables seules.
 */

/** Ce que le serveur constate de la production d'un projet. */
export type EtatProduction = {
  /** L'empreinte courte de l'enregistrement mis en production, si on la connaît. */
  commit?: string;
  /** Quand cette mise en production a abouti. */
  at?: number;
  /** La branche du dépôt à laquelle la production est comparée. */
  branche?: string;
  /** L'empreinte courte de la tête de cette branche. */
  commitDepot?: string;
  /**
   * COMBIEN d'enregistrements séparent la production de la tête de la branche.
   * 0 = la production est à jour. Absent quand la comparaison n'a pas pu se
   * faire (dépôt illisible, enregistrement disparu).
   */
  ecart?: number;
  /** L'adresse publique de la production, quand le projet en déclare une. */
  url?: string;
  /**
   * POURQUOI on ne sait rien, quand c'est le cas — jamais un silence : « aucune
   * mise en production n'a encore abouti », « le dossier n'est pas un dépôt ».
   */
  raison?: string;
};

/** L'empreinte, coupée court pour l'affichage. Vide si on ne la connaît pas. */
export function empreinteCourte(commit?: string): string {
  return (commit ?? '').trim().slice(0, 7);
}

/**
 * UNE PHRASE PRÊTE À TRADUIRE : le texte français — la CLÉ du dictionnaire —
 * et les valeurs de ses trous. L'écran fait `t(p.texte, p.valeurs)` ; les
 * chiffres ne sont donc jamais collés dans la clé, et les cinq langues placent
 * le trou où leur grammaire le veut.
 */
export type PhraseAtraduire = { texte: string; valeurs?: Record<string, string | number> };

/**
 * L'ÉCART entre la production et le dépôt, dit en une phrase.
 *
 * Quatre cas, et aucun silence :
 *  - jamais mise en production → on le DIT, au lieu d'un tiret ;
 *  - écart inconnu (comparaison impossible) → on le dit AUSSI : mieux vaut
 *    « écart inconnu » qu'un « à jour » faux ;
 *  - écart nul → « À jour avec le dépôt » ;
 *  - écart connu → le nombre d'enregistrements de retard.
 *
 * LE PLURIEL NE S'INVENTE PAS : les deux phrases sont écrites, et c'est la
 * règle qui choisit — exactement comme partout ailleurs dans cette interface.
 */
export function ecartProduction(etat: EtatProduction | null | undefined): PhraseAtraduire {
  if (!etat || !etat.commit) return { texte: 'Jamais mise en production' };
  if (etat.ecart === undefined) return { texte: 'Écart avec le dépôt inconnu' };
  if (etat.ecart === 0) return { texte: 'À jour avec le dépôt' };
  return etat.ecart > 1
    ? { texte: '{n} enregistrements de retard sur le dépôt', valeurs: { n: etat.ecart } }
    : { texte: '1 enregistrement de retard sur le dépôt' };
}

/**
 * LA PRODUCTION EST-ELLE EN RETARD ? C'est ce qui décide de la couleur du
 * repère : orange quand du travail attend d'être publié, neutre sinon. Un écart
 * inconnu n'alerte pas — on ne crie pas au loup sur une mesure manquante.
 */
export function productionEnRetard(etat: EtatProduction | null | undefined): boolean {
  return !!etat && !!etat.commit && (etat.ecart ?? 0) > 0;
}

/**
 * CE QUE LE BOUTON « Mettre à jour la version prod » VA FAIRE, en une phrase de
 * confirmation. Elle nomme l'écart, parce que c'est exactement ce qui partira.
 */
export function annonceMiseAJourProduction(etat: EtatProduction | null | undefined): PhraseAtraduire {
  if (!etat?.commit) {
    return { texte: 'Le code du dépôt va partir chez le client : ce sera la première mise en production.' };
  }
  if ((etat.ecart ?? 0) === 0) {
    return { texte: 'La production est déjà à jour : la mise en ligne repartira sur le même enregistrement.' };
  }
  const n = etat.ecart ?? 0;
  return n > 1
    ? { texte: '{n} enregistrements du dépôt vont partir chez le client.', valeurs: { n } }
    : { texte: '1 enregistrement du dépôt va partir chez le client.' };
}
