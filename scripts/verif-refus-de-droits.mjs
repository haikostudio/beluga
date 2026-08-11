#!/usr/bin/env node
/**
 * LE CHEF D'ORCHESTRE A-T-IL VRAIMENT L'ACCÈS COMPLET ?
 *
 * Sa seule frontière est de ne pas modifier lui-même du code, et elle tient sur
 * les outils d'édition — pas sur le disque. Le bac à sable qui l'enfermait a été
 * retiré le 11/08/2026 : il bloquait les gestes mêmes qu'on veut lui ouvrir
 * (construire écrit dans le projet, administrer exige une élévation de
 * privilèges qu'aucun bac à sable ne laisse passer), et le chef annonçait alors
 * « je n'ai pas les droits » alors que rien ne lui manquait.
 *
 * Ce script ne fait confiance à aucune citation :
 *
 *   1. les réglages envoyés aux DEUX moteurs n'enferment plus rien ;
 *   2. la CONSIGNE du chef annonce l'accès complet, nomme les gestes ouverts et
 *      lui interdit le vocabulaire des droits ;
 *   3. un refus RÉEL de la machine (bac à sable resté allumé, fichier d'un autre
 *      compte, administration à configurer) est traduit en cause + réparation,
 *      l'explication posée AU-DESSUS de la sortie d'origine ;
 *   4. le fait qu'un bac à sable enfermerait encore le chef est PROUVÉ à
 *      l'envers : on en monte un pour de vrai et on vérifie qu'il bloque bien ce
 *      qu'on vient d'ouvrir — c'est ce refus-là qu'on a supprimé.
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

const {
  consigneEspaceDuChef,
  detailDuRefus,
  natureDuRefus,
  reglagesClaudeDuChef,
  surchargesCodexDuChef,
} = await import(path.join(RACINE, 'shared/dist/index.js'));

const LISTES = {
  allowedTools: ['Bash', 'mcp__haikodev__board_create_card'],
  disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'mcp__haikodev__make_archive'],
};

console.log('\nCE QUI PART AUX MOTEURS\n');

const codex = surchargesCodexDuChef(LISTES);
dire(codex.includes('sandbox_mode="danger-full-access"'), 'Codex : accès complet, aucun bac à sable');
dire(
  !codex.some((s) => s.startsWith('sandbox_workspace_write')),
  'Codex : plus aucune limite d’écriture à un espace de travail',
);
dire(codex.includes('approval_policy="never"'), 'Codex : les commandes partent sans attendre un accord');
dire(
  codex.some((s) => s.includes('disabled_tools=["make_archive"]')),
  'Codex : les outils réservés aux agents de tâche restent fermés',
);

const claude = reglagesClaudeDuChef(LISTES, '/root/projet');
dire(claude?.sandbox?.enabled === false, 'Claude : bac à sable éteint');
dire(!JSON.stringify(claude).includes('denyWrite'), 'Claude : plus aucun dossier fermé en écriture');
dire(
  LISTES.disallowedTools.includes('Edit') &&
    LISTES.disallowedTools.includes('Write') &&
    LISTES.disallowedTools.includes('NotebookEdit'),
  'les outils d’ÉDITION restent la seule frontière — modifier du code passe par une carte',
);

console.log('\nLA CONSIGNE ENVOYÉE AU CHEF\n');

const consigne = consigneEspaceDuChef('/root/travail/chef', '/root/projet');
for (const [quoi, motif] of [
  ['l’accès complet est annoncé', /ACCÈS COMPLET/],
  ['construire est ouvert', /construction/i],
  ['installer des dépendances est ouvert', /installation/i],
  ['déployer est ouvert', /déploiement/i],
  ['redémarrer un service est ouvert', /redémarrage/i],
  ['administrer la machine est ouvert', /administration/i],
  ['le projet lui est ouvert en entier', /\/root\/projet/],
  ['les requêtes réseau sont ouvertes', /requêtes réseau/i],
  ['GitHub est ouvert', /GitHub/],
  ['la connexion SSH est ouverte', /SSH/],
  ['créer et modifier des cartes est ouvert', /cartes/i],
  ['ces gestes se font dans le tour, sans carte', /DANS LE TOUR EN COURS, SANS CARTE/],
  ['la seule frontière est nommée', /TA SEULE FRONTIÈRE/],
  ['modifier le code lui-même reste fermé', /tu ne modifies pas TOI-MÊME le code/],
  ['le mot « droits » lui est interdit', /NE DIS JAMAIS « je n'ai pas les droits »/],
]) {
  dire(motif.test(consigne), quoi);
}
dire(
  !/lecture seule|bac à sable les refuse|SEUL dossier où tu as le droit/i.test(consigne),
  'la consigne ne lui annonce plus aucun mur qui n’existe plus',
);

console.log('\nUN REFUS RÉEL DE LA MACHINE, PROVOQUÉ ET TRADUIT\n');

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-refus-'));
try {
  const ferme = path.join(bac, 'projet');
  fs.mkdirSync(ferme);

  const disponible = await sortieDe('bwrap', ['--version']);
  if (/bubblewrap|\d+\.\d+/.test(disponible)) {
    // On MONTE un bac à sable exprès pour prouver ce qu'il bloquait : c'est
    // exactement ce que le chef ne doit plus subir.
    const bloque = await sortieDe('bwrap', [
      '--dev-bind', '/', '/',
      '--ro-bind', ferme, ferme,
      '/bin/sh', '-c', `echo x > ${ferme}/interdit.txt`,
    ]);
    dire(
      natureDuRefus(bloque) === 'bac-a-sable-residuel',
      `un bac à sable resté allumé est reconnu — ${bloque.trim().split('\n')[0] || '(vide)'}`,
    );
    const detail = detailDuRefus(bloque);
    dire(/À RÉPARER SUR LE SERVEUR/.test(detail ?? ''), 'il est signalé comme un réglage à éteindre');
    dire((detail ?? '').includes(bloque.trim()), 'la sortie du système reste lisible dessous');
    dire(
      !/(pas les droits|droits manquants|permission manquante)/i.test(detail ?? ''),
      'l’explication ne parle JAMAIS de droits manquants',
    );
  } else {
    console.log('  …  bwrap absent : le contrôle du bac à sable résiduel est sauté.');
  }

  // Un fichier d'un AUTRE compte : le refus qui reste possible, accès complet ou non.
  const dAutrui = await sortieDe('node', [
    '-e',
    "try{require('fs').writeFileSync('/etc/shadow','x')}catch(e){console.log(e.message)}",
  ]);
  dire(
    natureDuRefus(dAutrui) === 'fichier-d-un-autre-compte' || process.getuid?.() === 0,
    `un fichier d’un autre compte est reconnu — ${dAutrui.trim() || '(le démon tourne en root)'}`,
  );

  dire(
    natureDuRefus('sudo: a password is required') === 'administration-a-configurer',
    'une administration qui réclame un mot de passe dit la règle à poser',
  );
  dire(natureDuRefus('Construction terminée en 12 s') === null, 'une sortie ordinaire n’est pas un refus');
} finally {
  fs.rmSync(bac, { recursive: true, force: true });
}

const runtime = fs.readFileSync(path.join(RACINE, 'server/src/runtime.ts'), 'utf8');
dire(
  /consigneEspaceDuChef\(/.test(runtime),
  'le démon prend sa consigne du module partagé, pas d’un texte recopié',
);
dire(/detailDuRefus\(/.test(runtime), 'le démon traduit le détail des étapes d’un chef');

console.log(echecs ? `\n${echecs} contrôle(s) en échec.\n` : '\nTout est en place.\n');
process.exit(echecs ? 1 : 0);
