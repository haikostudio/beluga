/**
 * LA FICHE DE LA MACHINE ET CE QUI OCCUPE SES DISQUES — les règles pures.
 *
 * La page « Serveur » des réglages montre la machine qui fait tourner Beluga :
 * ses adresses publiques, ses cœurs, sa mémoire, ses disques (stockage externe
 * compris), les dix éléments les plus lourds et un explorateur en lecture seule.
 * Le démon lit la machine (`server/src/occupation-disque.ts`) ; tout ce qui se
 * décide sans base ni disque vit ici, avec ses tests
 * (`server/src/test/serveur-machine.test.ts`).
 */

/* ------------------------------------------------------------------ */
/* Les formes échangées avec l'écran                                   */
/* ------------------------------------------------------------------ */

export interface DisqueDeLaMachine {
  /** Point de montage : « / », « /mnt/sauvegardes »… */
  montage: string;
  /** Ce qui est monté : « /dev/sda1 », « u123@box:./ »… */
  source: string;
  /** Type de système de fichiers : ext4, fuse.sshfs… */
  type: string;
  /** Un stockage réseau (sshfs, nfs, cifs) : il peut ne pas répondre. */
  externe: boolean;
  taille: number;
  utilise: number;
  libre: number;
}

export interface FicheDeLaMachine {
  nom: string;
  systeme: string;
  ipv4: string[];
  ipv6: string[];
  coeurs: number;
  processeur: string;
  memoireTotale: number;
  memoireDisponible: number;
  demarreeDepuis: number;
  disques: DisqueDeLaMachine[];
  /** Le relevé des disques n'a pas répondu à temps (stockage réseau figé). */
  disquesInjoignables?: boolean;
}

export type GenreDOccupation = 'fichier' | 'dossier';

/** Un candidat sorti du relevé : un dossier (du) ou un gros fichier (find). */
export interface CandidatDOccupation {
  chemin: string;
  genre: GenreDOccupation;
  octets: number;
  /** L'écriture la plus récente DANS ce dossier (`du --time`), en millisecondes. */
  dernierLe?: number;
}

export interface ElementLourd extends CandidatDOccupation {
  /** Le disque qui le porte. */
  montage: string;
  /** Variation depuis le relevé d'au moins 20 h plus ancien ; absente sans relevé comparable. */
  variation?: number;
  /** Le projet dont il fait partie, quand son chemin tombe dans un projet déclaré. */
  projet?: string;
}

export interface EntreeDeDossier {
  nom: string;
  chemin: string;
  genre: GenreDOccupation | 'lien' | 'autre';
  /** Taille : celle du fichier, ou celle du dossier tirée du dernier relevé quand elle est connue. */
  octets?: number;
  modifieLe?: number;
  /**
   * UN DOSSIER : la date de son fichier le plus récent, à l'intérieur, à toute
   * profondeur (08/11/2026). La date du dossier lui-même ne bouge que quand une
   * entrée DIRECTE apparaît ou disparaît : « il y a 43 j » pour un dossier
   * écrit ce matin trois niveaux plus bas. Connue avec la taille, par la même
   * lecture (`du --time`).
   */
  dernierFichierLe?: number;
  /** Cette entrée EST le point de montage d'un AUTRE disque (le disque externe sous « /mnt ») : un lien vers sa racine. */
  disque?: string;
}

/* ------------------------------------------------------------------ */
/* Les adresses publiques                                               */
/* ------------------------------------------------------------------ */

/** Les interfaces qui ne sont jamais l'adresse de la machine : boucle, docker, ponts, tunnels virtuels. */
const INTERFACES_INTERNES = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|cali|tun|tap|wg|zt|tailscale|vxlan)/;

