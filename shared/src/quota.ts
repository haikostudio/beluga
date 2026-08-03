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

/* ------------------------------------------------------------------ */
/* La prévision d'épuisement de la fenêtre hebdomadaire                */
/* ------------------------------------------------------------------ */

/**
 * « À ce rythme, quand le quota de la semaine sera-t-il vide ? »
 *
 * La matière première est l'historique des relevés déjà tenu par le serveur :
 * une suite de pourcentages consommés, horodatés. La pente entre le premier et
 * le dernier relevé de la fenêtre EN COURS donne le rythme ; le reste à
 * consommer divisé par ce rythme donne l'instant d'épuisement.
 *
 * Le silence l'emporte sur le chiffre inventé : pas assez d'historique, rythme
 * nul ou négatif, fenêtre déjà pleine, ou épuisement qui tombe APRÈS la remise
 * à zéro — dans tous ces cas la fonction ne rend rien.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

/** Un relevé de quota : à telle heure, tant de pour cent consommés. */
export interface ReleveQuota {
  at: number;
  weekly: number;
  /** La fenêtre de cinq heures du même relevé, quand elle est connue. */
  session?: number;
}

/** Laquelle des deux fenêtres on regarde. */
export type SerieQuota = 'weekly' | 'session';

/**
 * Sous cette durée d'observation, la pente ne veut rien dire. Une heure pour la
 * semaine ; vingt minutes pour la fenêtre de cinq heures, qui se remet à zéro
 * bien plus souvent et n'offrirait jamais une heure d'observation utile.
 */
export const OBSERVATION_MINIMALE_MS = 60 * 60 * 1000;
export const OBSERVATION_MINIMALE_COURTE_MS = 20 * 60 * 1000;

/**
 * Part du temps restant qui sépare une prévision « le quota va manquer » d'une
 * prévision qui tient presque jusqu'au bout : épuisement dans le dernier quart
 * avant la remise à zéro, c'est juste, mais ce n'est pas un manque.
 */
export const MARGE_CONFORT = 0.25;

export interface PrevisionEpuisement {
  /** L'instant estimé, arrondi à la demi-heure. */
  at: number;
  /** Ce qui s'affiche : « épuisé lundi vers 17 h ». */
  texte: string;
  /** L'infobulle : l'heure exacte et le rythme observé. */
  detail: string;
  /** « manque » : le quota tombe bien avant la fin. « juste » : de peu. */
  niveau: 'manque' | 'juste';
  /** Le rythme retenu, en points de pourcentage par jour. */
  parJour: number;
}

/** La valeur lue sur la série demandée ; la semaine à défaut. */
function valeur(releve: ReleveQuota, serie: SerieQuota): number {
  return serie === 'session' ? (releve.session ?? 0) : releve.weekly;
}

/** Les relevés de la fenêtre EN COURS : tout ce qui suit la dernière remise à zéro. */
function depuisLaDerniereRemiseAZero(releves: ReleveQuota[], serie: SerieQuota): ReleveQuota[] {
  for (let i = releves.length - 1; i > 0; i--) {
    // Un pourcentage qui RECULE ne peut vouloir dire qu'une chose : la fenêtre
    // a été remise à zéro entre ces deux relevés.
    if (valeur(releves[i], serie) < valeur(releves[i - 1], serie)) return releves.slice(i);
  }
  return releves;
}

/** « aujourd'hui », « demain », sinon le jour de la semaine en toutes lettres. */
function jourEnClair(at: number, maintenant: number): string {
  const jour = (valeur: number) => new Date(valeur).toDateString();
  if (jour(at) === jour(maintenant)) return 'aujourd’hui';
  if (jour(at) === jour(maintenant + 24 * 3600 * 1000)) return 'demain';
  return new Date(at).toLocaleDateString('fr-CH', { weekday: 'long' });
}

/** « 17 h » ou « 17 h 30 » : la demi-heure suffit pour une estimation. */
function heureEnClair(at: number): string {
  const date = new Date(at);
  return date.getMinutes() ? `${date.getHours()} h 30` : `${date.getHours()} h`;
}

