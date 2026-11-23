#!/usr/bin/env node
/**
 * UNE CARTE N'EST ARCHIVÉE QUE SI SON TRAVAIL EST PROUVÉ DANS LA BRANCHE D'ARRIVÉE.
 *
 * Constat (23/10/2026) : la fusion du lot cherchait la branche d'une carte dans
 * le seul dossier local. Une branche qui n'existait que sur GitHub était sautée
 * en silence, puis la carte marquée déployée et ARCHIVÉE — son travail jamais
 * mis en ligne. Ce contrôle rejoue de VRAIES publications sur des dépôts
 * d'essai (un distant nu tient lieu de GitHub) :
 *
 *   1. une branche qui n'existe QUE sur le distant est rapatriée et fusionnée ;
 *   2. une branche locale EN RETARD sur le distant est avancée avant la fusion ;
 *   3. une branche introuvable PARTOUT : la carte reste dans « À déployer »,
 *      sans date de mise en ligne, nommée, sans rattrapage automatique — et les
 *      autres cartes du lot passent ;
 *   4. un lot entièrement introuvable fait tomber l'étape, rien n'est rangé ;
 *   5. un projet à DEUX dépôts : une branche présente dans un seul d'entre eux
 *      est fusionnée, jamais écartée.
 *
 *   node scripts/verif-carte-prouvee-au-lot.mjs
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché : BELUGA_DATA
 * est détourné vers un dossier d'essai AVANT tout import, et les dépôts sont
 * montés dans un dossier temporaire. Ne jamais le lancer depuis le dépôt
 * principal du serveur : depuis une copie de travail.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-carte-prouvee-'));
process.env.BELUGA_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const store = await import('../server/dist/store.js');
const { startDeploy } = await import('../server/dist/deploy.js');

let echecs = 0;
const dire = (ok, texte, detail = '') => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}${detail ? ` — ${detail}` : ''}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
const identite = (cwd) => {
  git(cwd, 'config', 'user.email', 'essai@beluga');
  git(cwd, 'config', 'user.name', 'Essai');
};

/**
 * Un dépôt de travail ET son distant nu (« GitHub ») : `locales` sont créées
 * dans le dossier de travail, `distantes` uniquement chez le distant (poussées
 * depuis un second clone, comme une carte travaillée ailleurs).
 */
function monterDepot(nom, { locales = [], distantes = [] } = {}) {
  const distant = path.join(racine, `${nom}.git`);
  git(racine, 'init', '-q', '--bare', '-b', 'main', distant);
  const cwd = path.join(racine, nom);
  git(racine, 'clone', '-q', distant, cwd);
  identite(cwd);
  git(cwd, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(cwd, 'LISEZMOI.md'), 'départ\n');
  git(cwd, 'add', 'LISEZMOI.md');
  git(cwd, 'commit', '-q', '-m', 'départ');
  git(cwd, 'push', '-q', '-u', 'origin', 'main');

  for (const branche of locales) {
    git(cwd, 'checkout', '-q', '-b', branche, 'main');
    fs.writeFileSync(path.join(cwd, `${branche.replace(/\//g, '-')}.txt`), `travail local de ${branche}\n`);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-q', '-m', `travail de ${branche}`);
    git(cwd, 'checkout', '-q', 'main');
  }

  const ailleurs = path.join(racine, `${nom}-ailleurs`);
  git(racine, 'clone', '-q', distant, ailleurs);
  identite(ailleurs);
  for (const branche of distantes) {
    const base = locales.includes(branche) ? `origin/${branche}` : 'origin/main';
    if (locales.includes(branche)) git(cwd, 'push', '-q', 'origin', branche);
    git(ailleurs, 'fetch', '-q', 'origin');
    git(ailleurs, 'checkout', '-q', '-B', branche, base);
    fs.writeFileSync(path.join(ailleurs, `${branche.replace(/\//g, '-')}-distant.txt`), `travail distant de ${branche}\n`);
    git(ailleurs, 'add', '.');
    git(ailleurs, 'commit', '-q', '-m', `travail distant de ${branche}`);
    git(ailleurs, 'push', '-q', 'origin', branche);
  }
  return cwd;
}

