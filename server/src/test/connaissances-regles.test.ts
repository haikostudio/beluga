import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FICHES_GLOBAL,
  FICHES_PROJET,
  PORTEE_GLOBALE,
  TYPES_UNITE,
  categorieDuTexte,
  detailAuGabarit,
  entreesDepuisGit,
  ficheDeLUnite,
  ficheDuType,
  ficheParNom,
  formaterIdentifiant,
  jugerProposition,
  lireLigneDHistorique,
  lirePropositionsDuModele,
  recopieMotPourMot,
  rendreChangelog,
  rendreFicheNumerotee,
  reunirLeChangelog,
  scoreDUnite,
  sujetDeProjetDeCompetence,
  texteDAccueilConnaissances,
  titreEtResumeDuFait,
  titreEnglobe,
  titreNormalise,
  typeDuFait,
  typeReconnu,
  typesProbables,
  uniteDansLaFiche,
  type Unite,
} from '@beluga/shared';

/*
 * LA BASE DE CONNAISSANCES, EN RÈGLES PURES (`shared/src/connaissances.ts`) :
 * taxonomie et fiche d'arrivée, jugement d'une proposition (quatre questions,
 * contenus interdits), gabarits, rendu des fiches, changelog tiré de git et de
 * l'historique, pondération et accueil.
 */

function unite(partiel: Partial<Unite>): Unite {
  return {
    id: 'MEM-0001',
    portee: 'p1',
    type: 'convention',
    sujets: [],
    titre: 'Une convention',
    resume: 'Les scripts de vérification visent le serveur de développement, jamais l’application publiée.',
    detail: '',
    raisonnement: '',
    statut: 'active',
    importance: 'P2',
    confiance: 0.9,
    source: { genre: 'carte', ref: 'tache/essai' },
    liens: [],
    supersedes: null,
    supersededBy: null,
    jamaisSupposer: false,
    relue: false,
    version: 1,
    auteur: 'essai',
    creeLe: Date.UTC(2026, 8, 1),
    modifieLe: Date.UTC(2026, 8, 1),
    ...partiel,
  };
}

test('chaque type de la taxonomie a UNE fiche d’arrivée, au projet comme au global', () => {
  assert.equal(TYPES_UNITE.length, 14);
  for (const type of TYPES_UNITE) {
    assert.equal(FICHES_PROJET.filter((f) => f.types.includes(type)).length, 1, `projet : ${type}`);
    assert.equal(FICHES_GLOBAL.filter((f) => f.types.includes(type)).length, 1, `global : ${type}`);
  }
  assert.equal(FICHES_PROJET[0].id, '00_project');
  assert.equal(FICHES_PROJET.at(-1)!.id, '13_skills');
  assert.equal(FICHES_GLOBAL.at(-1)!.id, '07_skills');
  assert.equal(ficheDuType('p1', 'decision').id, '05_decisions');
  assert.equal(ficheDuType(PORTEE_GLOBALE, 'decision').id, '03_decisions');
  assert.equal(ficheParNom('p1', '05')?.id, '05_decisions');
  assert.equal(ficheParNom('p1', 'decisions')?.id, '05_decisions');
  assert.equal(ficheParNom('p1', 'Décisions')?.id, '05_decisions');
  assert.equal(formaterIdentifiant('decision', 7), 'DEC-007');
  assert.equal(formaterIdentifiant('lesson', 42), 'MEM-0042');
});

