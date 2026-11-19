import { demarrerSecurite } from './service-securite.js';
import { menageQuotidienDesJournaux } from './menage-des-journaux.js';
import { demarrerLesVeilles } from './veille-de-carte.js';
import { demarrerLaSondeDeBlocage } from './sonde-de-blocage.js';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { titreDuProcessus } from '@beluga/shared';
import { CONFIG, ROOT, ensureDirs } from './config.js';
import { effacerProvisoiresOublies } from './envoi-piece-jointe.js';
import { dossiersDeLecture } from './pieces-jointes.js';
import { getDb, openDb } from './db.js';
import { ANCIEN_DOSSIER_PAR_DEFAUT, passerLeDossierAuxBackups } from './passage-backups.js';
import { log } from './logger.js';
import { ensureCredentials } from './auth.js';
import { chargerLIdentiteDInstallation, preparerLeCodeDInstallation } from './installation.js';
import { surveillerLesNouveautes } from './installation-copie.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';
import { bootstrapAccounts, prochaineTentativeQuota, refreshQuotas } from './accounts.js';
import { chargerLesMoteursAjoutes, rattraperLesCartesDesMoteurs } from './moteurs-ajoutes.js';
import { demarrerRelaisChat } from './engines/relais-chat.js';
import { semerAuDemarrage } from './semis-competences.js';
import {
  adopterLesCompetencesDuCoffre,
  preparerLeDepotDuPool,
  relierCompetencesAuxCoffres,
} from './competences.js';
import { brancherLesCompetencesSurLaMemoire } from './competences-memoire.js';
import { bus } from './bus.js';
import { sampleCapacity, fermerLesRestesDEssai } from './capacity.js';
import { startCard, startScheduler, startVeille, tick } from './scheduler.js';
import { recoverAfterRestart, cleanupMcpConfigs } from './runtime.js';
import { startDeploy } from './deploy.js';
import { archiverLesCartesEnLigneRestees } from './archive.js';
import { rattraperLesBranchesPerdues } from './rattrapage-branches-perdues.js';
import { reprendreLesRattrapages } from './rattrapage-ecartee.js';
import { poserLesVerrousDeLaMachine, verrouillerLesDistants } from './depot-public.js';
import { signalerLInstallation, surveillerLesTelechargements } from './relais-installations.js';
import { demarrerLaMesureDUsage } from './usage-installation.js';
import { ensureSelfProject, rangerLeProjetDeLOutilSiHebergee, detacherLeProjetDuDepotPublic, refreshGitInfo, adoptServerProjects } from './projects.js';
import { scheduleNightlyBackup } from './backup.js';
import { purgerCopiesDeProjetsSupprimes } from './copie-de-projet-supprime.js';
import { planifierLesBackups } from './backups.js';
import { purgeOldArchives } from './files.js';
import { purgeOldAudio, scheduleDailyDigest } from './voice.js';
import { ensureLocalGroup, getSettings, listProjects, saveSettings } from './store.js';
import { iconeManquante, recupererFaviconEnTache, planifierRevisionFavicons } from './favicon.js';
import { aChaqueCatalogue, listEngines } from './engines/index.js';
import { suivreLesModelesRetires } from './modeles-retires.js';
import { initPush } from './push.js';
import { brancherLAvancementDesCartes } from './espace-commandes.js';
import { amorcerFenetres } from './amorce.js';
import { planifierAutoAmelioration } from './auto-amelioration.js';
import { planifierLaVeilleDesCompetences } from './veille-competences.js';
import { veillerSurLesCartes } from './juge-des-cartes.js';
import { convertirLesDepotsAnnexes, rafraichirLesMeres, veillerSurLesMeres } from './regroupements.js';
import { planifierLesCourriels } from './courriels-clients.js';
import { planifierMenageDesCompetences } from './menage-competences.js';
import { planifierRangementDesInstructions } from './instructions-en-attente.js';
import { planifierLaMemoireDeNuit } from './memoire-de-nuit.js';
import { planifierLeMenage } from './menage.js';
import { planifierLeMiroirDesProjets } from './miroir-des-projets.js';
import { planifierLeRangementDesChemins } from './gestes-de-jarvis.js';
import { planifierPurgeDesArchives } from './coffre-fort.js';
import { planifierPurgeDeLaCorbeilleDesMedias } from './communication.js';
import { remettreLeCoffreEnOrdreAuDemarrage } from './coffre-structuration.js';
import { veillerSurLesTitresHumains } from './titres-humains.js';
import { veillerSurLaRelectureDeLaMemoire } from './relecture-memoire.js';
import { arreterLeVectoriseur } from './vectoriseur.js';
import { planifierCompactage } from './compactage.js';
import { planifierMiseAJourDesMoteurs } from './mise-a-jour-moteurs.js';
import { arretParSignal, diffuserEtatDemon } from './demon.js';
import { demarrerLaVeilleDesDecrochages } from './decrochages.js';
import { PlanificateurEcheancesQuotas } from './quota-echeances.js';
import { surveillerRepriseDeCompte } from './reprise-compte.js';
import { demarrerSurveillance, fermerNavigateur } from './surveillance.js';
import { demarrerTourneeDesServicesIa } from './services-ia-releve.js';
import { demarrerMarketing } from './marketing.js';
import { demarrerLeDirecteur } from './directeur-marketing.js';
import { demarrerPublicationSociale } from './publication-sociale.js';
import { demarrerLeSuiviStudio } from './suivi-studio.js';
import { demarrerLeRangementDesFichiers } from './fichiers-ranges.js';
import { rattraperLesPortsDesProjets } from './port-des-projets.js';
import { rattraperLesAdressesDeControle } from './rattrapage-adresses.js';
import { convertirLesSuppositionsDesCartes } from './questions-de-carte.js';
import { completerLesDemandesManquantes, relancerLesCadragesJamaisPartis } from './naissance-de-carte.js';
import { completerLesDemandesDesSuites } from './cahier-des-charges.js';
import { effacerTousLesDechiffrements, retenirLaCleDesCompetences } from './lot-competences-clients.js';
import { planifierLeDepotDuLot } from './depot-lot-competences.js';

