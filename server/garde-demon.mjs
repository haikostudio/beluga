#!/usr/bin/env node
/**
 * LE GARDE DU DÉMON, posé devant chaque commande d'un agent.
 *
 * Le moteur lui passe la commande sur l'entrée standard avant de la lancer. Si
 * elle peut couper le démon HaikoDev — un `pkill` au motif trop large, un
 * `kill -9` sur son numéro, un `systemctl restart haikodev` —, le garde la
 * REFUSE et dit quoi viser à la place. Tout le reste passe sans un mot.
 *
 * Règle de prudence : au moindre doute (règle illisible, entrée inattendue), on
 * LAISSE PASSER. Un garde qui se trompe en bloquant arrêterait tout le travail
 * des agents ; le pire qu'il puisse faire, c'est de rester muet.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ICI = path.dirname(new URL(import.meta.url).pathname);

async function lireEntree() {
  const morceaux = [];
  for await (const bout of process.stdin) morceaux.push(bout);
  return Buffer.concat(morceaux).toString('utf8');
}

async function main() {
  const brut = await lireEntree();
  if (!brut.trim()) return;

  let entree;
  try {
    entree = JSON.parse(brut);
  } catch {
    return;
  }

  const commande = entree?.tool_input?.command;
  if (typeof commande !== 'string' || !commande.trim()) return;

  let regle;
  try {
    const chemin = path.join(ICI, '..', 'shared', 'dist', 'index.js');
    regle = await import(pathToFileURL(chemin).href);
  } catch {
    return;
  }
  if (typeof regle.commandeMenaceLeDemon !== 'function') return;

  const pid = Number(process.env.HAIKODEV_DEMON_PID || '');
  const verdict = regle.commandeMenaceLeDemon(commande, {
    pidDuDemon: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    racineDuDemon: process.env.HAIKODEV_DEMON_RACINE || undefined,
  });
  if (!verdict?.refusee) return;

  // Code 2 : le moteur n'exécute pas la commande et rend ce texte à l'agent.
  process.stderr.write(regle.refusDuGarde(verdict) + '\n');
  process.exit(2);
}

main().catch(() => {
  // Un garde en panne ne bloque rien.
});
