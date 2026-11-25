/**
 * ARCHIVER UN PROJET SUR LE DISQUE EXTERNE — les règles pures.
 *
 * Archiver un projet, c'est envoyer TOUT son dossier dans une seule archive
 * compressée sur le disque de stockage (jamais fichier à fichier : le disque
 * externe est monté par le réseau, lent sur des milliers de petits fichiers),
 * la vérifier, puis seulement libérer la place sur le disque du serveur. Le
 * désarchivage refait le chemin inverse et supprime la copie externe.
 *
 * Ce module ne touche ni base ni disque : il dit QUAND c'est permis, lit les
 * sorties de `systemctl show`, de `docker inspect` et de la configuration
 * Caddy, et décrit les étapes que la fenêtre de progression coche. Le travail
 * réel vit dans `server/src/archivage-projet.ts`.
 */

/** Où vivent les archives : le disque de stockage, dans un dossier à part (jamais celui des sauvegardes). */
export const DOSSIER_DES_ARCHIVES_DE_PROJETS = '/mnt/sauvegardes/archives-projets';

export type SensDArchivage = 'archiver' | 'desarchiver';

export interface EtapeDArchivage {
  cle: string;
  titre: string;
}

/** Les étapes que la fenêtre coche, dans l'ordre. */
export const ETAPES_D_ARCHIVAGE: Record<SensDArchivage, EtapeDArchivage[]> = {
  archiver: [
    { cle: 'controles', titre: 'Contrôles avant de partir' },
    { cle: 'services', titre: 'Arrêt du site en développement' },
    { cle: 'copie', titre: 'Copie vers le disque externe' },
    { cle: 'verification', titre: 'Vérification de la copie' },
    { cle: 'liberation', titre: 'Place libérée sur le serveur' },
  ],
  desarchiver: [
    { cle: 'controles', titre: 'Contrôles avant de partir' },
    { cle: 'copie', titre: 'Retour des fichiers sur le serveur' },
    { cle: 'verification', titre: 'Vérification des fichiers' },
    { cle: 'remise', titre: 'Remise en place du dossier' },
    { cle: 'services', titre: 'Relance du site en développement' },
    { cle: 'nettoyage', titre: 'Copie externe supprimée' },
  ],
};

/** Ce qu'il faut savoir pour juger un archivage. */
export interface SituationDArchivage {
  isSelf?: boolean;
  archived?: boolean;
  /** Un transfert est-il déjà en cours sur ce projet ? */
  transfertEnCours?: boolean;
  agentsAuTravail: string[];
  publicationEnCours: boolean;
  /** Les services système (hors versions de travail `autoproject-*`) qui tournent depuis le dossier. */
  sitesPublics: string[];
  /** Les conteneurs qui montent le dossier. */
  conteneurs: string[];
  /** Les sites que Caddy sert directement depuis le dossier (`root *`). */
  racinesCaddy: string[];
  /** Les copies de travail de cartes (worktrees) qui vivent HORS du dossier : elles casseraient au retour. */
  copiesHorsDossier: string[];
  /** Le refus du dossier lui-même (zone protégée, autre projet dedans…), sinon null. */
  refusDuDossier?: string | null;
}

const liste = (noms: string[], max = 3) =>
  noms.slice(0, max).map((n) => `« ${n} »`).join(', ') + (noms.length > max ? ` et ${noms.length - max} autre(s)` : '');

/**
 * PEUT-ON ARCHIVER ? `null` : oui. Sinon la raison, en clair, dite AVANT tout
 * geste — c'est elle que la fenêtre affiche à la place du bouton.
 */
export function refusDArchivage(s: SituationDArchivage): string | null {
  if (s.isSelf) return 'L’espace de développement de Beluga ne s’archive pas.';
  if (s.archived) return 'Ce projet est déjà archivé.';
  if (s.transfertEnCours) return 'Un transfert est déjà en cours sur ce projet.';
  if (s.agentsAuTravail.length) return `Un agent travaille encore sur ce projet (${liste(s.agentsAuTravail)}) : attendez qu’il ait fini ou arrêtez-le.`;
  if (s.publicationEnCours) return 'Une mise en ligne de ce projet est en cours : attendez qu’elle se termine.';
  if (s.sitesPublics.length)
    return `Un site public tourne depuis le dossier de ce projet (${liste(s.sitesPublics)}) : l’archiver le couperait. Déplacez d’abord ce site.`;
  if (s.conteneurs.length) return `Des conteneurs utilisent le dossier de ce projet (${liste(s.conteneurs)}) : l’archiver les couperait.`;
  if (s.racinesCaddy.length) return `Le serveur web sert directement des fichiers de ce dossier (${liste(s.racinesCaddy)}) : l’archiver couperait ce site.`;
  if (s.copiesHorsDossier.length)
    return `Des copies de travail de cartes vivent hors du dossier (${liste(s.copiesHorsDossier)}) : fermez ces cartes avant d’archiver.`;
  if (s.refusDuDossier) return s.refusDuDossier;
  return null;
}

