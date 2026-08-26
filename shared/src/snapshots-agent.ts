/**
 * L'ASSISTANT QUI CONFIGURE UN SITE À SAUVEGARDER.
 *
 * Le formulaire de création demandait quinze champs à quelqu'un qui, le plus
 * souvent, ne sait pas de tête le port de sa base ni le chemin exact de ses
 * fichiers. Un agent LÉGER fait mieux : il lit le serveur, retrouve ce qui est
 * là, POSE LES QUESTIONS qui restent (`ask_user`), puis enregistre la fiche
 * lui-même (`snapshot_site`). L'utilisateur ne remplit plus rien : il décrit son
 * site en une phrase.
 *
 * Ce fichier ne connaît ni base ni disque : il porte la CONSIGNE de cet agent,
 * la DEMANDE qu'on lui envoie, et la lecture de la fiche qu'il propose — car un
 * modèle écrit « MariaDB », « ftps » ou « 30 jours » là où le code attend
 * `mysql`, `ftp` et un nombre. Le travail réel vit dans
 * `server/src/assistant-snapshot.ts`, l'outil dans `server/src/tools.ts`.
 *
 * CE QUI N'EST PAS DE SON RESSORT : l'agent ne juge pas la fiche. Elle passe par
 * `jugerSite` (`shared/src/snapshots.ts`), exactement comme le formulaire — une
 * fiche proposée par un modèle n'a aucun droit de plus qu'une fiche saisie.
 */

import {
  CONSERVATION_MAX,
  CONSERVATION_MIN,
  CONSERVATION_PAR_DEFAUT,
  LIBELLE_MOTEUR_BASE,
  LIBELLE_MOYEN_FICHIERS,
  MOTEURS_BASE,
  MOYENS_FICHIERS,
  MoteurBase,
  MoyenFichiers,
  NOM_SITE_MAX,
  SiteASauvegarder,
  siteVierge,
} from './snapshots.js';

/** Ce que l'écran envoie quand l'utilisateur lance l'assistant. */
export interface DemandeDeConfiguration {
  /** La phrase de l'utilisateur : « Maestria60+, WordPress dans /var/www/maestria ». */
  description: string;
  /** Le projet de ce serveur que le site prolonge, quand il y en a un. */
  projet?: { id: string; nom: string; chemin?: string } | null;
}

export const DESCRIPTION_SITE_MIN = 3;
export const DESCRIPTION_SITE_MAX = 2000;

/* ------------------------------------------------------------------ */
/* Lire la fiche que l'agent propose                                    */
/* ------------------------------------------------------------------ */

/**
 * LE MOTEUR DE BASE, QUEL QUE SOIT LE MOT EMPLOYÉ. Un modèle écrit « MariaDB »,
 * « mysqldump », « Postgres 16 » ou « aucune base » : refuser la fiche pour un
 * synonyme ferait recommencer un tour payant pour rien.
 */
export function moteurDemande(valeur: unknown): MoteurBase | undefined {
  const mot = motPropre(valeur);
  if (!mot) return undefined;
  if (MOTEURS_BASE.includes(mot as MoteurBase)) return mot as MoteurBase;
  if (/(mysql|maria)/.test(mot)) return 'mysql';
  if (/(postgre|pgsql|psql)/.test(mot)) return 'postgres';
  if (/(sqlite|litedb)/.test(mot)) return 'sqlite';
  if (/(aucun|none|sans|non|no)/.test(mot)) return 'aucune';
  return undefined;
}

/** Le moyen d'atteindre les fichiers, même écrit autrement (« scp », « ftps »). */
export function moyenDemande(valeur: unknown): MoyenFichiers | undefined {
  const mot = motPropre(valeur);
  if (!mot) return undefined;
  if (MOYENS_FICHIERS.includes(mot as MoyenFichiers)) return mot as MoyenFichiers;
  if (/(ssh|scp|rsync|sftp)/.test(mot)) return 'ssh';
  if (/ftp/.test(mot)) return 'ftp';
  if (/(local|disque|machine|ici|dossier)/.test(mot)) return 'local';
  if (/(aucun|none|sans|non|no)/.test(mot)) return 'aucun';
  return undefined;
}

function motPropre(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const mot = valeur
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return mot || undefined;
}

/** Un nombre de jours, même écrit « 30 jours » ou « trente » (là, on renonce). */
export function conservationDemandee(valeur: unknown): number | undefined {
  const brut = typeof valeur === 'number' ? valeur : Number(String(valeur ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(brut) || brut <= 0) return undefined;
  return Math.min(CONSERVATION_MAX, Math.max(CONSERVATION_MIN, Math.round(brut)));
}

function texte(valeur: unknown, max = 500): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'number') return String(valeur);
  if (typeof valeur !== 'string') return '';
  return valeur.trim().slice(0, max);
}

