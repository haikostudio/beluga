import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOIEMENTS_MONTRES_MAX,
  avecLesLignes,
  cheminApresRenommage,
  deploiementsDeLaCarte,
  lignesDepuisNumstat,
  totalDesLignes,
  etapesAMontrer,
  etatDepuisGit,
  fichiersDepuisNameStatus,
  libelleCibleDeploiement,
  libelleEtapeDeploiement,
  phraseDesFichiers,
  resumeDeBranche,
  resumeDesFichiers,
} from '@haikodev/shared';
import type { DeployRun } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Les fichiers touchés par la branche                                  */
/* ------------------------------------------------------------------ */

test('la lettre de git dit le sort du fichier', () => {
  assert.equal(etatDepuisGit('A'), 'ajoute');
  assert.equal(etatDepuisGit('M'), 'modifie');
  assert.equal(etatDepuisGit('D'), 'supprime');
  assert.equal(etatDepuisGit('R096'), 'renomme');
  // Une lettre inconnue ne fait pas taire le fichier.
  assert.equal(etatDepuisGit('T'), 'modifie');
  assert.equal(etatDepuisGit(''), 'modifie');
});

test('un renommage garde le chemin NOUVEAU, le seul qui existe encore', () => {
  const fichiers = fichiersDepuisNameStatus(
    ['A\tweb/src/neuf.tsx', 'M\tserver/src/github.ts', 'D\tvieux.md', 'R096\tancien.md\tnouveau.md'].join('\n'),
  );
  assert.deepEqual(fichiers, [
    { chemin: 'web/src/neuf.tsx', etat: 'ajoute' },
    { chemin: 'server/src/github.ts', etat: 'modifie' },
    { chemin: 'vieux.md', etat: 'supprime' },
    { chemin: 'nouveau.md', etat: 'renomme' },
  ]);
});

test('les lignes vides et les doublons ne comptent pas', () => {
  const fichiers = fichiersDepuisNameStatus('\nM\ta.ts\n\nM\ta.ts\nbruit\n');
  assert.deepEqual(fichiers, [{ chemin: 'a.ts', etat: 'modifie' }]);
});

test('les lignes ajoutées et supprimées se lisent fichier par fichier, comme git', () => {
  const lignes = lignesDepuisNumstat(
    ['12\t3\tweb/src/neuf.tsx', '0\t7\tvieux.md', '-\t-\timages/capture.png', 'bruit'].join('\n'),
  );
  assert.deepEqual(lignes.get('web/src/neuf.tsx'), { ajoutees: 12, supprimees: 3 });
  assert.deepEqual(lignes.get('vieux.md'), { ajoutees: 0, supprimees: 7 });
  // Un binaire n'a pas de compte : rien, plutôt qu'un zéro qui mentirait.
  assert.deepEqual(lignes.get('images/capture.png'), { ajoutees: undefined, supprimees: undefined });
  assert.equal(lignes.size, 3);
});

test('un renommage rend le chemin NOUVEAU, sous ses deux écritures', () => {
  assert.equal(cheminApresRenommage('ancien.md => nouveau.md'), 'nouveau.md');
  assert.equal(cheminApresRenommage('docs/{ancien => nouveau}/page.md'), 'docs/nouveau/page.md');
  assert.equal(cheminApresRenommage('docs/{ => nouveau}/page.md'), 'docs/nouveau/page.md');
  assert.equal(cheminApresRenommage('simple.ts'), 'simple.ts');
});

test('les fichiers reçoivent leurs lignes ; sans relevé, ils restent muets', () => {
  const fichiers = avecLesLignes(
    [
      { chemin: 'a.ts', etat: 'modifie' },
      { chemin: 'b.png', etat: 'ajoute' },
    ],
    lignesDepuisNumstat('4\t1\ta.ts'),
  );
  assert.deepEqual(fichiers[0], { chemin: 'a.ts', etat: 'modifie', ajoutees: 4, supprimees: 1 });
  assert.deepEqual(fichiers[1], { chemin: 'b.png', etat: 'ajoute' });
  assert.deepEqual(totalDesLignes(fichiers), { ajoutees: 4, supprimees: 1 });
});

