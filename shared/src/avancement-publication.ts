/**
 * OÙ EN EST LA MISE EN LIGNE — EN CHIFFRES, PAR BRANCHE ET POUR TOUT LE FLUX.
 *
 * Le tiroir racontait déjà TOUT : chaque étape, chaque moment horodaté, l'état
 * de chaque tâche du lot en toutes lettres. Ce qu'il ne disait pas, c'est
 * COMBIEN il en reste. Devant un lot de six branches arrêté sur un conflit, il
 * fallait lire six libellés puis compter les étapes restantes de tête pour
 * répondre à la seule question qu'on se pose vraiment : « c'est bientôt fini ? »
 *
 * Deux chiffres y répondent, et ils vivent ici, purs — ni base, ni disque, ni
 * horloge :
 *
 *  1. L'AVANCEMENT D'UNE BRANCHE : la moitié pour sa FUSION (ce qui lui est
 *     propre : elle attend, elle passe, elle bute sur un conflit), l'autre
 *     moitié pour le CHEMIN COMMUN qui suit (enregistrement, envoi, contrôles,
 *     construction, mise en ligne). Une branche fusionnée pendant la
 *     construction est donc bien au-delà de 50 %, et pas « finie » : elle n'est
 *     en ligne qu'à la fin.
 *  2. L'AVANCEMENT DU FLUX : les étapes réellement jouées, à poids égal, la
 *     fusion comptant pour ce que ses branches ont réellement passé.
 *
 * TROIS REFUS, tous nés du même principe — un pourcentage qui ment est pire
 * que pas de pourcentage :
 *
 *  - RIEN N'EST INVENTÉ : sans publication, sans étape, il n'y a pas de
 *    chiffre — `null`, et l'écran n'affiche rien.
 *  - LES ARRONDIS NE MENTENT PAS AUX DEUX BOUTS : tant qu'il reste quelque
 *    chose à faire on ne monte pas à 100 %, et dès que quelque chose est fait
 *    on ne retombe pas à 0 %.
 *  - CE QUI EST ÉCARTÉ N'A PAS DE POURCENTAGE : une branche absente ou laissée
 *    de côté n'avance plus du tout ; lui donner un chiffre la ferait passer
 *    pour en route. Elle le DIT (« écartée du lot »), elle ne se chiffre pas.
 */

import type { EtatDeTache, TacheDuLot } from './fusion-du-lot.js';
import { natureDeLEtat } from './fusion-du-lot.js';

/** L'état d'une étape de publication, tel que le porte la publication. */
export type EtatEtapePublication = 'todo' | 'running' | 'done' | 'failed' | 'skipped';

/** Ce qu'on lit d'une étape pour la chiffrer : sa clé et son état, rien d'autre. */
export interface EtapePourAvancement {
  key: string;
  state: EtatEtapePublication;
}

/**
 * CE QUE VAUT LA FUSION D'UNE BRANCHE, de 0 à 1.
 *
 * `null` pour ce qui est écarté : cette branche ne fait plus partie du voyage.
 *
 * Le conflit est plus AVANCÉ que la fusion en cours, et c'est voulu : le heurt
 * est déjà trouvé, il ne reste qu'à le résoudre — reculer le chiffre à ce
 * moment-là donnerait l'impression que le travail est perdu.
 */
export function avancementDeLaFusion(etat: EtatDeTache): number | null {
  if (natureDeLEtat(etat) === 'ecart') return null;
  if (etat === 'attente') return 0;
  if (etat === 'fusion') return 0.4;
  if (etat === 'conflit') return 0.7;
  return 1;
}

/** Le pourcentage entier d'une part comprise entre 0 et 1, sans mentir aux bouts. */
function pourcentHonnete(part: number): number {
  const borne = Math.min(Math.max(part, 0), 1);
  let pourcent = Math.round(borne * 100);
  if (pourcent >= 100 && borne < 1) pourcent = 99;
  if (pourcent <= 0 && borne > 0) pourcent = 1;
  return pourcent;
}

/**
 * CE QUE VALENT LES ÉTAPES QUI SUIVENT LA FUSION, de 0 à 1 : le chemin commun
 * à toutes les branches une fois réunies.
 *
 * Une étape SAUTÉE ne compte pas — ni au numérateur ni au dénominateur : elle
 * n'a pas été jouée, la faire peser fausserait les deux bouts. Une étape qui
 * TRAVAILLE compte pour une demie : on ne sait pas où elle en est, et la dire
 * finie serait un mensonge. Une étape TOMBÉE ne compte pas comme faite : le
 * chiffre se fige là où la publication s'est arrêtée.
 */
export function avancementApresLaFusion(etapes: readonly EtapePourAvancement[]): number {
  const suite = etapes.filter((etape) => etape.key !== 'merge' && etape.state !== 'skipped');
  if (!suite.length) return 0;
  const acquis = suite.reduce((somme, etape) => {
    if (etape.state === 'done') return somme + 1;
    if (etape.state === 'running') return somme + 0.5;
    return somme;
  }, 0);
  return acquis / suite.length;
}

