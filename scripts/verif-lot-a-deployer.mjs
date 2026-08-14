#!/usr/bin/env node
/**
 * « TOUT DÉPLOYER » NE DOIT JAMAIS ÊTRE MUET.
 *
 * Le bogue : le lot de « À déployer » écarte les cartes qui portent déjà une
 * date de mise en ligne. Rien n'effaçait cette date quand une carte REVENAIT
 * dans la colonne (repassée à la main depuis « En production », ou retravaillée
 * puis reposée là). Elle était alors écartée de TOUS les lots suivants : le
 * bouton annonçait « (0) », s'éteignait, et le clic ne partait nulle part —
 * aucune trace, aucun message.
 *
 * Quatre constats, joués de bout en bout sur des dépôts d'essai à soi :
 *
 * 1. une carte REPASSÉE dans « À déployer » perd sa vieille date, entre dans le
 *    lot et part RÉELLEMENT (branche fusionnée, carte déplacée) ;
 * 2. une carte encore piégée (date posée directement en base) est bien écartée,
 *    ET la règle du bouton NOMME la cause au lieu de se taire ;
 * 3. un déploiement qui ÉCHOUE le dit : état « failed », étape tombée, motif en
 *    français rendu par `messageEchecPublication` ;
 * 4. la sortie de « À déployer » ne perd PAS la date d'une carte déjà en ligne.
 *
 * Aucune base ni aucun dossier du serveur en service n'est touché :
 * HAIKODEV_DATA est détourné vers un dossier temporaire avant tout import.
 *
 *   node scripts/verif-lot-a-deployer.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais /root/haikodev en dur : lancé
   depuis une copie de travail, il doit juger CETTE copie. */
const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-lot-a-deployer-'));
process.env.HAIKODEV_DATA = path.join(racine, 'data');
fs.mkdirSync(process.env.HAIKODEV_DATA, { recursive: true });

const store = await import(path.join(racineDuDepot, 'server/dist/store.js'));
const { startDeploy, deployableCards } = await import(path.join(racineDuDepot, 'server/dist/deploy.js'));
const { rangerLaCarte } = await import(path.join(racineDuDepot, 'server/dist/deplacement-carte.js'));
const { raisonLotBloque, messageEchecPublication, natureDePublication } = await import(
  path.join(racineDuDepot, 'shared/dist/index.js')
);

let echecs = 0;
const dire = (ok, texte) => {
  if (!ok) echecs += 1;
  console.log(`${ok ? '  ok  ' : '  RATÉ'} ${texte}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** Un petit dépôt : une branche principale, une branche de carte à fusionner. */
function monterDepot(nom) {
  const cwd = path.join(racine, nom);
  fs.mkdirSync(cwd, { recursive: true });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'essai@haikodev');
  git(cwd, 'config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# essai\n');
  git(cwd, 'add', 'README.md');
  git(cwd, 'commit', '-q', '-m', 'départ');

  git(cwd, 'checkout', '-q', '-b', 'tache/essai');
  fs.writeFileSync(path.join(cwd, 'nouveau.txt'), 'le travail de la carte\n');
  git(cwd, 'add', 'nouveau.txt');
  git(cwd, 'commit', '-q', '-m', 'le travail de la carte');
  git(cwd, 'checkout', '-q', 'main');
  return cwd;
}

function monterProjet(nom, colonne, deployedAt) {
  const cwd = monterDepot(nom);
  const maintenant = Date.now();
  const projet = store.saveProject({
    id: store.newId(),
    name: nom,
    path: cwd,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1000,
    archived: false,
    /* Un projet neuf n'a plus de procédure de déploiement : sans elle, rien
       ne part. « Constaté » est le marqueur des projets d'avant — le déroulé
       de HaikoDev, du service système ou du dossier servi, inchangé. */
    deploiement: { constate: true },
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const carte = store.saveCard({
    id: store.newId(),
    projectId: projet.id,
    title: `Carte d'essai — ${nom}`,
    description: '',
    labels: [],
    column: colonne,
    position: 1,
    origin: 'user',
    run: { engine: 'claude' },
    excludedFromDeploy: false,
    horsTache: false,
    github: { branch: 'tache/essai' },
    deployedAt,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  return { projet, carte, cwd };
}

async function attendreFin(projectId, secondes = 180) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    const run = store.latestDeploy(projectId);
    if (run && run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 300));
  }
  return store.latestDeploy(projectId);
}

const etatDe = (run, cle) => run?.steps.find((s) => s.key === cle)?.state;

/* --- 1. Une carte REPASSÉE dans « À déployer » repart bel et bien ----- */

console.log('\n1. Une carte repassée de « En production » vers « À déployer »');
const repassee = monterProjet('essai-repassee', 'in_production', Date.now() - 3600_000);

