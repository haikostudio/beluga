/**
 * LES DÉCROCHAGES DU SERVEUR DE BELUGA — les règles pures.
 *
 * Deux sources disent que le serveur a lâché :
 *  - LE SURVEILLANT (`scripts/beluga-watchdog.sh`, root, chaque minute) note
 *    chaque silence de la sonde de santé dans `data/logs/decrochages/journal.tsv`
 *    et laisse un RELEVÉ de la machine à côté. Le démon y ajoute ses propres
 *    arrêts VOULUS (mise en ligne, bouton « Redémarrer ») et ses démarrages.
 *  - LE NAVIGATEUR consigne dans `interface-erreurs.log` chaque geste qui n'a
 *    pas pu partir faute de canal (« geste non parti »), avec l'état du canal.
 *
 * Ici, on les réunit en INCIDENTS, on écarte ce qui n'est pas une panne — une
 * relance voulue, une page mise en veille —, et on décide s'il faut ouvrir une
 * carte d'ENQUÊTE. Même exception que le dépannage des sites
 * (`depannage-site.ts`) : l'enquête s'ouvre seule et s'arrête au PLAN ; la
 * correction attend le clic de l'utilisateur.
 *
 * TROIS GARDE-FOUS, comme pour les sites : assez d'incidents sur la fenêtre
 * (`INCIDENTS_AVANT_ENQUETE` en `FENETRE_DECROCHAGES_MS`), UNE seule carte
 * ouverte à la fois (les décrochages suivants s'y ajoutent en note), et un écart
 * minimal entre deux enquêtes (`ECART_MINIMAL_ENQUETE_MS`).
 */

/** La fenêtre glissante sur laquelle on compte les incidents. */
export const FENETRE_DECROCHAGES_MS = 24 * 3_600_000;
/** Combien d'incidents sur la fenêtre font une récurrence. */
export const INCIDENTS_AVANT_ENQUETE = 3;
/** L'écart minimal entre deux cartes d'enquête. */
export const ECART_MINIMAL_ENQUETE_MS = 12 * 3_600_000;
/** Deux silences du surveillant séparés de moins que ça forment UN incident. */
export const ECART_SILENCES_MEME_INCIDENT_MS = 3 * 60_000;
/** Deux coupures du navigateur séparées de moins que ça forment UNE rafale. */
export const ECART_COUPURES_MEME_RAFALE_MS = 2 * 60_000;
/** Une rafale de moins de coupures que ça n'est qu'un geste malchanceux. */
export const COUPURES_MINIMUM_PAR_RAFALE = 2;
/**
 * …et une rafale plus BRÈVE que ça non plus : un seul clic envoie souvent
 * plusieurs commandes à la même milliseconde. Il faut que la coupure ait duré
 * assez pour qu'on réessaie (relevé du 27/10/2026 : 151 gestes, 65 moments).
 */
export const DUREE_MINIMALE_DE_RAFALE_MS = 5_000;
/**
 * Autour d'un arrêt VOULU, les coupures vues par le navigateur sont celles de
 * l'arrêt lui-même (environ 14 s de coupure, plus la reconnexion).
 */
export const MARGE_AVANT_ARRET_VOULU_MS = 30_000;
export const MARGE_APRES_ARRET_VOULU_MS = 3 * 60_000;

/** L'étiquette posée sur la carte d'enquête. */
export const LABEL_DECROCHAGE_SERVEUR = 'décrochage serveur';

/** Les genres écrits dans `journal.tsv`, par le surveillant ou par le démon. */
export type GenreDuJournalDesDecrochages =
  | 'silence'
  | 'silence-relance-voulue'
  | 'relance-surveillant'
  | 'relance-surveillant-essai'
  | 'relance-voulue'
  | 'arret-par-signal'
  | 'demarrage';

/** Les genres qui disent un arrêt VOULU : ni panne, ni coupure à compter. */
const GENRES_ARRET_VOULU = new Set(['relance-voulue', 'arret-par-signal']);

