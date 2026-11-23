#!/usr/bin/env node
/*
 * UN MONTAGE MORT SE REMONTE TOUT SEUL : LA PANNE EST REJOUÉE POUR DE VRAI.
 *
 * Le test unitaire juge la DÉCISION (quoi remonter, dans quel ordre) sur des
 * montages fabriqués. Ce contrôle-ci va plus loin : il pose un VRAI montage
 * « bind » dans un bac à sable, le casse, puis laisse le démon le réparer —
 * mêmes commandes, même code que le lancement d'une carte.
 *
 * Rien n'est touché hors du bac à sable : le montage d'essai est déclaré dans un
 * `fstab` À NOUS (variable `BELUGA_FSTAB`, lue par `mount -T`), jamais dans
 * `/etc/fstab`. Le bac à sable est démonté et effacé même en cas d'échec.
 *
 * Il faut pouvoir monter sans mot de passe (`sudo -n mount`) : sans ce droit, le
 * contrôle le DIT et s'arrête, il ne se déclare pas réussi.
 *
 *   node scripts/verif-remontage-automatique.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const echecs = [];
const verifie = (titre, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${titre}`);
  else {
    console.log(`  ✗ ${titre}${detail ? ` — ${detail}` : ''}`);
    echecs.push(titre);
  }
};

/** Le dossier répond-il ? C'est la seule question que pose un montage mort. */
const repond = (dossier) => {
  try {
    fs.readdirSync(dossier);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ */
/* Le bac à sable : une source, un point de montage, un fstab à nous    */
/* ------------------------------------------------------------------ */

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-remontage-'));
const source = path.join(bac, 'source');
const point = path.join(bac, 'projet');
const fstab = path.join(bac, 'fstab');

let monte = false;

async function demonter() {
  if (!monte) return;
  try {
    await run('sudo', ['-n', 'umount', '-l', point]);
  } catch {
    /* Déjà détaché : rien à faire. */
  }
  monte = false;
}

async function ranger() {
  await demonter();
  fs.rmSync(bac, { recursive: true, force: true });
}

process.on('exit', () => fs.rmSync(bac, { recursive: true, force: true }));

try {
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(point, { recursive: true });
  fs.writeFileSync(path.join(source, 'preuve.txt'), 'le dossier du projet', 'utf8');
  // Un vrai dépôt git : c'est ce que la porte du dépôt ira interroger.
  await run('git', ['init', '--quiet', source]);
  fs.writeFileSync(fstab, `${source} ${point} none bind,_netdev 0 0\n`, 'utf8');

  console.log('Le montage d’essai');

  try {
    await run('sudo', ['-n', 'mount', '-T', fstab, point]);
    monte = true;
  } catch (err) {
    console.log(
      `\n✗ Impossible de monter dans le bac à sable : ${String(err?.stderr || err?.message).trim()}`,
    );
    console.log("  Ce contrôle exige « sudo -n mount » ; il ne peut pas conclure sans lui.");
    await ranger();
    process.exit(1);
  }

  verifie('le montage d’essai est posé et répond', repond(point));
  verifie(
    'le contenu du projet se lit à travers le montage',
    fs.existsSync(path.join(point, 'preuve.txt')),
  );

  /* ---------------------------------------------------------------- */
  /* On casse le montage, exactement comme le fait la panne réelle      */
  /* ---------------------------------------------------------------- */

  console.log('\nLa panne');

  await run('sudo', ['-n', 'umount', '-l', point]);
  monte = false;
  // Le point détaché redevient un dossier ordinaire : on le rend illisible pour
  // que `readdir` échoue, comme sur un « bind » accroché à une connexion morte.
  await run('sudo', ['-n', 'chmod', '000', point]);

  verifie('le dossier du projet ne répond plus', !repond(point));

  /* ---------------------------------------------------------------- */
  /* Le démon le remonte tout seul, par le chemin du lancement de carte */
  /* ---------------------------------------------------------------- */

  console.log('\nLa reprise automatique');

  process.env.BELUGA_FSTAB = fstab;
  const { remonterLeDossierDuProjet, oublierLesEssaisDeRemontage } = await import(
    path.join(RACINE, 'server/dist/remontage.js')
  );

  const repare = await remonterLeDossierDuProjet(point);
  monte = repare;

  verifie('le démon annonce avoir remonté le dossier', repare === true);
  verifie('le dossier répond de nouveau', repond(point));
  verifie(
    'le contenu du projet est retrouvé, pas un dossier vide',
    fs.existsSync(path.join(point, 'preuve.txt')),
  );

  /* ---------------------------------------------------------------- */
  /* La porte du lancement laisse alors passer la carte                 */
  /* ---------------------------------------------------------------- */

  console.log('\nLa porte du lancement');

  const { etatDuDossierDuProjet } = await import(path.join(RACINE, 'server/dist/scheduler.js'));
  const { porteDuDepot } = await import(path.join(RACINE, 'shared/dist/index.js'));

  const etat = await etatDuDossierDuProjet(point);
  verifie('le dossier remonté est reconnu comme un dépôt', etat === 'depot', `état rendu : ${etat}`);
  verifie('la porte du dépôt laisse partir la carte', porteDuDepot(etat).ok === true);

  /* ---------------------------------------------------------------- */
  /* Deux essais collés ne relancent pas le remontage en rafale         */
  /* ---------------------------------------------------------------- */

  console.log('\nLe garde-fou contre les rafales');

  await run('sudo', ['-n', 'umount', '-l', point]);
  monte = false;
  await run('sudo', ['-n', 'chmod', '000', point]);

  // Le premier remontage vient d'avoir lieu : le second doit être retenu.
  const deuxiemeCoupSurCoup = await remonterLeDossierDuProjet(point);
  verifie('un second remontage immédiat est refusé', deuxiemeCoupSurCoup === false);
  verifie('le dossier est donc toujours muet', !repond(point));

  // Une fois la mémoire des essais oubliée, la reprise repart normalement.
  oublierLesEssaisDeRemontage();
  const reprise = await remonterLeDossierDuProjet(point);
  monte = reprise;
  verifie('passé le délai, le remontage repart', reprise === true);

  /* ---------------------------------------------------------------- */
  /* Un dossier qu’aucun montage ne porte reste refusé, en le disant    */
  /* ---------------------------------------------------------------- */

  console.log('\nCe qui ne se répare pas se dit toujours');

  const orphelin = path.join(bac, 'jamais-monte');
  verifie(
    'un dossier hors de tout montage déclaré n’est pas « remonté »',
    (await remonterLeDossierDuProjet(orphelin)) === false,
  );

  const { RAISON_DOSSIER_INJOIGNABLE } = await import(path.join(RACINE, 'shared/dist/index.js'));
  const refus = porteDuDepot('injoignable');
  verifie(
    'le refus qui subsiste nomme toujours la panne d’accès',
    refus.ok === false && refus.raison === RAISON_DOSSIER_INJOIGNABLE,
  );
} finally {
  await ranger();
}

if (echecs.length > 0) {
  console.log(`\n✗ ${echecs.length} vérification(s) en échec :`);
  for (const e of echecs) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\n✓ Un montage mort est remonté tout seul, et ce qui ne se répare pas est dit.');