/** Une IPv4 privée, de boucle, partagée ou locale au lien : jamais l'adresse publique. */
export function ipv4Privee(adresse: string): boolean {
  const parts = adresse.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Une IPv6 globale (2000::/3) ; la boucle, le lien local et les adresses uniques locales n'en sont pas. */
export function ipv6Globale(adresse: string): boolean {
  const premier = adresse.toLowerCase().split(':')[0];
  if (!premier) return false;
  const valeur = parseInt(premier, 16);
  return Number.isFinite(valeur) && valeur >= 0x2000 && valeur <= 0x3fff;
}

type InterfaceReseau = { address: string; family: string | number; internal?: boolean };

/** Les adresses publiques de la machine, tirées de `os.networkInterfaces()`. */
export function adressesPubliques(interfaces: Record<string, InterfaceReseau[] | undefined>): {
  ipv4: string[];
  ipv6: string[];
} {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (INTERFACES_INTERNES.test(nom)) continue;
    for (const adresse of adresses ?? []) {
      if (adresse.internal) continue;
      const famille = String(adresse.family);
      if ((famille === 'IPv4' || famille === '4') && !ipv4Privee(adresse.address)) ipv4.add(adresse.address);
      if ((famille === 'IPv6' || famille === '6') && ipv6Globale(adresse.address)) ipv6.add(adresse.address);
    }
  }
  return { ipv4: [...ipv4], ipv6: [...ipv6] };
}

/* ------------------------------------------------------------------ */
/* Les disques                                                          */
/* ------------------------------------------------------------------ */

/** Ce qui n'est pas un disque qu'on remplit : mémoire, conteneurs, micrologiciel. */
const TYPES_ECARTES = new Set(['tmpfs', 'devtmpfs', 'overlay', 'efivarfs', 'squashfs', 'proc', 'sysfs', 'devpts', 'cgroup', 'cgroup2', 'nsfs', 'ramfs', 'autofs', 'fuse.lxcfs']);
const MONTAGES_ECARTES = /^\/(boot(\/|$)|snap\/|run(\/|$)|dev(\/|$)|sys(\/|$)|proc(\/|$)|var\/lib\/docker\/)/;
const TYPES_RESEAU = /^(fuse\.sshfs|nfs|nfs4|cifs|smb3|fuse\.rclone|9p)$/;

/**
 * La sortie de `df -B1 --output=source,fstype,size,used,avail,pcent,target`,
 * réduite aux vrais disques. Un même périphérique monté deux fois ne compte
 * qu'une fois (le montage le plus court l'emporte).
 */
export function lireLesDisques(sortie: string): DisqueDeLaMachine[] {
  const disques: DisqueDeLaMachine[] = [];
  const vus = new Set<string>();
  const lignes = sortie.split('\n').slice(1);
  const lus = lignes
    .map((ligne) => ligne.trim().split(/\s+/))
    .filter((champs) => champs.length >= 7)
    .map((champs) => ({
      source: champs[0],
      type: champs[1],
      taille: Number(champs[2]),
      utilise: Number(champs[3]),
      libre: Number(champs[4]),
      montage: champs.slice(6).join(' '),
    }))
    .sort((a, b) => a.montage.length - b.montage.length);
  for (const d of lus) {
    if (TYPES_ECARTES.has(d.type) || MONTAGES_ECARTES.test(d.montage)) continue;
    if (!Number.isFinite(d.taille) || d.taille <= 0) continue;
    if (vus.has(d.source)) continue;
    vus.add(d.source);
    disques.push({ ...d, externe: TYPES_RESEAU.test(d.type) });
  }
  return disques.sort((a, b) => (a.montage === '/' ? -1 : b.montage === '/' ? 1 : a.montage.localeCompare(b.montage)));
}

/** La part occupée d'un disque, en pour cent entier. */
export function partOccupee(disque: Pick<DisqueDeLaMachine, 'taille' | 'utilise' | 'libre'>): number {
  // Comme `df` : la réserve du système ne compte pas comme place libre pour l'utilisateur.
  const utile = disque.utilise + disque.libre;
  return utile > 0 ? Math.round((disque.utilise / utile) * 100) : 0;
}

/* ------------------------------------------------------------------ */
/* Les chemins                                                          */
/* ------------------------------------------------------------------ */

/** Un chemin absolu POSIX normalisé, ou `null` s'il est inacceptable (relatif, octet nul, vide). */
export function normaliserChemin(brut: unknown): string | null {
  if (typeof brut !== 'string' || !brut.startsWith('/') || brut.includes('\0') || brut.length > 4096) return null;
  const morceaux: string[] = [];
  for (const morceau of brut.split('/')) {
    if (!morceau || morceau === '.') continue;
    if (morceau === '..') morceaux.pop();
    else morceaux.push(morceau);
  }
  return '/' + morceaux.join('/');
}

