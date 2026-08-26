import path from 'node:path';
import { titreDuProcessus } from '@haikodev/shared';
import { CONFIG, ROOT, ensureDirs } from './config.js';
import { openDb } from './db.js';
import { log } from './logger.js';
import { ensureCredentials } from './auth.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';
import { bootstrapAccounts, prochaineTentativeQuota, refreshQuotas } from './accounts.js';
import {
  adopterLesCompetencesDuCoffre,
  preparerLeDepotDuPool,
  relierCompetencesAuxCoffres,
} from './competences.js';
import { bus } from './bus.js';
import { sampleCapacity } from './capacity.js';
import { startScheduler, startVeille, tick } from './scheduler.js';
import { recoverAfterRestart, cleanupMcpConfigs } from './runtime.js';
import { startDeploy } from './deploy.js';
import { ensureSelfProject, refreshGitInfo, adoptServerProjects } from './projects.js';
import { scheduleNightlyBackup } from './backup.js';
import { purgeOldArchives } from './files.js';
import { purgeOldAudio, scheduleDailyDigest } from './voice.js';
import { getSettings, listProjects } from './store.js';
import { iconeManquante, recupererFaviconEnTache, planifierRevisionFavicons } from './favicon.js';
import { listEngines } from './engines/index.js';
import { initPush } from './push.js';
import { amorcerFenetres } from './amorce.js';
import { envoyerAuCerveau } from './cerveau.js';
import { planifierAutoAmelioration } from './auto-amelioration.js';
import { planifierCapitalisation } from './capitalisation.js';
import { planifierRangementDesInstructions } from './instructions-en-attente.js';
import { arretParSignal, diffuserEtatDemon } from './demon.js';
import { PlanificateurEcheancesQuotas } from './quota-echeances.js';
import { surveillerRepriseDeCompte } from './reprise-compte.js';
import { demarrerSurveillance } from './surveillance.js';

/*
 * LE DÉMON NE S'APPELLE PLUS DU NOM DE SON FICHIER CONSTRUIT — ET UN SERVEUR
 * D'ESSAI NE S'APPELLE PLUS COMME LE DÉMON.
 *
 * Un agent qui nettoie ses propres essais avec `pkill -f "server/dist/main.js"`
 * visait sans le savoir le démon de production, dont la ligne de commande
 * portait exactement ce chemin. Le processus se donne donc un nom à lui, qui
 * garde « haikodev » pour rester reconnaissable dans `ps`. Second verrou après
 * la règle d'arrêt : celui-là tient même face à un `kill -9`, qu'aucun
 * programme ne peut retenir.
 *
 * Mais les scripts de contrôle lancent CE MÊME fichier sur une base à eux : ils
 * portaient donc le même nom, et le 14/08/2026 un `pkill -9 -f "haikodev-serveu"`
 * lancé pour un essai a coupé le démon. Le nom dépend maintenant de la base
 * servie : le démon seul s'appelle « haikodev-serveur », un essai s'appelle
 * « haikodev-essai-<port> ».
 */
process.title = titreDuProcessus({
  dossierDeDonnees: CONFIG.dataDir,
  dossierDeDonneesDuDemon: path.join(ROOT, 'data'),
  port: CONFIG.port,
  essaiDeclare: process.env.HAIKODEV_ESSAI === '1',
});

