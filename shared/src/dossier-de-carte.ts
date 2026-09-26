/**
 * CHAQUE CARTE LANCÉE TRAVAILLE DANS SON PROPRE DOSSIER.
 *
 * La branche par carte existait déjà, mais toutes les cartes d'un projet se
 * partageaient UNE copie de travail : la seconde `git checkout -B` arrachait les
 * fichiers à la première, d'où une porte dure qui faisait attendre toute carte
 * dont le dossier était occupé. Conséquence visible : « Tout lancer » ne lançait
 * jamais qu'une carte à la fois.
 *
 * Git sait pourtant donner un dossier par branche (`git worktree add`). Les
 * règles pures du découpage vivent ici — où va le dossier, comment il se nomme,
 * lequel est orphelin — pour être rejouables sans dépôt ni disque. Le démon, lui,
 * appelle git (`server/src/dossier-de-carte.ts`).
 *
 * Le dossier vit DANS le dépôt (`.worktrees/…`) et non à côté : la résolution des
 * dépendances remonte alors toute seule au dossier principal, et un dossier
 * oublié se voit là où on le cherche.
 *
 * SAUF QUAND LE DÉPÔT VIT SUR UN STOCKAGE DISTANT. Vingt projets sur vingt-quatre
 * sont montés par le réseau (sshfs) : y écrire 200 petits fichiers prend 2,3 s,
 * contre 0,01 s sur le disque de la machine, et ouvrir la copie d'ProjetA
 * (37 000 fichiers) bloquait « Création du dossier de travail » plusieurs
 * minutes (mesures du 14.09.2026). La copie d'un tel projet naît donc sur le
 * disque LOCAL (`racineLocaleDesCopies`), le dépôt ne bouge pas : seul le
 * `.git` de la copie pointe vers lui.
 */

import { nomDeBranche, memeDossier } from './branche-de-carte.js';

/** Le dossier qui rassemble les copies de travail des cartes, dans le dépôt. */
export const DOSSIER_DES_CARTES = '.worktrees';

const propre = (chemin: string | undefined | null) => (chemin ?? '').trim().replace(/\/+$/, '');

/**
 * Le nom du dossier d'une carte : celui de sa branche, sans le « tache/ ». Même
 * source que la branche, donc jamais deux repères qui se contredisent.
 */
export function nomDuDossierDeCarte(titre: string, cardId: string): string {
  return nomDeBranche(titre, cardId).slice('tache/'.length);
}

/**
 * Où la carte travaillera : `<racine des copies>/<nom de branche>`. Sans racine
 * des copies donnée, `<projet>/.worktrees` — le rangement historique.
 */
export function cheminDossierDeCarte(racine: string, titre: string, cardId: string, racineDesCopies?: string): string {
  const copies = propre(racineDesCopies) || `${propre(racine)}/${DOSSIER_DES_CARTES}`;
  return `${copies}/${nomDuDossierDeCarte(titre, cardId)}`;
}

/**
 * Le dossier appartient-il au rangement des cartes de ce projet ? Le rangement
 * historique (`<projet>/.worktrees/`) compte toujours — une copie ouverte avant
 * le déménagement reste reconnue —, plus les racines de copies données.
 */
export function estDossierDeCarte(racine: string, dossier: string, racinesDesCopies: readonly string[] = []): boolean {
  const cible = (dossier ?? '').trim();
  const racines = [`${propre(racine)}/${DOSSIER_DES_CARTES}`, ...racinesDesCopies.map(propre).filter(Boolean)];
  return racines.some((copies) => cible.startsWith(`${copies}/`));
}

/**
 * Les dossiers de cartes qu'aucun agent n'occupe plus : un tour tué net, un démon
 * redémarré en plein travail, et la copie reste là sans personne dedans. On ne
 * ferme QUE les dossiers du rangement des cartes — jamais le dossier principal,
 * jamais un dossier ouvert à la main par quelqu'un.
 */
