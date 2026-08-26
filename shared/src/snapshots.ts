/**
 * LES SNAPSHOTS DES SITES EN PRODUCTION — les règles qui se jugent sans base ni
 * disque.
 *
 * La sauvegarde d'HaikoDev lui-même vit ailleurs (`server/src/backup.ts`) : elle
 * ne connaît QUE sa propre base et ses pièces jointes. Ce qui manquait, c'est le
 * reste — les sites SERVIS : leur base de données et leurs fichiers. Un site
 * peut être un projet de ce serveur, ou un site tout à fait extérieur dont on ne
 * possède qu'un accès.
 *
 * Ces règles disent QUOI sauvegarder, ce qui tient debout, quand un site est dû,
 * ce qu'on garde et ce qu'on jette, et comment se résume l'historique. Le
 * serveur (`server/src/snapshots.ts`) fait le travail réel ; l'interface
 * (`web/src/components/snapshots.tsx`) l'affiche.
 *
 * LES IDENTIFIANTS SONT GARDÉS EN CLAIR, comme dans le coffre-fort et pour la
 * même raison : une sauvegarde qui ne peut pas relire son mot de passe de base
 * ne sauvegarde rien.
 */

/* ------------------------------------------------------------------ */
/* Ce qu'un site porte                                                  */
/* ------------------------------------------------------------------ */

/** Les moteurs de base reconnus. `aucune` = ce site n'a pas de base. */
export const MOTEURS_BASE = ['aucune', 'mysql', 'postgres', 'sqlite'] as const;
export type MoteurBase = (typeof MOTEURS_BASE)[number];

export const LIBELLE_MOTEUR_BASE: Readonly<Record<MoteurBase, string>> = {
  aucune: 'Aucune base',
  mysql: 'MySQL / MariaDB',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite (fichier)',
};

/** Comment on atteint les fichiers du site. `aucun` = on ne prend que la base. */
export const MOYENS_FICHIERS = ['aucun', 'local', 'ssh', 'ftp'] as const;
export type MoyenFichiers = (typeof MOYENS_FICHIERS)[number];

export const LIBELLE_MOYEN_FICHIERS: Readonly<Record<MoyenFichiers, string>> = {
  aucun: 'Aucun fichier',
  local: 'Dossier de cette machine',
  ssh: 'Machine distante (SSH)',
  ftp: 'FTP / FTPS',
};

/** La base de données d'un site, telle qu'on la joint. */
export interface BaseDuSite {
  moteur: MoteurBase;
  /** Machine de la base — vide vaut « la même que le site ». */
  hote: string;
  port: string;
  /** Nom de la base, ou CHEMIN du fichier pour SQLite. */
  nom: string;
  utilisateur: string;
  motDePasse: string;
}

/** Les fichiers d'un site (le « FTP »), tels qu'on les tire. */
export interface FichiersDuSite {
  moyen: MoyenFichiers;
  /** Le dossier à prendre, du côté du site. */
  chemin: string;
  hote: string;
  port: string;
  utilisateur: string;
  motDePasse: string;
}

/** Un site à sauvegarder : un projet de ce serveur, ou un site extérieur. */
export interface SiteASauvegarder {
  id: string;
  nom: string;
  /** Le projet d'où il vient — `null` pour un site purement extérieur. */
  projectId: string | null;
  /** Un site éteint reste dans la liste et garde son historique, mais ne tourne plus. */
  actif: boolean;
  base: BaseDuSite;
  fichiers: FichiersDuSite;
  /** Au-delà de ce nombre de jours, un point de sauvegarde est jeté. */
  conservationJours: number;
  /** Tous les combien de jours ce site est sauvegardé (1 = chaque nuit). */
  frequenceJours: number;
  note: string;
  /**
   * LA CONVERSATION DE L'ASSISTANT qui a posé cette fiche en dernier. C'est elle
   * qu'un clic rouvre depuis la fenêtre : les questions posées, les essais faits
   * et le compte rendu s'y lisent, au lieu d'être perdus.
   */
  assistantId?: string;
  /** Le projet où cette conversation vit — un site extérieur est accueilli chez HaikoDev. */
  assistantProjectId?: string;
  /** Quand l'assistant a relu cette fiche après des échecs — 0 s'il ne l'a jamais fait. */
  relueLe?: number;
  creeLe: number;
  modifieLe: number;
}

