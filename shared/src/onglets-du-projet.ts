/**
 * LES ONGLETS D'UN PROJET (refonte du 13/11/2026, façon Claude Desktop).
 *
 * Dans un projet, une seule barre en haut : l'icône du projet, puis des onglets à plat. L'icône du projet mène à
 * son accueil (`CLE_ONGLET_TACHES`, jamais stocké, jamais fermable ; plus d'onglet « Tâches » dessiné depuis la
 * carte « Onglets et tiroir Communication » du 13/11/2026). Les autres s'ouvrent quand on ouvre une tâche,
 * un outil du projet (Backup, Studio…) ou un objet d'un outil (une campagne, une création, une charte, une analyse),
 * et se referment d'une croix. Ils sont RETENUS PAR PROJET : on les retrouve en revenant dans le projet.
 *
 * Ici, la règle pure : la liste, ses gestes et sa relecture depuis les préférences. Ce qui est AFFICHÉ (l'onglet
 * actif) se déduit de l'écran, jamais de la liste : la liste ne dit que ce qui reste ouvert.
 */

export type GenreDOnglet =
  | 'tache'
  | 'service'
  | 'objet'

/** Les genres qu'une liste retenue peut porter : tout autre est abîmé et tombe à la relecture. */
const GENRES_D_ONGLET: readonly string[] = [
  'tache',
  'service',
  'objet',
];

export interface OngletDuProjet {
  /** L'identité de l'onglet : `tache:<carte>`, `service:<vue>`, `objet:<adresse>` (ou `facturation:<carte>`). */
  cle: string;
  genre: GenreDOnglet;
  /** L'adresse (fragment, sans « # ») qui rouvre exactement ce qu'il montre. */
  adresse: string;
  /** Le service de l'onglet (sa vue), pour l'icône d'un service ou d'un objet. */
  service?: string;
  /** La carte d'un onglet de tâche (ou de sa facturation). */
  cardId?: string;
  /** Le nom affiché : la tâche, la campagne, la création… (un service se nomme par son libellé). */
  titre?: string;
  /**
   * QUAND L'UTILISATEUR L'A OUVERT OU REGARDÉ POUR LA DERNIÈRE FOIS (ms). Une tâche archivée APRÈS ce moment ferme
   * son onglet (`ongletsSansTachesRangees`) ; rouverte après coup, elle le garde. Absent des listes anciennes.
   */
  ouvertA?: number;
}

/**
 * LES OUTILS DE FONCTIONNEMENT S'OUVRENT EN GRANDE FENÊTRE, SANS ONGLET (décision du 13/11/2026 : « dans une grande
 * fenêtre, sans onglet ») : Statistiques, Messagerie, Backup, Surveillance, Tâches récurrentes. Leur adresse reste la
 * leur ; la fenêtre se pose par-dessus l'écran d'avant. Un onglet retenu pour l'un d'eux tombe à la relecture.
 */
export const VUES_DE_FONCTIONNEMENT_EN_FENETRE: readonly string[] = ['statistiques', 'espace-client', 'backups', 'surveillance', 'securite', 'taches-recurrentes'];

/** La clé de l'onglet fixe « Tâches », jamais stockée. */
export const CLE_ONGLET_TACHES = 'taches';
/** Au-delà, le plus ancien onglet (le plus à gauche) laisse sa place. */
export const PLAFOND_D_ONGLETS = 16;
/** L'événement du navigateur qu'émet une tâche réclamée que le serveur ne connaît plus : ses onglets tombent. */
export const EVENEMENT_CARTE_INTROUVABLE = 'beluga:carte-introuvable';
/** La préférence qui retient les onglets d'un projet. */
export const cleDesOngletsDuProjet = (projectId: string) => `onglets-du-projet:${projectId}`;

export function ongletDeTache(cardId: string, adresse: string, titre?: string): OngletDuProjet {
  return { cle: `tache:${cardId}`, genre: 'tache', adresse, cardId, titre };
}
export function ongletDeService(service: string, adresse: string): OngletDuProjet {
  return { cle: `service:${service}`, genre: 'service', adresse, service };
}
export function ongletDObjet(service: string, adresse: string, titre?: string): OngletDuProjet {
  return { cle: `objet:${adresse}`, genre: 'objet', adresse, service, titre };
}


function estOnglet(o: unknown): o is OngletDuProjet {
  if (!o || typeof o !== 'object') return false;
  const v = o as Record<string, unknown>;
  return (
    typeof v.cle === 'string' &&
    !!v.cle &&
    v.cle !== CLE_ONGLET_TACHES &&
    typeof v.adresse === 'string' &&
    typeof v.genre === 'string' &&
    GENRES_D_ONGLET.includes(v.genre)
  );
}

/** Relit une liste retenue : tout ce qui est abîmé ou en double tombe, sans jamais lever d'erreur. */
export function lireLesOnglets(brut: unknown): OngletDuProjet[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: OngletDuProjet[] = [];
  for (const o of brut) {
    if (!estOnglet(o) || vus.has(o.cle)) continue;
    /* UN ONGLET D'OBJET QUI NE MONTRE QUE LA RACINE DE SON SERVICE (« Mes marques ») est abîmé : il tombe. */
    if (o.genre === 'objet' && !adresseDObjetReel(o.adresse)) continue;
    /* UN OUTIL QUI S'OUVRE DÉSORMAIS EN FENÊTRE n'a plus d'onglet. */
    if (o.genre === 'service' && typeof o.service === 'string' && VUES_DE_FONCTIONNEMENT_EN_FENETRE.includes(o.service)) continue;
    vus.add(o.cle);
    sortie.push({
      cle: o.cle,
      genre: o.genre,
      adresse: o.adresse,
      ...(typeof o.service === 'string' ? { service: o.service } : {}),
      ...(typeof o.cardId === 'string' ? { cardId: o.cardId } : {}),
      ...(typeof o.titre === 'string' && o.titre ? { titre: o.titre } : {}),
      ...(typeof o.ouvertA === 'number' && Number.isFinite(o.ouvertA) ? { ouvertA: o.ouvertA } : {}),
    });
  }
  return sortie.slice(-PLAFOND_D_ONGLETS);
}

