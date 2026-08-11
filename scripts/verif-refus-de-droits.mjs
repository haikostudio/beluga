#!/usr/bin/env node
/**
 * LE REFUS DU BAC À SABLE SE DIT-IL EN CLAIR, SANS PARLER DE « DROITS » ?
 *
 * Le chef d'orchestre travaille derrière une frontière posée au niveau du
 * système : son dossier de travail est écrivable, le projet est monté en
 * LECTURE SEULE, l'élévation de privilèges est coupée. Rien ne lui manque —
 * c'est voulu. Il rapportait pourtant ses échecs en disant « je n'ai pas les
 * droits », et un utilisateur qui a tout accordé y lisait une autorisation
 * refusée.
 *
 * Ce script ne fait confiance à aucune citation : il PROVOQUE les trois refus
 * dans un vrai bac à sable `bwrap`, puis vérifie que le démon les traduit.
 *
 *   1. une écriture dans un dossier monté en lecture seule ;
 *   2. une écriture Node dans ce même dossier (code `EROFS`) ;
 *   3. une commande qui réclame l'administration de la machine (`sudo`) ;
 *   pour chacun : la nature reconnue, une explication SANS le mot « droits »,
 *   et la sortie d'origine gardée sous l'explication.
 *
 * On contrôle enfin que la consigne envoyée au chef nomme d'avance ce qui
 * échouera, et que le démon la prend bien du module partagé.
 *
 *   node scripts/verif-refus-de-droits.mjs
 *
 * Le script juge le dépôt d'où il PART, jamais le dossier principal ; il
 * n'écrit que dans un dossier temporaire, qu'il retire en partant.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let echecs = 0;
function dire(ok, quoi) {
  console.log(`${ok ? '  ok  ' : ' ÉCHEC'} ${quoi}`);
  if (!ok) echecs += 1;
}

/** La sortie d'une commande, ses deux flux mêlés — un refus arrive par l'un ou l'autre. */
async function sortieDe(commande, args) {
  try {
    const { stdout, stderr } = await execFileAsync(commande, args, { timeout: 30_000 });
    return `${stdout ?? ''}${stderr ?? ''}`;
  } catch (err) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}${err.stdout || err.stderr ? '' : String(err.message)}`;
  }
}

const { consigneEspaceDuChef, detailDuRefus, natureDuRefus } = await import(
  path.join(RACINE, 'shared/dist/index.js')
);

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-refus-'));
const lectureSeule = path.join(bac, 'projet');
const travail = path.join(bac, 'travail');
fs.mkdirSync(lectureSeule);
fs.mkdirSync(travail);
fs.writeFileSync(path.join(lectureSeule, 'lisible.txt'), 'le projet se lit\n');

/** Une commande lancée derrière la MÊME frontière que le chef : projet en lecture seule. */
const sousBwrap = (script) => [
  '--dev-bind', '/', '/',
  '--ro-bind', lectureSeule, lectureSeule,
  '--bind', travail, travail,
  '/bin/sh', '-c', script,
];

try {
  console.log('\nREFUS PROVOQUÉS DANS UN VRAI BAC À SABLE\n');

  const disponible = await sortieDe('bwrap', ['--version']);
  if (!/bubblewrap|\d+\.\d+/.test(disponible)) {
    console.log(
      "  bwrap est absent ou refusé sur cette machine : la frontière du chef ne peut pas être\n" +
        "  provoquée ici. C'est en soi une PANNE à signaler.\n",
    );
    process.exit(1);
  }

  // 1. Le chef lit le projet — cela, il le peut, et ce n'est pas un refus.
  const lecture = await sortieDe('bwrap', sousBwrap(`cat ${lectureSeule}/lisible.txt`));
  dire(/le projet se lit/.test(lecture), 'le projet reste LISIBLE derrière la frontière');
  dire(natureDuRefus(lecture) === null, 'une sortie ordinaire n’est pas prise pour un refus');

  // 2. Une écriture shell dans le projet : « Read-only file system ».
  const ecriture = await sortieDe('bwrap', sousBwrap(`echo x > ${lectureSeule}/interdit.txt`));
  dire(
    natureDuRefus(ecriture) === 'projet-en-lecture-seule',
    `écriture refusée reconnue — ${ecriture.trim().split('\n')[0] || '(vide)'}`,
  );
  const detail = detailDuRefus(ecriture, lectureSeule);
  dire(Boolean(detail), 'le détail de l’étape est réécrit');
  dire(/LECTURE SEULE/.test(detail ?? ''), 'l’explication nomme la cause réelle');
  dire(/agent de tâche/.test(detail ?? ''), 'l’explication donne la route à prendre');
  dire((detail ?? '').includes(ecriture.trim()), 'la sortie du système reste lisible dessous');
  dire(
    !/(pas les droits|droits manquants|permission manquante)/i.test(detail ?? ''),
    'l’explication ne parle JAMAIS de droits manquants',
  );

  // 3. La même écriture depuis Node : code « EROFS ».
  const erofs = await sortieDe(
    'bwrap',
    sousBwrap(
      `node -e "try{require('fs').writeFileSync('${lectureSeule}/x','x')}catch(e){console.log(e.message)}"`,
    ),
  );
  dire(/EROFS/.test(erofs), `le code EROFS est bien produit — ${erofs.trim()}`);
  dire(natureDuRefus(erofs) === 'projet-en-lecture-seule', 'le code EROFS est reconnu');

  // 4. L'administration de la machine, coupée dans le bac à sable.
  const admin = await sortieDe('bwrap', [
    '--dev-bind', '/', '/',
    '--ro-bind', lectureSeule, lectureSeule,
    '--unshare-user', '--new-session',
    '/bin/sh', '-c', 'sudo -n true',
  ]);
  dire(
    natureDuRefus(admin) === 'administration-refusee',
    `refus d’administration reconnu — ${admin.trim().split('\n')[0] || '(vide)'}`,
  );
  dire(
    /administration de la machine/.test(detailDuRefus(admin) ?? ''),
    'l’explication distingue l’administration d’une écriture refusée',
  );

  // 5. Un bac à sable qui ne démarre pas est une VRAIE panne, jamais une écriture refusée.
  dire(
    natureDuRefus('bwrap: setting up uid map: Permission denied') === 'bac-a-sable-absent',
    'un bac à sable qui ne démarre pas est signalé comme une panne du serveur',
  );

  console.log('\nLA CONSIGNE ENVOYÉE AU CHEF\n');
  const consigne = consigneEspaceDuChef('/root/travail/chef', '/root/projet');
  for (const [quoi, motif] of [
    ['le dossier où il PEUT écrire', /\/root\/travail\/chef/],
    ['le projet, en lecture seule', /\/root\/projet/],
    ['construire est annoncé comme voué à l’échec', /construire/i],
    ['déployer est annoncé comme voué à l’échec', /déploiement/i],
    ['la consigne de publication du serveur est écartée', /ne s'applique PAS à toi/],
    ['le mot « droits » lui est interdit', /NE DIS JAMAIS « je n'ai pas les droits »/],
    ['la phrase de remplacement lui est donnée', /agent de tâche/],
  ]) {
    dire(motif.test(consigne), quoi);
  }

  const runtime = fs.readFileSync(path.join(RACINE, 'server/src/runtime.ts'), 'utf8');
  dire(
    /consigneEspaceDuChef\(/.test(runtime),
    'le démon prend sa consigne du module partagé, pas d’un texte recopié',
  );
  dire(
    /detailDuRefus\(/.test(runtime),
    'le démon traduit le détail des étapes d’un chef bridé',
  );
} finally {
  fs.rmSync(bac, { recursive: true, force: true });
}

console.log(echecs ? `\n${echecs} contrôle(s) en échec.\n` : '\nTout est en place.\n');
process.exit(echecs ? 1 : 0);
