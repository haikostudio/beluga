/**
 * L'ANNEAU DE CONTEXTE — ce que la barre d'écriture montre du remplissage du
 * modèle, et ce que sa fenêtre détaillée en dit.
 *
 * La MESURE, elle, existe déjà : `AgentContextUsage` (`contexte-agent.ts`) est
 * posée par le démon à chaque réponse du moteur, à partir du dernier appel
 * rendu et de la fenêtre du modèle qui porte le fil. Rien n'est recalculé ici :
 * ce fichier ne fait que la METTRE EN FORME, et il reste pur pour être testé
 * seul.
 *
 * TROIS NIVEAUX, PAS QUATRE : au repos, chargé, critique. Le seuil de
 * compression n'est pas un niveau de couleur — il se dit en toutes lettres dans
 * la fenêtre, parce qu'il ne dépend pas du pourcentage mais d'un nombre de
 * JETONS (`seuilDeCompression`) : sur une fenêtre d'un million, la compression
 * part bien avant 50 %.
 */

import type { AgentContextUsage } from './contexte-agent.js';
import { seuilDeCompression } from './contexte-agent.js';

/** Le niveau de remplissage, la seule chose qui décide de la couleur. */
export type NiveauContexte = 'repos' | 'charge' | 'critique';

export const SEUIL_CONTEXTE_CHARGE = 60;
export const SEUIL_CONTEXTE_CRITIQUE = 85;

export function niveauDeContexte(pourcentage: number): NiveauContexte {
  if (pourcentage >= SEUIL_CONTEXTE_CRITIQUE) return 'critique';
  if (pourcentage >= SEUIL_CONTEXTE_CHARGE) return 'charge';
  return 'repos';
}

/**
 * Le tracé de l'anneau : deux cercles superposés, le fond puis la part
 * remplie. Un cercle SVG se remplit par son POINTILLÉ — un premier trait de la
 * longueur voulue, puis un trou qui couvre le reste du tour. On rend donc la
 * circonférence et ces deux longueurs, plutôt que de les recalculer dans le
 * composant.
 *
 * Le départ est mis À DOUZE HEURES par le composant (une rotation d'un quart de
 * tour) : ici on ne s'occupe que des longueurs.
 */
export interface TraceAnneau {
  rayon: number;
  circonference: number;
  /** Longueur du trait plein, en unités de tracé. */
  rempli: number;
  /** Longueur du trou qui referme le tour. */
  vide: number;
}

export function traceDeLAnneau(pourcentage: number, rayon: number): TraceAnneau {
  const r = Number.isFinite(rayon) && rayon > 0 ? rayon : 1;
  const circonference = 2 * Math.PI * r;
  const part = Math.min(100, Math.max(0, Number.isFinite(pourcentage) ? pourcentage : 0)) / 100;
  const rempli = circonference * part;
  return { rayon: r, circonference, rempli, vide: Math.max(0, circonference - rempli) };
}

/**
 * Un nombre de jetons, court et lisible dans un anneau de seize pixels comme
 * dans une phrase : au-delà du million on abrège, en dessous on garde les
 * milliers pleins. Le séparateur est une espace FINE INSÉCABLE, celle des
 * nombres en français — jamais un point, qui se lirait comme une décimale.
 */
export function jetonsLisibles(jetons: number): string {
  const n = Number.isFinite(jetons) ? Math.max(0, Math.round(jetons)) : 0;
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${(millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10).toString().replace('.', ',')} M`;
  }
  return n.toLocaleString('fr-CH').replace(/ | |'/g, ' ');
}

/**
 * Ce que la fenêtre détaillée a besoin d'afficher, calculé d'un coup. Le
 * SEUIL de compression est rendu en jetons ET en part de la fenêtre : c'est la
 * seule façon de comprendre pourquoi un anneau à 18 % annonce déjà une
 * compression prochaine.
 */
export interface DetailContexte {
  utilises: number;
  capacite: number;
  restants: number;
  pourcentage: number;
  niveau: NiveauContexte;
  /** Le seuil de compression en jetons, tel qu'il s'applique à cet agent. */
  seuilJetons: number;
  /** Ce même seuil rapporté à la fenêtre, arrondi au point. */
  seuilPourcentage: number;
  /** Jetons restants avant que la compression ne s'arme ; 0 si le seuil est passé. */
  avantCompression: number;
}

export function detailDuContexte(usage: AgentContextUsage, plafond?: number): DetailContexte {
  const capacite = Math.max(1, Math.round(usage.capacityTokens));
  const utilises = Math.min(capacite, Math.max(0, Math.round(usage.usedTokens)));
  const seuilJetons = Math.round(seuilDeCompression(capacite, plafond));
  return {
    utilises,
    capacite,
    restants: capacite - utilises,
    pourcentage: usage.percentage,
    niveau: niveauDeContexte(usage.percentage),
    seuilJetons,
    seuilPourcentage: Math.round((seuilJetons / capacite) * 100),
    avantCompression: Math.max(0, seuilJetons - utilises),
  };
}