export interface LigneDesDecrochages {
  instant: number;
  genre: string;
  /** Le nom du relevé laissé à côté du journal, s'il y en a un. */
  releve: string | null;
  detail: string | null;
}

/** Une ligne du journal, telle que le démon l'écrit. */
export function ligneDesDecrochages(entree: { instant: number; genre: GenreDuJournalDesDecrochages; detail?: string }): string {
  const propre = (v: string | undefined) => String(v ?? '').replace(/[\t\n\r]+/g, ' ').trim() || '-';
  return `${Math.round(entree.instant)}\t${entree.genre}\t-\t${propre(entree.detail)}\n`;
}

/** Lit une ligne du journal ; une ligne abîmée rend `null`. */
export function lireLigneDesDecrochages(ligne: string): LigneDesDecrochages | null {
  const champs = String(ligne ?? '').replace(/\r$/, '').split('\t');
  if (champs.length < 2) return null;
  const instant = Number(champs[0]);
  const genre = champs[1]?.trim();
  if (!Number.isFinite(instant) || instant <= 0 || !genre) return null;
  const valeur = (v: string | undefined) => (v && v.trim() && v.trim() !== '-' ? v.trim() : null);
  return { instant, genre, releve: valeur(champs[2]), detail: valeur(champs.slice(3).join('\t')) };
}

/**
 * LES ARRÊTS VOULUS LUS DANS LE JOURNAL DU DÉMON (`service.log`). Avant que le
 * démon ne les note dans `journal.tsv`, ses relances ne se lisaient que là :
 * « [2026-10-28T06:51:02.123Z] INFO redémarrage demandé depuis l’interface ».
 */
export function arretsVoulusDuJournalDuDemon(texte: string): number[] {
  const instants: number[] = [];
  const motif = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\][^\n]*(?:redémarrage demandé depuis l[’']interface|arrêt demandé \(SIG)/gm;
  for (const m of String(texte ?? '').matchAll(motif)) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t)) instants.push(t);
  }
  return instants;
}

/** Ce que le navigateur a vu d'une coupure qu'il a SUBIE. */
export interface CoupureDuNavigateur {
  instant: number;
  /** Le geste qui n'est pas parti (`prefs.set`, `deploy.check`…). */
  geste: string;
  /** Depuis combien de secondes le canal ne recevait plus rien, si dit. */
  muetDepuisS: number | null;
}

/**
 * UNE ERREUR DE L'INTERFACE EST-ELLE UNE COUPURE SUBIE ? Seuls les « geste non
 * parti » du canal comptent, et pas quand la page dormait : une fermeture par
 * « mise en veille », une page cachée ou un réseau hors ligne disent le
 * téléphone, pas le serveur.
 *
 * Ni quand la page SE CHARGEAIT : un canal jamais coupé et dont rien n'a
 * jamais été reçu est celui d'une page qui vient d'ouvrir, et ses premières
 * demandes partaient avant lui (quatre des six « décrochages » du 27/10). Le
 * client attend désormais l'ouverture ; s'il renonce, son rapport porte la
 * ligne « attente de l'ouverture » — celui-là compte, car une page qui
 * n'arrive JAMAIS à se connecter doit rester visible.
 */
export function coupureSubieDuNavigateur(erreur: {
  source?: string;
  message?: string;
  pile?: string;
  at?: number;
}): CoupureDuNavigateur | null {
  if (erreur?.source !== 'canal') return null;
  const message = String(erreur.message ?? '');
  const prefixe = 'geste non parti';
  if (!message.startsWith(prefixe)) return null;
  const instant = Number(erreur.at);
  if (!Number.isFinite(instant) || instant <= 0) return null;
  const pile = String(erreur.pile ?? '');
  if (/dernière fermeture\s*:\s*mise en veille/i.test(pile)) return null;
  const chargement =
    /coupé depuis\s*:\s*jamais/i.test(pile) &&
    /dernier message reçu\s*:\s*jamais/i.test(pile) &&
    !/attente de l.ouverture\s*:/i.test(pile);
  if (chargement) return null;
  if (/veille\s*:\s*oui/i.test(pile) || /page cachée\s*:\s*oui/i.test(pile) || /réseau\s*:\s*hors ligne/i.test(pile)) return null;
  const muet = /dernier message reçu\s*:\s*il y a\s*([\d.]+)\s*s/i.exec(pile);
  return {
    instant,
    geste: message.slice(prefixe.length).replace(/^\s*:\s*/, '').trim() || 'inconnu',
    muetDepuisS: muet ? Number(muet[1]) : null,
  };
}