/** `a` contient-il `b` (ou lui est-il égal) ? */
export function cheminContient(a: string, b: string): boolean {
  if (a === b) return true;
  const prefixe = a === '/' ? '/' : `${a}/`;
  return b.startsWith(prefixe);
}

/** Le dossier parent d'un chemin absolu (« / » reste « / »). */
export function dossierParent(chemin: string): string {
  if (chemin === '/') return '/';
  const i = chemin.lastIndexOf('/');
  return i <= 0 ? '/' : chemin.slice(0, i);
}

/** Les crans du fil d'un chemin : « / », « /root », « /root/beluga »… */
export function cransDuChemin(chemin: string): { nom: string; chemin: string }[] {
  const crans = [{ nom: '/', chemin: '/' }];
  let courant = '';
  for (const morceau of chemin.split('/').filter(Boolean)) {
    courant += `/${morceau}`;
    crans.push({ nom: morceau, chemin: courant });
  }
  return crans;
}

/** Le disque qui porte ce chemin : le montage le plus long qui le contient. */
export function montageDuChemin(chemin: string, montages: readonly string[]): string | undefined {
  return [...montages].sort((a, b) => b.length - a.length).find((m) => cheminContient(m, chemin));
}

/**
 * LE FIL D'UN CHEMIN DANS SON DISQUE : il commence à la racine du disque, jamais
 * au-dessus — dans le disque externe, « / » et « /mnt » appartiennent à l'AUTRE
 * disque. Le premier cran porte le montage lui-même (l'écran lui donne le nom du disque).
 */
export function cransDansLeDisque(chemin: string, montage: string): { nom: string; chemin: string }[] {
  return cransDuChemin(chemin).filter((c) => cheminContient(montage, c.chemin));
}

/**
 * LES POINTS DE MONTAGE D'UN AUTRE DISQUE dans une liste : l'entrée qui EST un
 * montage (« /mnt/sauvegardes » listé dans « /mnt ») devient un lien vers
 * la racine de ce disque, sans taille — sa place se lit sur SON disque, jamais
 * ajoutée à celui qui le contient.
 */
export function marquerLesPointsDeMontage(dossier: string, entrees: readonly EntreeDeDossier[], montages: readonly string[]): EntreeDeDossier[] {
  const autres = new Set(montages.filter((m) => m !== dossier));
  return entrees.map((e) => {
    if (!autres.has(e.chemin)) return e;
    const { octets: _octets, ...reste } = e;
    void _octets;
    return { ...reste, genre: 'dossier', disque: e.chemin };
  });
}

/** Une taille mesurée sur-le-champ, avec sa date. */
export interface TailleMesuree {
  octets: number;
  at: number;
  /** L'écriture la plus récente à l'intérieur, lue par la même mesure. */
  dernierLe?: number;
}

/**
 * LES TAILLES CONNUES DES ENFANTS D'UN DOSSIER, d'où qu'elles viennent : le
 * dernier relevé du disque (toutes les 6 h, ou 24 h pour le disque externe) et
 * les mesures faites depuis l'explorateur. Pour chaque enfant, la plus RÉCENTE
 * gagne. L'étiquette dit d'où vient l'ensemble : « mesurees » quand le dossier
 * a été mesuré en entier après le relevé, sinon « releve », sinon « aucune ».
 */
