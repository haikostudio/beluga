#!/usr/bin/env node
/**
 * LE GARDE DU DÉMON, posé devant chaque commande d'un agent.
 *
 * Le moteur lui passe la commande sur l'entrée standard avant de la lancer. Si
 * elle peut couper le démon Beluga Build — un `pkill` au motif trop large, un
 * `kill -9` sur son numéro, un `systemctl restart beluga` —, ou si elle ÉCRIT
 * sur un vrai site hors mise en production, le garde la REFUSE et dit quoi
 * faire à la place. Une commande qui bloquerait la tâche à attendre (boucle,
 * long sommeil, serveur d'essai au premier plan) l'est aussi. Tout le reste
 * passe sans un mot.
 *
 * Règle de prudence : au moindre doute (règle illisible, entrée inattendue), on
 * LAISSE PASSER. Un garde qui se trompe en bloquant arrêterait tout le travail
 * des agents ; le pire qu'il puisse faire, c'est de rester muet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

  const pid = Number(process.env.BELUGA_DEMON_PID || '');
  const verdict = regle.commandeMenaceLeDemon(commande, {
    pidDuDemon: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    racineDuDemon: process.env.BELUGA_DEMON_RACINE || undefined,
  });
  if (verdict?.refusee) {
    // Code 2 : le moteur n'exécute pas la commande et rend ce texte à l'agent.
    process.stderr.write(regle.refusDuGarde(verdict) + '\n');
    process.exit(2);
  }

  /*
   * LE DÉPÔT PUBLIC NE REÇOIT RIEN D'UNE INSTALLATION (`shared/src/depot-public.ts`) :
   * `git push`, `gh pr create`, `gh issue create`, `gh api` en écriture qui le
   * visent sont refusés. Seule la machine de l'auteur — celle qui porte le
   * dossier `prive/`, jamais publié — y échappe : c'est d'elle que part le miroir.
   */
  if (typeof regle.commandeEnvoieAuDepotPublic === 'function') {
    const force = process.env.BELUGA_MACHINE_AUTEUR;
    const auteur = force === '1' || (force !== '0' && fs.existsSync(path.join(ICI, '..', 'prive', 'valeurs-sensibles.json')));
    if (!auteur) {
      const envoi = regle.commandeEnvoieAuDepotPublic(commande);
      if (envoi?.refusee) {
        process.stderr.write(regle.refusDEnvoi(envoi) + '\n');
        process.exit(2);
      }
    }
  }

  /*
   * UNE CARTE DE CRÉATION FABRIQUE PAR KIE.AI SEULEMENT (`shared/src/garde-creation.ts`) :
   * la variable n'est posée que pour l'agent d'une carte caméra, jamais pour le moteur Codex en soi.
   */
  if (typeof regle.commandeFabriqueHorsDeKie === 'function' && process.env[regle.VARIABLE_DE_CREATION_DE_MEDIA] === '1') {
    const creation = regle.commandeFabriqueHorsDeKie(commande);
    if (creation?.refusee) {
      process.stderr.write(regle.refusDeCreation(creation) + '\n');
      process.exit(2);
    }
  }

  /*
   * LES ATTENTES INUTILES (`shared/src/garde-attentes.ts`) : une boucle
   * d'attente, un long sommeil, un serveur d'essai ou un « tail -f » lancés au
   * premier plan bloquent la tâche. Refusés avant de partir, avec leurs issues.
   */
  if (typeof regle.commandeAttendEnVain === 'function') {
    const attente = regle.commandeAttendEnVain(commande, { arrierePlan: entree?.tool_input?.run_in_background === true });
    if (attente?.refusee) {
      process.stderr.write(regle.refusDesAttentes(attente) + '\n');
      process.exit(2);
    }
  }

  /*
   * LES ESSAIS ATTENDENT LA MÉMOIRE (`shared/src/garde-memoire.ts`, 18/11/2026) :
   * un serveur d'essai ou un navigateur de test lancé sur une machine pleine
   * figeait le démon. Refusé avec une phrase qui dit quoi faire, une attente
   * BORNÉE comptée depuis le premier refus dans ce dossier de travail, puis
   * il part quand même.
   */
  if (typeof regle.gardeDeMemoire === 'function') {
    const memoire = verdictDeMemoire(regle, commande, entree?.cwd);
    if (memoire?.verdict === 'refuse') {
      process.stderr.write(memoire.texte + '\n');
      process.exit(2);
    }
  }

  /*
   * LES VRAIS SITES SONT EN LECTURE SEULE (`shared/src/garde-production.ts`) :
   * la liste voyage dans l'environnement de l'agent, posée par le démon pour
   * tout rôle sauf celui de la mise en production.
   */
  if (typeof regle.commandeEcritEnProduction !== 'function') return;
  const productions = regle.productionsDepuisLEnvironnement(process.env[regle.VARIABLE_DES_PRODUCTIONS]);
  if (!productions.length) return;
  const enProduction = regle.commandeEcritEnProduction(commande, productions);
  if (!enProduction?.refusee) return;
  process.stderr.write(regle.refusDuGardeDeProduction(enProduction) + '\n');
  process.exit(2);
}

/** Un premier refus plus vieux que cela ne compte plus : une nouvelle attente commence. */
const REFUS_PERIME_MS = 30 * 60_000;

function verdictDeMemoire(regle, commande, cwd) {
  try {
    if (!regle.commandeLanceUnEssai(commande)) return null;
    const signes = regle.signesDeMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (!signes) return null;
    let psi;
    try {
      psi = regle.psiSomeAvg10(fs.readFileSync('/proc/pressure/memory', 'utf8'));
    } catch {
      psi = undefined;
    }
    const pression = regle.pressionMemoire(signes.memPct, signes.swapPct, { psiSomeAvg10: psi });
    const dossier = path.join(os.tmpdir(), 'beluga-garde-memoire');
    const etat = path.join(dossier, `${createHash('sha256').update(String(cwd || process.cwd())).digest('hex').slice(0, 16)}.json`);
    const maintenant = Date.now();
    let premierRefusLe;
    try {
      const lu = JSON.parse(fs.readFileSync(etat, 'utf8')).premierRefusLe;
      if (Number.isFinite(lu) && maintenant - lu < REFUS_PERIME_MS) premierRefusLe = lu;
    } catch {
      premierRefusLe = undefined;
    }
    const verdict = regle.gardeDeMemoire({ commande, pression, premierRefusLe, maintenant });
    if (verdict.verdict === 'refuse' && premierRefusLe === undefined) {
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(etat, JSON.stringify({ premierRefusLe: maintenant }));
    } else if (verdict.verdict !== 'refuse') {
      fs.rmSync(etat, { force: true });
    }
    return verdict;
  } catch {
    // Au moindre doute, on laisse passer.
    return null;
  }
}

main().catch(() => {
  // Un garde en panne ne bloque rien.
});