/**
 * LA LIGNE QUE LE DÉMON ÉCRIT À CHAQUE FERMETURE DU CANAL D'UN ÉCRAN. Quatre
 * coupures « 1006 » du 27-28/10 sont restées sans cause : ni figement du
 * démon, ni rechargement de la porte d'entrée, ni fermeture décidée par le
 * serveur. Le code et la durée de vie vus CÔTÉ SERVEUR, rapprochés de ceux
 * vus par le navigateur, diront la prochaine fois qui a coupé : le réseau du
 * poste (le serveur voit aussi 1006), la porte d'entrée, ou le démon.
 */
export function ligneDeFermetureDuCanal(f: {
  code: number;
  raison?: string;
  ouvertA: number;
  fermeA: number;
  /** Octets restés dans le tampon d'envoi au moment de la fermeture. */
  enAttente: number;
  adresse?: string | null;
  appareil?: string | null;
}): string {
  const duree = Math.max(0, Math.round((f.fermeA - f.ouvertA) / 100) / 10);
  const appareil = String(f.appareil ?? '');
  const famille = /iPhone|iPad/.test(appareil) ? 'iPhone' : /Android/.test(appareil) ? 'Android' : /Macintosh/.test(appareil) ? 'Mac' : /Windows/.test(appareil) ? 'Windows' : /Linux/.test(appareil) ? 'Linux' : appareil ? 'autre' : 'inconnu';
  const raison = String(f.raison ?? '').trim();
  return (
    `canal fermé : code ${f.code}${raison ? ` (${raison.slice(0, 120)})` : ''} après ${duree} s` +
    ` · en attente ${f.enAttente} o · ${f.adresse || 'adresse inconnue'} · ${famille}`
  );
}

export type GenreDIncident = 'silence-serveur' | 'coupures-navigateur';

export interface IncidentDeDecrochage {
  genre: GenreDIncident;
  debut: number;
  fin: number;
  /** Silences du surveillant, ou coupures du navigateur, réunis ici. */
  nombre: number;
  /** Vrai quand le surveillant a dû relancer le service. */
  relance: boolean;
  /** Les relevés laissés par le surveillant pendant l'incident. */
  releves: string[];
}

/** Réunit des instants triés en groupes dont deux voisins sont à moins de `ecart`. */
function grouper<T extends { instant: number }>(elements: readonly T[], ecart: number): T[][] {
  const tries = [...elements].sort((a, b) => a.instant - b.instant);
  const groupes: T[][] = [];
  for (const e of tries) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && e.instant - dernier[dernier.length - 1].instant <= ecart) dernier.push(e);
    else groupes.push([e]);
  }
  return groupes;
}

/**
 * LES INCIDENTS DE LA FENÊTRE, du plus ancien au plus récent.
 *
 * - Un SILENCE du surveillant (genre « silence » seul : un silence pendant une
 *   relance voulue ne compte pas) ; les silences rapprochés font un incident.
 * - Une RAFALE de coupures vues par le navigateur, hors des minutes qui
 *   entourent un arrêt voulu, et hors d'un incident de silence déjà compté.
 *   Une coupure isolée, ou plusieurs gestes du même instant, ne font pas une
 *   rafale.
 */