/*
 * LE DÉMON NE S'APPELLE PLUS DU NOM DE SON FICHIER CONSTRUIT — ET UN SERVEUR
 * D'ESSAI NE S'APPELLE PLUS COMME LE DÉMON.
 *
 * Un agent qui nettoie ses propres essais avec `pkill -f "server/dist/main.js"`
 * visait sans le savoir le démon de production, dont la ligne de commande
 * portait exactement ce chemin. Le processus se donne donc un nom à lui, qui
 * garde « beluga » pour rester reconnaissable dans `ps`. Second verrou après
 * la règle d'arrêt : celui-là tient même face à un `kill -9`, qu'aucun
 * programme ne peut retenir.
 *
 * Mais les scripts de contrôle lancent CE MÊME fichier sur une base à eux : ils
 * portaient donc le même nom, et le 14/08/2026 un `pkill -9 -f "beluga-serveu"`
 * lancé pour un essai a coupé le démon. Le nom dépend maintenant de la base
 * servie : le démon seul s'appelle « beluga-serveur », un essai s'appelle
 * « beluga-essai-<port> ».
 */
process.title = titreDuProcessus({
  dossierDeDonnees: CONFIG.dataDir,
  dossierDeDonneesDuDemon: path.join(ROOT, 'data'),
  port: CONFIG.port,
  essaiDeclare: process.env.BELUGA_ESSAI === '1',
});

/*
 * LA CLÉ DES COMPÉTENCES PROTÉGÉES quitte l'environnement AVANT que quoi que ce
 * soit ne soit lancé (moteurs, terminal, scripts héritent de `process.env`), et
 * aucun contenu déchiffré d'un tour passé ne survit à un redémarrage ou une
 * panne (`server/src/lot-competences-clients.ts`).
 */
retenirLaCleDesCompetences();
// Un dossier par base servie : un démon d'essai n'efface jamais ce qu'un autre a ouvert.
process.env.BELUGA_DECHIFFREMENTS ||= path.join(
  os.tmpdir(),
  `beluga-competences-ouvertes-${createHash('sha256').update(CONFIG.dataDir).digest('hex').slice(0, 12)}`,
);
effacerTousLesDechiffrements();

/**
 * LE DOSSIER DES BACKUPS PASSE AU NOUVEAU NOM, au démarrage, juste après la
 * base (bloc éphémère, `passage-backups.ts`). Un incident ne retient jamais le
 * service : le réglage garde alors l'ancien chemin, et rien n'est perdu.
 */
function passerLeDossierDesBackups(): void {
  try {
    const regle = (getSettings().backupDossier ?? '').trim();
    const dossier = regle || path.join(CONFIG.dataDir, ANCIEN_DOSSIER_PAR_DEFAUT);
    const neuf = passerLeDossierAuxBackups(dossier, getDb(), (texte) => log.info(texte));
    if (neuf && regle) saveSettings({ backupDossier: neuf });
  } catch (err: any) {
    log.warn('dossier des backups : passage au nouveau nom impossible', err?.message ?? err);
  }
}

