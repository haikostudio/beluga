/**
 * LA MISE EN PRODUCTION FAIT PASSER « dev » DANS « main » — les règles pures.
 *
 * La règle d'or dit : branche de carte → `dev` au déploiement → `main` à la
 * mise en production. La moitié « dev → main » n'existait pas dans le code :
 * la mise en production poussait la branche courante et laissait `main` où elle
 * était. `main` n'avançait donc qu'à la main — par une demande de fusion GitHub
 * écrasée en un seul commit, dont l'historique ne rejoint plus jamais `dev`.
 *
 * CE QUE `main` REÇOIT : EXACTEMENT L'ARBRE DE `dev`. Ce qui part en production
 * est ce qui a été déployé et éprouvé sur le serveur, rien d'autre. Un commit
 * posé directement sur `main` (fusion écrasée, retouche faite sur GitHub) n'a
 * pas suivi le chemin : une fusion ordinaire le garderait — et avec lui, des
 * changements que `dev` a défaits depuis. Il n'est pas perdu pour autant : il
 * reste dans l'historique de `main`, et le récit le NOMME.
 *
 * JAMAIS EN FORCE. Chaque geste rend un commit dont l'ancien sommet de `main`
 * est un ancêtre : l'envoi est une avance rapide, ou il est refusé.
 */

export type GesteVersProduction = 'deja-a-jour' | 'avance-rapide' | 'creation' | 'recalage' | 'fusion' | 'sans-source';

export interface EtatDesDeuxBranches {
  sourceExiste: boolean;
  cibleExiste: boolean;
  /** La source (`dev`) est un ancêtre de la cible (`main`). */
  cibleContientSource: boolean;
  /** La cible (`main`) est un ancêtre de la source (`dev`). */
  sourceContientCible: boolean;
  /** Les deux sommets décrivent le même état du projet. */
  arbresEgaux: boolean;
}

/**
 * LE GESTE, selon ce qu'on constate :
 *  - `avance-rapide` : `main` est derrière `dev`, sans rien à elle ;
 *  - `recalage`      : `main` contient déjà `dev` mais porte en plus ses propres
 *                      changements — un commit sur `main` lui rend l'arbre de `dev` ;
 *  - `fusion`        : les deux ont divergé (le cas de la fusion écrasée) — un
 *                      commit de fusion à deux parents, avec l'arbre de `dev`.
 */
export function gesteVersProduction(etat: EtatDesDeuxBranches): GesteVersProduction {
  if (!etat.sourceExiste) return 'sans-source';
  if (!etat.cibleExiste) return 'creation';
  if (etat.sourceContientCible) {
    return etat.cibleContientSource ? 'deja-a-jour' : 'avance-rapide';
  }
  if (etat.cibleContientSource) return etat.arbresEgaux ? 'deja-a-jour' : 'recalage';
  return 'fusion';
}

/** Le message du commit posé sur `main`. */
export function messageVersProduction(geste: GesteVersProduction, source: string, cible: string): string {
  return geste === 'recalage'
    ? `Recale ${cible} sur ${source} (mise en production)`
    : `Fusionne ${source} dans ${cible} (mise en production)`;
}

/** Le récit de l'étape, tel qu'il s'écrit dans le fil de la publication. */
export function recitVersProduction(entree: {
  geste: GesteVersProduction;
  source: string;
  cible: string;
  avant?: string;
  apres?: string;
  /** Les commits que `main` portait sans `dev`. */
  ecartes?: string[];
  /** Les fichiers où `main` différait de `dev`. */
  fichiers?: string[];
  notes?: string[];
}): string {
  const court = (sha?: string) => (sha ? sha.slice(0, 10) : '—');
  const { geste, source, cible } = entree;
  const lignes: string[] = [];
  switch (geste) {
    case 'sans-source':
      lignes.push(`La branche « ${source} » n’existe pas : rien à mettre en production.`);
      break;
    case 'deja-a-jour':
      lignes.push(`« ${cible} » porte déjà exactement « ${source} » (${court(entree.apres)}) : rien à fusionner.`);
      break;
    case 'creation':
      lignes.push(`« ${cible} » n’existait pas : elle est posée sur « ${source} » (${court(entree.apres)}).`);
      break;
    case 'avance-rapide':
      lignes.push(`« ${cible} » avance de ${court(entree.avant)} à ${court(entree.apres)}, sur « ${source} » (avance rapide).`);
      break;
    case 'recalage':
      lignes.push(`« ${cible} » contenait déjà « ${source} » mais portait ses propres changements : recalée sur l’arbre de « ${source} » (${court(entree.avant)} → ${court(entree.apres)}).`);
      break;
    case 'fusion':
      lignes.push(`« ${cible} » et « ${source} » avaient divergé : commit de fusion ${court(entree.apres)}, avec l’arbre exact de « ${source} », posé sur ${court(entree.avant)} — sans envoi forcé.`);
      break;
  }
  const ecartes = entree.ecartes ?? [];
  if (ecartes.length) {
    lignes.push(`Commit(s) propre(s) à « ${cible} », restés dans son historique mais pas dans la version mise en production :`);
    lignes.push(...ecartes.slice(0, 10).map((c) => `  · ${c}`));
    if (ecartes.length > 10) lignes.push(`  … et ${ecartes.length - 10} de plus.`);
  }
  const fichiers = entree.fichiers ?? [];
  if (fichiers.length) {
    lignes.push(`${fichiers.length} fichier(s) où « ${cible} » différait de « ${source} » : ${fichiers.slice(0, 8).join(', ')}${fichiers.length > 8 ? '…' : ''}`);
  }
  lignes.push(...(entree.notes ?? []));
  return lignes.join('\n');
}
