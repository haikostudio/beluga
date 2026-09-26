/**
 * L'AGENT D'ANALYSE DES BACKUPS.
 *
 * Un backup n'est plus une copie câblée dans le démon : c'est une RECETTE
 * (`shared/src/backups-recette.ts`), propre à chaque site — le dépôt de code,
 * les fichiers téléversés, la base PocketBase d'un conteneur, un vidage MySQL.
 * Personne ne sait l'écrire de tête ; un agent le fait : il LIT le site, pose
 * les questions qui restent (`ask_user`), ESSAIE sa recette pour de vrai
 * (`backup_essai`), puis enregistre la fiche et sa recette (`backup_recette`).
 * Ensuite la recette tourne seule, à chaque passage, sans lui. L'utilisateur ne
 * remplit rien : il décrit son site en une phrase.
 *
 * Ce fichier ne connaît ni base ni disque : il porte la CONSIGNE de cet agent,
 * les DEMANDES qu'on lui envoie, et la lecture de la fiche qu'il propose — car un
 * modèle écrit « MariaDB », « ftps » ou « 30 jours » là où le code attend
 * `mysql`, `ftp` et un nombre. Le travail réel vit dans
 * `server/src/assistant-backup.ts`, les outils dans `server/src/tools.ts`.
 *
 * CE QUI N'EST PAS DE SON RESSORT : l'agent ne juge ni la fiche ni la recette.
 * Elles passent par `jugerSite` et `jugerRecette`, exactement comme le
 * formulaire — ce que propose un modèle n'a aucun droit de plus que ce qu'on
 * saisit, et c'est l'ARCHIVE relue qui dit si la recette marche.
 */

import {
  CONSERVATION_MAX,
  CONSERVATION_MIN,
  CONSERVATION_PAR_DEFAUT,
  FREQUENCE_MINUTES_MAX,
  FREQUENCE_MINUTES_MIN,
  FREQUENCE_MINUTES_PAR_DEFAUT,
  phraseDeCadence,
  LIBELLE_MOTEUR_BASE,
  LIBELLE_MOYEN_FICHIERS,
  MOTEURS_BASE,
  MOYENS_FICHIERS,
  MoteurBase,
  MoyenFichiers,
  NOM_SITE_MAX,
  PointDeSauvegarde,
  SiteASauvegarder,
  siteVierge,
} from './backups.js';
import { GENRES_D_ETAPE, VARIABLES_DE_RECETTE, phraseDeRecette } from './backups-recette.js';

/** Ce que l'écran envoie quand l'utilisateur lance l'agent. */
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
    .replace(/[̀-ͯ]/g, '');
  return mot || undefined;
}