/** PEUT-ON DÉSARCHIVER ? `null` : oui. */
export function refusDeDesarchivage(s: {
  archived?: boolean;
  transfertEnCours?: boolean;
  /** L'archive annoncée existe-t-elle sur le disque externe ? (sans objet quand le projet n'a pas d'archive) */
  archiveTrouvee: boolean | null;
  /** Le dossier d'origine existe-t-il déjà, NON VIDE ? */
  dossierOccupe: boolean;
  disqueExterneJoignable: boolean;
}): string | null {
  if (!s.archived) return 'Ce projet n’est pas archivé.';
  if (s.transfertEnCours) return 'Un transfert est déjà en cours sur ce projet.';
  if (s.archiveTrouvee === null) return null; // rien à ramener : seul le badge se retire.
  if (!s.disqueExterneJoignable) return 'Le disque externe ne répond pas : rien n’a été tenté.';
  if (!s.archiveTrouvee) return 'L’archive de ce projet est introuvable sur le disque externe.';
  if (s.dossierOccupe) return 'Un dossier non vide occupe déjà la place du projet sur le serveur : rien n’a été touché.';
  return null;
}

/** `/a/b` contient-il `/a/b/c` (ou l'égale-t-il) ? */
export function cheminDans(chemin: string, dossier: string): boolean {
  const net = (p: string) => p.replace(/\/+$/, '');
  const c = net(chemin);
  const d = net(dossier);
  return !!d && (c === d || c.startsWith(d + '/'));
}

/**
 * LES SERVICES QUI TOURNENT DEPUIS LE DOSSIER, lus dans la sortie de
 * `systemctl show <unités> -p Id -p WorkingDirectory -p ExecStart` (blocs
 * séparés par une ligne vide). Rend chaque unité dont le dossier de travail
 * ou un chemin de la commande tombe DANS le dossier du projet.
 */