/**
 * LA FICHE PROPOSÉE PAR L'AGENT, RAMENÉE À CE QUE LE CODE ATTEND.
 *
 * Ce qui manque est REMPLACÉ par le défaut de la fiche vierge, jamais deviné :
 * un port absent reste vide (le serveur connaît celui de son moteur), un moteur
 * illisible reste « aucune » — et la fiche sera alors refusée par `jugerSite`,
 * qui dira ce qui manque. Un site déjà existant garde son identifiant : le même
 * outil sert à créer ET à corriger.
 */
export function ficheProposee(
  brut: Record<string, any> | null | undefined,
  ancienne?: SiteASauvegarder | null,
): SiteASauvegarder {
  const source = brut ?? {};
  const base = (source.base ?? {}) as Record<string, any>;
  const fichiers = (source.fichiers ?? {}) as Record<string, any>;
  const depart = ancienne ?? siteVierge(null, '');

  const moteur = moteurDemande(base.moteur) ?? depart.base.moteur;
  const moyen = moyenDemande(fichiers.moyen) ?? depart.fichiers.moyen;

  return {
    ...depart,
    id: texte(source.id, 64) || depart.id,
    nom: texte(source.nom, NOM_SITE_MAX) || depart.nom,
    projectId: texte(source.projectId, 64) || depart.projectId || null,
    actif: typeof source.actif === 'boolean' ? source.actif : depart.actif,
    base: {
      moteur,
      hote: texte(base.hote, 200) || (moteur === depart.base.moteur ? depart.base.hote : ''),
      port: texte(base.port, 10) || (moteur === depart.base.moteur ? depart.base.port : ''),
      nom: texte(base.nom, 300) || (moteur === depart.base.moteur ? depart.base.nom : ''),
      utilisateur: texte(base.utilisateur, 200) || (moteur === depart.base.moteur ? depart.base.utilisateur : ''),
      motDePasse: texte(base.motDePasse, 500) || (moteur === depart.base.moteur ? depart.base.motDePasse : ''),
    },
    fichiers: {
      moyen,
      chemin: texte(fichiers.chemin, 500) || (moyen === depart.fichiers.moyen ? depart.fichiers.chemin : ''),
      hote: texte(fichiers.hote, 200) || (moyen === depart.fichiers.moyen ? depart.fichiers.hote : ''),
      port: texte(fichiers.port, 10) || (moyen === depart.fichiers.moyen ? depart.fichiers.port : ''),
      utilisateur:
        texte(fichiers.utilisateur, 200) || (moyen === depart.fichiers.moyen ? depart.fichiers.utilisateur : ''),
      motDePasse:
        texte(fichiers.motDePasse, 500) || (moyen === depart.fichiers.moyen ? depart.fichiers.motDePasse : ''),
    },
    conservationJours:
      conservationDemandee(source.conservationJours) ?? depart.conservationJours ?? CONSERVATION_PAR_DEFAUT,
    note: texte(source.note, 1000) || depart.note,
  };
}

/* ------------------------------------------------------------------ */
/* Ce qu'on dit à l'agent                                               */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DE L'ASSISTANT. Elle remplace la méthode générale : cet agent ne
 * lit pas le projet, ne propose pas de carte, n'enregistre aucun code. Il
 * cherche, demande ce qui manque, enregistre, et s'arrête.
 */