export function incidentsDeDecrochage(entree: {
  journal: readonly LigneDesDecrochages[];
  coupures: readonly CoupureDuNavigateur[];
  /** Arrêts voulus lus ailleurs (le journal du démon), en plus de ceux du journal. */
  arretsVoulus?: readonly number[];
  maintenant: number;
  fenetreMs?: number;
}): IncidentDeDecrochage[] {
  const depuis = entree.maintenant - (entree.fenetreMs ?? FENETRE_DECROCHAGES_MS);
  const dansLaFenetre = (t: number) => t >= depuis && t <= entree.maintenant + 60_000;
  const journal = entree.journal.filter((l) => dansLaFenetre(l.instant));

  const silences = journal.filter((l) => l.genre === 'silence');
  const relances = journal.filter((l) => l.genre === 'relance-surveillant');
  const incidents: IncidentDeDecrochage[] = grouper(silences, ECART_SILENCES_MEME_INCIDENT_MS).map((groupe) => {
    const debut = groupe[0].instant;
    const fin = groupe[groupe.length - 1].instant;
    const releves = [...new Set(groupe.map((l) => l.releve).filter((r): r is string => Boolean(r)))];
    return {
      genre: 'silence-serveur' as const,
      debut,
      fin,
      nombre: groupe.length,
      relance: relances.some((r) => r.instant >= debut && r.instant <= fin + ECART_SILENCES_MEME_INCIDENT_MS),
      releves,
    };
  });

  const arrets = [
    ...journal.filter((l) => GENRES_ARRET_VOULU.has(l.genre)).map((l) => l.instant),
    ...(entree.arretsVoulus ?? []),
  ];
  const coupures = entree.coupures.filter((c) => {
    if (!dansLaFenetre(c.instant)) return false;
    if (arrets.some((a) => c.instant >= a - MARGE_AVANT_ARRET_VOULU_MS && c.instant <= a + MARGE_APRES_ARRET_VOULU_MS)) return false;
    if (incidents.some((i) => c.instant >= i.debut - ECART_SILENCES_MEME_INCIDENT_MS && c.instant <= i.fin + ECART_SILENCES_MEME_INCIDENT_MS)) return false;
    return true;
  });
  for (const rafale of grouper(coupures, ECART_COUPURES_MEME_RAFALE_MS)) {
    if (rafale.length < COUPURES_MINIMUM_PAR_RAFALE) continue;
    if (rafale[rafale.length - 1].instant - rafale[0].instant < DUREE_MINIMALE_DE_RAFALE_MS) continue;
    incidents.push({
      genre: 'coupures-navigateur',
      debut: rafale[0].instant,
      fin: rafale[rafale.length - 1].instant,
      nombre: rafale.length,
      relance: false,
      releves: [],
    });
  }
  return incidents.sort((a, b) => a.debut - b.debut);
}

/** Ce que les réglages gardent de l'enquête en cours. */
export interface EtatDeLEnquete {
  /** La carte d'enquête ouverte, tant qu'elle n'est pas rangée. */
  cardId?: string;
  /** Quand la dernière enquête a été LANCÉE — posé avant le tour, jamais après. */
  lanceLe?: number;
  /** La fin du dernier incident déjà raconté à la carte. */
  dernierIncidentSignale?: number;
}

export type RaisonDeNePasEnqueter = 'pas-recurrent' | 'enquete-deja-ouverte' | 'trop-recent';

export type DecisionDEnquete =
  | { enqueter: true }
  | { enqueter: false; raison: RaisonDeNePasEnqueter };

/**
 * FAUT-IL OUVRIR UNE ENQUÊTE ? Trois refus, chacun dit : pas assez d'incidents
 * sur la fenêtre, une carte d'enquête est encore ouverte (les nouveaux
 * décrochages s'y ajoutent), ou la précédente est trop récente.
 */
