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
 * « remise à zéro imminente » juste autour de l'échéance — le fournisseur
 * annonce parfois l'heure une poignée de secondes avant de basculer. Au-delà
 * d'une minute, on dit que l'échéance est dépassée : l'ancien message ne doit
 * jamais donner l'impression que la bascule est encore à quelques secondes.
 */
export function tempsRestant(resetsAt?: number, maintenant = Date.now()): string | null {
  if (!resetsAt) return null;
  const restant = resetsAt - maintenant;
  if (restant <= -60_000) return 'échéance dépassée — vérification en cours';
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

/**
 * Âge lisible du dernier relevé réussi. Cette phrase n'est montrée que lorsque
 * la lecture suivante échoue : les pourcentages restent utiles, mais personne
 * ne doit les prendre pour des chiffres frais.
 */
export function fraicheurDuReleve(fetchedAt?: number, maintenant = Date.now()): string | null {
  if (!fetchedAt) return null;
  const age = Math.max(0, maintenant - fetchedAt);
  const minutes = Math.floor(age / 60_000);
  const heures = Math.floor(minutes / 60);
  const jours = Math.floor(heures / 24);
  if (jours >= 1) return `dernier relevé il y a ${jours} jour${jours > 1 ? 's' : ''}`;
  if (heures >= 1) return `dernier relevé il y a ${heures} h`;
  if (minutes >= 1) return `dernier relevé il y a ${minutes} min`;
  return 'dernier relevé il y a moins d’une minute';
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
  /** Le profil des heures creuses a servi (sinon : simple prolongement de la pente). */
  heuresCreuses: boolean;
  /**
   * Le chemin projeté, du présent jusqu'à l'épuisement : de quoi tracer le
   * pointillé du graphique en suivant les creux au lieu d'une droite.
   */
  trajectoire: { at: number; pct: number }[];
}

/* ------------------------------------------------------------------ */
/* Le profil des heures de la journée                                  */
/* ------------------------------------------------------------------ */

/**
 * La nuit, entre une heure et sept heures du matin, il ne se lance quasiment
 * rien. Prolonger la pente des dernières heures comme si le rythme tenait
 * vingt-quatre heures sur vingt-quatre annonce donc un épuisement trop tôt.
 *
 * Le profil se MESURE : pour chaque tranche, on additionne ce qui a été
 * consommé pendant cette tranche et le temps réellement observé dedans, ce
 * qui donne un rythme par tranche. Ramené à une moyenne de 1, il
 * dit « cette tranche-là consomme deux fois plus que la moyenne », « celle-là
 * presque rien » — sans qu'aucune heure creuse soit écrite dans le code.
 *
 * Et l'heure seule ne suffit pas : un samedi à 15 h et un mardi à 15 h n'ont
 * aucune raison de se ressembler. Le profil de SEMAINE tient donc quarante-huit
 * tranches — vingt-quatre heures pour les jours ouvrés, vingt-quatre pour le
 * week-end — et retombe sur les vingt-quatre tranches d'une journée type quand
 * l'historique n'a pas encore vu les deux régimes en entier.
 */

/** Les deux régimes du profil de semaine, dans l'ordre où ils sont rangés. */
export const TRANCHES_JOURNEE = 24;
export const TRANCHES_SEMAINE = 48;

/** Samedi et dimanche d'un côté, les cinq autres jours de l'autre. */
export function estWeekEnd(at: number): boolean {
  const jour = new Date(at).getDay();
  return jour === 0 || jour === 6;
}

/**
 * Où ranger un instant : son heure seule sur un profil de journée, son heure
 * DÉCALÉE de vingt-quatre cases sur un profil de semaine quand c'est un
 * week-end.
 */
function trancheDe(at: number, taille: number): number {
  const heure = new Date(at).getHours();
  return taille === TRANCHES_SEMAINE && estWeekEnd(at) ? heure + TRANCHES_JOURNEE : heure;
}

/**
 * La part de chaque tranche dans une semaine type. Sur un profil de journée,
 * les vingt-quatre heures pèsent pareil. Sur un profil de semaine, une tranche
 * de jour ouvré revient CINQ fois par semaine et une tranche de week-end deux :
 * c'est cette pondération-là qui garantit qu'une semaine entière consomme
 * exactement autant qu'avant le profil — seule l'heure d'épuisement bouge.
 */
function partsDeLaSemaine(taille: number): number[] {
  if (taille !== TRANCHES_SEMAINE) return new Array(taille).fill(1 / taille);
  return Array.from({ length: TRANCHES_SEMAINE }, (_, i) =>
    i < TRANCHES_JOURNEE ? 5 / 7 / TRANCHES_JOURNEE : 2 / 7 / TRANCHES_JOURNEE,
  );
}

/** Il faut au moins ce temps d'observation pour qu'un profil veuille dire quelque chose. */
export const PROFIL_OBSERVATION_MINIMALE_MS = 24 * 60 * 60 * 1000;
/** Et au moins ce total consommé : sous ce seuil, on ne mesure que du bruit. */
export const PROFIL_CONSOMMATION_MINIMALE_PCT = 3;
/** Chaque tranche de la journée doit avoir été observée au moins ce temps-là. */
export const PROFIL_COUVERTURE_MINIMALE_MS = 10 * 60 * 1000;
/** Un poids ne monte jamais au-delà : une pointe isolée ne fait pas la loi. */
export const PROFIL_POIDS_MAXIMUM = 4;
/**
 * Et jamais tout à fait zéro : une tranche à zéro absolu ferait une projection
 * qui n'arrive jamais au bout, alors qu'une nuit vraiment creuse n'est jamais
 * qu'une nuit très lente.
 */
export const PROFIL_POIDS_MINIMUM = 0.02;

/** Répartit une consommation sur les tranches qu'elle traverse. */
function repartirSurLesTranches(
  debut: number,
  fin: number,
  consomme: number,
  duree: number[],
  poids: number[],
): void {
  const total = fin - debut;
  if (total <= 0) return;
  let curseur = debut;
  // Garde-fou : un trou de plusieurs semaines entre deux relevés ne doit pas
  // faire tourner cette boucle indéfiniment.
  for (let pas = 0; pas < 24 * 60 && curseur < fin; pas++) {
    const tranche = trancheDe(curseur, duree.length);
    const prochaine = new Date(curseur).setMinutes(60, 0, 0);
    const bord = Math.min(prochaine, fin);
    const part = bord - curseur;
    duree[tranche] += part;
    poids[tranche] += (consomme * part) / total;
    curseur = bord;
  }
}

/**
 * Le profil mesuré, de la taille demandée : des poids de moyenne 1, ou rien du
 * tout quand l'historique est trop court, trop maigre ou troué. Rien du tout
 * veut dire « garde le calcul d'avant » : mieux vaut la pente plate qu'une
 * prévision fantaisiste.
 */
function construireProfil(
  releves: ReleveQuota[],
  serie: SerieQuota,
  taille: number,
): number[] | null {
  const points = [...releves].sort((a, b) => a.at - b.at);
  if (points.length < 2) return null;

  const duree = new Array(taille).fill(0);
  const consomme = new Array(taille).fill(0);
  let totalConsomme = 0;
  let totalDuree = 0;

  for (let i = 1; i < points.length; i++) {
    const delta = valeur(points[i], serie) - valeur(points[i - 1], serie);
    const span = points[i].at - points[i - 1].at;
    if (span <= 0) continue;
    // Un pourcentage qui RECULE est une remise à zéro : ce qui a été consommé
    // avant la bascule est inconnu, la tranche entière sort du calcul.
    if (delta < 0) continue;
    repartirSurLesTranches(points[i - 1].at, points[i].at, delta, duree, consomme);
    totalConsomme += delta;
    totalDuree += span;
  }

  if (totalDuree < PROFIL_OBSERVATION_MINIMALE_MS) return null;
  if (totalConsomme < PROFIL_CONSOMMATION_MINIMALE_PCT) return null;
  /*
   * Une tranche jamais observée n'a pas de rythme : sans la journée entière, le
   * profil ne saurait pas projeter la suite. Sur un profil de semaine, cette
   * même exigence porte sur les quarante-huit tranches — c'est elle qui réclame
   * d'avoir vu un week-end complet ET un jour ouvré complet avant de séparer
   * les deux régimes.
   */
  if (duree.some((d) => d < PROFIL_COUVERTURE_MINIMALE_MS)) return null;

  const parts = partsDeLaSemaine(taille);
  const rythmes = consomme.map((c, i) => c / duree[i]);
  const moyenne = rythmes.reduce((somme, r, i) => somme + r * parts[i], 0);
  if (moyenne <= 0) return null;

  /*
   * Aucun lissage entre tranches voisines : il déplacerait les bords du creux
   * et fausserait le calage du rythme (une heure de plein jour voisine de la
   * nuit se verrait rabaissée). Seule une pointe démesurée est ramenée au
   * plafond, puis l'ensemble est remis à une moyenne de 1 : c'est cette moyenne
   * qui garantit que sur une semaine entière, le profil ne change rien au total.
   */
  const bruts = rythmes.map((r) =>
    Math.min(PROFIL_POIDS_MAXIMUM, Math.max(PROFIL_POIDS_MINIMUM, r / moyenne)),
  );
  const apresPlafond = bruts.reduce((somme, p, i) => somme + p * parts[i], 0);
  if (apresPlafond <= 0) return null;
  return bruts.map((p) => p / apresPlafond);
}

/* ------------------------------------------------------------------ */
/* La tranche de la journée la plus chargée                            */
/* ------------------------------------------------------------------ */

/**
 * Une tranche ne se dit chargée qu'au-delà de ce rapport à la moyenne.
 * En dessous, la journée est trop régulière pour qu'une pointe veuille dire
 * quelque chose : annoncer un creux qui n'existe pas serait pire que se taire.
 */
export const SEUIL_TRANCHE_CHARGEE = 1.2;

/**
 * Et une plage nommée ne dépasse jamais ces quelques heures. Une journée qui
 * travaille de 8 h à minuit est au-dessus de la moyenne SEIZE heures d'affilée :
 * l'annoncer d'un bloc n'apprendrait rien (« le plus chargé entre 8 h et 1 h »).
 * On garde le cœur de la pointe, là où le rythme est le plus fort.
 */
export const TRANCHE_LARGEUR_MAX = 4;

/** La tranche la plus chargée de la journée, telle qu'elle s'annonce. */
export interface TranchePointe {
  /** Heure de début, de 0 à 23. */
  debut: number;
  /** Heure de fin, exclue (24 s'écrit 0) : « entre 14 h et 16 h ». */
  fin: number;
  /** Combien de fois la moyenne cette tranche consomme. */
  facteur: number;
  /** La phrase affichée sous la courbe. */
  texte: string;
}

/** « deux », « trois »… : un chiffre nu se lit mal dans une phrase. */
function enLettres(n: number): string {
  return ['zéro', 'une', 'deux', 'trois', 'quatre'][n] ?? String(n);
}

/** L'écart à la moyenne, dit comme on le dirait à voix haute. */
function ecartEnMots(facteur: number): string {
  // Sous « deux fois », un pourcentage parle mieux qu'une fraction : « environ
  // 35 % de plus » est plus juste que « environ une fois et demie ».
  if (facteur < 1.75) {
    const pourcent = Math.round(((facteur - 1) * 100) / 5) * 5;
    return `environ ${pourcent} % de plus que la moyenne`;
  }
  if (facteur >= 4.5) return 'plus de quatre fois la moyenne';
  const demies = Math.round(facteur * 2) / 2;
  const entier = Math.floor(demies);
  const moitie = demies - entier >= 0.5;
  return `environ ${enLettres(entier)} fois${moitie ? ' et demie' : ''} la moyenne`;
}

/**
 * La pointe du profil : l'heure la plus chargée, élargie de proche en proche
 * tant que la tranche voisine se tient elle aussi au-dessus du seuil, et sans
 * jamais dépasser `TRANCHE_LARGEUR_MAX`. On nomme ainsi UN bloc continu — celui
 * du pic — au lieu de coudre ensemble des heures éparses qui ne formeraient pas
 * une plage de la journée.
 *
 * Rend `null` sans profil (historique trop court, trop maigre ou troué) et
 * quand aucune tranche ne dépasse le seuil : une journée régulière n'a pas de
 * pointe à annoncer.
 */
export function trancheLaPlusChargee(profil: number[] | null | undefined): TranchePointe | null {
  if (!profil || profil.length !== 24) return null;

  let sommet = 0;
  for (let h = 1; h < 24; h++) if (profil[h] > profil[sommet]) sommet = h;
  if (profil[sommet] < SEUIL_TRANCHE_CHARGEE) return null;

  const dedans = [sommet];
  // On avance des deux côtés en tournant sur le cadran : une pointe qui
  // enjambe minuit reste une seule plage (« entre 22 h et 2 h »).
  let gauche = sommet;
  let droite = sommet;
  while (dedans.length < TRANCHE_LARGEUR_MAX) {
    const avant = (gauche + 23) % 24;
    const apres = (droite + 1) % 24;
    const prendAvant = !dedans.includes(avant) && profil[avant] >= SEUIL_TRANCHE_CHARGEE;
    const prendApres = !dedans.includes(apres) && profil[apres] >= SEUIL_TRANCHE_CHARGEE;
    if (!prendAvant && !prendApres) break;
    // Le voisin le plus chargé d'abord : le bloc grandit par où il pèse.
    if (prendAvant && (!prendApres || profil[avant] >= profil[apres])) {
      dedans.push(avant);
      gauche = avant;
    } else {
      dedans.push(apres);
      droite = apres;
    }
  }

  const facteur = dedans.reduce((somme, h) => somme + profil[h], 0) / dedans.length;
  const fin = (droite + 1) % 24;
  return {
    debut: gauche,
    fin,
    facteur,
    texte: `le plus chargé entre ${gauche} h et ${fin} h, ${ecartEnMots(facteur)}`,
  };
}

/** Le profil d'une journée type : vingt-quatre poids, sans distinguer les jours. */
export function profilHoraire(releves: ReleveQuota[], serie: SerieQuota = 'weekly'): number[] | null {
  return construireProfil(releves, serie, TRANCHES_JOURNEE);
}

/**
 * Le profil de SEMAINE : quarante-huit poids, les vingt-quatre premiers pour
 * les jours ouvrés, les vingt-quatre suivants pour le week-end. Rien du tout
 * tant que les deux régimes n'ont pas été observés heure par heure.
 */
export function profilSemaine(releves: ReleveQuota[], serie: SerieQuota = 'weekly'): number[] | null {
  return construireProfil(releves, serie, TRANCHES_SEMAINE);
}

/**
 * Le meilleur profil disponible : celui de la semaine s'il tient debout, sinon
 * celui d'une journée type, sinon rien.
 */
export function profilRetenu(releves: ReleveQuota[], serie: SerieQuota = 'weekly'): number[] | null {
  return profilSemaine(releves, serie) ?? profilHoraire(releves, serie);
}

/** Le poids d'un instant, quel que soit le profil qu'on tient. */
function poidsA(profil: number[], at: number): number {
  return profil[trancheDe(at, profil.length)];
}

/**
 * Combien de « temps utile » contient un intervalle, une fois chaque tranche
 * pesée par le profil. Deux heures de plein après-midi pèsent bien plus que
 * deux heures de nuit : c'est ce qui permet de ramener une pente observée sur
 * quelques heures de jour à un rythme de référence honnête.
 */
function tempsPondere(debut: number, fin: number, profil: number[]): number {
  if (fin <= debut) return 0;
  let curseur = debut;
  let total = 0;
  for (let pas = 0; pas < 24 * 60 && curseur < fin; pas++) {
    const bord = Math.min(new Date(curseur).setMinutes(60, 0, 0), fin);
    total += (bord - curseur) * poidsA(profil, curseur);
    curseur = bord;
  }
  return total;
}

/**
 * L'avance heure par heure : à chaque tranche son rythme (le rythme moyen
 * multiplié par le poids de la tranche), jusqu'à ce que le reste soit mangé.
 * Rend l'instant d'épuisement et le chemin parcouru pour y arriver.
 *
 * Sans profil, c'est la ligne droite d'avant, exactement.
 */
function avancerJusquAEpuisement(
  depart: number,
  reste: number,
  rythme: number,
  profil: number[] | null,
): { at: number; trajectoire: { at: number; pct: number }[] } | null {
  const consommeDepart = 100 - reste;
  if (!profil) {
    const at = depart + reste / rythme;
    return { at, trajectoire: [{ at: depart, pct: consommeDepart }, { at, pct: 100 }] };
  }

  const trajectoire = [{ at: depart, pct: consommeDepart }];
  let curseur = depart;
  let manquant = reste;
  // Au-delà de soixante jours, la prévision n'a plus d'objet : aucune fenêtre
  // de quota ne dure aussi longtemps.
  for (let pas = 0; pas < 24 * 60; pas++) {
    const bord = new Date(curseur).setMinutes(60, 0, 0);
    // La tranche est lue sur le jour que TRAVERSE la prévision : un samedi de
    // la projection prend le régime week-end, pas celui du jour d'aujourd'hui.
    const vitesse = rythme * poidsA(profil, curseur);
    const tranche = bord - curseur;
    const mangeable = vitesse * tranche;
    if (vitesse > 0 && mangeable >= manquant) {
      const at = curseur + manquant / vitesse;
      trajectoire.push({ at, pct: 100 });
      return { at, trajectoire };
    }
    manquant -= mangeable;
    curseur = bord;
    trajectoire.push({ at: curseur, pct: 100 - manquant });
  }
  return null;
}

/** Le pointillé n'a pas besoin de mille points : on en garde au plus une poignée. */
function allegerLaTrajectoire(points: { at: number; pct: number }[]): { at: number; pct: number }[] {
  const MAX = 60;
  if (points.length <= MAX) return points;
  const pas = Math.ceil(points.length / MAX);
  const out = points.filter((_, index) => index % pas === 0);
  const dernier = points[points.length - 1];
  if (out[out.length - 1] !== dernier) out.push(dernier);
  return out;
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

  /*
   * Le profil se mesure sur TOUT l'historique, pas seulement sur la fenêtre en
   * cours : plus il y a de nuits observées, plus les creux sont sûrs. Il rend
   * null dès que la matière manque, et l'avance retombe alors sur la ligne
   * droite d'avant.
   */
  /*
   * Le profil ne vaut que pour la SEMAINE : une fenêtre de cinq heures se joue
   * à l'intérieur d'une demi-journée, un rythme moyen par heure n'y
   * apprendrait rien et une nuit ne la traverse presque jamais. Le profil de
   * semaine (jours ouvrés / week-end) passe d'abord ; à défaut, celui d'une
   * journée type.
   */
  const profil = serie === 'weekly' ? profilRetenu(passes, serie) : null;

  /*
   * Le rythme de référence, une fois le profil connu, n'est plus la pente
   * brute : c'est ce qu'on a consommé rapporté au temps PONDÉRÉ de la période
   * observée. Une pente relevée sur une matinée bien remplie devient ainsi un
   * rythme moyen sur la journée entière, nuit comprise — ce qui repousse
   * l'épuisement au lieu de l'annoncer trop tôt.
   */
  const pondere = profil ? tempsPondere(premier.at, dernier.at, profil) : 0;
  const consommeObserve = valeur(dernier, serie) - valeur(premier, serie);
  const reference = profil && pondere > 0 ? consommeObserve / pondere : rythme;
  const retenu = profil && reference > 0 ? reference : rythme;
  const applique = profil && reference > 0 ? profil : null;

  const avance = avancerJusquAEpuisement(maintenant, reste, retenu, applique);
  if (!avance) return null; // l'épuisement se perd dans un avenir sans intérêt

  const brut = avance.at;
  if (brut >= fenetre.resetsAt) return null; // le quota tient jusqu'au bout

  const demiHeure = 30 * 60 * 1000;
  const at = Math.round(brut / demiHeure) * demiHeure;
  const marge = fenetre.resetsAt - brut;
  const total = fenetre.resetsAt - maintenant;
  const parJour = retenu * 24 * 3600 * 1000;

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
      ? `environ ${(retenu * 3600 * 1000).toFixed(1)} % par heure`
      : `environ ${parJour.toFixed(1)} % par jour`;

  // Le chiffre doit rester compréhensible : on dit d'où il sort, et notamment
  // qu'il ne suppose plus le même rythme la nuit que le jour.
  const base = !applique
    ? 'en prolongeant simplement le rythme des dernières heures'
    : applique.length === TRANCHES_SEMAINE
      ? 'en tenant compte des heures creuses mesurées (la nuit et le week-end consomment peu)'
      : 'en tenant compte des heures creuses mesurées (la nuit consomme peu)';

  return {
    at,
    texte: `épuisé ${jourEnClair(at, maintenant)} vers ${heureEnClair(at)}`,
    detail: `Au rythme observé (${cadence}), ${base}, épuisement estimé ${exact}, avant la remise à zéro.`,
    niveau: marge > total * MARGE_CONFORT ? 'manque' : 'juste',
    parJour,
    heuresCreuses: !!applique,
    trajectoire: allegerLaTrajectoire(avance.trajectoire),
  };
}

/* ------------------------------------------------------------------ */
/* L'emballement : le rythme s'écarte brusquement de l'habitude         */
/* ------------------------------------------------------------------ */

/**
 * La prévision d'épuisement ne parle que lorsqu'elle bascule au niveau
 * « manque » : quand elle se décide, le quota est déjà largement entamé. Un
 * agent parti en boucle peut donc brûler en deux heures ce qu'une journée
 * entière consomme d'habitude, sans que rien ne sorte.
 *
 * Ici on ne regarde pas la fin de la semaine mais le rythme des DERNIÈRES
 * heures, comparé à ce que le profil mesuré (`profilHoraire`) prévoyait pour
 * ces mêmes tranches de la journée. Au-delà d'un écart franc et soutenu, il y a
 * emballement. Sans profil, aucun avis : on ne crie pas sur une base qu'on n'a
 * pas.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

/** Au-delà de ce multiple de l'attendu, l'intervalle est dit « emballé ». */
export const EMBALLEMENT_FACTEUR = 3;
/** Et il en faut au moins autant d'affilée : une pointe isolée n'est pas un emballement. */
export const EMBALLEMENT_RELEVES_MINIMUM = 2;
/** Sous ce total consommé pendant la série, l'écart n'est que du bruit d'arrondi. */
export const EMBALLEMENT_CONSOMMATION_MINIMALE_PCT = 1;
/** Le dernier relevé doit dater de moins que ça : on ne s'alarme pas sur du passé. */
export const EMBALLEMENT_FRAICHEUR_MS = 60 * 60 * 1000;

export interface EmballementConsommation {
  /** L'instant où la série s'est emballée : c'est lui qui sert de marque d'annonce. */
  depuis: number;
  /** Combien d'intervalles d'affilée sont au-dessus du seuil. */
  releves: number;
  /** Ce qui a été consommé pendant la série, en points de pourcentage. */
  consommePct: number;
  /** Ce qui aurait dû l'être sur la même période, selon le profil mesuré. */
  attenduPct: number;
  /** Le rapport des deux : 4 pour « quatre fois plus vite que d'habitude ». */
  facteur: number;
  /** La phrase toute prête, en français simple. */
  texte: string;
}

/**
 * Le rythme de référence : ce qui a été consommé sur tout l'historique, rapporté
 * au temps PONDÉRÉ par le profil. Calibré ainsi, l'attendu d'une période colle
 * exactement au total réellement observé — le profil ne fait que le répartir.
 */
function rythmeDeReference(points: ReleveQuota[], serie: SerieQuota, profil: number[]): number {
  let consomme = 0;
  let pondere = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = valeur(points[i], serie) - valeur(points[i - 1], serie);
    const span = points[i].at - points[i - 1].at;
    // Un pourcentage qui recule est une remise à zéro : la tranche sort du calcul.
    if (span <= 0 || delta < 0) continue;
    consomme += delta;
    pondere += tempsPondere(points[i - 1].at, points[i].at, profil);
  }
  return pondere > 0 ? consomme / pondere : 0;
}

