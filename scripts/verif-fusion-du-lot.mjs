#!/usr/bin/env node
/**
 * LA FUSION DU LOT : L'ORDRE DES BRANCHES ET LE DÉTAIL DE L'ÉTAPE.
 *
 * L'audit du 18/08/2026 (`docs/audit-fusion-deploiement.md`) a chiffré ce que
 * coûte la fusion : 66 % du temps de publication, dont 98 % dans les conflits.
 * Trois des corrections retenues se vérifient ici, sur du VRAI git et une VRAIE
 * publication — les règles pures, elles, sont déjà verrouillées par
 * `server/src/test/fusion-du-lot.test.ts`.
 *
 * 1. VOLET DÉPÔT — la prévision lit un vrai dépôt : `git merge-tree` reconnaît
 *    la branche qui se heurte et laisse passer celle qui ne touche à rien. Le
 *    classement retenu passe alors les propres devant. Rien n'est fusionné :
 *    `merge-tree` travaille EN MÉMOIRE.
 *
 * 2. VOLET PUBLICATION — une publication réelle, trois branches PROPRES (donc
 *    aucun agent appelé, aucun jeton dépensé) : chaque branche s'écrit UNE
 *    SEULE FOIS dans le détail de l'étape. C'est le défaut mesuré : `setStep`
 *    ajoutant son texte, la boucle lui repassait son journal ENTIER à chaque
 *    conflit — 175 lignes « CONFLIT » relevées pour 78 conflits réels.
 *
 * 3. VOLET TÊTE — un détail trop long garde ses DEUX bouts. Il ne se coupait
 *    que par la fin, donc un gros lot perdait ses PREMIÈRES branches, celles
 *    qu'on venait justement relire.
 *
 *   node scripts/verif-fusion-du-lot.mjs
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché :
 * HAIKODEV_DATA est détourné vers un dossier d'essai avant tout import, et les
 * dépôts sont montés dans un dossier temporaire.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-fusion-lot-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { startDeploy, fichiersEnConflit } = await import('../server/dist/deploy.js');
const { ordreDeFusion, detailDeLEtape, DETAIL_ETAPE_MAX } = await import('../shared/dist/index.js');

let echecs = 0;
const dire = (ok, texte, detail = '') => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}${detail ? ` — ${detail}` : ''}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/**
 * Un dépôt d'essai : une branche principale, puis une branche par carte.
 * `heurte` dit si la branche réécrit la MÊME ligne du même fichier que la
 * principale — le cas des 74 % de conflits mesurés (`CLAUDE.md`, `MEMOIRE.md`).
 */
function monterDepot(nom, branches, partage = 'PARTAGE.md') {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'essai@haikodev');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, partage), 'ligne commune\n');
  git(cwd, 'add', partage);
  git(cwd, 'commit', '-q', '-m', 'départ');

  for (const { branche, heurte } of branches) {
    git(cwd, 'checkout', '-q', '-b', branche, 'main');
    if (heurte) {
      fs.writeFileSync(path.join(cwd, partage), `réécrit par ${branche}\n`);
      git(cwd, 'add', partage);
    } else {
      fs.writeFileSync(path.join(cwd, `${branche.replace(/\//g, '-')}.txt`), `le travail de ${branche}\n`);
      git(cwd, 'add', '.');
    }
    git(cwd, 'commit', '-q', '-m', `travail de ${branche}`);
    git(cwd, 'checkout', '-q', 'main');
  }
  // La principale bouge à son tour : c'est CE commit que la branche « heurte »
  // ne pourra pas fusionner sans arbitrage.
  fs.writeFileSync(path.join(cwd, partage), 'ligne commune, revue sur la principale\n');
  git(cwd, 'add', partage);
  git(cwd, 'commit', '-q', '-m', 'revue sur la principale');
  return cwd;
}