export function decisionDEnquete(
  incidents: readonly IncidentDeDecrochage[],
  etat: EtatDeLEnquete & { carteOuverte: boolean },
  maintenant = Date.now(),
): DecisionDEnquete {
  if (incidents.length < INCIDENTS_AVANT_ENQUETE) return { enqueter: false, raison: 'pas-recurrent' };
  if (etat.carteOuverte) return { enqueter: false, raison: 'enquete-deja-ouverte' };
  const lance = Number(etat.lanceLe ?? 0);
  if (lance && maintenant - lance < ECART_MINIMAL_ENQUETE_MS) return { enqueter: false, raison: 'trop-recent' };
  return { enqueter: true };
}

/** Les incidents qu'une carte encore ouverte n'a pas encore reçus. */
export function incidentsNonSignales(
  incidents: readonly IncidentDeDecrochage[],
  etat: EtatDeLEnquete,
): IncidentDeDecrochage[] {
  const deja = Number(etat.dernierIncidentSignale ?? 0);
  return incidents.filter((i) => i.fin > deja);
}

/* ------------------------------------------------------------------ */
/* La carte et sa demande                                               */
/* ------------------------------------------------------------------ */

export const TITRE_ENQUETE_DECROCHAGES = 'Le serveur décroche : enquête';

/** La description de la carte, lue par quelqu'un qui ne programme pas. */
export function descriptionDEnqueteDecrochages(incidents: readonly IncidentDeDecrochage[]): string {
  return (
    `Le serveur de Beluga a décroché ${incidents.length} fois en 24 heures. ` +
    'Un agent lit les relevés gardés à chaque décrochage, cherche la cause et propose une correction, ' +
    'qui attend votre accord : rien n’est corrigé, relancé ni mis en ligne sans vous.'
  );
}