/** L'issue d'un point de sauvegarde. */
export type StatutDePoint = 'reussi' | 'partiel' | 'echec';

/** UN POINT DE SAUVEGARDE : ce qui a été pris, quand, et ce qu'il pèse. */
export interface PointDeSauvegarde {
  id: string;
  siteId: string;
  debut: number;
  fin: number;
  statut: StatutDePoint;
  /** Le poids du fichier de base, en octets. */
  octetsBase: number;
  /** Le poids de l'archive des fichiers, en octets. */
  octetsFichiers: number;
  /** Le dossier où le point est posé, sur le disque de stockage. */
  chemin: string;
  /** Ce qui s'est passé, en clair — y compris l'échec. */
  detail: string;
  /** `automatique` (le passage de nuit) ou `manuel` (un clic). */
  origine: 'automatique' | 'manuel';
}

/** Ce qu'une fenêtre d'historique montre pour un site. */
export interface ResumeDeSite {
  site: SiteASauvegarder;
  points: PointDeSauvegarde[];
  dernier: PointDeSauvegarde | null;
  /** Le VOLUME TOTAL du site : la somme de tous ses points gardés. */
  octets: number;
  reussis: number;
  echecs: number;
}

export const CONSERVATION_PAR_DEFAUT = 14;
export const CONSERVATION_MIN = 1;
export const CONSERVATION_MAX = 365;
export const NOM_SITE_MAX = 80;

/** Tous les combien de jours un site est repris, par défaut (chaque nuit). */
export const FREQUENCE_PAR_DEFAUT = 1;
export const FREQUENCE_MIN = 1;
export const FREQUENCE_MAX = 30;

/** L'heure par défaut du passage de nuit — après la sauvegarde du démon (3 h). */
export const HEURE_SNAPSHOT_PAR_DEFAUT = 4;

/**
 * L'écart minimal entre deux passages automatiques d'un même site, pour une
 * fréquence d'UN jour. Vingt heures, pas vingt-quatre : un démon redémarré une
 * heure trop tard ne doit pas SAUTER la journée, il doit rattraper.
 */
export const ECART_MINIMAL_MS = 20 * 3600 * 1000;

/** La marge de rattrapage retranchée à toute fréquence (même logique que ci-dessus). */
const MARGE_RATTRAPAGE_MS = 4 * 3600 * 1000;

/**
 * L'ÉCART MINIMAL ENTRE DEUX PASSAGES pour la fréquence propre d'un site : le
 * nombre de jours réglé, moins la même marge de rattrapage. Une fréquence d'un
 * jour retombe exactement sur `ECART_MINIMAL_MS`.
 */
export function ecartMinimalMs(frequenceJours: number): number {
  const jours = Math.max(FREQUENCE_MIN, Math.round(frequenceJours) || FREQUENCE_PAR_DEFAUT);
  return Math.max(MARGE_RATTRAPAGE_MS, jours * 24 * 3600 * 1000 - MARGE_RATTRAPAGE_MS);
}

/* ------------------------------------------------------------------ */
/* Ce qui tient debout                                                  */
/* ------------------------------------------------------------------ */

/** Une fiche vierge, telle que la fenêtre de création la reçoit. */
export function siteVierge(projectId: string | null = null, nom = ''): SiteASauvegarder {
  return {
    id: '',
    nom,
    projectId,
    actif: true,
    base: { moteur: 'aucune', hote: '', port: '', nom: '', utilisateur: '', motDePasse: '' },
    fichiers: { moyen: 'aucun', chemin: '', hote: '', port: '', utilisateur: '', motDePasse: '' },
    conservationJours: CONSERVATION_PAR_DEFAUT,
    frequenceJours: FREQUENCE_PAR_DEFAUT,
    note: '',
    assistantId: '',
    assistantProjectId: '',
    relueLe: 0,
    creeLe: 0,
    modifieLe: 0,
  };
}