/** Un projet d'essai posé sur un dépôt, avec une carte par branche. */
function monterProjet(nom, cwd, branches) {
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1000,
    archived: false,
    // « Aucune » : le seul type qui n'appelle NI agent NI transfert.
    miseEnProduction: { type: 'aucune' },
    deploiement: { constate: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  branches.forEach((branche, i) =>
    store.saveCard({
      id: store.newId(),
      projectId: projet.id,
      title: `Carte d'essai — ${branche}`,
      description: '',
      labels: [],
      column: 'to_deploy',
      position: i + 1,
      origin: 'user',
      run: { engine: 'claude' },
      excludedFromDeploy: false,
      horsTache: false,
      github: { branch: branche },
      createdAt: maintenant + i,
      updatedAt: maintenant + i,
    }),
  );
  return projet;
}

/** Lancer une publication et attendre qu'elle rende la main. */
async function publierEtAttendre(projetId) {
  const lance = await startDeploy(projetId);
  const fin = Date.now() + 180000;
  let run = null;
  while (Date.now() < fin) {
    run = store.latestDeploy(projetId);
    if (run && run.state !== 'running') break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { lance, run };
}

/* ------------------------------------------------------------------ */
/* 1. La prévision sur un VRAI dépôt, et l'ordre qui en découle        */
/* ------------------------------------------------------------------ */

console.log('\n1. La prévision des heurts, lue sur un vrai dépôt');

const depot = monterDepot('previsions', [
  { branche: 'tache/heurte', heurte: true },
  { branche: 'tache/propre-a', heurte: false },
  { branche: 'tache/propre-b', heurte: false },
]);

/* Exactement ce que fait la boucle de fusion : `git merge-tree --write-tree`
   fusionne en mémoire, sans toucher au dossier de travail ni à la branche. */
function prevoir(branche) {
  try {
    execFileSync('git', ['merge-tree', '--write-tree', '--name-only', 'main', branche], {
      cwd: depot,
      stdio: 'pipe',
    });
    return { heurte: false, fichiers: [] };
  } catch (err) {
    const sortie = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    const fichiers = fichiersEnConflit(sortie);
    return { heurte: fichiers.length > 0 || sortie.includes('CONFLICT'), fichiers };
  }
}

const avant = git(depot, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
const heurte = prevoir('tache/heurte');
const propre = prevoir('tache/propre-a');

dire(heurte.heurte, 'la branche qui réécrit la même ligne est annoncée comme heurtée');
dire(heurte.fichiers.includes('PARTAGE.md'), 'et le fichier en cause est NOMMÉ', heurte.fichiers.join(', ') || '—');
dire(!propre.heurte, 'la branche qui ne touche à rien de commun passe sans bruit');
dire(
  git(depot, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === avant &&
    !git(depot, 'status', '--porcelain').trim(),
  'prévoir n’a RIEN touché : ni la branche courante, ni le dossier de travail',
);

const classe = ordreDeFusion([
  { cardId: 'heurte', heurte: heurte.heurte },
  { cardId: 'propre-a', heurte: false },
  { cardId: 'propre-b', heurte: false },
]);
dire(
  JSON.stringify(classe.map((b) => b.cardId)) === JSON.stringify(['propre-a', 'propre-b', 'heurte']),
  'les branches sans heurt passent devant, la conflictuelle en dernier',
  classe.map((b) => b.cardId).join(' → '),
);

/* ------------------------------------------------------------------ */
/* 2. Une publication réelle : le détail ne se recopie plus            */
/* ------------------------------------------------------------------ */

console.log('\n2. Une publication réelle, trois branches propres');

const branches = ['tache/lot-a', 'tache/lot-b', 'tache/lot-c'];
const cwd = monterDepot(
  'publication',
  branches.map((branche) => ({ branche, heurte: false })),
);

const projet = monterProjet('essai-fusion-du-lot', cwd, branches);
const { lance, run } = await publierEtAttendre(projet.id);
dire(lance.ok, 'la publication démarre', lance.error ?? '');

const etape = run?.steps.find((s) => s.key === 'merge');
const detail = etape?.log ?? '';
dire(etape?.state === 'done', 'l’étape « Fusion des branches » est menée à terme', etape?.state ?? '—');

for (const branche of branches) {
  const fois = detail.split('\n').filter((ligne) => ligne.includes(`${branche} : fusionnée`)).length;
  dire(fois === 1, `« ${branche} » est écrite UNE seule fois dans le détail`, `${fois} fois`);
}

const lignes = detail.trim().split('\n').filter(Boolean);
dire(
  new Set(lignes).size === lignes.length,
  'aucune ligne du détail n’est répétée',
  `${lignes.length} ligne(s), ${new Set(lignes).size} distincte(s)`,
);

const rangDe = (branche) => detail.indexOf(`${branche} : fusionnée`);
dire(
  branches.every((b) => rangDe(b) >= 0) && rangDe(branches[0]) < rangDe(branches[1]) && rangDe(branches[1]) < rangDe(branches[2]),
  'sans aucun heurt prévu, l’ordre des cartes est conservé',
);

const fil = etape?.journal ?? [];
dire(
  branches.every((b) => fil.some((m) => m.texte.includes(b))),
  'le fil de l’étape nomme chacune des branches',
  `${fil.length} moment(s)`,
);

/* ------------------------------------------------------------------ */
/* 3. Un détail trop long garde ses deux bouts                         */
/* ------------------------------------------------------------------ */

console.log('\n3. Un détail trop long');

const long = detailDeLEtape('', `PREMIÈRE\n${'x'.repeat(DETAIL_ETAPE_MAX * 2)}\nDERNIÈRE`);
dire(long.length <= DETAIL_ETAPE_MAX, 'le détail reste sous son plafond', `${long.length} signes`);
dire(long.startsWith('PREMIÈRE'), 'la TÊTE du détail est gardée : les premières branches du lot');
dire(long.endsWith('DERNIÈRE'), 'la FIN du détail est gardée : où l’on en est');
dire(long.includes('milieu a été retiré'), 'et ce qui manque est DIT, jamais retiré en silence');

/* ------------------------------------------------------------------ */
/* 4. Un heurt de DOCUMENTATION se recolle SANS appeler d'agent        */
/* ------------------------------------------------------------------ */

console.log('\n4. Un vrai conflit sur CLAUDE.md, recollé sans moteur');

/*
 * C'est le cas le plus fréquent de tous : 44 des 78 conflits mesurés portaient
 * sur `CLAUDE.md`, 14 sur `MEMOIRE.md`. Ici la branche réécrit la même ligne du
 * même fichier que la principale — un VRAI conflit git, pas une simulation. Le
 * contrôle est probant parce qu'AUCUN moteur n'est joignable dans ce bac à
 * sable : si un agent était appelé, la carte serait écartée du lot.
 */
const doc = ['tache/doc-a', 'tache/doc-b'];
const cwdDoc = monterDepot(
  'documentation',
  [
    { branche: doc[0], heurte: false },
    { branche: doc[1], heurte: true },
  ],
  'CLAUDE.md',
);
const projetDoc = monterProjet('essai-recollage', cwdDoc, doc);
const { run: runDoc } = await publierEtAttendre(projetDoc.id);
const etapeDoc = runDoc?.steps.find((s) => s.key === 'merge');
const filDoc = etapeDoc?.journal ?? [];
const detailDoc = etapeDoc?.log ?? '';

dire(etapeDoc?.state === 'done', 'l’étape « Fusion des branches » est menée à terme', etapeDoc?.state ?? '—');
dire(
  /recollé sans agent/.test(detailDoc),
  'le heurt sur CLAUDE.md est recollé mécaniquement',
  detailDoc.split('\n').find((l) => /CLAUDE\.md|recollé/.test(l)) ?? '—',
);
dire(
  filDoc.some((m) => /aucun agent appelé/.test(m.texte)),
  'et le fil DIT qu’aucun agent n’a été appelé : pas un jeton dépensé',
);
dire(
  !/carte écartée/.test(detailDoc),
  'aucune carte n’est écartée du lot pour un simple heurt de documentation',
);

const recolle = fs.readFileSync(path.join(cwdDoc, 'CLAUDE.md'), 'utf8');
dire(
  recolle.includes('revue sur la principale') && recolle.includes(`réécrit par ${doc[1]}`),
  'LES DEUX INTENTIONS sont gardées dans le fichier recollé',
  recolle.trim().replaceAll('\n', ' | '),
);
dire(!/<{7}|={7}|>{7}/.test(recolle), 'et il ne reste AUCUN marqueur de conflit dans le fichier');

/* ------------------------------------------------------------------ */
/* 5. Où en est chaque tâche du lot                                    */
/* ------------------------------------------------------------------ */

console.log('\n5. La liste des tâches du lot, portée par la publication');

const taches = runDoc?.taches ?? [];
dire(taches.length === doc.length, 'chaque carte du lot a sa ligne', `${taches.length} ligne(s)`);
dire(
  taches.every((t) => t.titre && t.branche),
  'chaque ligne porte son titre et sa branche',
  taches.map((t) => `${t.titre} (${t.branche})`).join(', '),
);
dire(
  runDoc?.state !== 'success' || taches.every((t) => t.etat === 'en-ligne'),
  'une publication réussie laisse toutes ses tâches « en ligne »',
  taches.map((t) => `${t.branche} → ${t.etat}`).join(', '),
);
dire(
  taches.some((t) => t.detail?.includes('CLAUDE.md')),
  'et la tâche recollée garde le NOM du fichier qui avait heurté',
  taches.map((t) => t.detail ?? '—').join(' | '),
);

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} refus.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