/** « 1 h 30 », « 45 min » : la durée d'une série, dite court. */
function dureeEnClair(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes - heures * 60;
  return reste ? `${heures} h ${String(reste).padStart(2, '0')}` : `${heures} h`;
}

/**
 * La série d'intervalles emballés qui se termine MAINTENANT, ou rien du tout.
 *
 * On remonte le temps depuis le dernier relevé tant que chaque intervalle
 * dépasse le seuil ; le premier intervalle rentré dans l'ordinaire arrête le
 * compte. La série n'est donc pas bornée par une fenêtre glissante : un
 * emballement qui dure garde le même point de départ — donc la même marque
 * d'annonce — et ne se redit pas.
 */
export function emballementConsommation(
  releves: ReleveQuota[],
  maintenant = Date.now(),
  serie: SerieQuota = 'weekly',
): EmballementConsommation | null {
  const passes = releves.filter((point) => point.at <= maintenant).sort((a, b) => a.at - b.at);
  /*
   * Le profil vient de TOUT l'historique, pas de la seule fenêtre en cours :
   * c'est lui l'« habituel » auquel on compare. Comme pour la prévision, il ne
   * vaut que pour la semaine — une fenêtre de cinq heures ne traverse pas de
   * nuit et n'apprendrait rien d'un rythme par heure de la journée.
   */
  const profil = serie === 'weekly' ? profilHoraire(passes, serie) : null;
  // Sans profil mesuré, il n'y a pas d'habitude connue : on se tait.
  if (!profil) return null;

  const reference = rythmeDeReference(passes, serie, profil);
  if (reference <= 0) return null;

  const recents = depuisLaDerniereRemiseAZero(passes, serie);
  if (recents.length < EMBALLEMENT_RELEVES_MINIMUM + 1) return null;
  // Relevés trop vieux : le rythme qu'ils décrivent n'est plus celui de maintenant.
  if (maintenant - recents[recents.length - 1].at > EMBALLEMENT_FRAICHEUR_MS) return null;

  let depuis = 0;
  let nombre = 0;
  let consomme = 0;
  let attendu = 0;
  for (let i = recents.length - 1; i > 0; i--) {
    const delta = valeur(recents[i], serie) - valeur(recents[i - 1], serie);
    const span = recents[i].at - recents[i - 1].at;
    if (span <= 0) break;
    const prevu = reference * tempsPondere(recents[i - 1].at, recents[i].at, profil);
    if (prevu <= 0 || delta < prevu * EMBALLEMENT_FACTEUR) break;
    depuis = recents[i - 1].at;
    nombre++;
    consomme += delta;
    attendu += prevu;
  }

  if (nombre < EMBALLEMENT_RELEVES_MINIMUM) return null;
  // Trop peu consommé en tout : trois fois presque rien reste presque rien.
  if (consomme < EMBALLEMENT_CONSOMMATION_MINIMALE_PCT) return null;

  const facteur = attendu > 0 ? consomme / attendu : 0;
  const fin = recents[recents.length - 1].at;
  return {
    depuis,
    releves: nombre,
    consommePct: consomme,
    attenduPct: attendu,
    facteur,
    texte:
      `${facteur.toFixed(1)} fois plus vite que d’habitude depuis ${dureeEnClair(fin - depuis)} ` +
      `(${consomme.toFixed(1)} % consommés au lieu de ${attendu.toFixed(1)} % attendus)`,
  };
}