function heure(instant: number): string {
  if (!instant) return 'heure inconnue';
  return new Date(instant).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Une ligne d'incident, telle qu'elle se lit dans le récit. */
export function ligneDIncident(incident: IncidentDeDecrochage): string {
  const duree = Math.round((incident.fin - incident.debut) / 1000);
  if (incident.genre === 'silence-serveur') {
    return (
      `- ${heure(incident.debut)} : le surveillant n’a pas eu de réponse ${incident.nombre} fois d’affilée` +
      (incident.relance ? ', et a relancé le service' : '') +
      (incident.releves.length ? ` — relevés : ${incident.releves.join(', ')}` : '')
    );
  }
  return `- ${heure(incident.debut)} : ${incident.nombre} gestes de l’interface n’ont pas pu partir faute de connexion, sur ${duree} s`;
}

/**
 * LES CONSTATS DU CADRAGE DU 28/10/2026, joints à la PREMIÈRE enquête : ils ne
 * se retrouvent plus dans le journal système, trop court pour remonter si loin.
 */
export const CONSTATS_DE_DEPART_DECROCHAGES = [
  'CONSTATS DE DÉPART (cadrage du 28/10/2026, carte « Chevron, barre de progression et serveur instable »)',
  '- 9 relances du service entre le 26/10 23:01 et le 28/10 06:51, toutes « redémarrage demandé depuis l’interface » (mises en ligne, dont le déploiement automatique) ; coupure d’environ 14 s chacune (démarrage → « écoute sur 7070 »).',
  '- Aucune mémoire épuisée côté noyau, aucune sortie en erreur du service.',
  '- Surveillant : un seul silence (27/10 21:03).',
  '- 141 « geste non parti » côté navigateur le 27/10, surtout canal « en ouverture » : pour la plupart des demandes lancées au chargement de la page, avant la première ouverture du canal (« coupé depuis : jamais », « dernier message reçu : jamais »). Un « dernier message reçu il y a ~20 s » est le rythme normal du battement (un ping toutes les 20 s), pas un canal muet.',
  '- Mémoire tendue : 7,6 Go dont ~410 Mo libres, échange 4,4/8 Go, pression mémoire et disque non nulles ; laya-service.py ~1,7 Go.',
  '- Le fil principal du démon se fige ~1,5 à 1,75 s toutes les ~30 min (blocages.log), surtout le calcul des décisions en attente (rangement des cartes oubliées, passage de veille) et le complément des vecteurs de la base de connaissances.',
].join('\n');

/**
 * LA DEMANDE ENVOYÉE À L'AGENT DE CADRAGE. Elle exige l'enquête puis le plan,
 * interdit `ask_user` (personne n'attend devant l'écran) et toute
 * modification : comme pour une panne de site, l'enquête s'arrête au plan.
 */
export function demandeDEnqueteDecrochages(entree: {
  incidents: readonly IncidentDeDecrochage[];
  /** Les arrêts voulus de la fenêtre, pour situer les coupures. */
  arretsVoulus: readonly number[];
  dossierDesReleves: string;
  journalDuDemon: string;
  /** Vrai pour la toute première enquête : on y joint les constats de départ. */
  premiere: boolean;
}): string {
  const lignes = [
    `CETTE CARTE A ÉTÉ OUVERTE PAR LA SURVEILLANCE DU SERVEUR, pas par une personne au clavier : le serveur de Beluga a décroché ${entree.incidents.length} fois en 24 heures.`,
    '',
    'LES DÉCROCHAGES, DU PLUS ANCIEN AU PLUS RÉCENT',
    ...entree.incidents.map(ligneDIncident),
    '',
    `ARRÊTS VOULUS SUR LA MÊME PÉRIODE (mises en ligne, bouton « Redémarrer », arrêts par signal) : ${entree.arretsVoulus.length}` +
      (entree.arretsVoulus.length ? ` — ${[...entree.arretsVoulus].sort((a, b) => a - b).map(heure).join(', ')}` : ''),
    'Ils ne sont PAS comptés comme décrochages : les coupures qui les entourent sont attendues.',
    '',
    'OÙ LIRE',
    `- les relevés de la machine pris à chaque silence, et leur journal : ${entree.dossierDesReleves} (journal.tsv)`,
    `- le journal du démon : ${entree.journalDuDemon}, et blocages.log à côté (moments où le fil principal se fige)`,
    '- les coupures vues par le navigateur : interface-erreurs.log, au même endroit (« geste non parti », avec l’état du canal)',
    '- le journal système : `sudo -n journalctl -u beluga.service`, `-u caddy`, `-k` (il ne remonte pas loin)',
    '',
  ];
  if (entree.premiere) lignes.push(CONSTATS_DE_DEPART_DECROCHAGES, '');
  lignes.push(
    'CE QUE TU FAIS MAINTENANT',
    '1. ENQUÊTE POUR DE VRAI : lis les relevés, rapproche-les des journaux, cherche ce qui revient (mémoire, fil principal figé, proxy, relances). Ce que tu n’as pas vu se dit comme non vérifié, en toutes lettres.',
    '2. RENDS CE QUE TU AS COMPRIS avec « rendre_comprehension » : les décrochages constatés, leur cause probable, ce qui reste incertain.',
    '3. LE PLAN DE CORRECTION TE SERA DEMANDÉ JUSTE APRÈS, dans un second tour. Il attend ensuite la validation de l’utilisateur.',
    '',
    'NE POSE AUCUNE QUESTION AVEC « ask_user » : personne n’est devant l’écran. Ce que seul l’utilisateur peut trancher se prépare dans le champ « questions » de « rendre_comprehension ». Aucune supposition : « hypotheses » reste vide.',
    '',
    'NE TOUCHE À AUCUN FICHIER, NE REDÉMARRE RIEN, NE PUBLIE RIEN pendant ce tour : ton travail est de comprendre puis de proposer.',
  );
  return lignes.join('\n');
}

/** La note posée sur la carte encore ouverte quand de nouveaux décrochages arrivent. */
export function noteDeNouveauxDecrochages(incidents: readonly IncidentDeDecrochage[]): string {
  return [
    `Le serveur a encore décroché ${incidents.length} fois depuis la dernière note. Cette enquête n’étant pas rangée, aucune autre carte n’a été ouverte :`,
    ...incidents.map(ligneDIncident),
  ].join('\n');
}
