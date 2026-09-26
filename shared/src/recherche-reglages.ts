/**
 * LA RECHERCHE DES RÉGLAGES, À LA MANIÈRE D'iOS.
 *
 * Les réglages ne sont plus dix onglets mais une arborescence de groupes et de
 * sous-pages : on ne peut plus « voir » où se cache un réglage, il faut pouvoir
 * le DEMANDER. Un champ en tête du menu filtre un index construit à partir des
 * fiches des sous-pages — titre, groupe, mots-clés déclarés à la main, et les
 * libellés des réglages que la page porte.
 *
 * Ces règles vivent ici parce qu'elles n'ont besoin ni de base, ni de disque,
 * ni du navigateur : elles se testent seules (`server/src/test/recherche-reglages.test.ts`).
 *
 * RIEN DU CONTENU DES PROJETS N'ENTRE DANS L'INDEX : seulement les textes de
 * l'interface, déjà traduits par l'appelant. La recherche ne fouille jamais les
 * cartes, les conversations ni les fichiers.
 */

import { normaliserPourRecherche } from './mots.js';

/* ACCENTS ET CASSE NE COMPTENT PAS : « thème » se tape « theme ». La
   normalisation existe déjà pour la mémoire (`mots.ts`), on la reprend telle
   quelle plutôt que d'en écrire une seconde qui divergerait. */

/** Une sous-page telle que la recherche la voit. */
export interface FicheDeReglage {
  /** La clé de la sous-page, celle qui ouvre l'écran. */
  cle: string;
  /** Le titre affiché de la page, déjà traduit. */
  titre: string;
  /** Le titre de son groupe, déjà traduit — c'est le chemin qu'on affiche. */
  groupe: string;
  /** Des mots que l'utilisateur pourrait taper sans qu'ils soient à l'écran. */
  motsCles?: string[];
  /** Les libellés des réglages portés par la page. */
  libelles?: string[];
}

/** Une page trouvée, avec ce qui l'a fait sortir. */
export interface ResultatDeRecherche {
  fiche: FicheDeReglage;
  /** Plus il est haut, plus la page colle : le titre passe devant les mots-clés. */
  score: number;
}

/** La distance d'édition, plafonnée : au-delà du plafond on s'arrête. */
function distance(a: string, b: string, plafond: number): number {
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      const valeur = Math.min(courante[j - 1] + 1, precedente[j] + 1, precedente[j - 1] + cout);
      courante.push(valeur);
      if (valeur < minimum) minimum = valeur;
    }
    if (minimum > plafond) return plafond + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

/**
 * UN MOT TAPÉ COLLE-T-IL À CE TEXTE ? Trois chances, de la plus sûre à la plus
 * lâche : le texte contient le mot, un de ses mots commence par lui, ou un de
 * ses mots n'en diffère que d'une lettre (à partir de quatre lettres — en
 * dessous, « api » attraperait « avi », « ami » et tout le reste).
 */
function motColle(mot: string, texte: string): boolean {
  if (!mot) return true;
  if (texte.includes(mot)) return true;
  const morceaux = texte.split(/[^a-z0-9]+/).filter(Boolean);
  if (morceaux.some((morceau) => morceau.startsWith(mot))) return true;
  if (mot.length < 4) return false;
  return morceaux.some((morceau) => distance(mot, morceau, 1) <= 1);
}

/** Le poids de chaque champ : le titre d'abord, les libellés en dernier. */
const POIDS: Array<[keyof FicheDeReglage | 'motsCles' | 'libelles', number]> = [
  ['titre', 100],
  ['groupe', 40],
  ['motsCles', 30],
  ['libelles', 20],
];

function champsDeLaFiche(fiche: FicheDeReglage): Array<[string, number]> {
  const champs: Array<[string, number]> = [];
  for (const [nom, poids] of POIDS) {
    const valeur = fiche[nom as keyof FicheDeReglage];
    if (typeof valeur === 'string') champs.push([normaliserPourRecherche(valeur), poids]);
    else if (Array.isArray(valeur)) {
      for (const item of valeur) champs.push([normaliserPourRecherche(String(item)), poids]);
    }
  }
  return champs;
}

/**
 * LE FILTRE. Une requête vide rend tout, dans l'ordre reçu — le menu complet.
 * Sinon CHAQUE mot tapé doit coller à au moins un champ de la fiche : taper
 * « heure sauvegarde » ne doit pas rendre toutes les pages qui parlent d'heures.
 */
export function chercherDansLesReglages(
  fiches: FicheDeReglage[],
  requete: string,
): ResultatDeRecherche[] {
  const mots = normaliserPourRecherche(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return fiches.map((fiche) => ({ fiche, score: 0 }));

  const trouves: ResultatDeRecherche[] = [];
  for (const fiche of fiches) {
    const champs = champsDeLaFiche(fiche);
    let score = 0;
    let tousLesMots = true;
    for (const mot of mots) {
      let meilleur = 0;
      for (const [texte, poids] of champs) {
        if (!motColle(mot, texte)) continue;
        // Une correspondance en DÉBUT de champ vaut mieux qu'au milieu.
        const bonus = texte.startsWith(mot) ? 10 : 0;
        if (poids + bonus > meilleur) meilleur = poids + bonus;
      }
      if (!meilleur) {
        tousLesMots = false;
        break;
      }
      score += meilleur;
    }
    if (tousLesMots) trouves.push({ fiche, score });
  }
  // À score égal, l'ordre du menu est conservé : le tri est STABLE en JS moderne.
  return trouves.sort((a, b) => b.score - a.score);
}

/**
 * LES RÉSULTATS S'AFFICHENT GROUPÉS, comme dans le menu : chaque groupe garde
 * ses pages, dans l'ordre où la recherche les a classées.
 */
export function grouperLesResultats(
  resultats: ResultatDeRecherche[],
): Array<{ groupe: string; fiches: FicheDeReglage[] }> {
  const parGroupe = new Map<string, FicheDeReglage[]>();
  for (const { fiche } of resultats) {
    const liste = parGroupe.get(fiche.groupe);
    if (liste) liste.push(fiche);
    else parGroupe.set(fiche.groupe, [fiche]);
  }
  return [...parGroupe.entries()].map(([groupe, fiches]) => ({ groupe, fiches }));
}