export interface EtatAlerteEmballement {
  /** L'emballement constaté, absent quand tout est normal. */
  emballement?: EmballementConsommation | null;
  /** La dernière lecture de quota a échoué : les chiffres sont périmés. */
  lectureEnEchec?: boolean;
  /** Le départ de série pour lequel on a DÉJÀ prévenu, s'il y en a un. */
  dejaAnnoncee?: number;
}

/**
 * Faut-il prévenir sur le téléphone ? Une seule fois par emballement : c'est le
 * DÉPART de la série qui sert de marque. Tant que la même série dure, rien ne
 * repart ; il faut un retour à la normale, puis une nouvelle pointe — donc un
 * nouveau départ — pour redonner droit à une alerte. La marque étant retenue
 * hors mémoire vive, un redémarrage du serveur n'en refait pas une.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */
export function doitAlerterEmballement(etat: EtatAlerteEmballement): boolean {
  // Chiffres périmés : prévenir sur une preuve qu'on n'a plus n'aide personne.
  if (etat.lectureEnEchec || !etat.emballement) return false;
  return etat.dejaAnnoncee !== etat.emballement.depuis;
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

/**
 * La part de quota qu'une tâche a consommée sur une fenêtre : le pourcentage
 * relevé APRÈS le tour moins celui d'AVANT. Jamais négatif — une remise à zéro
 * en cours de tour ferait passer l'« après » sous l'« avant », et l'on
 * n'attribue pas une remise à la tâche. Un relevé manquant (fenêtre inconnue,
 * lecture en échec) donne 0 : on n'invente pas une part qu'on n'a pas mesurée.
 *
 * Règle pure, sans réseau ni base : elle se teste seule.
 */
export function partQuotaConsommee(avant?: number, apres?: number): number {
  if (typeof avant !== 'number' || typeof apres !== 'number') return 0;
  if (!Number.isFinite(avant) || !Number.isFinite(apres)) return 0;
  const part = apres - avant;
  return part > 0 ? part : 0;
}

/**
 * Le POIDS d'un tour dans le partage du quota : ses jetons consommés, ou à
 * défaut sa durée en secondes (un tour qui n'a pas encore de compte de jetons).
 * Un poids négatif ou non fini vaut 0 — on ne pèse pas ce qu'on n'a pas mesuré.
 *
 * Règle pure, sans réseau ni base : elle se teste seule.
 */
export function poidsDeTour(tokens?: number, seconds?: number): number {
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) return tokens;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return seconds;
  return 0;
}