async function main(): Promise<void> {
  ensureDirs();
  openDb();
  passerLeDossierDesBackups();
  // Envois de pièces jointes coupés par un arrêt du démon : leurs provisoires partent.
  setImmediate(() => effacerProvisoiresOublies(dossiersDeLecture()));

  // L'identité de l'installation AVANT tout ce qui la lit (notifications,
  // courriels, création d'adresses) : `server/src/installation.ts`.
  chargerLIdentiteDInstallation();

  const credentials = ensureCredentials();
  /*
   * UNE INSTALLATION NEUVE ATTEND SON PROPRIÉTAIRE : le code d'installation est
   * tiré ici, et montré UNE fois. Qui l'a perdu en tire un neuf sur le serveur
   * (`node scripts/code-installation.mjs`).
   */
  const code = preparerLeCodeDInstallation();
  if (code) {
    log.info('════════════════════════════════════════════════');
    log.info(" CODE D'INSTALLATION — demandé à la première ouverture");
    log.info(`   ${code}`);
    log.info('════════════════════════════════════════════════');
  }
  if (credentials) {
    log.info('════════════════════════════════════════════════');
    log.info(" ACCÈS BELUGA — à conserver, affiché une seule fois");
    log.info(`   identifiant : ${credentials.username}`);
    log.info(`   mot de passe : ${credentials.password}`);
    log.info('════════════════════════════════════════════════');
  }

  // Les moteurs AJOUTÉS entrent au registre AVANT les comptes et le catalogue :
  // sans eux, leurs comptes passeraient pour des moteurs inconnus.
  chargerLesMoteursAjoutes();
  // Le relais « responses → chat » écoute AVANT le premier tour : sans lui, un
  // moteur ajouté au format chat (Gemini) refuse de partir.
  await demarrerRelaisChat().catch((err) => log.warn('relais des moteurs ajoutés (chat) indisponible', err?.message ?? err));
  bootstrapAccounts();
  // Les compétences partagées entrent dans le coffre de chaque compte : c'est
  // là que le moteur va les chercher, et un coffre neuf n'en a aucune.
  // Le pool est son propre dépôt git : `data/` est écarté du dépôt du projet,
  // le pool serait donc hors sauvegarde alors qu'il devient la mémoire commune
  // de tous les projets. Pousser reste un geste de l'utilisateur.
  void preparerLeDepotDuPool();
  // Une installation neuve reçoit les compétences publiées avec le code (`semis-competences.ts`).
  semerAuDemarrage();
  // Le coffre personnel de l'utilisateur entre DANS le pool : quinze fiches y
  // vivaient sans qu'une seule, hors « compta », soit raccordée à quoi que ce
  // soit. Rien n'est copié ni déplacé — un lien, et la source reste la sienne.
  adopterLesCompetencesDuCoffre();
  relierCompetencesAuxCoffres();
  // Chaque compétence est aussi une unité de la mémoire (classeur global) : la
  // recherche des agents la trouve. Premier passage maintenant, puis un passage
  // de fond ; déprécier son unité à l'écran Mémoire l'archive dans le pool.
  brancherLesCompetencesSurLaMemoire();
  initPush();
  // L'avancement d'une carte liée à une demande prévient les clients de celle-ci.
  brancherLAvancementDesCartes();
  /*
   * LE DÉPÔT PUBLIC NE REÇOIT RIEN D'ICI, DÈS LE PREMIER DÉMARRAGE — avant même
   * le premier compte, quand le projet de l'outil n'est pas encore inscrit
   * (`server/src/depot-public.ts`). Sans effet sur la machine de l'auteur.
   */
  poserLesVerrousDeLaMachine();
  await verrouillerLesDistants(CONFIG.selfPath);
  await ensureSelfProject();
  // Sur l'offre hébergée, un projet de l'outil déjà inscrit se range (rien n'est supprimé).
  rangerLeProjetDeLOutilSiHebergee();
  // Le dépôt public se lit, il ne reçoit jamais d'envoi depuis ce projet.
  await detacherLeProjetDuDepotPublic();
  // Les moteurs ajoutés avant les cartes d'ajout reçoivent la leur (projet Beluga Build).
  await rattraperLesCartesDesMoteurs();
  // Beluga vit dans son groupe « Local », créé ou repris ici (`shared/src/groupe-local.ts`).
  ensureLocalGroup();
  await adoptServerProjects();
  await refreshGitInfo();
  // Le dépôt public a-t-il du nouveau ? Regardé une fois par jour, jamais appliqué seul.
  surveillerLesNouveautes();
  // Le signe de vie quotidien vers l'équipe Beluga, et, chez elle, le relevé des téléchargements.
  signalerLInstallation();
  demarrerLaMesureDUsage();
  surveillerLesTelechargements();
  // Chez l'auteur : le lot de compétences des serveurs clients, refait et déposé au central la nuit.
  planifierLeDepotDuLot();

  // Les projets dont l'icône manque encore — jamais récupérée, ou fichier
  // disparu depuis : on la va chercher sans attendre un prochain changement
  // d'adresse. Un projet SANS adresse en fait partie : son icône se trouve
  // alors dans son dépôt (`server/src/favicon.ts`).
  for (const projet of listProjects(true)) {
    if (iconeManquante(projet)) recupererFaviconEnTache(projet);
  }

  // Reprise après redémarrage AVANT d'accepter des connexions : les agents
  // disparus repartent en file sans consommer de tentative, et une publication
  // coupée en plein vol est relancée depuis le début de son étape (comptes et
  // projets sont déjà chargés à ce point).
  //
  // ELLE NE PEUT PLUS EMPÊCHER LE SERVICE DE S'OUVRIR. Cette reprise parcourt
  // tout ce qui est en base ; une seule donnée refusée y jetait une exception
  // avant `listen`, et le service entier ne répondait plus — Caddy renvoyant un
  // 502 pendant que systemd rejouait la même erreur en boucle. Un ménage de
  // démarrage manqué laisse au pire des marques périmées, ce qui reste sans
  // commune mesure avec un service injoignable : on le dit, et on sert.
  try {
    recoverAfterRestart((run, reprises) => {
      void startDeploy(run.projectId, { cible: run.cible, reprises });
    });
  } catch (err: any) {
    log.error(
      'reprise après redémarrage incomplète : le service démarre quand même',
      err?.stack ?? err?.message ?? err,
    );
  }
  // Les veilles des dépanneurs de publication vivaient en mémoire : un redémarrage les effaçait et la publication
  // tombée ne reprenait jamais. On les recrée (`reprendreLesVeillesDeDepannage`).
  void import('./depannage-publication.js')
    .then(({ reprendreLesVeillesDeDepannage }) => {
      const reprises = reprendreLesVeillesDeDepannage();
      if (reprises) log.info(`${reprises} veille(s) de dépannage de publication reprise(s) au démarrage`);
    })
    .catch((err) => log.warn(`veilles de dépannage non reprises : ${err?.message ?? err}`));
  cleanupMcpConfigs();
  purgeOldArchives();
  purgeOldAudio();

  // Un modèle retiré par la mise à jour du moteur : les réglages mémorisés
  // passent à la version actuelle de sa famille dès le catalogue frais.
  aChaqueCatalogue((catalogue) => {
    suivreLesModelesRetires(catalogue);
  });
  const engines = await listEngines();
  for (const engine of engines) {
    log.info(`moteur ${engine.label} : ${engine.installed ? engine.version : 'absent'}`);
  }

  const server = createHttpServer();
  attachWebSocket(server);

  server.listen(CONFIG.port, CONFIG.host, () => {
    log.info(`Beluga Build ${CONFIG.version} écoute sur http://${CONFIG.host}:${CONFIG.port}`);
  });

  /*
   * LA PORTE D'ENTRÉE DES PROJETS D'AVANT LA RÈGLE (`port-des-projets.ts`) : le
   * port réellement servi de chaque projet sans port, enregistré avec lui. Dix
   * secondes après l'ouverture et sans être attendu — il lit sockets, vhosts et
   * unités, rien qui doive retarder la première réponse. Idempotent : un
   * redémarrage de plus ne touche aucun port déjà enregistré.
   */
  setTimeout(() => {
    void rattraperLesPortsDesProjets()
      .then(({ enregistres, laisses }) => {
        if (enregistres || laisses) log.info(`ports des projets : ${enregistres} enregistré(s), ${laisses} laissé(s) sans port`);
      })
      .catch((err) => log.warn('rattrapage des ports des projets incomplet', err));
  }, 10_000).unref?.();

  /*
   * LES SUPPOSITIONS DES CARTES ENCORE EN CADRAGE DEVIENNENT DES QUESTIONS
   * (`questions-de-carte.ts`) : sans agent ni quota, idempotent.
   */
  setTimeout(() => {
    try {
      const converties = convertirLesSuppositionsDesCartes();
      if (converties) log.info(`suppositions converties en questions sur ${converties} carte(s)`);
    } catch (err) {
      log.warn('conversion des suppositions en questions incomplète', err);
    }
  }, 10_000).unref?.();

  /*
   * LES ADRESSES DE CONTRÔLE DES PROJETS D'AVANT (`rattrapage-adresses.ts`) :
   * relevées le 30/09/2026, re-contrôlées puis écrites UNE fois, sans ouvrir
   * aucun suivi des visites. Même délai, sans être attendu.
   */
  setTimeout(() => {
    void rattraperLesAdressesDeControle().catch((err) => log.warn('rattrapage des adresses de contrôle incomplet', err));
  }, 10_000).unref?.();

  /* LA MISE EN PRODUCTION DES PROJETS DÉJÀ INITIALISÉS, rallumée une fois (`procedure-publication.ts`, 19/11/2026). */
  setTimeout(() => {
    void import('./procedure-publication.js')
      .then((m) => m.rallumerLaProductionDesProjetsInitialises())
      .catch((err) => log.warn('rattrapage de la mise en production des projets initialisés incomplet', err));
  }, 10_000).unref?.();

  /*
   * TOUTE CARTE PORTE SA DEMANDE (MEM-3555) : celles posées avant la règle la
   * reçoivent ici, texte seulement — aucun agent, aucun tour moteur.
   * Idempotent.
   */
  try {
    const completees = completerLesDemandesManquantes();
    if (completees) log.info(`demandes des cartes : ${completees} carte(s) complétée(s)`);
  } catch (err) {
    log.warn('complément des demandes de cartes impossible', err);
  }
  /*
   * LES CARTES DE CONSTRUCTION D'UN CAHIER DES CHARGES nées sans leur demande
   * (avant la règle) reçoivent le jalon « Demande » et le cahier joint — aucun
   * agent, aucun moteur. Idempotent.
   */
  void completerLesDemandesDesSuites()
    .then((n) => {
      if (n) log.info(`cartes de construction : ${n} demande(s) écrite(s) avec leur cahier des charges`);
    })
    .catch((err) => log.warn('complément des demandes des cartes de construction impossible', err));
  /*
   * LE FILET DES CADRAGES JAMAIS PARTIS : une carte dont l'agent de cadrage est
   * né sans jamais recevoir son premier tour (panne, ancienne règle) le reçoit,
   * une carte après l'autre, jusqu'à la compréhension seulement. Trente
   * secondes après le démarrage, une fois les tours d'avant repris.
   */
  setTimeout(() => {
    try {
      const relances = relancerLesCadragesJamaisPartis();
      if (relances) log.info(`cadrages jamais partis : ${relances} carte(s) remise(s) en route`);
    } catch (err) {
      log.warn('relance des cadrages jamais partis impossible', err);
    }
  }, 30_000).unref?.();

  // Boucles de fond
  const scheduler = startScheduler();
  /*
   * LE FILET A SON PROPRE MINUTEUR, à côté de l'ordonnanceur et jamais dedans :
   * une boucle d'ordonnancement pendue ne doit pas emporter avec elle ce qui
   * referme les agents bloqués (`shared/src/veille-du-demon.ts`).
   */
  const veille = startVeille();
  const quotaEcheances = new PlanificateurEcheancesQuotas({
    lire: (comptes) => refreshQuotas(true, comptes),
    diffuser: (quotas) => bus.emit({ type: 'quotas', quotas }),
    prochaineTentative: prochaineTentativeQuota,
    signalerErreur: (erreur) => log.warn('actualisation du quota à son échéance impossible', erreur),
    apresLectureFraiche: async () => {
      // Le relevé frais libère immédiatement les cartes qui attendaient ce
      // quota ; elles n'ont pas à patienter jusqu'au prochain tour de 15 s.
      await tick();
      void amorcerFenetres();
    },
  });
  // Toute lecture de quota (échéance, bouton, connexion ou boucle de sécurité)
  // redonne ses nouvelles échéances au même planificateur central.
  const suivreEcheances = bus.subscribe((evenement) => {
    if (evenement.type === 'quotas') quotaEcheances.actualiser(evenement.quotas);
  });
  // Un travail coupé par une limite attend peut-être qu'un compte se libère :
  // le même flux de quotas le lui dit, sans boucle en plus.
  const suivreReprises = surveillerRepriseDeCompte();
  let passagesDeCapacite = 0;
  const capacityTimer = setInterval(() => {
    sampleCapacity();
    // Toutes les cinq minutes : les serveurs d'essai laissés par une carte qui ne travaille plus.
    passagesDeCapacite += 1;
    if (passagesDeCapacite % 10 === 0) {
      try {
        fermerLesRestesDEssai();
      } catch (err) {
        log.warn('ménage des restes d’essai impossible', err);
      }
    }
    // Le même rythme sert à dire si le démon tourne encore sur du code périmé :
    // quelques lectures de dates de fichiers, rien de plus.
    diffuserEtatDemon();
  }, 30_000);
  // Toutes les dix minutes : assez pour suivre la consommation, assez peu pour
  // ne pas se faire refuser les lectures par excès d'appels.
  const quotaTimer = setInterval(() => {
    void refreshQuotas(true).then((quotas) => {
      bus.emit({ type: 'quotas', quotas });
      // Juste après la lecture : les chiffres sont frais, et on n'ajoute aucun
      // appel à l'API de quota, qui limite fortement sa fréquence.
      void amorcerFenetres();
    });
  }, 600_000);
  /*
   * La surveillance des sites : un battement de cinq minutes qui n'appelle que
   * les adresses DUES (une heure). Elle vit à côté des autres minuteurs et
   * s'arrête avec eux (`server/src/surveillance.ts`).
   */
  const surveillanceTimer = demarrerSurveillance();
  /*
   * LE SERVICE SÉCURITÉ : une tournée horaire qui lance l'audit des projets suivis DUS (sept jours après le dernier) et
   * range les audits de plus de douze mois. Sans agent ni quota (`server/src/service-securite.ts`).
   */
  const securiteTimer = demarrerSecurite();
  void import('./belugapass.js').then((m) => m.nettoyerLesLectures()).catch(() => {});
  /*
   * LES SOLDES DES SERVICES D'IA (OpenRouter, kie.ai, HeyGen, Agentik…) : une tournée de 30 min, à part du
   * relevé des moteurs et jamais sur le chemin d'un lancement. Elle allume le point orange du pied de
   * colonne et prévient quand un service tombe à sec (`server/src/services-ia-releve.ts`).
   */
  const servicesIaTimer = demarrerTourneeDesServicesIa();
  /*
   * LES VEILLES DE CARTE : un battement d'une minute qui rejoue, sans moteur
   * ni quota, les contrôles DUS des cartes en attente d'un tiers. Au
   * redémarrage, chaque veille reprend d'après son prochain passage relu en
   * base (`server/src/veille-de-carte.ts`).
   */
  const veillesTimer = demarrerLesVeilles();
  /*
   * L'atelier marketing : le rangement des vieux passages (90 jours) et le
   * plan de la semaine du dimanche soir (`server/src/marketing.ts`).
   */
  const marketingTimer = demarrerMarketing();
  const directeurTimer = demarrerLeDirecteur();
  /*
   * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX : les contenus programmés qui
   * visent des comptes reliés partent à l'heure prévue, les accès se
   * renouvellent, les commentaires et messages se relèvent
   * (`server/src/publication-sociale.ts`).
   */
  const publicationSocialeTimer = demarrerPublicationSociale();
  /* Les vidéos demandées par un agent : leur bloc de suivi et les miroirs des boutons à prix (`suivi-studio.ts`). */
  demarrerLeSuiviStudio();
  /* LES FICHIERS RANGÉS PAR PROJET ET PAR SERVICE : pièces neuves rangées au dépôt, rangement complet toutes les 30 min. */
  demarrerLeRangementDesFichiers();
  /*
   * LE STUDIO : un export resté « en cours » a été coupé par l'arrêt du démon.
   * Il le DIT au démarrage, au lieu de rester affiché comme s'il tournait.
   */
  void import('./studio-rendu.js')
    .then((m) => m.rattraperExportsCoupes())
    .catch((err) => log.warn('studio : rattrapage des exports coupés impossible', err));
  /* …et une fabrication de voix finales coupée de même ne reste pas affichée « en cours ». */
  void import('./studio-generation.js')
    .then((m) => m.rattraperVoixCoupees())
    .catch((err) => log.warn('studio : rattrapage des voix coupées impossible', err));
  /* …et une carte dont le film se lit déjà passe au Montage (15/11/2026, « le travail fait avance la carte »). */
  void import('./studio.js')
    .then((m) => m.rattraperLesFilmsMontes())
    .catch((err) => log.warn('studio : rattrapage des films montés impossible', err));
  /* …ni un personnage 3D dont la fabrication a été coupée par le redémarrage. */
  void Promise.all([import('./studio-3d.js'), import('./studio.js')])
    .then(([m, s]) => m.rattraperLesPersonnages3dCoupes(s.depensesValideesDeGenre('modele3d')))
    .catch((err) => log.warn('studio : rattrapage des personnages 3D coupés impossible', err));
  /* LES EXTRAITS DES VOIX FINALES SONT PRÊTS D'AVANCE : ceux qui manquent se fabriquent une fois, l'un après l'autre,
     deux minutes après le démarrage — l'écoute d'une voix ne fait plus attendre (`preparerLesExtraitsManquants`). */
  setTimeout(() => {
    void import('./studio-generation.js')
      .then((m) => m.preparerLesExtraitsManquants())
      .catch((err) => log.warn('studio : préparation des extraits de voix impossible', err));
  }, 120_000).unref();
  /* LES MÉDIAS VALIDÉS ABSENTS DE LEUR PISTE (capture #ae82) s'y posent, une minute après le démarrage (`rattraperLesValidesDuMontage`). */
  setTimeout(() => {
    void import('./studio-montage-de-carte.js')
      .then((m) => m.rattraperLesValidesDuMontage())
      .then((n) => n && log.info(`montage : ${n} média(s) validé(s) posé(s) sur leur piste`))
      .catch((err) => log.warn('montage : rattrapage des médias validés impossible', err));
  }, 60_000).unref();
  /* LES ARCHIVES DU STUDIO, une seule fois : ses vidéos rangées dans une carte « Archivé » (`server/src/archives-du-studio.ts`). */
  setTimeout(() => {
    void import('./archives-du-studio.js')
      .then((m) => m.rangerLesArchivesDuStudio())
      .catch((err) => log.warn('archives du Studio impossibles', err));
  }, 40_000).unref();
  const backupTimer = scheduleNightlyBackup(() => getSettings().backupHour);
  const digestTimer = scheduleDailyDigest(() => getSettings().dailyDigestHour);
  // L'agent de l'assistant porte le titre « Assistant <nom> » : un agent créé avant le réglage du nom est renommé.
  void import('./assistant-global.js').then((m) => m.retitrerLAssistant()).catch(() => undefined);
  // Les backups des sites en production : leur propre heure, après celle de
  // la sauvegarde du démon, et rien tant qu'aucun dossier de stockage n'est réglé.
  const backupsSitesTimer = planifierLesBackups();
  /*
   * LES CARTES ÉCARTÉES D'UNE PUBLICATION SE RÉPARENT APRÈS (DEC-255) : leur
   * rattrapage est écrit sur la publication, repris ici au démarrage — c'est
   * le redémarrage qui suit la publication de Beluga elle-même — puis toutes
   * les deux minutes, pour ce qui attendait un quota
   * (`server/src/rattrapage-ecartee.ts`).
   */
  setTimeout(() => void reprendreLesRattrapages(), 30_000).unref?.();
  // Les cartes mises en ligne restées en « À déployer » rejoignent « Archivé » (`archive.ts`).
  setTimeout(
    () => void archiverLesCartesEnLigneRestees().catch((err) => log.warn('rangement des cartes en ligne restées', err)),
    30_000,
  ).unref?.();
  // Les cartes archivées qui avaient perdu le nom de leur branche le retrouvent (`rattrapage-branches-perdues.ts`).
  setTimeout(
    () => void rattraperLesBranchesPerdues().catch((err) => log.warn('rattrapage des branches perdues', err)),
    45_000,
  ).unref?.();
  const rattrapageTimer = setInterval(() => void reprendreLesRattrapages(), 120_000);
  // Premier passage différé de 15 min, hors de la fenêtre du démarrage (rendu de la mémoire,
  // vecteurs, rattrapages) : à +2 min, sa lecture à froid figeait le démon ~5 s (18/11/2026).
  // La boucle horaire le rattrape ensuite : un jour n'est jamais sauté.
  setTimeout(() => void menageQuotidienDesJournaux(), 15 * 60_000).unref?.();
  const janitorTimer = setInterval(
    () => {
      purgeOldArchives();
      purgeOldAudio();
      void refreshGitInfo();
      // Les copies de secours des projets supprimés vivent 15 jours (`copie-de-projet-supprime.ts`).
      void purgerCopiesDeProjetsSupprimes().catch((err) => log.warn('purge des copies de projets supprimés', err));
      // Le texte des vieux journaux de cartes et les traces du juge de plus de 7 jours : une passe par jour.
      void menageQuotidienDesJournaux();
      // Le récapitulatif des commentaires des clients sur les documents (Charte graphique) : une fois par jour, s'il y a du nouveau.
      void import('./plaquettes.js')
        .then((pl) => pl.envoyerLeRecapDesCommentaires())
        .catch((err) => log.warn('récapitulatif des commentaires', err));
    },
    60 * 60 * 1000,
  );

  /*
   * Le rendez-vous d'auto-amélioration : chaque nuit vers 3 h, un agent
   * d'analyse cherche ce qui peut être amélioré et le PROPOSE, sans rien
   * modifier. Aucun rattrapage au démarrage : une analyse complète lancée en
   * pleine journée mangerait la réserve du jour,
   * ce qu'on veut précisément éviter.
   */
  const autoAmeliorationTimer = planifierAutoAmelioration();
  // La veille des sources de compétences : une fois par semaine, dimanche vers 1 h,
  // un agent d'analyse cherche sur GitHub et le web et PROPOSE, sans rien importer.
  const veilleDesCompetencesTimer = planifierLaVeilleDesCompetences();
  /*
   * LES DÉCROCHAGES DU SERVEUR : le démarrage est noté, le surveillant remis à
   * jour depuis le dépôt, et une enquête s'ouvre seule quand ils se répètent
   * (`decrochages.ts`).
   */
  const decrochagesTimer = demarrerLaVeilleDesDecrochages();
  // Les deux courriels : le point du matin à Haiko, celui du lundi aux clients.
  const recapitulatifTimer = planifierLesCourriels();
  /*
   * LA CAPITALISATION : vers 5 h, APRÈS l'auto-amélioration de 3 h, un agent
   * d'analyse relit les cartes qui ont fait leurs preuves — contrôles rejoués,
   * passage en production, sept jours sans contradiction — et n'écrit dans le
   * pool de compétences que ce qui vient de la PLATEFORME, pas du seul code
   * d'un projet. Presque toutes les nuits, il n'a rien à faire et ne coûte rien.
   */
  const menageDesCompetencesTimer = planifierMenageDesCompetences();
  /*
   * LE COMPACTAGE DE LA BASE : vers 4 h, entre l'auto-amélioration et le
   * ménage des compétences. Les pages libérées par les purges (messages, cartes
   * effacées, migrations) ne sont jamais rendues au disque par les VACUUM
   * INTO existants, qui écrivent tous une copie séparée. Un VACUUM classique
   * ne part que si aucune publication ni aucun agent ne travaille, et
   * seulement si les pages libres dépassent 100 Mo — il se saute et se
   * reporte sinon, sans jamais bloquer.
   */
  const compactageTimer = planifierCompactage();
  /*
   * LE RANGEMENT DES INSTRUCTIONS : entre 2 h et 5 h, ce que les agents ont
   * déposé dans `docs/instructions-en-attente.md` rejoint le fichier de son
   * sujet, et seule une ligne de contrat rejoint `CLAUDE.md`. Le fichier
   * d'instructions ne bouge donc plus qu'une fois par nuit, au lieu de trente à
   * soixante fois par jour — chaque réécriture faisant repayer aux agents qui
   * démarrent ensuite les 73 000 jetons du fichier, au plein tarif.
   */
  const instructionsTimer = planifierRangementDesInstructions();
  /*
   * LA MÉMOIRE EN CLASSEURS : reprise de l'ancien arbre une minute après le
   * premier démarrage (une seule fois), puis chaque nuit entre 2 h et 5 h les
   * vecteurs manquants et les doublons proposés (`server/src/memoire-de-nuit.ts`).
   */
  const memoireTimers = planifierLaMemoireDeNuit();
  /*
   * LE MÉNAGE DU DISQUE, chaque nuit : temporaires, caches d'outils, restes de
   * construction, emplacements de copies refermées et branches de tâche dont le
   * travail est déjà ailleurs. Les projets vivent maintenant sur le disque de la
   * machine : ce qui s'accumule se paie (`server/src/menage.ts`). Le tout
   * premier passage se fait À BLANC.
   */
  const menageTimer = planifierLeMenage();
  /*
   * LE MIROIR DES PROJETS : les dossiers vivent maintenant sur le disque de la
   * machine, donc plus « hors machine » comme ils l'étaient sur le stockage
   * distant. Chaque nuit, chacun y est recopié, sans ce qui se réinstalle
   * (`server/src/miroir-des-projets.ts`).
   */
  const miroirTimer = planifierLeMiroirDesProjets();
  // Les chemins réussis de Jarvis à l'écran se rangent chaque nuit en compétences (`server/src/gestes-de-jarvis.ts`).
  const cheminsDeJarvisTimer = planifierLeRangementDesChemins();
  // Les fiches du coffre retirées depuis plus de six mois s'effacent (`server/src/coffre-fort.ts`).
  const archivesTimers = planifierPurgeDesArchives();
  // Les gestes répétés dans Chrome partent à leur échéance, ou au retour de Chrome (`server/src/extension-chrome.ts`).
  void import('./extension-chrome.js').then((m) => m.planifierLesRoutines()).catch(() => {});
  // L'audit SEO + GEO du Marketing : contrôle technique hebdomadaire, test des IA mensuel (`server/src/referencement.ts`).
  // Les médias de Communication restés 30 jours à la corbeille s'effacent (`server/src/communication.ts`).
  const corbeilleDesMediasTimers = planifierPurgeDeLaCorbeilleDesMedias();
  // La remise en ordre des fiches (chaque valeur dans sa case), UNE fois, après une copie sur le disque de stockage.
  remettreLeCoffreEnOrdreAuDemarrage();
  // Les unités de mémoire sans titre clair en reçoivent un, par lots, en tâche de fond (`server/src/titres-humains.ts`).
  const arreterLesTitresHumains = veillerSurLesTitresHumains();
  // Les unités peu sûres sont relues par le système, jamais « confirmées » à la main (`server/src/relecture-memoire.ts`).
  const arreterLaRelecture = veillerSurLaRelectureDeLaMemoire();
  const faviconTimer = planifierRevisionFavicons();
  /*
   * L'OUTIL DE CHAQUE MOTEUR (Claude, Codex, Cursor) SE TIENT À JOUR TOUT
   * SEUL, une fois par jour, sans jamais toucher à celui qu'un agent utilise
   * en ce moment (`server/src/mise-a-jour-moteurs.ts`). Sans ce passage, un
   * modèle tout juste sorti reste injoignable jusqu'à ce que quelqu'un pense
   * à relancer la commande à la main — ce qui vient d'arriver avec Opus 5.5
   * le 22.09.2026.
   */
  const miseAJourMoteursTimer = planifierMiseAJourDesMoteurs();
  /*
   * LE JUGE RAPIDE, branché sur les cartes qui passent : sa description est-elle
   * assez fournie pour travailler, et quel effort la carte demande. Tant
   * qu'aucune clé n'est rangée au coffre-fort, ce guetteur n'émet RIEN — il ne
   * fait qu'écouter (`server/src/juge-des-cartes.ts`).
   */
  const arreterLeJuge = veillerSurLesCartes();
  // Qui fige le démon ? Le fil principal bat, un gardien relève la pile d'un blocage (`sonde-de-blocage.ts`).
  const arreterLaSonde = demarrerLaSondeDeBlocage();
  /*
   * LES PROJETS RÉUNIS : les cartes mères suivent leurs filles, et les anciens
   * projets à dépôts annexes deviennent des regroupements, une fois
   * (`server/src/regroupements.ts`).
   */
  /* Les suites d'étapes lancent chaque étape par le chemin ordinaire (`startCard`). */
  const arreterLesMeres = veillerSurLesMeres(startCard);
  try {
    convertirLesDepotsAnnexes();
  } catch (err) {
    log.error('conversion des dépôts annexes en projets réunis', err);
  }
  try {
    rafraichirLesMeres();
  } catch (err) {
    log.error('relevé des cartes mères au démarrage', err);
  }

  sampleCapacity();
  // La page « Serveur » : historique horaire des disques, et relevé des plus
  // lourds en arrière-plan (jamais sur l'offre hébergée ni sur un démon d'essai).
  void import('./occupation-disque.js')
    .then(({ demarrerLeSuiviDesDisques }) => demarrerLeSuiviDesDisques())
    .catch((err) => log.error('suivi des disques', err));
  void refreshQuotas(true).then((quotas) => {
    bus.emit({ type: 'quotas', quotas });
    void amorcerFenetres();
  });

  const shutdown = (signal: string) => {
    /*
     * Un signal venu du dehors ne passe PAS outre la règle : tant qu'une
     * publication ou un agent travaille, l'arrêt est retenu et rejoué tout seul
     * à la fin du dernier travail. Sans cela, un simple `pkill -f` visant les
     * processus d'essai d'un agent coupait le démon de production, et avec lui
     * toutes les tâches en vol (14/08/2026).
     */
    if (!arretParSignal(signal)) return;
    log.info(`arrêt demandé (${signal})`);
    clearInterval(scheduler);
    clearInterval(veille);
    clearInterval(capacityTimer);
    clearInterval(quotaTimer);
    quotaEcheances.arreter();
    suivreEcheances();
    suivreReprises();
    clearInterval(surveillanceTimer);
    clearInterval(securiteTimer);
    clearInterval(servicesIaTimer);
    clearInterval(veillesTimer);
    clearInterval(marketingTimer);
    clearInterval(directeurTimer);
    if (publicationSocialeTimer) clearInterval(publicationSocialeTimer);
    void fermerNavigateur();
    clearInterval(backupTimer);
    clearInterval(digestTimer);
    clearInterval(backupsSitesTimer);
    clearInterval(janitorTimer);
    clearInterval(rattrapageTimer);
    clearInterval(autoAmeliorationTimer);
    clearInterval(veilleDesCompetencesTimer);
    if (decrochagesTimer) clearInterval(decrochagesTimer);
    clearInterval(recapitulatifTimer);
    clearInterval(menageDesCompetencesTimer);
    clearInterval(compactageTimer);
    clearInterval(instructionsTimer);
    clearInterval(menageTimer);
    clearInterval(miroirTimer);
    clearInterval(cheminsDeJarvisTimer);
    for (const minuteur of memoireTimers) clearTimeout(minuteur);
    for (const minuteur of archivesTimers) clearTimeout(minuteur);
    for (const minuteur of corbeilleDesMediasTimers) clearTimeout(minuteur);
    arreterLesTitresHumains();
    arreterLaRelecture();
    arreterLeVectoriseur();
    clearInterval(faviconTimer);
    clearInterval(miseAJourMoteursTimer);
    arreterLeJuge();
    arreterLaSonde();
    arreterLesMeres();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('promesse rejetée', err));
  process.on('uncaughtException', (err) => log.error('exception non rattrapée', err));
}

main().catch((err) => {
  log.error('démarrage impossible', err);
  process.exit(1);
});
