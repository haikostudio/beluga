#!/usr/bin/env node
/**
 * LE GARDE DE `gh`, posé devant le vrai programme par `poserLesVerrousDeLaMachine`
 * (`server/src/depot-public.ts`) sur toute installation qui n'est pas celle de
 * l'auteur. Il rejoue la règle `commandeEnvoieAuDepotPublic` sur ses propres
 * arguments : un geste qui ÉCRIRAIT sur le dépôt public de Beluga Build (ticket,
 * proposition, commentaire, fork) sort en code 2 avec la raison ; tout le reste
 * passe sans un mot. Au moindre doute (règle illisible), on laisse passer.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ICI = path.dirname(new URL(import.meta.url).pathname);

async function main() {
  let regle;
  try {
    regle = await import(pathToFileURL(path.join(ICI, '..', 'shared', 'dist', 'index.js')).href);
  } catch {
    return;
  }
  if (typeof regle.commandeEnvoieAuDepotPublic !== 'function') return;
  const commande = ['gh', ...process.argv.slice(2).map((mot) => (/\s/.test(mot) ? JSON.stringify(mot) : mot))].join(' ');
  const verdict = regle.commandeEnvoieAuDepotPublic(commande);
  if (verdict?.refusee) {
    process.stderr.write(regle.refusDEnvoi(verdict) + '\n');
    process.exit(2);
  }
}

await main();