/** L'avancement chiffré d'une branche embarquée, prêt à afficher. */
export interface AvancementDeBranche {
  /** Le pourcentage entier (0 à 100). */
  pourcent: number;
  /** Sa fusion est-elle passée ? */
  fusionnee: boolean;
  /** Cette branche est-elle en ligne, donc au bout du chemin ? */
  termine: boolean;
}

/**
 * OÙ EN EST UNE BRANCHE, en un chiffre.
 *
 * Moitié fusion, moitié chemin commun — mais le chemin commun ne compte QUE
 * si la fusion de cette branche est passée : une branche encore en conflit ne
 * doit pas gagner des points parce que… rien d'autre ne tourne, justement.
 *
 * `null` pour une branche écartée : elle n'avance plus.
 */
export function avancementDeLaBranche(
  etat: EtatDeTache,
  etapes: readonly EtapePourAvancement[],
): AvancementDeBranche | null {
  const fusion = avancementDeLaFusion(etat);
  if (fusion === null) return null;
  if (etat === 'en-ligne') return { pourcent: 100, fusionnee: true, termine: true };
  const fusionnee = fusion >= 1;
  const suite = fusionnee ? avancementApresLaFusion(etapes) : 0;
  return { pourcent: pourcentHonnete(fusion * 0.5 + suite * 0.5), fusionnee, termine: false };
}

/** L'avancement chiffré de TOUT le flux, tel qu'il s'affiche en tête du tiroir. */
export interface AvancementDuFlux {
  /** Le pourcentage entier (0 à 100). */
  pourcent: number;
  /** Les étapes réellement jouées (les sautées ne comptent pas). */
  etapes: number;
  /** Celles qui sont passées. */
  faites: number;
  /** Tout est passé : le repère passe alors au bleu « terminé ». */
  termine: boolean;
  /** La publication s'est arrêtée là : le chiffre est FIGÉ, pas en route. */
  arrete: boolean;
}

/**
 * L'AVANCEMENT DE L'ENSEMBLE DU FLUX, de la fusion à la mise en ligne.
 *
 * Chaque étape jouée pèse pareil : aucune mesure n'existe pour dire qu'une
 * construction « vaut » trois enregistrements, et inventer des poids ferait un
 * chiffre qui recule d'une publication à l'autre. La FUSION, elle, ne vaut pas
 * 0 ou 1 : elle vaut ce que ses branches ont réellement passé — c'est la seule
 * étape dont on connaît le détail.
 *
 * Une publication RÉUSSIE est à 100 %, même si une étape a été sautée : c'est
 * fini, le dire autrement serait absurde. Une publication TOMBÉE ou ARRÊTÉE
 * garde le chiffre du moment où elle s'est arrêtée, et le DIT.
 */
export function avancementDuFlux(run: {
  state: 'running' | 'success' | 'failed' | 'stopped';
  steps: readonly EtapePourAvancement[];
  taches?: readonly TacheDuLot[];
}): AvancementDuFlux | null {
  const jouees = run.steps.filter((etape) => etape.state !== 'skipped');
  if (!jouees.length) return null;
  const arrete = run.state === 'failed' || run.state === 'stopped';

  const partDeLEtape = (etape: EtapePourAvancement): number => {
    if (etape.state === 'done') return 1;
    if (etape.key === 'merge' && etape.state === 'running') return partDeLaFusion(run.taches);
    if (etape.state === 'running') return 0.5;
    return 0;
  };

  const acquis = jouees.reduce((somme, etape) => somme + partDeLEtape(etape), 0);
  const faites = jouees.filter((etape) => etape.state === 'done').length;
  const part = run.state === 'success' ? 1 : acquis / jouees.length;
  return {
    pourcent: pourcentHonnete(part),
    etapes: jouees.length,
    faites,
    termine: run.state === 'success',
    arrete,
  };
}

/**
 * CE QUE LA FUSION A RÉELLEMENT PASSÉ, pendant qu'elle tourne : la moyenne de
 * ses branches. Les branches ÉCARTÉES ne pèsent pas — leur sort est réglé, les
 * compter pour 0 ferait reculer le chiffre à chaque abandon. Sans liste de
 * tâches (une publication d'avant cette liste), la fusion compte pour une
 * demie, comme n'importe quelle étape en cours.
 */
function partDeLaFusion(taches?: readonly TacheDuLot[]): number {
  if (!taches?.length) return 0.5;
  const parts = taches.map((tache) => avancementDeLaFusion(tache.etat)).filter((p): p is number => p !== null);
  if (!parts.length) return 1;
  return parts.reduce((somme, part) => somme + part, 0) / parts.length;
}
