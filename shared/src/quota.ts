/**
 * Les repères de temps des fenêtres de quota.
 *
 * Une heure fixe (« remise à zéro à 12 h 59 ») se lit mal : à 8 h 59 elle
 * ressemble à un compte à rebours qui vient de partir, alors que la fenêtre
 * tournait déjà depuis une heure. Le temps RESTANT ne laisse aucune place à
 * cette lecture-là.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

/**
 * Ce qu'il reste avant la remise à zéro, dit court : « reste 3 h 57 »,
 * « reste 12 min », « reste 2 j 4 h ». Rien du tout sans heure connue, et
 * « remise à zéro imminente » quand l'échéance est passée — le fournisseur
 * annonce parfois l'heure une poignée de secondes avant de basculer.
 */
export function tempsRestant(resetsAt?: number, maintenant = Date.now()): string | null {
  if (!resetsAt) return null;
  const restant = resetsAt - maintenant;
  if (restant <= 0) return 'remise à zéro imminente';

  const minutes = Math.floor(restant / 60_000);
  const heures = Math.floor(minutes / 60);
  const jours = Math.floor(heures / 24);

  if (jours >= 1) {
    const reste = heures - jours * 24;
    return reste ? `reste ${jours} j ${reste} h` : `reste ${jours} j`;
  }
  if (heures >= 1) {
    const reste = minutes - heures * 60;
    // Deux chiffres après l'heure : « 3 h 7 » se lit mal, « 3 h 07 » se lit.
    return reste ? `reste ${heures} h ${String(reste).padStart(2, '0')}` : `reste ${heures} h`;
  }
  // Sous la minute, « reste 0 min » donnerait l'impression d'un compteur figé.
  return minutes >= 1 ? `reste ${minutes} min` : 'reste moins d’une minute';
}

/* ------------------------------------------------------------------ */
/* L'alerte de fin de fenêtre                                          */
/* ------------------------------------------------------------------ */

/** Sous ce reste, la fenêtre de cinq heures se signale sur le téléphone. */
export const SEUIL_FIN_DE_FENETRE_MS = 30 * 60 * 1000;

export interface EtatFinDeFenetre {
  /** Heure annoncée de remise à zéro de la fenêtre courte. */
  resetsAt?: number;
  /** La dernière lecture de quota a échoué : les chiffres affichés sont périmés. */
  lectureEnEchec?: boolean;
  /** L'échéance pour laquelle on a DÉJÀ prévenu, s'il y en a une. */
  dejaAnnoncee?: number;
}

/**
 * Faut-il prévenir maintenant ? Une seule fois par fenêtre : c'est l'heure de
 * remise à zéro elle-même qui sert de marque, donc une nouvelle fenêtre
 * (nouvelle échéance) redonne droit à une alerte, et un redémarrage du serveur
 * n'en refait pas une pour la même.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */
export function doitAlerterFinDeFenetre(etat: EtatFinDeFenetre, maintenant = Date.now()): boolean {
  // Chiffres périmés : prévenir sur une preuve qu'on n'a plus n'aide personne.
  if (etat.lectureEnEchec || !etat.resetsAt) return false;
  if (etat.dejaAnnoncee === etat.resetsAt) return false;
  const restant = etat.resetsAt - maintenant;
  // Échéance déjà passée : la fenêtre est finie, l'alerte n'a plus d'objet.
  return restant > 0 && restant <= SEUIL_FIN_DE_FENETRE_MS;
}

/** L'heure exacte de remise à zéro, pour l'infobulle : le détail reste accessible. */
export function heureDeRemiseAZero(resetsAt?: number, maintenant = Date.now()): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  const heure = date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  const memeJour = date.toDateString() === new Date(maintenant).toDateString();
  return memeJour
    ? `Remise à zéro à ${heure}`
    : `Remise à zéro le ${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} à ${heure}`;
}

/**
 * La couleur d'une jauge de quota, jugée sur ce qu'il RESTE et non sur ce qui
 * est consommé : vert tant qu'on a de la marge, jaune en entrant dans les
 * derniers 30 %, rouge dans les derniers 15 %. Une seule règle pour la barre
 * d'un compte et pour l'anneau du bouton : les deux doivent virer ensemble.
 */
export type NiveauQuota = 'ok' | 'attention' | 'critique';

export const RESTE_ATTENTION_PCT = 30;
export const RESTE_CRITIQUE_PCT = 15;

/** `consommePct` : la part déjà dépensée de la fenêtre, de 0 à 100. */
export function niveauQuota(consommePct: number): NiveauQuota {
  const reste = 100 - Math.max(0, Math.min(100, consommePct));
  if (reste <= RESTE_CRITIQUE_PCT) return 'critique';
  if (reste <= RESTE_ATTENTION_PCT) return 'attention';
  return 'ok';
}
