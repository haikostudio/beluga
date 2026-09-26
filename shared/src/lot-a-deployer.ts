/**
 * LE LOT QUI PART, ET POURQUOI IL NE PART PAS.
 *
 * Deux règles pures, nées du même bogue : « Tout déployer » cliqué, et rien —
 * pas une carte déplacée, pas une ligne dans le journal du service.
 *
 * 1. La DATE DE MISE EN LIGNE PÉRIMÉE. Le lot de « À déployer » écarte les
 *    cartes qui portent déjà une date de mise en ligne (`deployedAt`) : le
 *    garde-fou vaut pour le lot en cours, où une carte ne doit pas partir deux
 *    fois. Mais rien n'effaçait cette date quand la carte REVENAIT dans « À
 *    déployer » — repassée à la main depuis « En production », ou retravaillée
 *    puis reposée là. Elle était alors écartée de TOUS les lots suivants, à
 *    jamais : le bouton annonçait « (0) », s'éteignait, et le clic ne partait
 *    nulle part. Une carte qui ENTRE dans « À déployer » attend un NOUVEAU
 *    déploiement : sa vieille date n'a plus cours.
 *
 * 2. LE BOUTON ÉTEINT DOIT DIRE POURQUOI. Un bouton qui ne fait rien est pire
 *    qu'un bouton qui explique : tant qu'il refuse de partir, la cause s'écrit
 *    en toutes lettres sous lui.
 *
 * Règles PURES : ni base, ni disque, ni navigateur — donc rejouables seules.
 */

import type { ColumnKey } from './columns.js';

/**
 * La carte change de colonne : sa date de mise en ligne est-elle périmée ?
 *
 * Oui dès qu'elle ENTRE dans « À déployer » en venant d'ailleurs — la colonne
 * dit « celle-ci attend d'être déployée », et une date d'un déploiement passé
 * la ferait écarter en silence. Non pour tout autre trajet : une carte qui
 * quitte « À déployer » vers « En production » ou « Archivé » GARDE sa date,
 * qui est justement la trace de sa mise en ligne.
 *
 * Un rangement sur place (même colonne au départ et à l'arrivée) ne périme
 * rien : on n'efface pas une trace sans que la carte ait bougé.
 */
export function dateDeMiseEnLignePerimee(depart: ColumnKey, arrivee: ColumnKey): boolean {
  if (arrivee !== 'to_deploy') return false;
  return depart !== 'to_deploy';
}

/**
 * LE CHIFFRE ENTRE PARENTHÈSES du bouton « Tout déployer/publier » et du
 * bouton « Déployer » de la fenêtre de sélection.
 *
 * Les deux additionnaient en silence les cartes du lot et le travail
 * enregistré sans carte : le bouton annonçait « (10) » quand la fenêtre ne
 * listait que cinq cartes à cocher, le reste écrit en petit sous la liste.
 * Le chiffre est désormais TOUJOURS lisible d'un coup d'œil : seul quand une
 * des deux parts est nulle, les deux NOMMÉES dès qu'elles coexistent.
 */
export function libelleCompteLot(nbCartes: number, nbSansCarte: number): string {
  if (nbCartes > 0 && nbSansCarte > 0) return `${nbCartes} + ${nbSansCarte} sans carte`;
  if (nbSansCarte > 0) return `${nbSansCarte} sans carte`;
  return `${nbCartes}`;
}

/** Ce que le bloc de publication sait au moment où l'on regarde son bouton. */
export interface EtatDuLot {
  /** Le verbe de l'étape : « déployer » ou « publier ». */
  verbe: string;
  /** Ce que le bouton annonce entre parenthèses : cartes + travail sans carte. */
  aPublier: number;
  /** Combien de cartes sont physiquement posées dans la colonne. */
  cartesDansLaColonne: number;
  /** Une publication de ce projet tourne déjà (ici ou à l'autre étape). */
  autrePublication?: boolean;
  /** Les agents qui travaillent encore dans le dossier du projet. */
  agentsOccupes?: string[];
  /** Une mise en production sans prompt réglé : la phrase du refus. */
  productionBloquee?: string;
  /** Le navigateur n'a plus de lien avec le serveur : rien ne partirait. */
  horsLigne?: boolean;
  /**
   * L'étape n'embarque AUCUNE carte (mise en production) : un lot vide n'est
   * alors pas un blocage — c'est son fonctionnement normal. Ce qui la retient
   * reste tout le reste : lien coupé, procédure absente, agent au travail,
   * publication déjà en cours.
   */
  sansLot?: boolean;
}

/**
 * POURQUOI le bouton refuse de partir — la phrase à écrire sous lui, telle
 * quelle. Rend `null` quand rien ne bloque : le bouton part, il n'a rien à
 * expliquer.
 *
 * L'ordre compte : on nomme le blocage le plus FORT, celui qu'il faut lever en
 * premier. Un lien coupé passe devant tout (rien ne partirait), puis le refus
 * réglé de la mise en production, puis une publication déjà en cours, puis les
 * agents au travail, et enfin le lot vide — dont la cause diffère selon qu'il
 * n'y a rien du tout, ou des cartes que le lot écarte.
 */
export function raisonLotBloque(etat: EtatDuLot): string | null {
  if (etat.horsLigne) {
    return 'Le lien avec le serveur est coupé : la demande ne partirait pas. Rechargez la page.';
  }

  if (etat.productionBloquee?.trim()) return etat.productionBloquee.trim();

  if (etat.autrePublication) {
    return 'Une publication de ce projet est déjà en cours : attendez qu’elle finisse.';
  }

  const occupes = etat.agentsOccupes ?? [];
  if (occupes.length) {
    // Le titre d'un agent EST celui de sa carte, souvent long : sans guillemets,
    // la phrase se lit comme si la carte parlait d'elle-même.
    const noms = occupes.map((titre) => `« ${titre} »`).join(', ');
    const verbe = occupes.length > 1 ? 'travaillent' : 'travaille';
    return `${noms} ${verbe} encore dans le dossier : la mise en ligne partirait sur un dépôt en mouvement.`;
  }

  if (etat.aPublier > 0) return null;

  // Une étape sans lot n'a rien à compter : elle pousse une VERSION, pas des
  // cartes. Aucun de ce qui suit ne la concerne.
  if (etat.sansLot) return null;

  if (etat.cartesDansLaColonne > 0) {
    const n = etat.cartesDansLaColonne;
    return `${n} carte${n > 1 ? 's' : ''} ${n > 1 ? 'sont' : 'est'} dans cette colonne, mais ${
      n > 1 ? 'aucune n’entre' : 'elle n’entre pas'
    } dans le lot : ${n > 1 ? 'elles portent' : 'elle porte'} déjà une date de mise en ligne, ou ${
      n > 1 ? 'elles ont été retirées' : 'elle a été retirée'
    } du lot. Rouvrez la carte pour la remettre dans le lot.`;
  }

  return `Rien à ${etat.verbe} : la colonne est vide et aucun travail n’attend sur la branche.`;
}