export function fusionnerLesTailles(entree: {
  enfants: readonly string[];
  releve?: { faitLe: number; tailles: ReadonlyMap<string, number>; dates?: ReadonlyMap<string, number> };
  mesurees: ReadonlyMap<string, TailleMesuree>;
  /** La dernière mesure du dossier lui-même (`du -d 1`), complète ou coupée par son délai. */
  mesureDuDossier?: { at: number; complete: boolean };
}): { connues: Map<string, number>; dates: Map<string, number>; tailles: 'mesurees' | 'releve' | 'aucune'; taillesLe?: number } {
  const { enfants, releve, mesurees, mesureDuDossier } = entree;
  const connues = new Map<string, number>();
  // La date du fichier le plus récent suit la taille : même source, même fraîcheur.
  const dates = new Map<string, number>();
  let duReleve = 0;
  let mesureesVues = 0;
  for (const enfant of enfants) {
    const r = releve?.tailles.get(enfant);
    const m = mesurees.get(enfant);
    if (m && (r === undefined || !releve || m.at >= releve.faitLe)) {
      connues.set(enfant, m.octets);
      if (m.dernierLe) dates.set(enfant, m.dernierLe);
      mesureesVues++;
    } else if (r !== undefined) {
      connues.set(enfant, r);
      const d = releve?.dates?.get(enfant);
      if (d) dates.set(enfant, d);
      duReleve++;
    }
  }
  if (mesureDuDossier?.complete && (!releve || mesureDuDossier.at >= releve.faitLe)) {
    return { connues, dates, tailles: 'mesurees', taillesLe: mesureDuDossier.at };
  }
  if (releve && (duReleve || !mesureesVues)) return { connues, dates, tailles: 'releve', taillesLe: releve.faitLe };
  if (mesureesVues && mesureDuDossier) return { connues, dates, tailles: 'mesurees', taillesLe: mesureDuDossier.at };
  return { connues, dates, tailles: 'aucune' };
}

/** Le projet dont ce chemin fait partie : le dossier déclaré le plus long qui le contient. */
export function projetQuiPorteLeChemin(chemin: string, projets: readonly { nom: string; dossier: string }[]): string | undefined {
  const trouve = [...projets]
    .filter((p) => p.dossier && p.dossier !== '/')
    .sort((a, b) => b.dossier.length - a.dossier.length)
    .find((p) => cheminContient(p.dossier, chemin));
  return trouve?.nom;
}

/* ------------------------------------------------------------------ */
/* Lecture des relevés                                                  */
/* ------------------------------------------------------------------ */

/** La sortie de `du -k` (« taille<TAB>chemin » par ligne), en octets. */
export function lireDu(sortie: string): CandidatDOccupation[] {
  const lus: CandidatDOccupation[] = [];
  for (const ligne of sortie.split('\n')) {
    const tab = ligne.indexOf('\t');
    if (tab <= 0) continue;
    const ko = Number(ligne.slice(0, tab));
    let chemin = ligne.slice(tab + 1);
    // `du --time --time-style=+%s` glisse la date (en secondes) entre la taille et le chemin.
    let dernierLe: number | undefined;
    const second = chemin.indexOf('\t');
    if (second > 0 && /^\d+$/.test(chemin.slice(0, second))) {
      dernierLe = Number(chemin.slice(0, second)) * 1000;
      chemin = chemin.slice(second + 1);
    }
    if (!Number.isFinite(ko) || !chemin.startsWith('/')) continue;
    lus.push({ chemin, genre: 'dossier', octets: ko * 1024, ...(dernierLe ? { dernierLe } : {}) });
  }
  return lus;
}

/** La sortie de `find -printf '%s\t%p\n'` (les gros fichiers), en octets. */
export function lireGrosFichiers(sortie: string): CandidatDOccupation[] {
  const lus: CandidatDOccupation[] = [];
  for (const ligne of sortie.split('\n')) {
    const tab = ligne.indexOf('\t');
    if (tab <= 0) continue;
    const octets = Number(ligne.slice(0, tab));
    const chemin = ligne.slice(tab + 1);
    if (!Number.isFinite(octets) || !chemin.startsWith('/')) continue;
    lus.push({ chemin, genre: 'fichier', octets });
  }
  return lus;
}

/**
 * La sortie de `find <dossier> -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%T@\t%f\n'`,
 * en entrées de l'explorateur. Les tailles de dossiers connues (dernier relevé)
 * remplacent la taille d'inode, qui ne dit rien.
 */
