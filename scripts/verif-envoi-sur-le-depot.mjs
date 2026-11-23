#!/usr/bin/env node
/**
 * L'ENVOI SUR LE DÉPÔT PART-IL SUR LA BRANCHE RÉELLE, ET RIEN D'AUTRE ?
 *
 * Constat qui a produit ce contrôle : le 07/09/2026, la publication de
 * Maestria60+ est tombée à 17 % sur l'étape « Envoi sur le dépôt ». La branche
 * locale n'avait pas de référence de suivi, git a écrit « fatal: upstream
 * branch 'refs/heads/dev' not stored as a remote-tracking branch », et CE
 * MESSAGE a servi d'arguments au `git push` : chaque mot est devenu un refspec,
 * deux lignes ont même été exécutées par le shell.
 *
 * On rejoue donc l'étape ENTIÈRE (`envoyerSurLeDepot`, celle qu'emploie la
 * vraie publication) sur de vrais dépôts jetables, dans les trois situations :
 *
 *   1. branche AVEC amont : l'envoi part sur le couple suivi et aboutit ;
 *   2. branche SANS amont (le cas exact de Maestria) : l'envoi pose l'amont
 *      lui-même au lieu de réingérer le conseil de git ;
 *   3. distant qui a AVANCÉ (non-fast-forward) : sans heurt, la branche
 *      distante est récupérée, fusionnée, et l'envoi rejoué ABOUTIT, sans
 *      forcer ; avec un heurt, la fusion est annulée (dossier propre), rien
 *      n'est envoyé, et l'échec reste lisible, sans pluie de « src refspec » ;
 *   4. quoi qu'il arrive, AUCUN mot d'une sortie de git ne se retrouve dans les
 *      arguments du push — et une branche illisible n'envoie RIEN.
 *
 * Aucun dépôt réel n'est touché : tout se passe dans un dossier temporaire,
 * effacé en partant.
 *
 *   npm run build:server && node scripts/verif-envoi-sur-le-depot.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-envoi-depot-'));
process.env.BELUGA_DATA = path.join(bacASable, 'donnees');

const { envoyerSurLeDepot } = await import(path.join(racineDuDepot, 'server/dist/deploy.js'));
const { planDEnvoi, resumeDEchecDEnvoi } = await import(path.join(racineDuDepot, 'shared/dist/index.js'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const IDENTITE = ['-c', 'user.email=essai@beluga', '-c', 'user.name=Essai', '-c', 'commit.gpgsign=false'];
function git(cwd, ...args) {
  return execFileSync('git', [...IDENTITE, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Un dépôt distant nu + une copie de travail qui le suit, avec un premier commit. */
function depotDEssai(nom) {
  const distant = path.join(bacASable, `${nom}.git`);
  const copie = path.join(bacASable, nom);
  fs.mkdirSync(distant, { recursive: true });
  git(bacASable, 'init', '--bare', '--initial-branch=dev', distant);
  git(bacASable, 'clone', distant, copie);
  fs.writeFileSync(path.join(copie, 'fichier.txt'), 'départ\n');
  git(copie, 'add', 'fichier.txt');
  git(copie, 'commit', '-m', 'départ');
  git(copie, 'branch', '-M', 'dev');
  git(copie, 'push', '-u', 'origin', 'dev');
  return { distant, copie };
}

/** Ce que la copie a réellement envoyé, vu du dépôt distant. */
function teteDistante(distant, branche) {
  try {
    return git(distant, 'rev-parse', `refs/heads/${branche}`).trim();
  } catch {
    return '';
  }
}

function commiter(copie, texte) {
  fs.appendFileSync(path.join(copie, 'fichier.txt'), `${texte}\n`);
  git(copie, 'add', 'fichier.txt');
  git(copie, 'commit', '-m', texte);
  return git(copie, 'rev-parse', 'HEAD').trim();
}

const MESSAGE_DE_GIT = "fatal: upstream branch 'refs/heads/dev' not stored as a remote-tracking branch";