test('une proposition propre passe, et une décision est remise au gabarit ADR', () => {
  const j = jugerProposition({
    type: 'decision',
    importance: 'p1',
    titre: 'La base fait foi, les fiches sont rendues',
    resume: 'Les unités vivent en base ; les fichiers Markdown numérotés sont régénérés à chaque écriture.',
    detail: 'Les fichiers servent à la lecture humaine.',
    raisonnement: 'La recherche pondérée et le dédoublonnage ont besoin de la base.',
    sujets: 'Mémoire, recherche',
  });
  assert.equal(j.ok, true);
  if (!j.ok) return;
  assert.equal(j.propre.importance, 'P1');
  assert.deepEqual(j.propre.sujets, ['memoire', 'recherche']);
  assert.match(j.propre.detail, /^### Contexte\n\n_Non renseigné\._\n\n### Décision\n\nLes fichiers servent à la lecture humaine\.\n\n### Conséquences/);
});

test('le moteur refuse ce qui ne se mémorise pas, en disant pourquoi', () => {
  const base = { type: 'lesson', importance: 'P2', titre: 'Un titre correct' };
  const refus = (resume: string, extra: object = {}) => {
    const j = jugerProposition({ ...base, resume, ...extra });
    assert.equal(j.ok, false, resume);
    return j.ok ? [] : j.raisons;
  };
  assert.match(refus('La carte a ajouté un bouton de régénération à l’écran Mémoire.').join(), /Durable \?/);
  assert.match(refus('Le démon plante probablement à cause du vectoriseur au démarrage.').join(), /Vérifié \?/);
  assert.match(refus('Je pense que la migration doit être rejouée après la bascule.').join(), /Utile \?/);
  assert.match(refus('git status').join(), /Non trivial|résumé manque/);
  assert.match(
    refus('Trace du démarrage du démon relevée sur le serveur.', {
      detail: '12:00:01 [info] départ\n12:00:02 [warn] lent\n12:00:03 [error] tombé',
    }).join(),
    /journal/,
  );
  assert.match(refus('Un résumé correct et assez long pour passer les bornes.', { type: 'opinion' }).join(), /hors taxonomie/);
  assert.match(jugerProposition({ action: 'update', resume: 'x' }).ok ? '' : 'id', /id/);
});

test('le détail d’un composant garde une section inconnue après le gabarit', () => {
  const d = detailAuGabarit('component', '### Fichiers\n\n`web/src/x.tsx`\n\n### Pièges\n\nNe pas confondre.');
  assert.match(d, /^### Rôle\n\n_Non renseigné\._/);
  assert.ok(d.indexOf('### Fichiers') < d.indexOf('### Pièges'));
});

test('la fiche 00 porte « À ne jamais supposer » et les P0 des autres fiches ; les dépréciées n’y sont pas', () => {
  const unites = [
    unite({ id: 'MEM-0001', type: 'project', importance: 'P0', titre: 'Beluga pilote des agents' }),
    unite({ id: 'MEM-0002', type: 'environment', importance: 'P0', titre: 'Le démon écoute sur 7070', jamaisSupposer: true }),
    unite({ id: 'MEM-0003', type: 'project', statut: 'deprecated', titre: 'Ancienne description' }),
  ];
  const md = rendreFicheNumerotee({ portee: 'p1', nomDeLaPortee: 'Beluga', fiche: FICHES_PROJET[0], unites }, unites);
  assert.match(md, /^# 00 — Projet — Beluga/);
  assert.match(md, /## À ne jamais supposer\n\n- \*\*MEM-0002\*\* — Le démon écoute sur 7070/);
  assert.match(md, /## Unités vitales \(P0\) ailleurs dans la base\n\n- \*\*MEM-0002\*\* \(09_environment\)/);
  assert.match(md, /## MEM-0001 — Beluga pilote des agents/);
  assert.doesNotMatch(md, /Ancienne description/);
});

test('le changelog tiré de git : une entrée par fusion de tâche, le texte de son dernier commit, sans le bruit', () => {
  const commits = [
    { hash: 'm2', parents: ['c3', 'b2'], date: '2026-09-13T12:00:00Z', sujet: "Merge branch 'tache/memoire-1fa02d' into dev" },
    { hash: 'b2', parents: ['b1'], date: '2026-09-13T11:00:00Z', sujet: 'Mémoire : un classeur par projet' },
    { hash: 'b1', parents: ['c2'], date: '2026-09-13T10:00:00Z', sujet: 'Travaux en cours enregistrés avant publication' },
    { hash: 'c3', parents: ['c2'], date: '2026-09-12T10:00:00Z', sujet: 'Corrige la migration sautée' },
    { hash: 'c2', parents: ['c1'], date: '2026-09-11T10:00:00Z', sujet: 'Travaux en cours enregistrés avant publication' },
  ];
  const entrees = entreesDepuisGit('p1', commits);
  assert.deepEqual(
    entrees.map((e) => [e.jour, e.categorie, e.texte, e.branche]),
    [
      ['2026-09-13', 'Modifié', 'Mémoire : un classeur par projet', 'tache/memoire-1fa02d'],
      ['2026-09-12', 'Corrigé', 'Corrige la migration sautée', null],
    ],
  );
  assert.deepEqual(entrees[0].commits, ['m2', 'b2']);
});

test('historique et cartes rejoignent git sans doublon, et le rendu groupe par jour puis catégorie', () => {
  const git = entreesDepuisGit('p1', [
    { hash: 'm1', parents: ['a', 'b'], date: '2026-09-08T12:00:00Z', sujet: "Merge branch 'tache/badge-12ab34' into dev" },
    { hash: 'b', parents: ['a'], date: '2026-09-08T11:00:00Z', sujet: 'wip badge' },
  ]);
  const h1 = lireLigneDHistorique('p1', '- 08.09.2026 : « Badge de messages non lus » livrée et publiée.');
  const h2 = lireLigneDHistorique('p1', '- 03.08.2026 : « Supprimer deux dossiers inutilisés » livrée.');
  assert.equal(h1?.jour, '2026-09-08');
  assert.equal(h1?.publication, 'publiée le 2026-09-08');
  assert.equal(h2?.categorie, 'Retiré');
  const tout = reunirLeChangelog({
    git,
    historique: [h1!, h2!],
    cartes: [{ id: 'carte-1234567', titre: 'Badge de messages non lus', branche: 'tache/badge-12ab34', livreeLe: Date.UTC(2026, 8, 8) }],
  });
  assert.equal(tout.length, 2, 'la ligne d’historique qui redit la carte fusionnée ne se redit pas');
  assert.equal(tout[0].texte, 'Badge de messages non lus');
  assert.deepEqual(tout[0].cartes, ['carte-1234567']);
  const md = rendreChangelog('Beluga', tout);
  assert.match(md, /## 2026-09-08\n\n### Améliorations\n\n- \*\*Badge de messages non lus\*\* _\(tache\/badge-12ab34/);
  assert.ok(md.indexOf('2026-09-08') < md.indexOf('2026-08-03'));
  assert.equal(categorieDuTexte('Répare la fusion du lot'), 'Corrigé');
});

test('la pondération suit 45/20/15/10/10, et les types probables se lisent dans la demande', () => {
  const maintenant = Date.UTC(2026, 8, 13);
  const fort = scoreDUnite({ similarite: 1, importance: 'P0', type: 'decision', typesVises: ['decision'], modifieLe: maintenant, liens: 4, maintenant });
  assert.equal(fort, 1);
  const faible = scoreDUnite({ similarite: 0, importance: 'P3', type: 'lesson', typesVises: ['decision'], modifieLe: maintenant - 3650 * 86_400_000, liens: 0, maintenant });
  assert.ok(faible < 0.1);
  assert.ok(typesProbables('pourquoi avoir choisi SQLite ?').includes('decision'));
  assert.ok(typesProbables('le déploiement plante au redémarrage').includes('issue'));
});

test('l’accueil tient sous son plafond et compte ce qui déborde', () => {
  const vitales = Array.from({ length: 80 }, (_, i) => unite({ id: `MEM-${String(i).padStart(4, '0')}`, importance: 'P1', titre: `Règle numéro ${i}` }));
  const texte = texteDAccueilConnaissances({
    nomDuProjet: 'Beluga',
    tete: [unite({ type: 'project', importance: 'P0', titre: 'Beluga pilote des agents' })],
    jamaisSupposer: [],
    vitales,
    changelog: [],
    totalUnites: 81,
    plafond: 3000,
  });
  assert.ok(texte.length <= 3200);
  assert.match(texte, /00 — PROJET/);
  assert.match(texte, /hors plafond/);
});

test('remember : titre, résumé et type devinés d’une ligne', () => {
  // Une suite qui commence par un article ou un pronom ne se lit pas seule : le résumé garde la ligne entière.
  assert.deepEqual(titreEtResumeDuFait('Vecteurs : le modèle e5-small vit dans data/vectoriseur/modeles.'), {
    titre: 'Vecteurs',
    resume: 'Vecteurs : le modèle e5-small vit dans data/vectoriseur/modeles.',
  });
  assert.deepEqual(titreEtResumeDuFait('Scripts de contrôle qui écrivent : ils visent la PRODUCTION par défaut'), {
    titre: 'Scripts de contrôle qui écrivent',
    resume: 'Scripts de contrôle qui écrivent : ils visent la PRODUCTION par défaut',
  });
  // Une suite qui commence par un identifiant se lit seule : inchangée.
  assert.deepEqual(titreEtResumeDuFait('Vecteurs : data/vectoriseur/modeles contient le modèle e5-small.'), {
    titre: 'Vecteurs',
    resume: 'data/vectoriseur/modeles contient le modèle e5-small.',
  });
  assert.equal(typeDuFait('Piège : npm install saute les dépendances de développement'), 'lesson');
  assert.equal(titreNormalise('La base fait foi !'), 'base fait foi');
});

test('la sortie d’un modèle se relit même entourée de texte, et une recopie mot pour mot se voit', () => {
  assert.equal(lirePropositionsDuModele('Voici :\n```json\n[{"type":"lesson","titre":"x"}]\n```').length, 1);
  assert.deepEqual(lirePropositionsDuModele('rien'), []);
  const matiere = 'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq fin';
  assert.equal(recopieMotPourMot(matiere, `avant ${matiere} après`), true);
  assert.equal(recopieMotPourMot('une phrase réécrite et courte', matiere), false);
});

test('les fusions GitHub et les fusions au sujet libre entrent au changelog', () => {
  const entrees = entreesDepuisGit('p1', [
    { hash: 'r1', parents: ['m1', 'x9'], date: '2026-09-10T12:00:00Z', sujet: 'Release prod : vitrine et paiement in-app' },
    { hash: 'm1', parents: ['a1', 'f2'], date: '2026-09-09T12:00:00Z', sujet: 'Merge pull request #45 from haikostudio/feat/changelog-historique' },
    { hash: 'f2', parents: ['a1'], date: '2026-09-09T11:00:00Z', sujet: 'feat(central): changelog historique' },
    { hash: 'a1', parents: ['a0'], date: '2026-09-08T11:00:00Z', sujet: 'Merge pull request #44 from haikostudio/release-dev-to-main' },
  ]);
  assert.deepEqual(
    entrees.map((e) => [e.jour, e.categorie, e.texte, e.branche]),
    [
      ['2026-09-10', 'Modifié', 'Release prod : vitrine et paiement in-app', null],
      ['2026-09-09', 'Ajouté', 'feat(central): changelog historique', 'feat/changelog-historique'],
    ],
  );
});

test('la génération ramène les mots courants à un type de la taxonomie', () => {
  assert.equal(typeReconnu('Piège'), 'lesson');
  assert.equal(typeReconnu('regle'), 'convention');
  assert.equal(typeReconnu('infrastructure'), 'environment');
  assert.equal(typeReconnu('credential'), 'security');
  assert.equal(typeReconnu('decision'), 'decision');
  assert.equal(typeReconnu('opinion'), null);
});

test('une compétence se range dans la fiche « Compétences », au global ou dans le projet qui la nomme', () => {
  const globale = unite({ portee: PORTEE_GLOBALE, type: 'operation', source: { genre: 'competence', ref: 'deploiement' }, sujets: ['competences'] });
  const duProjet = unite({ portee: PORTEE_GLOBALE, type: 'operation', source: { genre: 'competence', ref: 'ecran' }, sujets: ['competences', sujetDeProjetDeCompetence('p1')] });
  const fGlobal = FICHES_GLOBAL.find((f) => f.id === '07_skills')!;
  const fOperations = FICHES_GLOBAL.find((f) => f.id === '05_operations')!;
  const fProjet = FICHES_PROJET.find((f) => f.id === '13_skills')!;
  assert.equal(ficheDeLUnite(globale).id, '07_skills');
  assert.equal(uniteDansLaFiche(fGlobal, globale), true);
  assert.equal(uniteDansLaFiche(fOperations, globale), false);
  assert.equal(uniteDansLaFiche(fGlobal, duProjet), false);
  assert.equal(uniteDansLaFiche(fProjet, duProjet, 'p1'), true);
  assert.equal(uniteDansLaFiche(fProjet, duProjet, 'p2'), false);
  assert.equal(uniteDansLaFiche(fProjet, globale, 'p1'), false);
  const ordinaire = unite({ portee: PORTEE_GLOBALE, type: 'operation' });
  assert.equal(uniteDansLaFiche(fOperations, ordinaire), true);
  assert.equal(uniteDansLaFiche(fGlobal, ordinaire), false);
});

test('titreEnglobe : un titre contenu en entier dans l’autre, à 4 mots au moins, et rien de plus', () => {
  const court = 'La liste des agents se lit par un curseur unique';
  const long = 'La liste des agents se lit par un curseur unique : updatedAt puis id, archives mêlées';
  assert.equal(titreEnglobe(court, long), true);
  assert.equal(titreEnglobe(long, court), true, 'symétrique');
  assert.equal(titreEnglobe('Le curseur unique', 'Le curseur unique : updatedAt puis id'), false, 'moins de 4 mots');
  assert.equal(
    titreEnglobe('Une seule navigation : la colonne de gauche porte les projets', 'La colonne de gauche liste les projets et les agents'),
    false,
    'un recouvrement partiel ne suffit pas',
  );
});