export function lireLeDossier(
  dossier: string,
  sortie: string,
  taillesConnues: ReadonlyMap<string, number> = new Map(),
  datesConnues: ReadonlyMap<string, number> = new Map(),
): EntreeDeDossier[] {
  const entrees: EntreeDeDossier[] = [];
  for (const ligne of sortie.split('\n')) {
    const champs = ligne.split('\t');
    if (champs.length < 4) continue;
    const [type, taille, date] = champs;
    const nom = champs.slice(3).join('\t');
    if (!nom || nom.includes('/')) continue;
    const chemin = dossier === '/' ? `/${nom}` : `${dossier}/${nom}`;
    const genre: EntreeDeDossier['genre'] = type === 'f' ? 'fichier' : type === 'd' ? 'dossier' : type === 'l' ? 'lien' : 'autre';
    const octets = genre === 'fichier' ? Number(taille) : genre === 'dossier' ? taillesConnues.get(chemin) : undefined;
    const modifieLe = Math.round(Number(date) * 1000);
    const dernierFichierLe = genre === 'dossier' ? datesConnues.get(chemin) : undefined;
    entrees.push({
      nom,
      chemin,
      genre,
      ...(octets !== undefined && Number.isFinite(octets) ? { octets } : {}),
      ...(Number.isFinite(modifieLe) && modifieLe > 0 ? { modifieLe } : {}),
      ...(dernierFichierLe ? { dernierFichierLe } : {}),
    });
  }
  return trierLesEntrees(entrees);
}

/** Les plus lourds d'abord ; ce dont on ignore la taille ensuite, par nom. */
export function trierLesEntrees(entrees: EntreeDeDossier[]): EntreeDeDossier[] {
  return [...entrees].sort((a, b) => {
    const ta = a.octets ?? -1;
    const tb = b.octets ?? -1;
    if (ta !== tb) return tb - ta;
    return a.nom.localeCompare(b.nom);
  });
}

/* ------------------------------------------------------------------ */
/* LES DIX PLUS LOURDS, FICHIERS ET DOSSIERS MÊLÉS, SANS DOUBLON         */
/* ------------------------------------------------------------------ */

/**
 * Un dossier n'est retenu que s'il pèse PAR LUI-MÊME : ses sous-éléments
 * relevés (dossiers et gros fichiers) font moins de la moitié de sa taille.
 * Sinon c'est un simple couloir — « /root » qui ne pèse que par « /root/beluga »
 * — et ce sont ses enfants qui parlent.
 */
export const PART_PROPRE_MINIMALE = 0.5;

/**
 * Les `n` éléments les plus lourds, fichiers et dossiers mêlés, sans qu'un
 * octet soit compté deux fois : un élément retenu écarte ses descendants (déjà
 * comptés en lui) ; un point de montage n'est jamais retenu seul (c'est le
 * disque entier, déjà affiché en tête de page).
 */
export function lesPlusLourds(
  candidats: readonly CandidatDOccupation[],
  options: { montages?: readonly string[]; n?: number } = {},
): CandidatDOccupation[] {
  const n = options.n ?? 10;
  const montages = new Set(options.montages ?? []);
  montages.add('/');
  const parChemin = new Map<string, CandidatDOccupation>();
  for (const c of candidats) {
    const deja = parChemin.get(c.chemin);
    if (!deja || c.octets > deja.octets) parChemin.set(c.chemin, c);
  }

  /* Le plus proche ancêtre relevé de chaque candidat : la somme de ses
     enfants relevés dit combien un dossier pèse « par ses enfants ». */
  const parEnfants = new Map<string, number>();
  for (const c of parChemin.values()) {
    let parent = dossierParent(c.chemin);
    while (true) {
      if (parChemin.get(parent)?.genre === 'dossier' && parent !== c.chemin) {
        parEnfants.set(parent, (parEnfants.get(parent) ?? 0) + c.octets);
        break;
      }
      if (parent === '/') break;
      parent = dossierParent(parent);
    }
  }

  const eligibles = [...parChemin.values()].filter((c) => {
    if (montages.has(c.chemin)) return false;
    if (c.genre === 'fichier') return true;
    const enfants = parEnfants.get(c.chemin) ?? 0;
    return c.octets > 0 && (c.octets - enfants) / c.octets >= PART_PROPRE_MINIMALE;
  });
  eligibles.sort((a, b) => b.octets - a.octets || a.chemin.localeCompare(b.chemin));

  const retenus: CandidatDOccupation[] = [];
  for (const c of eligibles) {
    if (retenus.length >= n) break;
    if (retenus.some((r) => cheminContient(r.chemin, c.chemin) || cheminContient(c.chemin, r.chemin))) continue;
    retenus.push(c);
  }
  return retenus;
}

