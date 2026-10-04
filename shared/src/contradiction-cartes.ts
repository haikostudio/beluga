/**
 * UNE CARTE EN CONTREDIT-ELLE UNE AUTRE ?
 *
 * C'est le point dur du pool : sans cette réponse, une fiche continue
 * d'enseigner un travail que la semaine suivante a défait — le ménage de nuit
 * s'en sert pour revoir ces fiches (`server/src/menage-competences.ts`). Les mêmes FICHIERS ne suffisent pas — un
 * correctif touche souvent d'AUTRES fichiers du même écran —, et un seul signal
 * ne suffit jamais : deux cartes voisines mais indépendantes se ressemblent
 * beaucoup dans un projet qui travaille toujours au même endroit.
 *
 * ON RELÈVE DONC CINQ SIGNAUX, et la contradiction ne se déclare qu'au
 * CROISEMENT d'au moins deux :
 *
 *   1. FICHIERS COMMUNS — la carte postérieure a rouvert les mêmes fichiers ;
 *   2. PÉRIMÈTRE COMMUN — mêmes mots rares dans les deux demandes (le même
 *      écran, le même mécanisme), même quand les fichiers diffèrent ;
 *   3. PROXIMITÉ DE SENS — les deux demandes parlent de la même chose ;
 *   4. RENVOI EXPLICITE — la seconde NOMME la première (son titre, son numéro) ;
 *   5. RÉOUVERTURE ou RETOUR EN ARRIÈRE — la seconde dit « corriger »,
 *      « revenir », « ne marche plus », « régression ».
 *
 * Rien ici ne lit la base : le démon relève les faits, ces règles les jugent.
 */

import { motsDuTexte, normaliserPourRecherche } from './mots.js';

/** Ce qu'on sait d'une carte pour la comparer à une autre. */
export interface CarteComparable {
  id: string;
  titre: string;
  /** La demande, telle qu'elle a été écrite. */
  demande: string;
  /** Les fichiers réellement modifiés, chemins relatifs au projet. */
  fichiers: string[];
  /** Quand la carte a été close, en millisecondes. */
  closeLe: number;
}

/** Les cinq signaux, nommés — un compte anonyme ne se lit pas. */
export const SIGNAUX = [
  'fichiers-communs',
  'perimetre-commun',
  'proximite-de-sens',
  'renvoi-explicite',
  'reouverture',
] as const;
export type Signal = (typeof SIGNAUX)[number];

/** Combien de signaux il faut pour DÉCLARER une contradiction. Jamais un seul. */
export const SIGNAUX_MINIMUM = 2;

/** En deçà, deux demandes ne parlent pas de la même chose. */
export const PROXIMITE_MINIMUM = 0.34;

/** Les mots qui disent qu'une carte revient sur du travail déjà fait. */
export const MOTS_DE_RETOUR = [
  'corriger',
  'correction',
  'corrige',
  'reparer',
  'repare',
  'revenir',
  'retour en arriere',
  'regression',
  'ne marche plus',
  'ne fonctionne plus',
  'casse',
  'cassee',
  'bug',
  'annuler',
  'revert',
  'a nouveau',
  'de nouveau',
  'toujours pas',
];

export interface Contradiction {
  /** Vrai dès `SIGNAUX_MINIMUM` signaux relevés. */
  contredite: boolean;
  signaux: Signal[];
  /** La phrase à écrire sur la carte, ou dans le journal du pool. */
  raison: string;
}

/**
 * LA SECONDE CARTE CONTREDIT-ELLE LA PREMIÈRE ? L'ORDRE COMPTE : seule une
 * carte POSTÉRIEURE peut contredire — l'inverse n'est qu'un précédent.
 */
