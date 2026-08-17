#!/usr/bin/env node
/**
 * UNE ÉTAPE DE PUBLICATION QUI TOMBE SE RELÈVE-T-ELLE VRAIMENT TOUTE SEULE ?
 *
 * Constat qui a produit ce contrôle : le 17/08/2026, un déploiement d'HaikoDev
 * a fusionné, envoyé, vérifié, construit et INSTALLÉ son lot — puis s'est
 * déclaré en échec, en rouge, sur un incident survenu APRÈS la mise en ligne.
 * Et avant lui, quatre étapes n'avaient aucun secours : un envoi refusé parce
 * qu'une autre carte avait poussé entre-temps, une installation sans droit
 * d'écriture, un service qui ne repart pas, une adresse muette — chacune
 * laissait la publication bloquée jusqu'à ce qu'un humain la relance.
 *
 * On rejoue donc le mécanisme ENTIER (`rejouerAvecDepannage`, celui qu'emploie
 * la vraie publication), avec un dépanneur d'essai à la place de l'agent :
 *
 *   1. une panne RECONNUE appelle un dépanneur, puis l'étape est REJOUÉE ;
 *   2. une panne INCONNUE n'appelle personne — rien n'est bricolé ;
 *   3. une panne reconnue mais qui se règle ailleurs (identifiant refusé)
 *      n'appelle personne non plus, et elle est NOMMÉE ;
 *   4. une étape qui retombe toujours s'arrête au PLAFOND de reprises ;
 *   5. une adresse muette est toujours la même panne, quel que soit le motif ;
 *   6. les reprises restent LISIBLES dans l'étape (compte + récit).
 *
 * Aucun moteur n'est appelé, aucune vraie publication n'est lancée : tout se
 * passe dans une base jetable, effacée en partant.
 *
 *   npm run build:server && node scripts/verif-reparation-publication.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Une base jetable, posée AVANT d'importer ce qui la lit.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-reparation-publication-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import(path.join(racineDuDepot, 'server/dist/store.js'));
const { rejouerAvecDepannage } = await import(path.join(racineDuDepot, 'server/dist/deploy.js'));
const { DeployRun, REPRISES_ETAPE_MAX, panneDAdresseMuette } = await import(
  path.join(racineDuDepot, 'shared/dist/index.js')
);

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une publication d'essai, avec ses sept étapes à l'état de départ. */
function publicationDEssai() {
  return store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      state: 'running',
      startedAt: Date.now(),
      steps: ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'].map((key) => ({
        key,
        state: 'todo',
        log: '',
      })),
    }),
  );
}

/** Un dépanneur d'essai : il compte ses appels, il ne coûte pas un jeton. */
function depanneurDEssai(aboutit = true) {
  const appels = [];
  const depanneur = async (projectId, etape, panne, sortie, passe) => {
    appels.push({ etape, panne: panne.nom, passe });
    return aboutit
      ? { tente: true, recit: '' }
      : { tente: false, recit: `reprise ${passe} : l’agent de dépannage n’a pas abouti (essai)` };
  };
  return { appels, depanneur };
}

const REFUS_DE_POUSSER = [
  'To github.com:haikostudio/haikodev.git',
  ' ! [rejected]        HEAD -> main (non-fast-forward)',
  'error: failed to push some refs',
].join('\n');

try {
  /* ---------------------------------------------------------------- */
  /* 1. Panne reconnue : un dépanneur passe, l'étape est rejouée        */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'push' },
      async () => {
        tours += 1;
        // Premier essai refusé, second passé : exactement le cas d'une autre
        // carte qui a poussé pendant que la publication construisait.
        return tours === 1 ? { ok: false, sortie: REFUS_DE_POUSSER } : { ok: true, sortie: 'HEAD -> main' };
      },
      depanneur,
    );
    noter(
      'un envoi refusé appelle un dépanneur, puis l’étape est rejouée et elle passe',
      issue.ok && appels.length === 1 && issue.reprises === 1 && tours === 2,
      `${appels.length} appel(s), ${issue.reprises} reprise(s), ${tours} essai(s)`,
    );
    noter(
      'le déroulé garde ce qui a été tenté, en clair',
      issue.reparations.some((r) => /dépôt distant a avancé/.test(r)) &&
        issue.reparations.some((r) => /rejouée et elle est passée/.test(r)),
      issue.reparations.join(' | ').slice(0, 140),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Panne INCONNUE : personne n'est appelé, rien n'est bricolé      */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'push' },
      async () => {
        tours += 1;
        return { ok: false, sortie: 'une sortie que personne n’a jamais vue' };
      },
      depanneur,
    );
    noter(
      'une panne inconnue n’est jamais bricolée : aucun agent appelé, l’étape retombe',
      !issue.ok && appels.length === 0 && tours === 1 && issue.reprises === 0,
      `${appels.length} appel(s), ${tours} essai(s)`,
    );
    noter(
      'et le refus le DIT, avec ce qui a été tenté',
      issue.reparations.some((r) => /panne non reconnue/.test(r)),
      issue.reparations.join(' | ').slice(0, 120),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3. Panne reconnue mais qui se règle ailleurs                       */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'push' },
      async () => ({ ok: false, sortie: 'git@github.com: Permission denied (publickey).' }),
      depanneur,
    );
    noter(
      'un identifiant refusé est nommé, sans qu’on envoie personne tourner autour',
      !issue.ok &&
        appels.length === 0 &&
        issue.reparations.some((r) => /ne se répare pas depuis une publication/.test(r)),
      issue.reparations.join(' | ').slice(0, 140),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 4. Le plafond de reprises tient                                    */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'restart' },
      async () => {
        tours += 1;
        return { ok: false, sortie: 'Job for exemple.service failed (status=1/FAILURE)' };
      },
      depanneur,
    );
    noter(
      `une étape qui retombe toujours s’arrête au plafond (${REPRISES_ETAPE_MAX} reprises)`,
      !issue.ok && appels.length === REPRISES_ETAPE_MAX && issue.reprises === REPRISES_ETAPE_MAX,
      `${appels.length} appel(s), ${tours} essai(s)`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 5. Une adresse muette : la panne est FORCÉE, jamais devinée        */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      {
        projectId: 'projet-essai',
        etape: 'publish',
        panne: panneDAdresseMuette('https://essai.haikostudio.cloud'),
      },
      async () => {
        tours += 1;
        return tours === 1
          ? { ok: false, sortie: 'Adresse https://essai.haikostudio.cloud injoignable (fetch failed).' }
          : { ok: true, sortie: 'Adresse https://essai.haikostudio.cloud joignable (200).' };
      },
      depanneur,
    );
    noter(
      'une adresse muette appelle un dépanneur, puis elle est RECONTRÔLÉE',
      issue.ok && appels.length === 1 && tours === 2 && /ne répond pas/.test(appels[0].panne),
      `${appels.length} appel(s), ${tours} contrôle(s)`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 6. Un dépanneur qui n'aboutit pas ne fait pas rejouer l'étape      */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai(false);
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'push' },
      async () => {
        tours += 1;
        return { ok: false, sortie: REFUS_DE_POUSSER };
      },
      depanneur,
    );
    noter(
      'un dépanneur en échec arrête là : l’étape n’est pas rejouée dans le vide',
      !issue.ok && appels.length === 1 && tours === 1 && issue.reprises === 0,
      issue.reparations.join(' | ').slice(0, 140),
    );
  }
} finally {
  fs.rmSync(bacASable, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
process.exit(echecs.length ? 1 : 0);