/** Les champs qu'un moteur de base réclame VRAIMENT. */
export function champsBaseRequis(moteur: MoteurBase): string[] {
  if (moteur === 'aucune') return [];
  if (moteur === 'sqlite') return ['nom'];
  return ['nom', 'utilisateur'];
}

/** Les champs qu'un moyen de transport de fichiers réclame VRAIMENT. */
export function champsFichiersRequis(moyen: MoyenFichiers): string[] {
  if (moyen === 'aucun') return [];
  if (moyen === 'local') return ['chemin'];
  return ['chemin', 'hote', 'utilisateur'];
}

/** Un site qui ne prend NI base NI fichiers ne sauvegarderait rien du tout. */
export function siteVide(site: SiteASauvegarder): boolean {
  return site.base.moteur === 'aucune' && site.fichiers.moyen === 'aucun';
}

/**
 * Le jugement d'une fiche avant enregistrement. Il DIT ce qui manque, en clair :
 * une fiche refusée sans raison se ressaisit au hasard.
 */
export function jugerSite(site: SiteASauvegarder): { ok: boolean; raison?: string } {
  const nom = (site.nom ?? '').trim();
  if (!nom) return { ok: false, raison: 'un site a besoin d’un nom' };
  if (nom.length > NOM_SITE_MAX) return { ok: false, raison: `le nom dépasse ${NOM_SITE_MAX} signes` };
  if (!MOTEURS_BASE.includes(site.base?.moteur as MoteurBase)) {
    return { ok: false, raison: 'moteur de base inconnu' };
  }
  if (!MOYENS_FICHIERS.includes(site.fichiers?.moyen as MoyenFichiers)) {
    return { ok: false, raison: 'moyen de transport inconnu' };
  }
  if (siteVide(site)) {
    return { ok: false, raison: 'ce site ne sauvegarderait rien : choisissez une base, des fichiers, ou les deux' };
  }
  for (const champ of champsBaseRequis(site.base.moteur)) {
    if (!String((site.base as any)[champ] ?? '').trim()) {
      return { ok: false, raison: `la base demande son champ « ${champ} »` };
    }
  }
  for (const champ of champsFichiersRequis(site.fichiers.moyen)) {
    if (!String((site.fichiers as any)[champ] ?? '').trim()) {
      return { ok: false, raison: `les fichiers demandent leur champ « ${champ} »` };
    }
  }
  const jours = Number(site.conservationJours);
  if (!Number.isFinite(jours) || jours < CONSERVATION_MIN || jours > CONSERVATION_MAX) {
    return { ok: false, raison: `la conservation se règle entre ${CONSERVATION_MIN} et ${CONSERVATION_MAX} jours` };
  }
  const frequence = Number(site.frequenceJours);
  if (!Number.isFinite(frequence) || frequence < FREQUENCE_MIN || frequence > FREQUENCE_MAX) {
    return { ok: false, raison: `la fréquence se règle entre ${FREQUENCE_MIN} et ${FREQUENCE_MAX} jours` };
  }
  return { ok: true };
}

/**
 * CHANGER DE MOTEUR VIDE LES CHAMPS DE L'ANCIEN. Sans cela, une fiche passée de
 * MySQL à « aucune base » garderait un mot de passe que plus rien n'affiche —
 * gardé sans être vu, c'est le pire des deux mondes.
 */
export function nettoyerSite(site: SiteASauvegarder): SiteASauvegarder {
  const base =
    site.base.moteur === 'aucune'
      ? { moteur: 'aucune' as MoteurBase, hote: '', port: '', nom: '', utilisateur: '', motDePasse: '' }
      : site.base;
  const fichiers =
    site.fichiers.moyen === 'aucun'
      ? { moyen: 'aucun' as MoyenFichiers, chemin: '', hote: '', port: '', utilisateur: '', motDePasse: '' }
      : site.fichiers.moyen === 'local'
        ? { ...site.fichiers, hote: '', port: '', utilisateur: '', motDePasse: '' }
        : site.fichiers;
  return { ...site, nom: (site.nom ?? '').trim(), base, fichiers };
}