export function contradictionEntre(avant: CarteComparable, apres: CarteComparable): Contradiction {
  if (apres.id === avant.id || apres.closeLe < avant.closeLe) {
    return { contredite: false, signaux: [], raison: 'la carte comparée n’est pas postérieure' };
  }
  const signaux: Signal[] = [];

  const communs = fichiersCommuns(avant.fichiers, apres.fichiers);
  if (communs.length) signaux.push('fichiers-communs');

  const perimetre = perimetreCommun(avant, apres);
  if (perimetre.length) signaux.push('perimetre-commun');

  if (proximiteDeSens(avant.demande, apres.demande) >= PROXIMITE_MINIMUM) signaux.push('proximite-de-sens');

  if (renvoieA(apres, avant)) signaux.push('renvoi-explicite');

  if (parleDeRetourEnArriere(`${apres.titre}\n${apres.demande}`)) signaux.push('reouverture');

  const contredite = signaux.length >= SIGNAUX_MINIMUM;
  return {
    contredite,
    signaux,
    raison: contredite
      ? `« ${apres.titre} » revient sur ce travail (${signaux.join(', ')})`
      : `signaux insuffisants (${signaux.length ? signaux.join(', ') : 'aucun'})`,
  };
}

/** Les fichiers que deux cartes ont tous les deux touchés. */
export function fichiersCommuns(a: string[], b: string[]): string[] {
  const cible = new Set(b.map((f) => f.trim()).filter(Boolean));
  return [...new Set(a.map((f) => f.trim()).filter((f) => f && cible.has(f)))];
}

/**
 * LE PÉRIMÈTRE : les mots RARES que les deux demandes partagent, hors mots
 * vides. Deux cartes qui parlent l'une et l'autre de « barre d'état » et
 * d'« application installable » travaillent au même endroit, même si elles ont
 * modifié deux fichiers différents.
 */
export const PERIMETRE_MOTS_MIN = 2;

export function perimetreCommun(a: { titre: string; demande: string }, b: { titre: string; demande: string }): string[] {
  const motsDe = (carte: { titre: string; demande: string }) =>
    new Set(motsDuTexte(`${carte.titre} ${carte.demande}`).filter((mot) => mot.length > 4));
  const gauche = motsDe(a);
  const droite = motsDe(b);
  const communs = [...gauche].filter((mot) => droite.has(mot));
  return communs.length >= PERIMETRE_MOTS_MIN ? communs : [];
}

/**
 * LA PROXIMITÉ DE SENS, sans modèle : la part de mots partagés rapportée à la
 * plus petite des deux demandes (indice de recouvrement). On ne compare pas de vecteurs
 * ici — la détection tourne sur des centaines de couples de cartes, et un
 * appel de modèle par couple coûterait des minutes pour un gain nul à ce seuil.
 */
export function proximiteDeSens(a: string, b: string): number {
  const gauche = new Set(motsDuTexte(a));
  const droite = new Set(motsDuTexte(b));
  if (!gauche.size || !droite.size) return 0;
  let communs = 0;
  for (const mot of gauche) if (droite.has(mot)) communs++;
  return communs / Math.min(gauche.size, droite.size);
}

/** La seconde carte NOMME-t-elle la première — son titre, son identifiant ? */
export function renvoieA(apres: { titre: string; demande: string }, avant: { id: string; titre: string }): boolean {
  const texte = normaliserPourRecherche(`${apres.titre} ${apres.demande}`);
  if (avant.id && texte.includes(normaliserPourRecherche(avant.id))) return true;
  const titre = normaliserPourRecherche(avant.titre).trim();
  return titre.length > 12 && texte.includes(titre);
}

/** Le texte dit-il qu'on revient sur du travail déjà livré ? */
export function parleDeRetourEnArriere(texte: string): boolean {
  const propre = normaliserPourRecherche(texte);
  return MOTS_DE_RETOUR.some((mot) => propre.includes(normaliserPourRecherche(mot)));
}

/**
 * LA PREMIÈRE CONTRADICTION TROUVÉE parmi les cartes postérieures, s'il y en a
 * une. On rend la PLUS ANCIENNE : c'est elle qui a interrompu le délai de sept
 * jours, et c'est donc elle qu'il faut nommer.
 */
export function premiereContradiction(
  carte: CarteComparable,
  suivantes: CarteComparable[],
): { carte: CarteComparable; contradiction: Contradiction } | undefined {
  const triees = [...suivantes].sort((a, b) => a.closeLe - b.closeLe);
  for (const suivante of triees) {
    const contradiction = contradictionEntre(carte, suivante);
    if (contradiction.contredite) return { carte: suivante, contradiction };
  }
  return undefined;
}