/**
 * Répartit un delta de quota observé entre les tours qui tournaient EN MÊME
 * TEMPS sur le même compte. Plusieurs cartes d'un même projet démarrent en
 * parallèle sur le même compte : chacune relève le MÊME compteur global et,
 * sans partage, s'attribue TOUT le delta — la somme des parts dépasse alors la
 * consommation réelle. On rend ici à chaque tour sa part au prorata de son
 * poids (`poidsDeTour`), rapporté au poids de TOUT le groupe :
 *
 *   part = delta × poidsPropre ⁄ (somme des poids du groupe)
 *
 * `poidsGroupe` contient les poids de TOUS les tours du groupe, celui-ci
 * compris. Chaque fraction reste ≤ 1, donc la somme des parts des tours qui
 * voient le même delta et le même groupe vaut EXACTEMENT le delta, jamais plus.
 * Un tour seul (groupe d'un) reçoit tout. Un groupe sans poids exploitable est
 * partagé à ÉGALITÉ (delta ⁄ nombre de tours) plutôt que divisé par zéro.
 *
 * Règle pure, sans réseau ni base : elle se teste seule. Les deux fenêtres
 * (5 h et semaine) l'appellent avec les mêmes poids, donc suivent la même
 * répartition.
 */
export function repartirPartQuota(delta: number, poidsPropre: number, poidsGroupe: number[]): number {
  if (!(delta > 0)) return 0;
  const poids = poidsGroupe.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const total = poids.reduce((somme, p) => somme + p, 0);
  const propre = Number.isFinite(poidsPropre) && poidsPropre > 0 ? poidsPropre : 0;
  if (!(total > 0)) {
    return poids.length > 0 ? delta / poids.length : delta;
  }
  return delta * (propre / total);
}