export function previsionEpuisement(
  releves: ReleveQuota[],
  fenetre: { usedPct?: number; resetsAt?: number } | undefined,
  maintenant = Date.now(),
  serie: SerieQuota = 'weekly',
): PrevisionEpuisement | null {
  // Sans heure de remise à zéro, impossible de dire si l'épuisement tombe
  // avant ou après la fin : on se tait.
  if (!fenetre?.resetsAt || fenetre.resetsAt <= maintenant) return null;

  const passes = releves.filter((point) => point.at <= maintenant).sort((a, b) => a.at - b.at);
  const recents = depuisLaDerniereRemiseAZero(passes, serie);
  if (recents.length < 2) return null;

  const premier = recents[0];
  const dernier = recents[recents.length - 1];
  const duree = dernier.at - premier.at;
  const minimum = serie === 'session' ? OBSERVATION_MINIMALE_COURTE_MS : OBSERVATION_MINIMALE_MS;
  if (duree < minimum) return null;

  const rythme = (valeur(dernier, serie) - valeur(premier, serie)) / duree; // points de % par ms
  if (rythme <= 0) return null;

  const consomme = fenetre.usedPct ?? valeur(dernier, serie);
  const reste = 100 - consomme;
  if (reste <= 0) return null; // déjà épuisée : il n'y a plus rien à prévoir

  const brut = maintenant + reste / rythme;
  if (brut >= fenetre.resetsAt) return null; // le quota tient jusqu'au bout

  const demiHeure = 30 * 60 * 1000;
  const at = Math.round(brut / demiHeure) * demiHeure;
  const marge = fenetre.resetsAt - brut;
  const total = fenetre.resetsAt - maintenant;
  const parJour = rythme * 24 * 3600 * 1000;

  const exact = new Date(brut).toLocaleString('fr-CH', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Une fenêtre de cinq heures se juge à l'heure, pas à la journée : « 6 % par
  // jour » sur une fenêtre qui dure cinq heures ne dit rien à personne.
  const cadence =
    serie === 'session'
      ? `environ ${(rythme * 3600 * 1000).toFixed(1)} % par heure`
      : `environ ${parJour.toFixed(1)} % par jour`;

  return {
    at,
    texte: `épuisé ${jourEnClair(at, maintenant)} vers ${heureEnClair(at)}`,
    detail: `Au rythme observé (${cadence}), épuisement estimé ${exact}, avant la remise à zéro.`,
    niveau: marge > total * MARGE_CONFORT ? 'manque' : 'juste',
    parJour,
  };
}

/* ------------------------------------------------------------------ */
/* Le compte de secours                                                */
/* ------------------------------------------------------------------ */

/**
 * Quand un compte va manquer de quota, la question suivante est toujours la
 * même : « sur lequel bascule-t-on ? ». La réponse ne vaut qu'entre comptes du
 * MÊME moteur — un compte Codex ne remplace pas un compte Claude — et
 * seulement si le candidat, lui, tient jusqu'à la remise à zéro.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */
export interface CandidatSecours {
  id: string;
  label: string;
  engine: string;
  /** Le compte répond encore : il n'est pas marqué épuisé. */
  disponible: boolean;
  /** Sa semaine tient jusqu'au bout : aucune prévision de manque dessus. */
  tientJusquAuBout: boolean;
  /** Part consommée de sa semaine, pour départager deux candidats. */
  consommePct: number;
}

export function compteDeSecours(
  enManque: { id: string; engine: string },
  candidats: CandidatSecours[],
): CandidatSecours | null {
  const possibles = candidats.filter(
    (c) => c.id !== enManque.id && c.engine === enManque.engine && c.disponible && c.tientJusquAuBout,
  );
  if (!possibles.length) return null;
  // Le moins entamé : c'est celui qui tiendra le plus longtemps après la bascule.
  return possibles.reduce((meilleur, c) => (c.consommePct < meilleur.consommePct ? c : meilleur));
}

/* ------------------------------------------------------------------ */
/* L'alerte « le quota va manquer »                                    */
/* ------------------------------------------------------------------ */

export interface EtatAlerteEpuisement {
  /** Fin de la fenêtre hebdomadaire : elle sert aussi de marque d'annonce. */
  resetsAt?: number;
  /** Le niveau de la prévision, absent quand il n'y en a pas. */
  niveau?: 'manque' | 'juste';
  /** La dernière lecture de quota a échoué : les chiffres sont périmés. */
  lectureEnEchec?: boolean;
  /** La fenêtre pour laquelle on a DÉJÀ prévenu, s'il y en a une. */
  dejaAnnoncee?: number;
}

/**
 * Faut-il prévenir sur le téléphone ? Seulement quand le quota va vraiment
 * manquer, et une seule fois par semaine : c'est l'heure de remise à zéro de la
 * fenêtre hebdomadaire qui sert de marque, donc une nouvelle semaine redonne
 * droit à une alerte et un redémarrage du serveur n'en refait pas une.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */
export function doitAlerterEpuisementProche(
  etat: EtatAlerteEpuisement,
  maintenant = Date.now(),
): boolean {
  if (etat.lectureEnEchec || !etat.resetsAt) return false;
  if (etat.niveau !== 'manque') return false;
  if (etat.dejaAnnoncee === etat.resetsAt) return false;
  return etat.resetsAt > maintenant;
}
