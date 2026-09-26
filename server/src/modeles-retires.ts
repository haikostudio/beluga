import { EngineInfo, migrationDeReglage } from '@beluga/shared';
import { bus } from './bus.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * LES RÉGLAGES MÉMORISÉS SUIVENT LA VERSION ACTUELLE DE LEUR FAMILLE.
 *
 * Les moteurs se mettent à jour seuls chaque nuit (`mise-a-jour-moteurs.ts`) et
 * leur catalogue ne garde que la version la plus récente de chaque famille. Un
 * réglage retenu hier — défaut d'un projet, réglage de cadrage, carte encore
 * planifiée — nommait alors un modèle qui n'est plus au menu : le configurateur
 * affichait l'identifiant brut et invitait à re-choisir.
 *
 * On réécrit donc, au premier catalogue frais qui ne le connaît plus, ce qui
 * SERVIRA : même famille, version actuelle, réflexion gardée si elle existe
 * encore (`migrationDeReglage`). Jamais sur une liste de secours (`live`
 * faux) : un catalogue non lu ne prouve pas qu'un modèle a disparu. Jamais
 * l'historique : les cartes lancées, terminées ou rangées et les agents gardent
 * ce qui a réellement servi. Ce n'est pas un choix réécrit au sens de DEC-213 :
 * la famille voulue reste, seule la version retirée change.
 */
export function suivreLesModelesRetires(engines: EngineInfo[]): number {
  let changes = 0;
  const moteur = (id: string | undefined) => engines.find((entry) => entry.id === id);

  const settings = store.getSettings();
  const cadrage = migrationDeReglage(moteur(settings.cadrageEngine), settings.cadrageModel, settings.cadrageThinking);
  if (cadrage) {
    const maj = store.saveSettings({ cadrageModel: cadrage.model, cadrageThinking: cadrage.thinking ?? settings.cadrageThinking });
    bus.emit({ type: 'settings', settings: maj });
    changes++;
  }

  for (const project of store.listProjects(true)) {
    const defaut = migrationDeReglage(
      moteur(project.defaultEngine ?? 'claude'),
      project.defaultModel,
      project.defaultThinking,
    );
    if (defaut) {
      const maj = store.saveProject({
        ...project,
        defaultModel: defaut.model,
        defaultThinking: defaut.thinking ?? project.defaultThinking,
      });
      bus.emit({ type: 'project.upsert', project: maj });
      changes++;
    }

    for (const card of store.listCardsInColumn(project.id, 'planned')) {
      if (!card.run) continue;
      const suite = migrationDeReglage(moteur(card.run.engine), card.run.model, card.run.thinking);
      if (!suite) continue;
      const maj = store.saveCard({
        ...card,
        run: { ...card.run, model: suite.model, thinking: suite.thinking ?? card.run.thinking },
      });
      bus.emit({ type: 'card.upsert', card: maj });
      changes++;
    }
  }

  if (changes) log.info(`modèles retirés : ${changes} réglage(s) passé(s) à la version actuelle de leur famille`);
  return changes;
}