/**
 * OUVRIR UN ONGLET. Déjà ouvert, il reste À SA PLACE et prend la dernière adresse et le dernier titre connus
 * (un service où l'on a descendu d'un cran se rouvre où on l'a laissé). Nouveau, il se pose au bout.
 * Rend `null` quand rien ne change : l'appelant n'écrit alors rien.
 */
export function ouvrirLOnglet(
  liste: readonly OngletDuProjet[],
  onglet: OngletDuProjet,
  maintenant?: number,
): OngletDuProjet[] | null {
  if (onglet.cle === CLE_ONGLET_TACHES) return null;
  const rang = liste.findIndex((o) => o.cle === onglet.cle);
  if (rang >= 0) {
    const avant = liste[rang];
    const titre = onglet.titre || avant.titre;
    /* L'heure n'est RAFRAÎCHIE que si elle manquait : réécrire la préférence à chaque regard ferait une écriture
       par changement d'écran. Une tâche rouverte APRÈS son archivage reçoit, elle, une heure neuve (`rouvrirLOnglet`). */
    const ouvertA = avant.ouvertA ?? maintenant;
    if (avant.adresse === onglet.adresse && avant.titre === titre && avant.ouvertA === ouvertA) return null;
    const suite = [...liste];
    suite[rang] = { ...avant, ...onglet, titre, ...(ouvertA !== undefined ? { ouvertA } : {}) };
    return suite;
  }
  return [...liste, { ...onglet, ...(maintenant !== undefined ? { ouvertA: maintenant } : {}) }].slice(-PLAFOND_D_ONGLETS);
}

/**
 * UNE TÂCHE RANGÉE AUX ARCHIVES PUIS ROUVERTE PAR L'UTILISATEUR garde son onglet : on lui donne l'heure du regard,
 * postérieure à l'archivage. Rend `null` si rien ne change.
 */
export function rouvrirLOnglet(liste: readonly OngletDuProjet[], cle: string, maintenant: number): OngletDuProjet[] | null {
  const rang = liste.findIndex((o) => o.cle === cle);
  if (rang < 0) return null;
  const suite = [...liste];
  suite[rang] = { ...suite[rang], ouvertA: maintenant };
  return suite;
}

/**
 * L'ADRESSE D'UN ONGLET D'OBJET DÉSIGNE-T-ELLE VRAIMENT UN OBJET ? La racine d'un service (la liste des créations du
 * Studio, « Mes marques » de Communication, une marque sans campagne ouverte) n'en est pas un : c'est l'onglet du
 * service. Studio : `studio/<création>` ; Communication : `communication2/<marque>/<page>/<élément>` ; plaquettes :
 * `plaquettes/<projet>/<plaquette>` ; Marketing : `marketing2/<dossier>`.
 */
export function adresseDObjetReel(adresse: string): boolean {
  const [tete, ...reste] = adresse.split('/').filter(Boolean);
  switch (tete) {
    case 'studio':
      return reste.length >= 1;
    case 'communication2':
      return reste.length >= 3;
    case 'plaquettes':
      return reste.length >= 2;
    case 'marketing2':
      return reste.length >= 1;
    default:
      return false;
  }
}

/** Ce que la règle des onglets rangés lit d'une carte. */
export interface CartePourLesOnglets {
  column: string;
  archivedAt?: number | null;
  deployedAt?: number | null;
}

/**
 * LES ONGLETS DES TÂCHES RANGÉES SE FERMENT SEULS (décision du 13/11/2026) : une tâche archivée — mise en ligne ou
 * simplement rangée — ferme son onglet (et celui de sa facturation), SAUF si l'utilisateur l'a rouverte APRÈS
 * l'archivage. Une carte ABSENTE de `cartes` (déchargée) ne fait rien tomber : seule une archive CONSTATÉE compte.
 * Rend `null` quand rien ne change.
 */
export function ongletsSansTachesRangees(
  liste: readonly OngletDuProjet[],
  cartes: Readonly<Record<string, CartePourLesOnglets | undefined>>,
): OngletDuProjet[] | null {
  const suite = liste.filter((o) => {
    if ((o.genre !== 'tache' && o.genre !== 'facturation') || !o.cardId) return true;
    const carte = cartes[o.cardId];
    if (!carte || carte.column !== 'archived') return true;
    const range = carte.archivedAt ?? carte.deployedAt ?? 0;
    return (o.ouvertA ?? 0) > range && range > 0;
  });
  return suite.length === liste.length ? null : suite;
}

/** Retire de la liste les onglets d'une carte qui n'existe plus (tâche et facturation). `null` si rien ne change. */
export function ongletsSansLaCarte(liste: readonly OngletDuProjet[], cardId: string): OngletDuProjet[] | null {
  const suite = liste.filter((o) => o.cardId !== cardId);
  return suite.length === liste.length ? null : suite;
}