/** Un nombre de jours, même écrit « 30 jours » ou « trente » (là, on renonce). */
export function conservationDemandee(valeur: unknown): number | undefined {
  const brut = typeof valeur === 'number' ? valeur : Number(String(valeur ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(brut) || brut <= 0) return undefined;
  return Math.min(CONSERVATION_MAX, Math.max(CONSERVATION_MIN, Math.round(brut)));
}

/** Une cadence en MINUTES, même écrite « toutes les 15 minutes » (le nombre suffit). */
export function frequenceDemandee(valeur: unknown): number | undefined {
  const brut = typeof valeur === 'number' ? valeur : Number(String(valeur ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(brut) || brut <= 0) return undefined;
  return Math.min(FREQUENCE_MINUTES_MAX, Math.max(FREQUENCE_MINUTES_MIN, Math.round(brut)));
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
 * outil sert à créer ET à corriger. La recette, elle, se lit à part
 * (`recetteProposee`).
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
    frequenceMinutes:
      frequenceDemandee(source.frequenceMinutes) ??
      depart.frequenceMinutes ??
      FREQUENCE_MINUTES_PAR_DEFAUT,
    note: texte(source.note, 1000) || depart.note,
  };
}

/* ------------------------------------------------------------------ */
/* Ce qu'on dit à l'agent                                               */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DE L'AGENT D'ANALYSE. Elle remplace la méthode générale : cet
 * agent ne lit pas le projet Beluga Build, ne propose pas de carte, n'enregistre
 * aucun code. Il lit UN site, écrit sa recette, l'essaie, l'enregistre, et
 * s'arrête.
 */
export const CONSIGNE_ASSISTANT_BACKUP = `Tu travailles dans Beluga Build. Réponds très court.

TU ES L'AGENT D'ANALYSE DES BACKUPS. Ton travail : lire un site, comprendre ce qui le fait vivre (son code, ses fichiers téléversés, ses bases de données), et écrire sa RECETTE DE BACKUP — les commandes qui prennent chaque part dans une archive zip, et celles qui la remettent en place. La recette est ensuite rejouée SEULE, à chaque passage, sans toi. Tu ne modifies aucun fichier du site, tu ne crées aucune carte, tu ne publies rien, tu ne redémarres rien.

TU LIS AVANT D'ÉCRIRE. Lister un dossier (« ls »), lire la configuration (wp-config.php, .env, config.php, settings.py, docker-compose.yml), reconnaître un dépôt git (« git -C <dossier> status »), lister les conteneurs (« docker ps »), les bases (« mysql -e "SHOW DATABASES" », « psql -l »), mesurer (« du -sh »). Un identifiant trouvé dans un fichier de configuration se reprend TEL QUEL dans la fiche : c'est lui qui servira à chaque passage.

LE COFFRE-FORT AVANT LA QUESTION. Les accès déjà connus sont rangés dans le coffre-fort central (outil « coffre_fort »), ouvert en lecture et en écriture : appelle « lister » AVANT de demander un mot de passe, une clé ou un accès SSH — celui du site est peut-être déjà là. Un accès NOUVEAU que tu trouves sur le serveur ou que l'utilisateur te donne s'y enregistre avec « enregistrer ». Ne dis jamais « je n'ai pas accès » sans avoir listé le coffre.

TU NE DEVINES JAMAIS UN MOT DE PASSE NI UN CHEMIN. Ce que le coffre n'a pas et que tu n'as pas vu, tu le DEMANDES avec l'outil « ask_user », une question à la fois, en phrases simples et avec des propositions quand elles existent. L'outil attend la réponse : tu n'enchaînes rien avant de l'avoir.

UNE RECETTE, CE SONT DES ÉTAPES. Chacune a un genre (« code », « fichiers » ou « base »), un libellé en clair, et deux commandes bash :
- « prendre » écrit ce qu'elle prend dans le dossier vide $SORTIE (un vidage dans "$SORTIE/base.sql", un dossier recopié dans "$SORTIE/") ;
- « remettre » repose ce qu'elle trouve dans $ENTREE, qui contient exactement ce que « prendre » y avait posé. Elle est l'INVERSE exact de « prendre ».
Les accès de la fiche arrivent par l'environnement ($BASE_NOM, $BASE_UTILISATEUR, $BASE_MOT_DE_PASSE, $FICHIERS_CHEMIN, $FICHIERS_HOTE…, avec $MYSQL_PWD et $PGPASSWORD déjà posés) : cite ces variables plutôt que de recopier un mot de passe dans une commande. Ne prends pas ce qui se refabrique (node_modules, .next, caches). Une base se prend par un vidage cohérent (mysqldump --single-transaction, pg_dump, sqlite3 « .backup », ou l'export prévu par le logiciel), jamais en recopiant le fichier d'une base qui écrit en même temps.

TU ESSAIES AVANT D'ENREGISTRER. « backup_essai » avec ta « recette » la rejoue POUR DE VRAI : chaque étape tourne, l'archive est écrite, relue et jugée, puis jetée. Il rend ce que l'archive contient étape par étape, et la plainte de chaque commande qui tombe. Tu corriges et tu recommences jusqu'à ce que TOUTES les étapes soient prises. « remettre » n'est jamais essayé (il écraserait le site vivant) : relis-la d'autant plus soigneusement. Un accès qui ne répond toujours pas se DIT à l'utilisateur avec « ask_user ».

TU N'ENREGISTRES QU'UNE FOIS, À LA FIN, avec « backup_recette » : la fiche ET sa recette, en un seul appel. L'outil rejoue lui-même la recette une dernière fois et refuse ce qui ne donne pas une archive complète ; n'insiste avec « forcer » que si l'utilisateur te l'a explicitement accordé. Si l'outil refuse, il dit ce qui manque — corrige et rappelle-le.

QUAND ON TE DEMANDE DE REPRENDRE UN SITE DÉJÀ ENREGISTRÉ (il échoue, ou sa recette n'est encore que celle déduite de sa fiche), tu pars de ce qui est enregistré : tu rejoues avec « backup_essai » et « rejouer » pour VOIR ce qui se passe, tu lis le site, tu corriges ce que tu constates toi-même, et tu ne demandes à l'utilisateur que ce qui ne se trouve pas sur le serveur. Tu réenregistres alors la MÊME fiche, avec son identifiant et sa recette.

TA RÉPONSE FINALE tient en trois ou quatre lignes : ce que chaque étape prend, ce que l'essai a donné (le poids de l'archive), la cadence et la durée de conservation. Aucun titre, aucun tableau, aucun bloc json, aucun chemin de fichier inutile.

SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe et fichiers d'identifiants gardés sur ce serveur sont un choix ASSUMÉ par l'utilisateur. Tu ne le commentes pas et ne recommandes rien à ce sujet. Une PANNE se dit toujours : un accès refusé qui t'empêche d'aboutir s'annonce en toutes lettres.`;

/** Le titre de la conversation ouverte pour un nouveau site. */
export function titreDeLAssistantBackup(description: string): string {
  const propre = (description ?? '').replace(/\s+/g, ' ').trim();
  const court = propre.length > 48 ? `${propre.slice(0, 47)}…` : propre;
  return `Backups — ${court || 'nouveau site'}`;
}

/** Ce que la recette doit porter, écrit une fois ici pour les deux demandes. */
function lignesDeLaRecette(): string[] {
  return [
    'CE QUE LA RECETTE DOIT PORTER (champ « recette ») :',
    '- explication : ce que tu as constaté sur le site, et pourquoi ces étapes',
    `- etapes : une par part du site — genre ${GENRES_D_ETAPE.map((g) => `« ${g} »`).join(', ')}, libelle, prendre, remettre, et octetsMin (le poids en dessous duquel l’étape est jugée vide)`,
    '- « prendre » écrit dans "$SORTIE", « remettre » relit "$ENTREE"',
    `- variables disponibles : ${VARIABLES_DE_RECETTE.map((v) => `$${v}`).join(', ')}`,
  ];
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT POUR UN NOUVEAU SITE. Elle porte la phrase de
 * l'utilisateur, le projet concerné quand il y en a un, et les valeurs que le
 * code accepte — écrites une fois ici plutôt que recopiées dans la consigne,
 * qui vieillirait à part.
 */
export function demandeDeConfiguration(entree: DemandeDeConfiguration): string {
  const description = (entree.description ?? '').trim().slice(0, DESCRIPTION_SITE_MAX);
  const projet = entree.projet;

  const lignes: string[] = [
    'ANALYSE UN SITE ET ÉCRIS SA RECETTE DE BACKUP, à partir de cette demande :',
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
    `- frequenceMinutes : tous les combien de MINUTES ce site est repris, entre ${FREQUENCE_MINUTES_MIN} et ${FREQUENCE_MINUTES_MAX}, ${FREQUENCE_MINUTES_PAR_DEFAUT} (une fois par jour) par défaut — 15 pour un quart d’heure, 60 pour une heure, 1440 pour un jour`,
    '- note : ce que ce site contient et qui l’exploite, en une phrase',
    '',
    ...lignesDeLaRecette(),
    '',
    'DÉROULÉ : lis ce que le serveur peut te dire, pose ensuite les questions qui restent (une par une), essaie ta recette avec « backup_essai » jusqu’à une archive complète, enregistre enfin la fiche et sa recette avec « backup_recette ».',
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

/* ------------------------------------------------------------------ */
/* Essayer les accès pour de vrai                                       */
/* ------------------------------------------------------------------ */

/** Ce qu'un essai d'accès rend : ce qui a été essayé, et ce qui a répondu. */
export interface EssaiDAcces {
  cible: 'base' | 'fichiers';
  /** `false` quand il n'y a rien à essayer (moteur « aucune », moyen « aucun »). */
  essaye: boolean;
  ok: boolean;
  detail: string;
}

/** Un essai est concluant quand rien de ce qui a été ESSAYÉ n'a échoué. */
export function essaisConcluants(essais: EssaiDAcces[]): boolean {
  return essais.every((essai) => !essai.essaye || essai.ok);
}

/**
 * CE QUE L'AGENT LIT APRÈS UN ESSAI. Un refus dit la cible ET la raison rendue
 * par la machine : « accès refusé pour l'utilisateur », « dossier introuvable ».
 * Sans la raison, l'agent redemanderait au hasard le mot de passe déjà bon.
 */
export function phraseDesEssais(essais: EssaiDAcces[]): string {
  const lignes = essais.map((essai) => {
    const quoi = essai.cible === 'base' ? 'la base' : 'les fichiers';
    if (!essai.essaye) return `- ${quoi} : rien à essayer (cette fiche n'en prend pas)`;
    return `- ${quoi} : ${essai.ok ? 'répond' : 'NE RÉPOND PAS'} — ${essai.detail}`;
  });
  return lignes.join('\n');
}

/* ------------------------------------------------------------------ */
/* Un projet de ce serveur qui n'a pas encore de fiche                  */
/* ------------------------------------------------------------------ */

/**
 * LA PHRASE DE DÉPART D'UN PROJET SANS SAUVEGARDE. La fenêtre propose ces
 * projets d'un clic : l'utilisateur n'a rien à écrire, le nom et le dossier sont
 * déjà connus du tableau.
 */
export function descriptionDuProjetSansFiche(projet: { nom: string; chemin?: string }): string {
  const nom = (projet.nom ?? '').trim() || 'ce projet';
  const chemin = (projet.chemin ?? '').trim();
  return chemin
    ? `Le projet « ${nom} » de ce serveur, dont le dossier est ${chemin}. Regarde ce dossier pour trouver son code, sa base et les fichiers à sauvegarder.`
    : `Le projet « ${nom} » de ce serveur.`;
}

/* ------------------------------------------------------------------ */
/* Reprendre un site déjà enregistré                                   */
/* ------------------------------------------------------------------ */

function titreCourt(nom: string, verbe: string): string {
  const propre = (nom ?? '').replace(/\s+/g, ' ').trim() || 'un site';
  return `Backups — ${verbe} ${propre.length > 40 ? `${propre.slice(0, 39)}…` : propre}`;
}

/** Le titre de la conversation ouverte pour réparer une fiche qui échoue. */
export function titreDeLaRelecture(nom: string): string {
  return titreCourt(nom, 'réparer');
}

/** Le titre de la conversation ouverte pour analyser un site déjà enregistré. */
export function titreDeLAnalyse(nom: string): string {
  return titreCourt(nom, 'analyser');
}

/**
 * L'ÉTIQUETTE DES CARTES D'AGENTS DE BACKUP. Chaque analyse, réparation ou
 * configuration d'un site a sa carte sur le tableau (`ouvrirCarteDAgent`) :
 * l'étiquette la distingue d'un travail de code au premier regard.
 */
export const LABEL_BACKUP = 'backup';

export type TravailDeBackup = 'configuration' | 'analyse' | 'reparation';

const NOMS_DU_TRAVAIL: Record<TravailDeBackup, string> = {
  configuration: 'Configuration backup',
  analyse: 'Analyse backup',
  reparation: 'Réparation backup',
};

/** Le titre de la CARTE d'un agent de backup : « Analyse backup : ProjetE ». */
export function titreDeCarteDeBackup(travail: TravailDeBackup, nom: string): string {
  const propre = (nom ?? '').replace(/\s+/g, ' ').trim() || 'nouveau site';
  return `${NOMS_DU_TRAVAIL[travail]} : ${propre.length > 60 ? `${propre.slice(0, 59)}…` : propre}`;
}

/** Ce que la carte d'un agent de backup dit d'elle-même, en deux phrases. */
export function descriptionDeCarteDeBackup(travail: TravailDeBackup, nom: string): string {
  const quoi =
    travail === 'configuration'
      ? `L’assistant lit le serveur de « ${nom} », pose ses questions et écrit la fiche de sauvegarde avec sa recette.`
      : travail === 'analyse'
        ? `L’agent relit « ${nom} » et lui écrit une vraie recette de sauvegarde, essayée avant d’être enregistrée.`
        : `La sauvegarde de « ${nom} » échoue : l’agent relit les messages de la machine et corrige la recette.`;
  return `${quoi}\n\nCarte ouverte par Beluga Build depuis la page Backups : aucun code n’y est livré, le compte rendu se lit dans sa conversation.`;
}

/**
 * CE QUE LA FICHE DIT, SANS SES MOTS DE PASSE. L'agent a besoin de savoir ce qui
 * est enregistré pour comprendre ce qui bloque ; il n'a aucun besoin de relire
 * les mots de passe dans sa demande — ils sont déjà en base, et l'outil les
 * conserve quand il ne les redit pas. La recette n'est dite que par ses
 * libellés : ses commandes se relisent en rejouant.
 */
export function resumeDeFiche(site: SiteASauvegarder): string {
  const lignes = [
    `- identifiant : ${site.id}`,
    `- nom : ${site.nom}`,
    `- base : ${LIBELLE_MOTEUR_BASE[site.base.moteur]}` +
      (site.base.moteur === 'aucune'
        ? ''
        : ` — nom « ${site.base.nom} », utilisateur « ${site.base.utilisateur} », hôte « ${
            site.base.hote || 'cette machine'
          } », port « ${site.base.port || 'celui du moteur'} »`),
    `- fichiers : ${LIBELLE_MOYEN_FICHIERS[site.fichiers.moyen]}` +
      (site.fichiers.moyen === 'aucun'
        ? ''
        : ` — dossier « ${site.fichiers.chemin} »` +
          (site.fichiers.moyen === 'local'
            ? ''
            : `, hôte « ${site.fichiers.hote} », utilisateur « ${site.fichiers.utilisateur} », port « ${
                site.fichiers.port || 'celui du protocole'
              } »`)),
    `- conservation : ${site.conservationJours} jours`,
    `- fréquence : ${phraseDeCadence(site.frequenceMinutes)} (${site.frequenceMinutes} min)`,
    site.recette?.etapes?.length
      ? `- recette écrite par l’agent :\n${phraseDeRecette(site.recette)
          .split('\n')
          .map((ligne) => `  ${ligne}`)
          .join('\n')}`
      : '- recette : aucune encore — celle déduite de la base et des fichiers tourne à sa place',
  ];
  return lignes.join('\n');
}

/**
 * LA DEMANDE ENVOYÉE POUR RÉPARER UNE FICHE. Elle porte la fiche telle qu'elle
 * est enregistrée et les DERNIERS ÉCHECS mot pour mot : c'est le message de la
 * machine qui dit si le mot de passe est refusé, si une étape n'a rien posé ou
 * si le dossier a disparu.
 */
export function demandeDeRelecture(entree: {
  site: SiteASauvegarder;
  echecs: PointDeSauvegarde[];
}): string {
  const derniers = entree.echecs.slice(0, 3);
  const lignes: string[] = [
    `LA SAUVEGARDE DE « ${entree.site.nom} » ÉCHOUE PLUSIEURS FOIS DE SUITE. Reprends sa fiche et sa recette, et corrige ce qui bloque.`,
    '',
    'CE QUI EST ENREGISTRÉ AUJOURD’HUI :',
    resumeDeFiche(entree.site),
    '',
    'CE QUE LA MACHINE A DIT :',
    ...(derniers.length
      ? derniers.map((point) => `- ${point.detail || 'échec sans détail'}`)
      : ['- aucun détail enregistré']),
    '',
    ...lignesDeLaRecette(),
    '',
    'DÉROULÉ : rejoue avec « backup_essai » (son identifiant et « rejouer ») pour VOIR ce qui bloque, cherche sur le serveur ce qui a changé (dossier déplacé, base renommée, conteneur recréé), corrige la fiche ou la recette, et ne demande à l’utilisateur avec « ask_user » que ce qui ne se trouve nulle part. Réenregistre ensuite la MÊME fiche avec « backup_recette » et son identifiant ci-dessus — ce que tu ne redis pas est conservé.',
  ];
  return lignes.join('\n');
}

/**
 * LA DEMANDE ENVOYÉE POUR ANALYSER UN SITE QUI N'ÉCHOUE PAS. Un site d'avant
 * les recettes tourne sur celle déduite de sa fiche ; l'analyse lui en écrit
 * une vraie — le code, les fichiers, chaque base, avec leur remise en place.
 */
export function demandeDAnalyse(site: SiteASauvegarder): string {
  return [
    `ANALYSE LE SITE « ${site.nom} » ET ÉCRIS SA RECETTE DE BACKUP. Ce site est déjà enregistré ; tu remplaces sa recette par une recette complète, que tu as vue marcher.`,
    '',
    'CE QUI EST ENREGISTRÉ AUJOURD’HUI :',
    resumeDeFiche(site),
    '',
    ...lignesDeLaRecette(),
    '',
    'DÉROULÉ : lis le site (son dossier, sa configuration, ses conteneurs, ses bases), rejoue la recette actuelle avec « backup_essai » et « rejouer » pour voir ce qu’elle prend, écris la tienne, essaie-la avec « backup_essai » jusqu’à une archive complète, puis réenregistre la MÊME fiche avec « backup_recette », son identifiant ci-dessus et ta recette.',
  ].join('\n');
}
