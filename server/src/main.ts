import { CONFIG, ensureDirs } from './config.js';
import { openDb } from './db.js';
import { log } from './logger.js';
import { ensureCredentials } from './auth.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';
import { bootstrapAccounts, refreshQuotas } from './accounts.js';
import { bus } from './bus.js';
import { sampleCapacity } from './capacity.js';
import { startScheduler } from './scheduler.js';
import { recoverAfterRestart, cleanupMcpConfigs } from './runtime.js';
import { ensureSelfProject, refreshGitInfo, adoptServerProjects } from './projects.js';
import { scheduleNightlyBackup } from './backup.js';
import { purgeOldArchives } from './files.js';
import { purgeOldAudio, scheduleDailyDigest } from './voice.js';
import { getSettings } from './store.js';
import { listEngines } from './engines/index.js';
import { initPush } from './push.js';

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
  initPush();
  await ensureSelfProject();
  await adoptServerProjects();
  await refreshGitInfo();

  // Reprise après redémarrage AVANT d'accepter des connexions : les agents
  // disparus repartent en file sans consommer de tentative.
  recoverAfterRestart();
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
  const capacityTimer = setInterval(sampleCapacity, 30_000);
  // Toutes les dix minutes : assez pour suivre la consommation, assez peu pour
  // ne pas se faire refuser les lectures par excès d'appels.
  const quotaTimer = setInterval(() => {
    void refreshQuotas(true).then((quotas) => bus.emit({ type: 'quotas', quotas }));
  }, 600_000);
  const backupTimer = scheduleNightlyBackup(() => getSettings().backupHour);
  const digestTimer = scheduleDailyDigest(() => getSettings().dailyDigestHour);
  const janitorTimer = setInterval(
    () => {
      purgeOldArchives();
      purgeOldAudio();
      void refreshGitInfo();
    },
    60 * 60 * 1000,
  );

  sampleCapacity();
  void refreshQuotas(true).then((quotas) => bus.emit({ type: 'quotas', quotas }));

  const shutdown = (signal: string) => {
    log.info(`arrêt demandé (${signal})`);
    clearInterval(scheduler);
    clearInterval(capacityTimer);
    clearInterval(quotaTimer);
    clearInterval(backupTimer);
    clearInterval(digestTimer);
    clearInterval(janitorTimer);
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