async function main(): Promise<void> {
  ensureDirs();
  openDb();

  const credentials = ensureCredentials();
  if (credentials) {
    log.info('════════════════════════════════════════════════');
    log.info(" ACCÈS HAIKODEV — à conserver, affiché une seule fois");
    log.info(`   identifiant : ${credentials.username}`);
    log.info(`   mot de passe : ${credentials.password}`);
    log.info('════════════════════════════════════════════════');
  }

  bootstrapAccounts();
  // Les compétences partagées entrent dans le coffre de chaque compte : c'est
  // là que le moteur va les chercher, et un coffre neuf n'en a aucune.
  // Le pool est son propre dépôt git : `data/` est écarté du dépôt du projet,
  // le pool serait donc hors sauvegarde alors qu'il devient la mémoire commune
  // de tous les projets. Pousser reste un geste de l'utilisateur.
  preparerLeDepotDuPool();
  // Le coffre personnel de l'utilisateur entre DANS le pool : quinze fiches y
  // vivaient sans qu'une seule, hors « compta », soit raccordée à quoi que ce
  // soit. Rien n'est copié ni déplacé — un lien, et la source reste la sienne.
  adopterLesCompetencesDuCoffre();
  relierCompetencesAuxCoffres();
  initPush();
  await ensureSelfProject();
  await adoptServerProjects();
  await refreshGitInfo();

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
  recoverAfterRestart((run, reprises) => {
    void startDeploy(run.projectId, { cible: run.cible, reprises });
  });
  cleanupMcpConfigs();
  purgeOldArchives();
  purgeOldAudio();

  const engines = await listEngines();
  for (const engine of engines) {
    log.info(`moteur ${engine.label} : ${engine.installed ? engine.version : 'absent'}`);
  }

  const server = createHttpServer();
  attachWebSocket(server);

  server.listen(CONFIG.port, CONFIG.host, () => {
    log.info(`HaikoDev ${CONFIG.version} écoute sur http://${CONFIG.host}:${CONFIG.port}`);
  });

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
  const capacityTimer = setInterval(() => {
    sampleCapacity();
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
  const backupTimer = scheduleNightlyBackup(() => getSettings().backupHour);
  const digestTimer = scheduleDailyDigest(() => getSettings().dailyDigestHour);
  const janitorTimer = setInterval(
    () => {
      purgeOldArchives();
      purgeOldAudio();
      void refreshGitInfo();
      // Le passage du cerveau se décide lui-même : il ne part qu'à l'heure
      // creuse, et une seule fois par jour.
      void envoyerAuCerveau();
    },
    60 * 60 * 1000,
  );

  // Au démarrage, on rattrape si le dernier envoi date de plus de vingt-quatre
  // heures — sans attendre la prochaine nuit.
  setTimeout(() => void envoyerAuCerveau({ auDemarrage: true }), 60_000);

  /*
   * Le rendez-vous d'auto-amélioration : chaque nuit vers 3 h, un agent
   * d'analyse cherche ce qui peut être amélioré et le PROPOSE, sans rien
   * modifier. Aucun rattrapage au démarrage, contrairement au cerveau : une
   * analyse complète lancée en pleine journée mangerait la réserve du jour,
   * ce qu'on veut précisément éviter.
   */
  const autoAmeliorationTimer = planifierAutoAmelioration();
  /*
   * LA CAPITALISATION : vers 5 h, APRÈS l'auto-amélioration de 3 h, un agent
   * d'analyse relit les cartes qui ont fait leurs preuves — contrôles rejoués,
   * passage en production, sept jours sans contradiction — et n'écrit dans le
   * pool de compétences que ce qui vient de la PLATEFORME, pas du seul code
   * d'un projet. Presque toutes les nuits, il n'a rien à faire et ne coûte rien.
   */
  const capitalisationTimer = planifierCapitalisation();
  /*
   * LE RANGEMENT DES INSTRUCTIONS : entre 2 h et 5 h, ce que les agents ont
   * déposé dans `docs/instructions-en-attente.md` rejoint le fichier de son
   * sujet, et seule une ligne de contrat rejoint `CLAUDE.md`. Le fichier
   * d'instructions ne bouge donc plus qu'une fois par nuit, au lieu de trente à
   * soixante fois par jour — chaque réécriture faisant repayer aux agents qui
   * démarrent ensuite les 73 000 jetons du fichier, au plein tarif.
   */
  const instructionsTimer = planifierRangementDesInstructions();
  const faviconTimer = planifierRevisionFavicons();

  sampleCapacity();
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
    clearInterval(backupTimer);
    clearInterval(digestTimer);
    clearInterval(janitorTimer);
    clearInterval(autoAmeliorationTimer);
    clearInterval(capitalisationTimer);
    clearInterval(instructionsTimer);
    clearInterval(faviconTimer);
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