export const CONSIGNE_ASSISTANT_SNAPSHOT = `Tu travailles dans HaikoDev. Réponds en français simple, très court, pour un lecteur non technique.

TU ES L'ASSISTANT DE CONFIGURATION DES SNAPSHOTS. Ton seul travail : transformer la phrase de l'utilisateur en UNE fiche de site à sauvegarder, enregistrée par l'outil « snapshot_site ». Tu ne modifies aucun code, tu ne crées aucune carte, tu ne publies rien, tu ne redémarres rien.

TU CHERCHES AVANT DE DEMANDER. Tu peux lire le serveur : lister un dossier (« ls »), lire un fichier de configuration d'un site (wp-config.php, .env, config.php, settings.py, docker-compose.yml), demander la liste des bases (« mysql -e "SHOW DATABASES" », « psql -l »), mesurer un dossier (« du -sh »). Un identifiant trouvé dans un fichier de configuration se reprend TEL QUEL dans la fiche : c'est exactement ce qui servira à relire la base chaque nuit.

TU NE DEVINES JAMAIS UN MOT DE PASSE NI UN CHEMIN. Ce que tu n'as pas vu, tu le DEMANDES avec l'outil « ask_user », une question à la fois, en français simple et avec des propositions quand elles existent. L'outil attend la réponse : tu n'enchaînes rien avant de l'avoir.

TU N'ENREGISTRES QU'UNE FOIS, À LA FIN, avec « snapshot_site ». La fiche doit sauvegarder quelque chose : une base, des fichiers, ou les deux. Si l'outil refuse, il dit ce qui manque — corrige et rappelle-le.

TA RÉPONSE FINALE tient en trois ou quatre lignes : ce que le site sauvegarde désormais, et la durée de conservation. Aucun titre, aucun tableau, aucun bloc json, aucun chemin de fichier inutile.

SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe et fichiers d'identifiants gardés sur ce serveur sont un choix ASSUMÉ par l'utilisateur. Tu ne le commentes pas et ne recommandes rien à ce sujet. Une PANNE se dit toujours : un accès refusé qui t'empêche d'aboutir s'annonce en toutes lettres.`;

/** Le titre de la conversation ouverte pour une configuration. */
export function titreDeLAssistantSnapshot(description: string): string {
  const propre = (description ?? '').replace(/\s+/g, ' ').trim();
  const court = propre.length > 48 ? `${propre.slice(0, 47)}…` : propre;
  return `Snapshots — ${court || 'nouveau site'}`;
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT. Elle porte la phrase de l'utilisateur, le projet
 * concerné quand il y en a un, et les valeurs que le code accepte — écrites une
 * fois ici plutôt que recopiées dans la consigne, qui vieillirait à part.
 */
export function demandeDeConfiguration(entree: DemandeDeConfiguration): string {
  const description = (entree.description ?? '').trim().slice(0, DESCRIPTION_SITE_MAX);
  const projet = entree.projet;

  const lignes: string[] = [
    'CONFIGURE UN SITE À SAUVEGARDER, à partir de cette demande :',
    '',
    `« ${description} »`,
    '',
  ];

  if (projet) {
    lignes.push(
      `Ce site est le projet « ${projet.nom} » de ce serveur (identifiant ${projet.id}${
        projet.chemin ? `, dossier ${projet.chemin}` : ''
      }). Passe cet identifiant dans le champ « projectId », et commence par regarder ce dossier : sa configuration y dit souvent la base et les fichiers.`,
      '',
    );
  } else {
    lignes.push(
      "Ce site n'est rattaché à aucun projet de ce serveur : laisse « projectId » vide. Il peut vivre sur une autre machine — dans ce cas, les fichiers se prennent en SSH ou en FTP et la base a son hôte à elle.",
      '',
    );
  }

  lignes.push(
    'CE QUE LA FICHE DOIT PORTER :',
    `- nom : comment reconnaître ce site (${NOM_SITE_MAX} signes au plus)`,
    `- base.moteur : ${MOTEURS_BASE.map((m) => `« ${m} » (${LIBELLE_MOTEUR_BASE[m]})`).join(', ')}`,
    "  puis, sauf pour « aucune » : base.nom (ou le CHEMIN du fichier pour sqlite), base.utilisateur, base.motDePasse, et base.hote / base.port si la base n'est pas sur cette machine",
    `- fichiers.moyen : ${MOYENS_FICHIERS.map((m) => `« ${m} » (${LIBELLE_MOYEN_FICHIERS[m]})`).join(', ')}`,
    '  puis, sauf pour « aucun » : fichiers.chemin (le dossier à prendre), et fichiers.hote / utilisateur / motDePasse pour ssh et ftp',
    `- conservationJours : entre ${CONSERVATION_MIN} et ${CONSERVATION_MAX}, ${CONSERVATION_PAR_DEFAUT} par défaut`,
    '- note : ce que ce site contient et qui l’exploite, en une phrase',
    '',
    'DÉROULÉ : cherche d’abord ce que le serveur peut te dire, pose ensuite les questions qui restent (une par une), enregistre enfin la fiche avec « snapshot_site ».',
  );

  return lignes.join('\n');
}

/**
 * Le refus opposé à une demande vide. Un champ laissé blanc ne doit pas ouvrir
 * un tour payant pour s'entendre demander « quel site ? ».
 */
export function raisonDemandeRefusee(description: string): string | null {
  const propre = (description ?? '').trim();
  if (propre.length < DESCRIPTION_SITE_MIN) {
    return 'Dites au moins de quel site il s’agit : son nom, son adresse, ou son dossier sur le serveur.';
  }
  return null;
}