// Le chemin RÉEL du déplacement à la main (`card.move` passe par là), pas une
// écriture directe en base : sortir une carte d'« En production » est un geste
// réservé à l'utilisateur, aucun agent ne peut le rejouer.
rangerLaCarte(store.getCard(repassee.carte.id), 'to_deploy');
dire(
  store.getCard(repassee.carte.id)?.column === 'to_deploy',
  'la carte est bien revenue dans « À déployer »',
);
dire(
  !store.getCard(repassee.carte.id)?.deployedAt,
  'la vieille date de mise en ligne est PÉRIMÉE en entrant dans « À déployer »',
);

const lot = deployableCards(repassee.projet.id, 'to_deploy');
dire(lot.some((c) => c.id === repassee.carte.id), 'la carte entre de nouveau dans le lot à déployer');

const lance = await startDeploy(repassee.projet.id);
dire(lance.ok === true, 'la publication démarre');
const run = await attendreFin(repassee.projet.id);
dire(run?.state === 'success', `elle aboutit (état « ${run?.state} »)`);
dire(etatDe(run, 'merge') === 'done', 'la branche de la carte est fusionnée dans la principale');
dire(
  fs.existsSync(path.join(repassee.cwd, 'nouveau.txt')),
  'le travail de la carte est RÉELLEMENT sur la branche principale',
);
dire(
  store.getCard(repassee.carte.id)?.column === 'in_production',
  'la carte a CHANGÉ de colonne : « À déployer » → « En production »',
);

/* --- 2. Une carte encore piégée : écartée, mais la cause est DITE ----- */

console.log('\n2. Une carte piégée par une date périmée : le bouton doit parler');
const piegee = monterProjet('essai-piegee', 'to_deploy', Date.now() - 7200_000);
const lotPiege = deployableCards(piegee.projet.id, 'to_deploy');
dire(lotPiege.length === 0, 'le garde-fou écarte bien la carte du lot');

const raison = raisonLotBloque({ verbe: 'déployer', aPublier: 0, cartesDansLaColonne: 1 });
dire(!!raison, 'le bouton éteint rend une raison, jamais rien');
dire(/date de mise en ligne/.test(raison ?? ''), `la cause est nommée : « ${raison} »`);

const raisonPrete = raisonLotBloque({ verbe: 'déployer', aPublier: 2, cartesDansLaColonne: 2 });
dire(raisonPrete === null, 'un lot prêt à partir n’a rien à expliquer');

/* --- 3. Un déploiement qui ÉCHOUE le DIT ----------------------------- */

console.log('\n3. Un échec provoqué doit être annoncé, avec sa cause');
const casse = monterProjet('essai-casse', 'to_deploy');
// Une construction qui tombe : l'étape « build » doit échouer et le dire.
fs.writeFileSync(
  path.join(casse.cwd, 'package.json'),
  JSON.stringify({ name: 'essai-casse', scripts: { build: 'exit 3' } }, null, 2),
);
git(casse.cwd, 'add', 'package.json');
git(casse.cwd, 'commit', '-q', '-m', 'un script de construction qui tombe');

const lanceCasse = await startDeploy(casse.projet.id);
dire(lanceCasse.ok === true, 'la publication démarre');
const runCasse = await attendreFin(casse.projet.id, 300);
dire(runCasse?.state === 'failed', `elle échoue franchement (état « ${runCasse?.state} »)`);
const tombee = runCasse?.steps.find((s) => s.state === 'failed')?.key;
dire(!!tombee, `une étape est marquée en échec (« ${tombee} »)`);
dire(!!runCasse?.error?.trim(), `le motif est écrit en clair : « ${runCasse?.error?.slice(0, 90)} »`);
const nature = natureDePublication({ etat: 'failed', etapeTombee: tombee, motif: runCasse?.error });
dire(nature === 'cassee', 'l’échec est qualifié de CASSÉ, pas d’interruption');
const message = messageEchecPublication({
  projet: casse.projet.name,
  etape: 'Construction',
  raison: runCasse?.error ?? '',
  nature: nature ?? undefined,
});
dire(/en échec/.test(message) && message.includes(casse.projet.name), `le message à l’écran : « ${message}` + '»');
dire(
  store.getCard(casse.carte.id)?.column === 'to_deploy',
  'la carte reste dans « À déployer » : rien n’a été menti',
);

/* --- 4. Sortir de « À déployer » ne perd PAS la date déjà acquise ----- */

console.log('\n4. Une carte qui QUITTE « À déployer » garde sa trace');
const gardee = monterProjet('essai-gardee', 'to_deploy');
store.saveCard({ ...store.getCard(gardee.carte.id), deployedAt: 1234567890 });
rangerLaCarte(store.getCard(gardee.carte.id), 'in_production');
dire(
  store.getCard(gardee.carte.id)?.column === 'in_production',
  'la carte est bien passée en « En production »',
);
dire(
  store.getCard(gardee.carte.id)?.deployedAt === 1234567890,
  'la date de mise en ligne est intacte : c’est la trace de son passage en ligne',
);

fs.rmSync(racine, { recursive: true, force: true });
console.log(echecs ? `\n${echecs} vérification(s) en échec.` : '\nTout est vérifié.');
process.exit(echecs ? 1 : 0);
