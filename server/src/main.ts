import { CONFIG, ensureDirs } from './config.js';
import { openDb } from './db.js';
import { log } from './logger.js';
import { ensureCredentials } from './auth.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';
import { bootstrapAccounts, prochaineTentativeQuota, refreshQuotas } from './accounts.js';
import { relierCompetencesAuxCoffres } from './competences.js';
import { bus } from './bus.js';
import { sampleCapacity } from './capacity.js';
import { startScheduler, tick } from './scheduler.js';
import { recoverAfterRestart, cleanupMcpConfigs } from './runtime.js';
import { startDeploy } from './deploy.js';
import { ensureSelfProject, refreshGitInfo, adoptServerProjects } from './projects.js';
import { scheduleNightlyBackup } from './backup.js';
import { purgeOldArchives } from './files.js';
import { purgeOldAudio, scheduleDailyDigest } from './voice.js';
import { getSettings, listProjects } from './store.js';
import { recupererFaviconEnTache, planifierRevisionFavicons } from './favicon.js';
import { listEngines } from './engines/index.js';
import { initPush } from './push.js';
import { amorcerFenetres } from './amorce.js';
import { envoyerAuCerveau } from './cerveau.js';
import { planifierAutoAmelioration } from './auto-amelioration.js';
import { diffuserEtatDemon } from './demon.js';
import { PlanificateurEcheancesQuotas } from './quota-echeances.js';
import { surveillerRepriseDeCompte } from './reprise-compte.js';

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
  relierCompetencesAuxCoffres();
  initPush();
  await ensureSelfProject();
  await adoptServerProjects();
  await refreshGitInfo();

  // Les projets déjà inscrits, mais dont l'icône n'a jamais été récupérée
  // (déploiement d'avant cette version) : on la va chercher sans attendre un
  // prochain changement d'adresse.
  for (const projet of listProjects(true)) {
    if (projet.devUrl?.trim() && !projet.favicon) recupererFaviconEnTache(projet);
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
  const faviconTimer = planifierRevisionFavicons();

  sampleCapacity();
  void refreshQuotas(true).then((quotas) => {
    bus.emit({ type: 'quotas', quotas });
    void amorcerFenetres();
  });

  const shutdown = (signal: string) => {
    log.info(`arrêt demandé (${signal})`);
    clearInterval(scheduler);
    clearInterval(capacityTimer);
    clearInterval(quotaTimer);
    quotaEcheances.arreter();
    suivreEcheances();
    suivreReprises();
    clearInterval(backupTimer);
    clearInterval(digestTimer);
    clearInterval(janitorTimer);
    clearInterval(autoAmeliorationTimer);
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