export function dossiersOrphelins(
  racine: string,
  ouverts: string[],
  occupes: string[],
  racinesDesCopies: readonly string[] = [],
): string[] {
  return (ouverts ?? [])
    .filter((d) => estDossierDeCarte(racine, d, racinesDesCopies))
    .filter((d) => !(occupes ?? []).some((o) => memeDossier(o, d)));
}

/* ------------------------------------------------------------------ */
/* Le disque des copies                                                */
/* ------------------------------------------------------------------ */

/** Un montage lu dans `/proc/mounts` : son point et son type. */
export interface MontageDuSysteme {
  point: string;
  type: string;
}

/**
 * Les types de systèmes de fichiers servis PAR LE RÉSEAU. `fuseblk` n'en fait
 * pas partie : c'est aussi un disque local (NTFS) ; les montages sshfs de ce
 * serveur se déclarent `fuse.sshfs` dans `/proc/mounts`.
 */
const TYPES_DISTANTS = /^(fuse\.sshfs|sshfs|fuse\.rclone|fuse\.s3fs|nfs4?|cifs|smb3?|smbfs|9p|davfs|fuse\.davfs|glusterfs|fuse\.glusterfs|ceph|fuse\.ceph)$/i;

/** Ce type de système de fichiers est-il servi par le réseau ? */
export function estSystemeDeFichiersDistant(type: string | undefined | null): boolean {
  return TYPES_DISTANTS.test((type ?? '').trim());
}

/** `/proc/mounts` lu en montages : les espaces y sont écrits `\040`. */
export function lireLesMontages(texte: string): MontageDuSysteme[] {
  const decode = (champ: string) => champ.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  return (texte ?? '')
    .split('\n')
    .map((ligne) => ligne.trim().split(/\s+/))
    .filter((champs) => champs.length >= 3)
    .map(([, point, type]) => ({ point: decode(point), type }));
}

/** Le type du système de fichiers qui porte ce chemin : le montage le plus profond qui le contient. */
export function typeDuSystemeDeFichiers(chemin: string, montages: readonly MontageDuSysteme[]): string | undefined {
  const cible = propre(chemin) || '/';
  let retenu: MontageDuSysteme | undefined;
  for (const montage of montages ?? []) {
    const point = propre(montage.point) || '/';
    const contient = point === '/' || cible === point || cible.startsWith(`${point}/`);
    if (!contient) continue;
    if (!retenu || point.length > (propre(retenu.point) || '/').length) retenu = montage;
  }
  return retenu?.type;
}

/** Une empreinte courte et stable d'un chemin (FNV-1a 32 bits), sans module de chiffrement. */
function empreinte(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Le dossier LOCAL des copies d'un projet : `<dossier local>/<nom du projet>-<empreinte>`.
 * L'empreinte du chemin du dépôt sépare deux projets de même nom.
 */
export function racineLocaleDesCopies(racineDuProjet: string, dossierLocal: string): string {
  const depot = propre(racineDuProjet);
  const nom = (depot.split('/').pop() || 'projet').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'projet';
  return `${propre(dossierLocal)}/${nom}-${empreinte(depot)}`;
}

/**
 * OÙ NAISSENT LES COPIES DE CE PROJET ? Sur le disque local quand le dépôt est
 * servi par le réseau ET que le dossier local ne l'est pas ; dans
 * `<projet>/.worktrees` sinon — un projet déjà local ne change rien.
 */
export function choisirLaRacineDesCopies(etat: {
  racineDuProjet: string;
  typeDuProjet?: string;
  dossierLocal: string;
  typeDuDossierLocal?: string;
  forcerLocal?: boolean;
}): string {
  const distant = etat.forcerLocal || estSystemeDeFichiersDistant(etat.typeDuProjet);
  if (distant && propre(etat.dossierLocal) && !estSystemeDeFichiersDistant(etat.typeDuDossierLocal)) {
    return racineLocaleDesCopies(etat.racineDuProjet, etat.dossierLocal);
  }
  return `${propre(etat.racineDuProjet)}/${DOSSIER_DES_CARTES}`;
}
