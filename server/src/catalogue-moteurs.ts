import { MoteurCatalogue } from '@haikodev/shared';
import { listEngines } from './engines/index.js';
import { cachedQuotas, listAccountRecords } from './accounts.js';

/**
 * Le catalogue réel des moteurs, comptes compris, tel que la règle pure des
 * réglages de proposition l'attend (`reglagesDeLaProposition`).
 *
 * Les modèles viennent du moteur lui-même, jamais d'une liste écrite en dur ;
 * les comptes disponibles viennent du dernier relevé de quota. Un compte sans
 * relevé compte comme disponible : on ne retient pas une carte sur une lecture
 * de quota qui n'a pas encore eu lieu.
 */
export async function catalogueMoteurs(): Promise<MoteurCatalogue[]> {
  const engines = await listEngines();
  const quotas = cachedQuotas();
  const comptes = listAccountRecords();
  return engines.map((engine) => ({
    id: engine.id,
    label: engine.label,
    installed: engine.installed,
    models: engine.models.map((m) => ({
      id: m.id,
      label: m.label,
      thinking: m.thinking.map((t) => ({ id: t.id })),
      defaultThinking: m.defaultThinking,
      // L'appétit sert à traduire le NIVEAU choisi par le chef en modèle réel
      // (`shared/src/niveau-agent.ts`) : sans lui, on retomberait sur les noms
      // de familles, qui vieillissent.
      appetite: m.appetite,
    })),
    defaultModel: engine.defaultModel,
    comptesDisponibles: comptes.filter(
      (c) => c.engine === engine.id && (quotas.find((q) => q.id === c.id)?.available ?? true),
    ).length,
  }));
}