test('le compte sépare ajoutés, modifiés et supprimés — un renommage compte comme une modification', () => {
  const resume = resumeDesFichiers([
    { chemin: 'a', etat: 'ajoute' },
    { chemin: 'b', etat: 'ajoute' },
    { chemin: 'c', etat: 'modifie' },
    { chemin: 'd', etat: 'renomme' },
    { chemin: 'e', etat: 'supprime' },
  ]);
  assert.deepEqual(resume, { ajoutes: 2, modifies: 2, supprimes: 1, total: 5 });
  assert.equal(phraseDesFichiers(resume), '2 ajoutés · 2 modifiés · 1 supprimé');
});

test('la phrase tait les zéros, et le dit quand rien n’a bougé', () => {
  assert.equal(phraseDesFichiers({ ajoutes: 1, modifies: 0, supprimes: 0, total: 1 }), '1 ajouté');
  assert.equal(phraseDesFichiers({ ajoutes: 0, modifies: 0, supprimes: 0, total: 0 }), 'aucun fichier touché');
});

/* ------------------------------------------------------------------ */
/* Le déroulé du déploiement                                            */
/* ------------------------------------------------------------------ */

function publication(patch: Partial<DeployRun>): DeployRun {
  return {
    id: 'run',
    projectId: 'p',
    state: 'success',
    steps: [],
    cardIds: [],
    reprises: 0,
    repriseApresCoupure: false,
    queued: false,
    startedAt: 1,
    ...patch,
  } as DeployRun;
}

test('une carte ne voit que les publications qui la NOMMENT, la plus récente d’abord', () => {
  const runs = [
    publication({ id: 'vieux', cardIds: ['c1'], startedAt: 10 }),
    publication({ id: 'autre', cardIds: ['c2'], startedAt: 20 }),
    publication({ id: 'frais', cardIds: ['c1', 'c2'], startedAt: 30 }),
  ];
  assert.deepEqual(
    deploiementsDeLaCarte(runs, 'c1').map((r) => r.id),
    ['frais', 'vieux'],
  );
});

test('une carte reprise dix fois ne déroule pas dix publications', () => {
  const runs = Array.from({ length: 8 }, (_, i) => publication({ id: `r${i}`, cardIds: ['c1'], startedAt: i }));
  assert.equal(deploiementsDeLaCarte(runs, 'c1').length, DEPLOIEMENTS_MONTRES_MAX);
});

test('une étape « à faire » disparaît d’une publication finie, elle reste sur une publication qui tourne', () => {
  const etapes = [
    { key: 'merge' as const, state: 'done' as const, log: '' },
    { key: 'push' as const, state: 'todo' as const, log: '' },
  ];
  assert.equal(etapesAMontrer(publication({ state: 'failed', steps: etapes })).length, 1);
  assert.equal(etapesAMontrer(publication({ state: 'running', steps: etapes })).length, 2);
});

test('chaque étape et chaque cible se disent en français', () => {
  assert.equal(libelleEtapeDeploiement('merge'), 'Fusion de la branche');
  assert.equal(libelleEtapeDeploiement('publish'), 'Mise en ligne');
  assert.equal(libelleCibleDeploiement('production'), 'Mise en production');
  assert.equal(libelleCibleDeploiement(undefined), 'Déploiement');
});

/* ------------------------------------------------------------------ */
/* L'état de la branche                                                 */
/* ------------------------------------------------------------------ */

test('sans relevé, l’état de la branche ne s’invente pas', () => {
  assert.equal(resumeDeBranche({}).etat, 'inconnue');
  assert.equal(resumeDeBranche({ branch: 'tache/x' }).etat, 'inconnue');
});

test('une branche relevée dit si elle a rejoint la principale, et laquelle', () => {
  const ouverte = resumeDeBranche({ branch: 'tache/x', branchePrincipale: 'main', fetchedAt: 1 });
  assert.equal(ouverte.etat, 'ouverte');
  assert.match(ouverte.phrase, /main/);

  const fusionnee = resumeDeBranche({ branch: 'tache/x', branchePrincipale: 'main', fusionnee: true, fetchedAt: 1 });
  assert.equal(fusionnee.etat, 'fusionnee');
  assert.match(fusionnee.phrase, /Fusionnée/);
});