/* ------------------------------------------------------------------ */
/* Quand un site est dû                                                 */
/* ------------------------------------------------------------------ */

/**
 * LE PASSAGE DE NUIT NE PREND QUE CE QUI EST DÛ. Un site est dû quand il est
 * actif, que l'heure est venue, et que son dernier point date d'assez longtemps.
 * Un site jamais sauvegardé est dû dès le premier passage.
 */
export function siteEstDu(
  site: SiteASauvegarder,
  dernier: PointDeSauvegarde | null,
  maintenant: number,
): boolean {
  if (!site.actif || siteVide(site)) return false;
  if (!dernier) return true;
  return maintenant - dernier.debut >= ecartMinimalMs(site.frequenceJours);
}

/** Les sites que le passage de cette minute doit prendre, dans l'ordre de la liste. */
export function sitesDuPassage(
  sites: SiteASauvegarder[],
  derniers: Map<string, PointDeSauvegarde>,
  maintenant: number,
): SiteASauvegarder[] {
  return sites.filter((site) => siteEstDu(site, derniers.get(site.id) ?? null, maintenant));
}

/* ------------------------------------------------------------------ */
/* L'historique : volumes, ménage, phrases                              */
/* ------------------------------------------------------------------ */

/** Le poids d'un point : la base plus les fichiers. */
export function volumeDuPoint(point: PointDeSauvegarde): number {
  return Math.max(0, point.octetsBase ?? 0) + Math.max(0, point.octetsFichiers ?? 0);
}

/** Le VOLUME TOTAL d'un site : la somme de ce qu'il occupe encore sur le disque. */
export function volumeDuSite(points: PointDeSauvegarde[]): number {
  return points.reduce((total, point) => total + volumeDuPoint(point), 0);
}

/**
 * L'historique tel que la fenêtre l'affiche : un résumé par site, du plus
 * récemment sauvegardé au plus ancien, les sites jamais pris à la fin.
 */
export function resumeParSite(
  sites: SiteASauvegarder[],
  points: PointDeSauvegarde[],
): ResumeDeSite[] {
  const parSite = new Map<string, PointDeSauvegarde[]>();
  for (const point of points) {
    const liste = parSite.get(point.siteId) ?? [];
    liste.push(point);
    parSite.set(point.siteId, liste);
  }
  const resumes = sites.map((site) => {
    const liste = (parSite.get(site.id) ?? []).slice().sort((a, b) => b.debut - a.debut);
    return {
      site,
      points: liste,
      dernier: liste[0] ?? null,
      octets: volumeDuSite(liste),
      reussis: liste.filter((p) => p.statut === 'reussi').length,
      echecs: liste.filter((p) => p.statut === 'echec').length,
    };
  });
  return resumes.sort((a, b) => (b.dernier?.debut ?? 0) - (a.dernier?.debut ?? 0));
}

/**
 * LE MÉNAGE : ce qui dépasse la conservation du site s'en va. Le DERNIER point
 * réussi ne part JAMAIS, même vieux : mieux vaut une sauvegarde d'il y a un an
 * que pas de sauvegarde du tout.
 */
export function pointsAPurger(
  points: PointDeSauvegarde[],
  conservationJours: number,
  maintenant: number,
): PointDeSauvegarde[] {
  const limite = maintenant - Math.max(CONSERVATION_MIN, conservationJours) * 24 * 3600 * 1000;
  const reussis = points.filter((p) => p.statut !== 'echec').sort((a, b) => b.debut - a.debut);
  const epargne = reussis[0]?.id;
  return points.filter((point) => point.debut < limite && point.id !== epargne);
}

/** Un poids d'octets tel qu'on le lit : « 1,4 Go », jamais « 1503238553 ». */
export function formaterOctets(octets: number): string {
  const n = Math.max(0, Math.round(octets ?? 0));
  if (n < 1024) return `${n} o`;
  const unites = ['Ko', 'Mo', 'Go', 'To'];
  let valeur = n / 1024;
  let rang = 0;
  while (valeur >= 1024 && rang < unites.length - 1) {
    valeur /= 1024;
    rang += 1;
  }
  const arrondi = valeur >= 100 ? Math.round(valeur) : Math.round(valeur * 10) / 10;
  return `${String(arrondi).replace('.', ',')} ${unites[rang]}`;
}