/** Un relevé est « de la veille » s'il a au moins 20 heures. */
export const AGE_MINIMAL_DE_LA_VEILLE_MS = 20 * 3_600_000;

/**
 * Le relevé qui sert de point de comparaison : le plus RÉCENT parmi ceux qui ont
 * au moins 20 heures. Rien de plus jeune — on comparerait deux relevés du jour.
 */
export function releveDeLaVeille<T extends { faitLe: number }>(releves: readonly T[], maintenant: number): T | undefined {
  return releves
    .filter((r) => maintenant - r.faitLe >= AGE_MINIMAL_DE_LA_VEILLE_MS)
    .sort((a, b) => b.faitLe - a.faitLe)[0];
}

/** La variation d'un élément contre le relevé de la veille ; `undefined` s'il n'y figurait pas. */
export function variationDepuis(chemin: string, octets: number, veille: ReadonlyMap<string, number> | undefined): number | undefined {
  if (!veille) return undefined;
  const avant = veille.get(chemin);
  return avant === undefined ? undefined : octets - avant;
}

/* ------------------------------------------------------------------ */
/* Mise en forme                                                         */
/* ------------------------------------------------------------------ */

/** « 12,4 Go », « 830 Mo », « 4 Ko » — en base 1024, virgule décimale. */
export function tailleEnClair(octets: number): string {
  const abs = Math.abs(octets);
  const unites = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let valeur = abs;
  let i = 0;
  while (valeur >= 1024 && i < unites.length - 1) {
    valeur /= 1024;
    i += 1;
  }
  const texte = i === 0 || valeur >= 100 ? String(Math.round(valeur)) : valeur.toFixed(1).replace('.', ',').replace(/,0$/, '');
  return `${octets < 0 ? '−' : ''}${texte} ${unites[i]}`;
}

/** « +1,2 Go », « −300 Mo », ou rien sous 1 Mo (le bruit d'un journal). */
export function formaterVariation(variation: number | undefined): string | undefined {
  if (variation === undefined || Math.abs(variation) < 1024 * 1024) return undefined;
  return variation > 0 ? `+${tailleEnClair(variation)}` : tailleEnClair(variation);
}

/** Le titre de la carte de ménage : le dossier, en clair. */
export function titreDeMenage(chemin: string): string {
  return `Ménage de ${chemin}`;
}

/** La description de la carte de ménage : ce qu'il faut savoir, et la prudence exigée. */
export function descriptionDeMenage(element: { chemin: string; genre: GenreDOccupation; octets: number; variation?: number; projet?: string }): string {
  const variation = formaterVariation(element.variation);
  return [
    `${element.genre === 'fichier' ? 'Fichier' : 'Dossier'} : ${element.chemin}`,
    `Taille : ${tailleEnClair(element.octets)}${variation ? ` (${variation} depuis la veille)` : ''}`,
    element.projet ? `Projet concerné : ${element.projet}` : '',
    '',
    'Demande posée depuis la page « Serveur » des réglages : regarder ce qui occupe cette place et ce qui peut partir sans danger.',
    '',
    'Consignes :',
    '- Analyser le contenu (âge, origine, programme qui l’écrit) et dire ce qui le fait grossir.',
    '- Proposer la liste précise de ce qui peut être supprimé ou déplacé sur le stockage externe, avec la place gagnée, par une question à l’utilisateur AVANT toute suppression.',
    '- Ne jamais toucher à une base de données, à un dossier de projet, à une sauvegarde ni à un fichier d’identifiants sans son accord explicite.',
    '- Si quelque chose se remplit tout seul (journaux, caches, images), proposer une règle de nettoyage durable plutôt qu’un ménage ponctuel.',
  ]
    .filter((ligne, i, toutes) => ligne !== '' || (toutes[i - 1] ?? '') !== '')
    .join('\n');
}