export interface TourAvecPartQuota {
  id: string;
  poids: number;
  quota5h: number;
  quotaSemaine: number;
}

/**
 * Répartit seulement la hausse apparue DEPUIS LE DERNIER RELEVÉ partagé, puis
 * l'ajoute au cumul de chaque tour encore actif. Un tour qui finit garde ainsi
 * sa part des premiers intervalles ; les tours restants ne revoient ensuite que
 * la hausse suivante, jamais le delta complet depuis leur départ.
 *
 * La fonction ne modifie pas ses entrées : le démon peut retirer le tour fini
 * du résultat et conserver les cumuls des autres jusqu'au relevé suivant.
 */
export function cumulerPartsQuota(
  avant: { session?: number; weekly?: number },
  apres: { session?: number; weekly?: number },
  tours: TourAvecPartQuota[],
): TourAvecPartQuota[] {
  const delta5h = partQuotaConsommee(avant.session, apres.session);
  const deltaSemaine = partQuotaConsommee(avant.weekly, apres.weekly);
  const poidsGroupe = tours.map((tour) => tour.poids);

  return tours.map((tour) => ({
    ...tour,
    quota5h: tour.quota5h + repartirPartQuota(delta5h, tour.poids, poidsGroupe),
    quotaSemaine: tour.quotaSemaine + repartirPartQuota(deltaSemaine, tour.poids, poidsGroupe),
  }));
}