/** Ce qu'un point dit de lui-même dans la liste. */
export function phraseDeStatut(point: PointDeSauvegarde): string {
  if (point.statut === 'reussi') return `Sauvegardé — ${formaterOctets(volumeDuPoint(point))}`;
  if (point.statut === 'partiel') return `Partiel — ${formaterOctets(volumeDuPoint(point))}`;
  return 'Échec — rien n’a été pris';
}

/**
 * LE DOSSIER D'UN POINT sur le disque de stockage : un dossier par site, un
 * sous-dossier par instant. Le nom du site est réduit à ce qui tient dans un
 * chemin, et son identifiant le suit pour que deux sites homonymes ne se
 * mélangent jamais.
 */
export function dossierDeSite(site: SiteASauvegarder): string {
  const propre = (site.nom || 'site')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${propre || 'site'}-${site.id.slice(0, 8)}`;
}

/** L'instant d'un point, en nom de dossier triable : « 2026-08-26-0412 ». */
export function horodatageDePoint(at: number): string {
  const d = new Date(at);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}-${deux(d.getHours())}${deux(
    d.getMinutes(),
  )}${deux(d.getSeconds())}`;
}

/**
 * LA DESTINATION DOIT ÊTRE RÉGLÉE, ET SON ABSENCE SE DIT. Le disque de stockage
 * est monté sur la machine (Hetzner ou autre) : tant que son dossier n'est pas
 * renseigné dans les réglages, aucun snapshot ne part — et l'écran le dit au
 * lieu d'empiler des échecs.
 */
export function raisonDestinationRefusee(dossier: string): string | null {
  const propre = (dossier ?? '').trim();
  if (!propre) return 'Aucun dossier de stockage réglé : renseignez-le dans les réglages « Système ».';
  if (!propre.startsWith('/')) return 'Le dossier de stockage doit être un chemin absolu (il commence par « / »).';
  return null;
}

/* ------------------------------------------------------------------ */
/* Une fiche qui échoue nuit après nuit                                 */
/* ------------------------------------------------------------------ */

/**
 * COMBIEN D'ÉCHECS DE SUITE AVANT DE FAIRE RELIRE LA FICHE. Un échec isolé
 * arrive (machine éteinte, réseau coupé) et ne mérite pas un tour de moteur.
 * Trois de suite, c'est la FICHE qui est fausse : un mot de passe changé, un
 * dossier déplacé, une base renommée.
 */
export const ECHECS_AVANT_RELECTURE = 3;

/** Un site relu ne l'est pas deux fois dans la même journée, même s'il échoue encore. */
export const ECART_MINIMAL_RELECTURE_MS = 20 * 3600 * 1000;

/** Le nombre de points en ÉCHEC depuis le plus récent, sans un seul succès entre eux. */
export function echecsDeSuite(points: PointDeSauvegarde[]): number {
  const ordonnes = [...points].sort((a, b) => b.debut - a.debut);
  let compte = 0;
  for (const point of ordonnes) {
    if (point.statut !== 'echec') break;
    compte += 1;
  }
  return compte;
}

/**
 * CE SITE DOIT-IL ÊTRE RELU PAR L'ASSISTANT ? Un site éteint ne l'est jamais —
 * il n'essaie même plus. Un site déjà relu récemment non plus : la relecture
 * précédente a peut-être corrigé la fiche, et la nuit suivante le dira.
 */
export function siteARelire(
  site: SiteASauvegarder,
  points: PointDeSauvegarde[],
  maintenant = Date.now(),
): boolean {
  if (!site.actif) return false;
  if (echecsDeSuite(points) < ECHECS_AVANT_RELECTURE) return false;
  const relue = Number(site.relueLe ?? 0);
  return !relue || maintenant - relue >= ECART_MINIMAL_RELECTURE_MS;
}
