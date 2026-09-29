import { descriptionMoteur } from './registre-moteurs.js';
/**
 * LE DÉBUT D'UNE SESSION NE CHANGE PLUS D'UN TOUR À L'AUTRE.
 *
 * Les moteurs facturent trois entrées différentes : le NEUF (plein tarif), ce
 * qui est ÉCRIT dans leur cache (un quart plus cher que le neuf) et ce qui y est
 * RELU (dix fois moins cher). Le cache ne fonctionne que par PRÉFIXE : il est
 * relu tant que le début de l'envoi est identique au signe près, et tout ce qui
 * suit le premier caractère qui change doit être RÉÉCRIT.
 *
 * Or les deux moteurs ne posent pas la consigne système au même endroit :
 *
 *  - CLAUDE la repose TOUT DEVANT à chaque invocation (`--append-system-prompt`,
 *    réappliqué à chaque reprise). Elle est donc le PRÉFIXE de la conversation :
 *    la changer en cours de session fait réécrire la conversation entière.
 *  - CODEX la colle DEVANT LA DEMANDE, donc à la FIN de l'historique du fil.
 *    Elle n'est plus un préfixe : la raccourcir n'invalide rien, et le pavé
 *    entier renvoyé à chaque tour s'ajouterait à l'historique.
 *  - CURSOR est dans le même cas que Codex : son API n'a pas de consigne
 *    système séparée, le texte part comme un message de plus dans le fil de
 *    l'agent cloud. Renvoyer la consigne entière à chaque tour la stockerait
 *    autant de fois qu'il y a de messages.
 *
 * D'où la règle, mesurée et non devinée (`scripts/mesure-cache-prefixe.mjs`,
 * moteur réel, deux sessions de deux tours) : sur une conversation d'environ
 * 50 000 jetons, remplacer l'entête entier par le rappel court au tour 2 fait
 * passer le relu de 50 802 à 17 753 jetons et le réécrit de 771 à 32 667 — six
 * fois plus cher, pour avoir économisé 930 jetons de texte.
 *
 * Règle PURE : aucun appel moteur, aucune base, aucun disque.
 */

/** Ce que l'appelant sait du tour au moment de choisir l'entête. */
export interface ChoixDEntete {
  /** Le moteur qui reçoit le tour. */
  engine?: string;
  /** Vrai quand on reprend une session déjà ouverte (deuxième tour et suivants). */
  reprise: boolean;
  /** La consigne de rôle entière, servie au premier tour. */
  systemPrompt?: string;
  /** Le rappel court de méthode, servi aux tours suivants quand il est sans risque. */
  systemPromptRappel?: string;
}

/**
 * Vrai quand la consigne système du moteur est le PRÉFIXE de la conversation —
 * et doit donc rester identique d'un tour à l'autre. Un moteur inconnu est
 * traité comme Claude : c'est la valeur par défaut du projet, et la supposition
 * la plus sûre (au pire on renvoie un texte déjà en cache).
 */
export function consigneEnTeteDeSession(engine?: string): boolean {
  return descriptionMoteur(engine)?.consigneEnTete ?? true;
}

/**
 * L'ENTÊTE RÉELLEMENT ENVOYÉ POUR CE TOUR.
 *
 * Sous Claude : toujours la consigne entière, au premier tour comme en reprise —
 * c'est ce qui garde le préfixe stable, donc relu. Sous Codex : la consigne
 * entière au premier tour, le rappel court ensuite, comme avant.
 */
export function enteteDuTour(choix: ChoixDEntete): string | undefined {
  if (!choix.reprise) return choix.systemPrompt;
  if (consigneEnTeteDeSession(choix.engine)) return choix.systemPrompt ?? choix.systemPromptRappel;
  return choix.systemPromptRappel;
}

/* ------------------------------------------------------------------ */
/* CE QUE LE CACHE A RÉELLEMENT ÉPARGNÉ, SUR SEPT JOURS                 */
/* ------------------------------------------------------------------ */

/**
 * La fenêtre du relevé affiché dans les réglages. Sept jours : assez long pour
 * lisser une journée creuse, assez court pour qu'un réglage changé se voie.
 */
export const JOURS_DE_CACHE = 7;

/** Ce qu'un moteur a compté en entrée sur la fenêtre : neuf ou réécrit, et relu. */
export interface EntreeMesuree {
  /** Moteur concerné, quand le relevé est détaillé. */
  engine?: string;
  /** Entrée facturée plein tarif : le neuf ET ce qui a été écrit dans le cache. */
  frais: number;
  /** Entrée RELUE au cache, dix fois moins chère. */
  relu: number;
  /** Nombre de tours derrière ces sommes. */
  tours?: number;
}

/** Le relevé rendu à l'écran : jamais un « 0 % » inventé sur une fenêtre vide. */
export interface PartDeCache {
  frais: number;
  relu: number;
  entree: number;
  /** Part relue, de 0 à 1. Absente quand rien n'a été mesuré. */
  part?: number;
  tours: number;
}

/**
 * LA PART DE L'ENTRÉE RELUE AU CACHE.
 *
 * Une fenêtre sans le moindre tour ne vaut pas zéro pour cent : elle vaut « pas
 * de mesure ». C'est la même règle que partout dans le projet — une mesure
 * absente se dit, elle ne se remplace pas par un chiffre rassurant.
 */
export function partRelueAuCache(mesures: EntreeMesuree[]): PartDeCache {
  const somme = (lire: (m: EntreeMesuree) => number) =>
    mesures.reduce((total, m) => total + Math.max(0, lire(m) || 0), 0);
  const frais = somme((m) => m.frais);
  const relu = somme((m) => m.relu);
  const entree = frais + relu;
  return {
    frais,
    relu,
    entree,
    part: entree > 0 ? relu / entree : undefined,
    tours: somme((m) => m.tours ?? 0),
  };
}