export function unitesDuDossier(sortie: string, dossier: string): string[] {
  const trouvees: string[] = [];
  for (const bloc of sortie.split(/\n\s*\n/)) {
    const id = bloc.match(/^Id=(.+)$/m)?.[1]?.trim();
    if (!id) continue;
    const travail = bloc.match(/^WorkingDirectory=(.*)$/m)?.[1]?.trim().replace(/^[-!]/, '') ?? '';
    const commande = bloc.match(/^ExecStart=(.*)$/m)?.[1] ?? '';
    const chemins = [travail, ...(commande.match(/\/[^\s;'"]+/g) ?? [])].filter(Boolean);
    if (chemins.some((c) => cheminDans(c, dossier))) trouvees.push(id);
  }
  return trouvees;
}

/** Une unité est-elle une VERSION DE TRAVAIL qu'on arrête puis relance (`autoproject-<projet>.service`) ? */
export function estUneVersionDeTravail(unite: string): boolean {
  return /^autoproject-.+\.service$/.test(unite);
}

/**
 * LES CONTENEURS QUI MONTENT LE DOSSIER, lus dans la sortie de
 * `docker inspect --format '{{.Name}}|{{range .Mounts}}{{.Source}};{{end}}'`.
 */
export function conteneursDuDossier(sortie: string, dossier: string): string[] {
  const trouves: string[] = [];
  for (const ligne of sortie.split('\n')) {
    const [nom, montages = ''] = ligne.split('|');
    if (!nom?.trim()) continue;
    if (montages.split(';').some((source) => source.trim() && cheminDans(source.trim(), dossier))) trouves.push(nom.trim().replace(/^\//, ''));
  }
  return trouves;
}

/** LES RACINES DE SITES QUE CADDY SERT DEPUIS LE DOSSIER (`root * <chemin>` ou `root <chemin>`). */
export function racinesCaddyDuDossier(texte: string, dossier: string): string[] {
  const trouvees: string[] = [];
  for (const ligne of texte.split('\n')) {
    const m = ligne.match(/^\s*root\s+(?:\S+\s+)?(\/\S+)\s*$/);
    const chemin = m?.[1];
    if (chemin && cheminDans(chemin, dossier) && !trouvees.includes(chemin)) trouvees.push(chemin);
  }
  return trouvees;
}

/** Les chemins de copies de travail (`git worktree list --porcelain`) qui vivent HORS du dossier. */
export function copiesHorsDuDossier(sortie: string, dossier: string): string[] {
  return sortie
    .split('\n')
    .map((l) => l.match(/^worktree (.+)$/)?.[1]?.trim())
    .filter((c): c is string => !!c && !cheminDans(c, dossier));
}

/** Le nom de l'archive : le nom du dossier, puis la date, sans caractère douteux. */
export function nomDeLArchiveDuProjet(dossier: string, quand: number): string {
  const base = (dossier.replace(/\/+$/, '').split('/').pop() || 'projet').replace(/[^A-Za-z0-9._-]+/g, '-');
  const d = new Date(quand);
  const deux = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}${deux(d.getUTCMonth() + 1)}${deux(d.getUTCDate())}-${deux(d.getUTCHours())}${deux(d.getUTCMinutes())}${deux(d.getUTCSeconds())}`;
  return `${base}-${date}.tar.zst`;
}

/**
 * LE BILAN D'UNE LISTE `tar -tv` : nombre d'entrées et somme des tailles des
 * fichiers ordinaires (les liens durs y valent 0 : ils ne sont stockés qu'une fois).
 */
export function bilanDUneListeTar(sortie: string): { entrees: number; octets: number } {
  let entrees = 0;
  let octets = 0;
  for (const ligne of sortie.split('\n')) {
    if (!ligne.trim()) continue;
    entrees += 1;
    if (ligne[0] !== '-') continue;
    const taille = Number(ligne.trim().split(/\s+/)[2]);
    if (Number.isFinite(taille)) octets += taille;
  }
  return { entrees, octets };
}

/**
 * LE BILAN DU DOSSIER SOURCE, lu dans `find <dossier> ! -type s -printf '%y %i %s\n'` :
 * une entrée par ligne, chaque fichier ordinaire compté UNE fois par inode
 * (un lien dur ne pèse pas deux fois, comme dans l'archive).
 */
export function bilanDUnDossier(sortie: string): { entrees: number; octets: number } {
  let entrees = 0;
  let octets = 0;
  const vus = new Set<string>();
  for (const ligne of sortie.split('\n')) {
    if (!ligne.trim()) continue;
    entrees += 1;
    const [type, inode, taille] = ligne.trim().split(/\s+/);
    if (type !== 'f' || vus.has(inode)) continue;
    vus.add(inode);
    octets += Number(taille) || 0;
  }
  return { entrees, octets };
}

/** La copie est-elle FIDÈLE à la source ? `null` : oui ; sinon ce qui diffère. */
export function ecartDeVerification(source: { entrees: number; octets: number }, copie: { entrees: number; octets: number }): string | null {
  if (source.entrees !== copie.entrees) return `La copie compte ${copie.entrees} éléments, le dossier ${source.entrees}.`;
  if (source.octets !== copie.octets) return `La copie pèse ${copie.octets} octets de fichiers, le dossier ${source.octets}.`;
  return null;
}

/**
 * L'AVANCEMENT AFFICHÉ : jamais 100 % avant la fin réelle (les en-têtes de
 * l'archive font dépasser le total annoncé), et un temps restant tiré du débit
 * observé — absent tant qu'il n'y a pas de quoi l'estimer.
 */
export function avancementDuTransfert(o: { octets: number; total: number; depuisMs: number }): { pourcent: number; resteSecondes: number | null } {
  const part = o.total > 0 ? Math.min(o.octets / o.total, 0.99) : 0;
  const pourcent = Math.max(0, Math.floor(part * 100));
  if (o.octets <= 0 || o.depuisMs < 2000 || o.total <= 0) return { pourcent, resteSecondes: null };
  const debit = o.octets / (o.depuisMs / 1000);
  const reste = Math.max(0, o.total - o.octets) / debit;
  return { pourcent, resteSecondes: Math.round(reste) };
}

/** La raison dite partout où un lancement est refusé sur un projet archivé. */
export const TEXTE_PROJET_ARCHIVE = 'Projet archivé : désarchivez-le d’abord pour lancer un agent ou une mise en ligne.';

/** Un projet en cours de transfert ou archivé ne lance rien. */
export function projetFigeParLArchive(projet: { archived?: boolean; archive?: { etat?: string } } | null | undefined): boolean {
  if (!projet) return false;
  return !!projet.archived || projet.archive?.etat === 'archivage' || projet.archive?.etat === 'desarchivage';
}

/* ------------------------------------------------------------------ */
/* L'historique des mouvements et l'archivage automatique              */
/* ------------------------------------------------------------------ */

/**
 * LE DÉLAI PAR DÉFAUT DE L'ARCHIVAGE AUTOMATIQUE (décision de l'utilisateur, 20/11/2026) : un projet sans
 * aucune activité de tâche depuis 30 jours part seul sur le disque de stockage, la nuit. Réglé UNE fois pour
 * tous les projets (`Settings.archivageAutoJours`, 0 = jamais) ; un projet s'en exempte par son interrupteur
 * (`Project.archivageAutoDesactive`).
 */
export const ARCHIVAGE_AUTO_JOURS_PAR_DEFAUT = 30;

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Un mouvement de l'historique d'archivage d'un projet. */
export interface MouvementDArchivage {
  id: number;
  projectId: string;
  quand: number;
  sens: SensDArchivage;
  /** À la main (menu, réglages, agent) ou par la nuit (archivage automatique). */
  origine: 'main' | 'auto';
  issue: 'reussi' | 'echec' | 'refus';
  /** La raison d'un échec ou d'un refus, ou le bilan d'une réussite. */
  detail?: string | null;
  /** Les octets libérés (archiver) ou ramenés (désarchiver). */
  octets?: number | null;
  octetsArchive?: number | null;
  chemin?: string | null;
}

/** Ce qu'il faut savoir d'un projet pour l'archivage automatique. */
export interface ProjetPourLArchivageAuto {
  id: string;
  name?: string;
  isSelf?: boolean;
  archived?: boolean;
  regroupement?: boolean;
  marqueSansDepot?: boolean;
  archivageAutoDesactive?: boolean;
  archive?: { etat?: string } | null;
  /** La dernière carte du projet qui a bougé (ms), dérivée par le serveur. */
  derniereActivite?: number;
  createdAt: number;
}

/**
 * LA DERNIÈRE ACTIVITÉ QUI COMPTE pour l'archivage automatique : la dernière carte qui a bougé, sinon la
 * création du projet (un projet neuf sans carte ne part pas le premier soir), et le dernier désarchivage — un
 * projet qu'on vient de ramener ne repart pas la nuit même parce que ses cartes sont anciennes.
 */
export function derniereActiviteDArchivage(p: ProjetPourLArchivageAuto, dernierDesarchivage?: number | null): number {
  return Math.max(p.derniereActivite ?? 0, p.createdAt ?? 0, dernierDesarchivage ?? 0);
}

/** Pourquoi ce projet n'entre JAMAIS dans l'archivage automatique — `null` : il y entre. */
export function horsArchivageAuto(p: ProjetPourLArchivageAuto): string | null {
  if (p.isSelf) return 'L’espace de développement de Beluga ne s’archive pas.';
  if (p.regroupement) return 'Un regroupement de projets ne s’archive pas tout seul.';
  if (p.marqueSansDepot) return 'Ce projet n’a pas de dossier à archiver.';
  if (p.archivageAutoDesactive) return 'L’archivage automatique est coupé pour ce projet.';
  return null;
}

/**
 * DANS COMBIEN DE JOURS ce projet partira seul (0 = cette nuit), ou `null` quand il ne partira pas : déjà
 * archivé, exempté, délai coupé (0 jour).
 */
export function joursAvantArchivageAuto(
  p: ProjetPourLArchivageAuto,
  o: { maintenant: number; jours: number; dernierDesarchivage?: number | null },
): number | null {
  if (!o.jours || o.jours <= 0) return null;
  if (p.archived || horsArchivageAuto(p)) return null;
  const echeance = derniereActiviteDArchivage(p, o.dernierDesarchivage) + o.jours * JOUR_MS;
  return Math.max(0, Math.ceil((echeance - o.maintenant) / JOUR_MS));
}

/**
 * LES PROJETS À ARCHIVER CETTE NUIT, le plus ancien d'abord. Le démon les traite UN À LA FOIS, par la même
 * fonction que le geste à la main (contrôles, copie vérifiée avant tout effacement).
 */
export function projetsAArchiverSeuls(
  projets: ProjetPourLArchivageAuto[],
  o: { maintenant: number; jours: number; derniersDesarchivages?: Map<string, number> },
): ProjetPourLArchivageAuto[] {
  if (!o.jours || o.jours <= 0) return [];
  const limite = o.maintenant - o.jours * JOUR_MS;
  return projets
    .filter((p) => !p.archived && !horsArchivageAuto(p))
    .filter((p) => p.archive?.etat !== 'archivage' && p.archive?.etat !== 'desarchivage')
    .map((p) => ({ p, quand: derniereActiviteDArchivage(p, o.derniersDesarchivages?.get(p.id)) }))
    .filter((x) => x.quand <= limite)
    .sort((a, b) => a.quand - b.quand)
    .map((x) => x.p);
}

/**
 * UN REFUS DE NUIT NE SE NOTE QU'UNE FOIS : un projet qui sert un site public est refusé chaque nuit ; son
 * historique ne garde que le premier refus tant que la raison ne change pas.
 */
export function refusDejaNote(dernier: Pick<MouvementDArchivage, 'issue' | 'origine' | 'detail'> | null | undefined, raison: string): boolean {
  return !!dernier && dernier.issue === 'refus' && dernier.origine === 'auto' && (dernier.detail ?? '') === raison;
}