try {
  /* ---------------------------------------------------------------- */
  /* 1. Branche AVEC amont : l'envoi part sur le couple suivi            */
  /* ---------------------------------------------------------------- */
  {
    const { distant, copie } = depotDEssai('avec-amont');
    const attendu = commiter(copie, 'travail');
    const envoi = await envoyerSurLeDepot(copie);
    noter(
      'branche avec amont : l’envoi aboutit sur la branche suivie',
      envoi.ok && envoi.commande === 'git push origin HEAD:refs/heads/dev' && teteDistante(distant, 'dev') === attendu,
      `${envoi.commande} — ${envoi.sortie.split('\n')[0] ?? ''}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Branche SANS amont : le cas exact de Maestria60+                 */
  /* ---------------------------------------------------------------- */
  {
    const { distant, copie } = depotDEssai('sans-amont');
    /*
     * On reproduit l'état RÉEL du dépôt Maestria : la configuration d'amont est
     * là (`branch.dev.remote` / `branch.dev.merge`), mais la référence de suivi
     * `refs/remotes/origin/dev` n'existe pas — le refspec de récupération avait
     * été rétréci à une autre branche. `git rev-parse … @{u}` sort alors en
     * erreur avec le message qui a tout déclenché.
     */
    git(copie, 'config', 'remote.origin.fetch', '+refs/heads/inexistante:refs/remotes/origin/inexistante');
    fs.rmSync(path.join(copie, '.git', 'refs', 'remotes', 'origin'), { recursive: true, force: true });
    fs.rmSync(path.join(copie, '.git', 'packed-refs'), { force: true });
    const attendu = commiter(copie, 'travail sans amont');
    const envoi = await envoyerSurLeDepot(copie);
    noter(
      'branche sans amont : l’envoi pose l’amont au lieu de réingérer le conseil de git',
      envoi.ok &&
        envoi.commande === 'git push -u origin HEAD:refs/heads/dev' &&
        teteDistante(distant, 'dev') === attendu,
      `${envoi.commande} — ${envoi.sortie.split('\n')[0] ?? ''}`,
    );
    noter(
      'branche sans amont : aucun mot du message de git n’est passé au push',
      !/refspec|not stored|remote-tracking/i.test(envoi.commande),
      envoi.commande,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3a. Le distant a AVANCÉ, sans heurt : rattrapé puis renvoyé         */
  /* ---------------------------------------------------------------- */
  {
    const { distant, copie } = depotDEssai('distant-avance');
    // Une autre copie pousse pendant ce temps, sur un AUTRE fichier.
    const autre = path.join(bacASable, 'autre-copie-avance');
    git(bacASable, 'clone', distant, autre);
    fs.writeFileSync(path.join(autre, 'autre.txt'), 'travail concurrent\n');
    git(autre, 'add', 'autre.txt');
    git(autre, 'commit', '-m', 'travail concurrent');
    git(autre, 'push', 'origin', 'dev');
    const concurrent = git(autre, 'rev-parse', 'HEAD').trim();

    const local = commiter(copie, 'travail local');
    const envoi = await envoyerSurLeDepot(copie);
    const tete = git(copie, 'rev-parse', 'HEAD').trim();
    noter(
      'distant qui a avancé : l’envoi est rattrapé puis aboutit',
      envoi.ok && teteDistante(distant, 'dev') === tete && /avait avancé/.test(envoi.sortie),
      envoi.sortie.split('\n').slice(0, 2).join(' / '),
    );
    const ancetre = (sha) => {
      try {
        git(distant, 'merge-base', '--is-ancestor', sha, 'refs/heads/dev');
        return true;
      } catch {
        return false;
      }
    };
    noter(
      'distant qui a avancé : rien n’est perdu (travail concurrent ET travail local sur le distant)',
      ancetre(concurrent) && ancetre(local),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3b. Le distant a avancé AVEC un heurt : annulé, lisible, rien forcé */
  /* ---------------------------------------------------------------- */
  {
    const { distant, copie } = depotDEssai('distant-refuse');
    // Une autre copie pousse pendant ce temps, sur la MÊME ligne.
    const autre = path.join(bacASable, 'autre-copie');
    git(bacASable, 'clone', distant, autre);
    commiter(autre, 'travail concurrent');
    git(autre, 'push', 'origin', 'dev');
    const teteAvant = teteDistante(distant, 'dev');

    commiter(copie, 'travail local');
    const envoi = await envoyerSurLeDepot(copie);
    const lisible =
      !envoi.ok &&
      /heurtent/.test(envoi.sortie) &&
      envoi.sortie.includes('Commande lancée : git push origin HEAD:refs/heads/dev') &&
      /Cause : .*(rejected|fetch first|non-fast-forward|failed to push)/i.test(envoi.sortie) &&
      !/src refspec/i.test(envoi.sortie);
    noter(
      'heurt avec le distant : la raison, la commande lancée et la cause sont dites, sans pluie de refspec',
      lisible,
      envoi.sortie.split('\n').slice(0, 2).join(' / '),
    );
    noter('heurt avec le distant : rien n’a été envoyé, rien forcé', teteDistante(distant, 'dev') === teteAvant);
    let fusionPendante = true;
    try {
      git(copie, 'rev-parse', '-q', '--verify', 'MERGE_HEAD');
    } catch {
      fusionPendante = false;
    }
    noter(
      'heurt avec le distant : la fusion est annulée, le dossier reste propre',
      !fusionPendante && git(copie, 'status', '--porcelain').trim() === '',
    );
  }

  /* ---------------------------------------------------------------- */
  /* 4. Une sortie de commande ne devient JAMAIS un argument             */
  /* ---------------------------------------------------------------- */
  {
    // La lecture de l'amont a ÉCHOUÉ : sa sortie n'est pas lue, quoi qu'elle dise.
    const plan = planDEnvoi({
      suivie: { ok: false, sortie: MESSAGE_DE_GIT },
      locale: { ok: true, sortie: 'dev\n' },
    });
    noter(
      'une lecture en échec n’est pas lue : on retombe sur la branche courante',
      plan.ok && plan.arguments.join(' ') === 'push -u origin HEAD:refs/heads/dev',
      plan.ok ? plan.commande : plan.raison,
    );
  }
  {
    // Même si le message arrivait comme une réussite, il n'est pas un nom de branche.
    const plan = planDEnvoi({
      suivie: { ok: true, sortie: MESSAGE_DE_GIT },
      locale: { ok: true, sortie: 'dev' },
    });
    noter(
      'un message de git rendu comme une réussite est refusé, pas envoyé',
      !plan.ok && /n’est pas un couple/.test(plan.raison),
      plan.ok ? plan.commande : plan.raison,
    );
  }
  {
    const plan = planDEnvoi({ suivie: { ok: false, sortie: '' }, locale: { ok: true, sortie: 'HEAD' } });
    noter(
      'une copie de travail détachée n’envoie rien',
      !plan.ok && /aucune branche/.test(plan.raison),
      plan.ok ? plan.commande : plan.raison,
    );
  }
  {
    const plan = planDEnvoi({
      suivie: { ok: false, sortie: '' },
      locale: { ok: true, sortie: 'dev; rm -rf /' },
    });
    noter(
      'un nom de branche qui contient du shell est refusé',
      !plan.ok,
      plan.ok ? plan.commande : plan.raison,
    );
  }
  {
    const sortie = ['error: src refspec a does not match any', 'error: src refspec a does not match any'].join('\n');
    const resume = resumeDEchecDEnvoi({ commande: 'git push origin HEAD:refs/heads/dev', sortie });
    noter(
      'les lignes répétées sont comptées, pas recopiées',
      resume.includes('(× 2)'),
      resume.split('\n').pop(),
    );
  }
} finally {
  fs.rmSync(bacASable, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
process.exit(echecs.length ? 1 : 0);