/** Un projet d'essai posé sur un dépôt (et ses annexes), avec une carte par branche. */
function monterProjet(nom, cwd, branches, depots = []) {
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
    // `herite` : la procédure commune, sans processus écrit ni service à relancer.
    deploiement: { herite: true },
    ...(depots.length ? { depots } : {}),
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const cartes = branches.map((branche, i) =>
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
  return { projet, cartes };
}

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

const tache = (run, carte) => run?.taches?.find((t) => t.cardId === carte.id);
const rangee = (carte) => {
  const lue = store.getCard(carte.id);
  return !!lue?.deployedAt || lue?.column !== 'to_deploy';
};
/** Le fichier apporté par une branche est-il dans la branche d'accueil (« dev ») ? */
const dansLAccueil = (cwd, fichier) => git(cwd, 'ls-tree', '-r', '--name-only', 'dev').split('\n').includes(fichier);

/* ------------------------------------------------------------------ */
console.log('\n1. Une branche qui n’existe que sur GitHub');

const cwd1 = monterDepot('seulement-en-ligne', { locales: ['tache/ici'], distantes: ['tache/en-ligne'] });
dire(!git(cwd1, 'branch', '--list', 'tache/en-ligne').trim(), 'au départ, la branche n’existe PAS dans le dossier local');
const p1 = monterProjet('essai-seulement-en-ligne', cwd1, ['tache/ici', 'tache/en-ligne']);
const { lance: lance1, run: run1 } = await publierEtAttendre(p1.projet.id);
dire(lance1.ok, "la publication démarre", lance1.error ?? "");
dire(run1?.state === 'success', 'la publication réussit', run1?.error ?? run1?.state ?? '—');
dire(dansLAccueil(cwd1, 'tache-en-ligne-distant.txt'), 'le travail de la branche distante EST dans la branche d’accueil');
dire(dansLAccueil(cwd1, 'tache-ici.txt'), 'celui de la branche locale aussi');
dire(tache(run1, p1.cartes[1])?.etat === 'en-ligne', 'la carte distante est « en ligne »', tache(run1, p1.cartes[1])?.etat ?? '—');
dire(/tache\/en-ligne : rapatriée depuis GitHub/.test(run1?.steps.find((s) => s.key === 'merge')?.log ?? ''), 'le détail de l’étape DIT que la branche a été rapatriée');

/* ------------------------------------------------------------------ */
console.log('\n2. Une branche locale en retard sur GitHub');

const cwd2 = monterDepot('en-retard', { locales: ['tache/retard'], distantes: ['tache/retard'] });
const p2 = monterProjet('essai-en-retard', cwd2, ['tache/retard']);
const { run: run2 } = await publierEtAttendre(p2.projet.id);
dire(run2?.state === 'success', 'la publication réussit', run2?.error ?? run2?.state ?? '—');
dire(dansLAccueil(cwd2, 'tache-retard.txt'), 'le travail local est arrivé');
dire(dansLAccueil(cwd2, 'tache-retard-distant.txt'), 'ET le travail plus récent, poussé sur GitHub, aussi');

/* ------------------------------------------------------------------ */
console.log('\n3. Une branche introuvable partout, au milieu d’un lot');

const cwd3 = monterDepot('introuvable', { locales: ['tache/presente'] });
const p3 = monterProjet('essai-introuvable', cwd3, ['tache/presente', 'tache/fantome']);
const { run: run3 } = await publierEtAttendre(p3.projet.id);
const fantome = p3.cartes[1];
const lue = store.getCard(fantome.id);
dire(run3?.state === 'success', 'la publication des autres cartes réussit', run3?.error ?? run3?.state ?? '—');
dire(!lue?.deployedAt, 'la carte introuvable n’a PAS de date de mise en ligne');
dire(lue?.column === 'to_deploy', 'elle reste dans « À déployer »', lue?.column ?? '—');
dire(!run3?.cardIds.includes(fantome.id), 'elle ne compte pas parmi les cartes mises en ligne');
dire(tache(run3, fantome)?.etat === 'absente', 'sa ligne dit « branche absente »', tache(run3, fantome)?.etat ?? '—');
dire(/introuvable/.test(tache(run3, fantome)?.detail ?? ''), 'avec sa raison, en clair', tache(run3, fantome)?.detail ?? '—');
dire(!tache(run3, fantome)?.rattrapage, 'aucun rattrapage automatique n’est posé sur elle');
dire(/INTROUVABLE.*reste dans « À déployer »/.test(run3?.steps.find((s) => s.key === 'merge')?.log ?? ''), 'le détail de l’étape la nomme');
dire(rangee(p3.cartes[0]), 'la carte présente, elle, est bien mise en ligne');

/* ------------------------------------------------------------------ */
console.log('\n4. Un lot entièrement introuvable');

const cwd4 = monterDepot('lot-introuvable');
const p4 = monterProjet('essai-lot-introuvable', cwd4, ['tache/nulle-part']);
const { run: run4 } = await publierEtAttendre(p4.projet.id);
dire(run4?.state === 'failed', 'l’étape de fusion tombe', run4?.state ?? '—');
dire(/aucune carte du lot n’a été trouvé/i.test(run4?.steps.find((s) => s.key === 'merge')?.log ?? run4?.error ?? ''), 'et dit pourquoi', run4?.error ?? '—');
dire(!rangee(p4.cartes[0]), 'la carte reste dans « À déployer », sans date de mise en ligne');

/* ------------------------------------------------------------------ */
console.log('\n5. Un projet à deux dépôts, une branche dans un seul');

const cwd5 = monterDepot('reuni-principal', { locales: ['tache/principale'] });
const cwd5b = monterDepot('reuni-annexe', { locales: ['tache/annexe'] });
const p5 = monterProjet('essai-reuni', cwd5, ['tache/principale', 'tache/annexe'], [{ nom: 'annexe', path: cwd5b }]);
const { run: run5 } = await publierEtAttendre(p5.projet.id);
dire(run5?.state === 'success', 'la publication réussit', run5?.error ?? run5?.state ?? '—');
dire(dansLAccueil(cwd5b, 'tache-annexe.txt'), 'la branche de l’annexe est fusionnée dans l’annexe');
dire(p5.cartes.every((c) => rangee(c)), 'aucune carte n’est écartée pour une branche absente d’UN seul dépôt',
  p5.cartes.map((c) => `${c.github.branch} → ${tache(run5, c)?.etat ?? '—'}`).join(', '));

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} refus.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
