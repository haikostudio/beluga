/**
 * LA RÉDACTION D'UNE TÂCHE NÉE DE LA MESSAGERIE, ET CE QU'ON EN DIT.
 *
 * Quand une demande de client devient une tâche, la carte naît avec le titre et
 * le texte ÉCRITS PAR LE CLIENT — c'est ce qui la rend utilisable tout de
 * suite — puis un agent de cadrage est chargé de les réécrire. Cette seconde
 * étape peut tomber : moteur indisponible, quota épuisé, tour parti qui ne rend
 * rien. Elle ne le disait à personne : une ligne de journal technique, et une
 * carte qui restait avec le texte du client sans que rien ne l'explique.
 *
 * Les règles ci-dessous n'ont besoin ni de base ni de réseau — elles disent, à
 * partir de l'état gardé sur la carte et de l'heure, ce que l'écran doit
 * montrer. Elles vivent donc ici, avec leur test.
 *
 * DEUX GARDE-FOUS DE TEMPS, ET C'EST TOUT CE QUI LES JUSTIFIE : un nouvel essai
 * est un `setTimeout` en mémoire, et un tour vit dans un processus. Les deux
 * meurent avec le démon. Sans échéance, une carte resterait « rédaction en
 * attente » pour toujours, en promettant un essai que plus personne ne fera —
 * ce qui est exactement le silence qu'on vient de corriger.
 */

/** L'état de la rédaction, tel qu'il est gardé sur la carte. */
export type EtatDeRedaction = 'en-cours' | 'en-attente' | 'faite' | 'echouee';

/** Ce que la carte garde de sa rédaction. */
export interface RedactionDeCarte {
  etat: EtatDeRedaction;
  /** Pourquoi elle a échoué, en mots courants. Absent tant que rien n'a raté. */
  raison?: string;
  /** Combien de tours ont déjà été tentés. */
  essais: number;
  /** Quand cet état a été posé. */
  a?: number;
  /** Quand le prochain essai doit partir, en attente d'un nouvel essai. */
  prochainEssaiA?: number;
}

/**
 * LA MARGE APRÈS L'ÉCHÉANCE D'UN NOUVEL ESSAI. Au-delà, l'essai promis ne
 * viendra plus (démon redémarré entre-temps) et la mention devient celle d'un
 * échec, avec son bouton.
 */
export const MARGE_DE_NOUVEL_ESSAI_MS = 120_000;

/**
 * AU-DELÀ, UN TOUR DE RÉDACTION « EN COURS » EST MORT. Un cadrage de demande
 * dure quelques dizaines de secondes ; un quart d'heure, jamais. Cette borne
 * évite la carte éternellement « en cours de rédaction » d'un démon coupé en
 * plein tour.
 */
export const DELAI_DE_REDACTION_MS = 15 * 60_000;

/** Ce que l'écran doit montrer, ou `null` quand il n'y a rien à dire. */
export interface MentionDeRedaction {
  /** « en-attente » : un nouvel essai est prévu. « echouee » : plus rien ne part. */
  etat: 'en-attente' | 'echouee';
  raison?: string;
  essais: number;
  /** Le bouton « refaire la rédaction » a-t-il un sens ici ? */
  relancable: boolean;
}

/**
 * CE QUI SE LIT SUR LA CARTE, à cet instant.
 *
 * Rien pour une rédaction réussie ni pour une rédaction qui tourne encore : le
 * cours normal des choses ne s'annonce pas. Une attente dépassée, un tour resté
 * en l'air, un échec : la mention paraît, et elle se relance.
 */
export function mentionDeRedaction(
  redaction: RedactionDeCarte | undefined,
  maintenant: number,
): MentionDeRedaction | null {
  if (!redaction || redaction.etat === 'faite') return null;
  const essais = redaction.essais ?? 0;
  const echec = (relancable: boolean): MentionDeRedaction => ({
    etat: 'echouee',
    raison: redaction.raison,
    essais,
    relancable,
  });

  if (redaction.etat === 'en-cours') {
    const depuis = redaction.a ?? 0;
    return maintenant - depuis > DELAI_DE_REDACTION_MS ? echec(true) : null;
  }
  if (redaction.etat === 'en-attente') {
    const echeance = redaction.prochainEssaiA ?? redaction.a ?? 0;
    if (maintenant < echeance + MARGE_DE_NOUVEL_ESSAI_MS) {
      return { etat: 'en-attente', raison: redaction.raison, essais, relancable: false };
    }
    return echec(true);
  }
  return echec(true);
}

/**
 * LA RAISON D'UN ÉCHEC, DITE POUR QUELQU'UN QUI NE PROGRAMME PAS. Les motifs
 * connus ont leur phrase ; le reste retombe sur le message brut, tronqué — mieux
 * vaut une phrase technique qu'aucune explication.
 */
export const LONGUEUR_RAISON_MAX = 240;

export function raisonDeRedaction(brut: string | undefined): string {
  const propre = (brut ?? '').trim().replace(/\s+/g, ' ');
  if (!propre) return 'la rédaction automatique n’a pas abouti, sans cause identifiée';
  return propre.length > LONGUEUR_RAISON_MAX ? `${propre.slice(0, LONGUEUR_RAISON_MAX - 1)}…` : propre;
}
