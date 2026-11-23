import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  demandeDeRedactionChangelog,
  estDuBruitDeChangelog,
  jugerRedactionChangelog,
  lireRedactionsDuModele,
  poidsDeLEntree,
  poidsDuMot,
  rendreChangelog,
  texteDAccueilConnaissances,
  titreDeLEntree,
  type EntreeDuChangelog,
  type Unite,
} from '@beluga/shared';

/*
 * LE CHANGELOG QUI RACONTE : chaque entrée a un titre clair, une explication et
 * un poids. Une ligne pauvre est refusée ; les grandes nouveautés passent devant
 * au rendu ; la reprise du passé réécrit sans rien effacer (les doublons sont
 * masqués).
 */

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-redige-'));
process.env.BELUGA_DATA = DONNEES;
const k = await import('../connaissances.js');
const { getDb } = await import('../db.js');
const { extraitDuCompteRendu } = await import('../redaction-changelog.js');

const PROJET = 'p-journal';
getDb()
  .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
  .run(PROJET, 'Journal', DONNEES, '{}', Date.now(), Date.now());

const entree = (e: Partial<EntreeDuChangelog>): EntreeDuChangelog => ({
  projectId: PROJET,
  jour: '2026-09-12',
  categorie: 'Modifié',
  texte: 'ligne',
  branche: null,
  commits: [],
  cartes: [],
  unites: [],
  publication: null,
  source: 'git',
  at: 1,
  ...e,
});

test('une rédaction pauvre est refusée avec sa raison, une bonne passe', () => {
  const explication = 'Les rapports PDF sont produits par le serveur lui-même. Plus besoin d’un service extérieur payant, et les documents sortent plus vite.';
  assert.equal(jugerRedactionChangelog({ titre: 'PDF', explication, poids: 'grande-nouveaute' }).ok, false);
  assert.equal(jugerRedactionChangelog({ titre: 'tache/pdf-interne-1a2b3c', explication, poids: 'grande-nouveaute' }).ok, false);
  assert.equal(jugerRedactionChangelog({ titre: 'Génération des PDF sur place', explication: 'Changé.', poids: 'amelioration' }).ok, false);
  assert.equal(jugerRedactionChangelog({ titre: 'Génération des PDF sur place', explication, poids: 'gros' }).ok, false);
  const bon = jugerRedactionChangelog({ titre: 'feat: Génération des PDF sur place', explication, poids: 'Grande nouveauté' });
  assert.ok(bon.ok);
  assert.equal(bon.ok && bon.titre, 'Génération des PDF sur place', 'le préfixe de commit tombe');
  assert.equal(bon.ok && bon.poids, 'grande-nouveaute');
  // La reprise du passé est souple : un détail peut rester sans explication.
  assert.ok(jugerRedactionChangelog({ titre: 'Redémarrage du serveur de développement', poids: 'detail' }, { souple: true }).ok);
});

test('le poids se lit, le bruit se replie en détail, le titre retombe sur la ligne d’origine', () => {
  assert.equal(poidsDuMot('amélioration'), 'amelioration');
  assert.equal(estDuBruitDeChangelog('Résolution : fusion de main dans la branche hexapro'), true);
  assert.equal(estDuBruitDeChangelog('Génération PDF internalisée, sans Restpack'), false);
  assert.equal(estDuBruitDeChangelog('docs: le port du serveur de dev est 15018'), true);
  assert.equal(poidsDeLEntree(entree({ texte: 'Redémarrage de dev en échec', categorie: 'Modifié' })), 'detail');
  assert.equal(poidsDeLEntree(entree({ texte: 'Corrige la bascule de langue', categorie: 'Corrigé' })), 'correction');
  assert.equal(titreDeLEntree(entree({ texte: 'fix(mail): rétablir l’envoi' })), 'Rétablir l’envoi');
});

test('le rendu met les grandes nouveautés devant, avec leur explication, et l’accueil laisse le bruit', () => {
  const entrees = [
    entree({ texte: 'Redémarrage de dev en échec', at: 3 }),
    entree({ texte: 'Génération PDF internalisée, sans Restpack', titre: 'Les PDF se fabriquent sur place', explication: 'Les rapports sont produits par le serveur. Plus de service extérieur.', poids: 'grande-nouveaute', at: 2 }),
  ];
  const md = rendreChangelog('Journal', entrees);
  assert.ok(md.indexOf('### Grandes nouveautés') < md.indexOf('### Détails'));
  assert.match(md, /- \*\*Les PDF se fabriquent sur place\*\* — Les rapports sont produits par le serveur/);
  const accueil = texteDAccueilConnaissances({ nomDuProjet: 'Journal', tete: [], jamaisSupposer: [], vitales: [], changelog: entrees, totalUnites: 0 });
  assert.match(accueil, /Grande nouveauté · Les PDF se fabriquent sur place — Les rapports/);
  assert.doesNotMatch(accueil, /Redémarrage/);
});

test('la demande au modèle porte les consignes, et sa réponse se relit', () => {
  const demande = demandeDeRedactionChangelog({ nomDuProjet: 'Journal', entrees: [{ cle: 'e1', jour: '2026-09-12', texte: 'PDF interne', contexte: 'Plus de Restpack' }] });
  assert.match(demande, /grande-nouveaute/);
  assert.match(demande, /### e1 — 2026-09-12/);
  const lues = lireRedactionsDuModele('Voici :\n```json\n[{"cle":"e1","titre":"t","explication":"x","poids":"detail","fusionneAvec":["e2","e1"]}]\n```');
  assert.deepEqual(lues[0].fusionneAvec, ['e2']);
  assert.deepEqual(lireRedactionsDuModele('rien'), []);
});

test('la reprise du passé réécrit par empreinte et masque les doublons sans les effacer', () => {
  k.importerLeChangelog(PROJET, [
    entree({ texte: 'Génération PDF internalisée, sans Restpack', at: 10 }),
    entree({ texte: 'PDF sans Restpack', at: 9, branche: 'tache/pdf-sans-restpack-9z8y7x', cartes: ['carte-pdf-doublon'] }),
    entree({ texte: 'Redémarrage de dev en échec', at: 8 }),
  ]);
  const [pdf, doublon, bruit] = getDb().prepare('SELECT empreinte FROM changelog_entrees WHERE project_id = ? ORDER BY at DESC').all(PROJET) as { empreinte: string }[];
  const bilan = k.reecrireLeChangelog(PROJET, [
    { empreinte: pdf.empreinte, titre: 'Les PDF se fabriquent sur place', explication: 'Les rapports sont produits par le serveur lui-même. Plus besoin de service extérieur.', poids: 'grande-nouveaute', fusionneAvec: [doublon.empreinte] },
    { empreinte: bruit.empreinte, titre: 'Redémarrage du serveur de développement', poids: 'detail' },
    { empreinte: 'inconnue', titre: 'x', poids: 'detail' },
  ]);
  assert.deepEqual(bilan, { reecrites: 2, fusionnees: 1, refusees: 1 });
  const visibles = k.entreesDuChangelog(PROJET);
  assert.equal(visibles.length, 2);
  assert.equal(visibles[0].poids, 'grande-nouveaute');
  assert.equal(visibles[0].texte, 'Génération PDF internalisée, sans Restpack', 'la ligne d’origine reste');
  assert.equal(visibles[0].branche, 'tache/pdf-sans-restpack-9z8y7x', 'le doublon masqué lègue sa branche');
  assert.deepEqual(visibles[0].cartes, ['carte-pdf-doublon'], 'et sa carte : « Ouvrir la carte » reste possible');
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM changelog_entrees WHERE project_id = ?').get(PROJET) as { n: number }).n, 3, 'le doublon est masqué, pas effacé');
});

test('une entrée corrigée à la main fait foi, et retrouve sa carte par sa branche', () => {
  const P = 'p-corrige';
  const maintenant = Date.now();
  getDb().prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(P, 'Corrigé', DONNEES, '{}', maintenant, maintenant);
  getDb()
    .prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at) VALUES (?, ?, 'done', 0, ?, ?, ?, ?)`)
    .run('carte-pdf', P, 'PDF sur place', JSON.stringify({ github: { branch: 'tache/pdf-1a2b3c' } }), maintenant, maintenant);
  k.importerLeChangelog(P, [entree({ projectId: P, texte: 'Génération PDF internalisée', branche: 'tache/pdf-1a2b3c' })]);
  const [avant] = k.entreesDuChangelog(P);
  assert.equal(k.lierLesCartes(P, [avant])[0].carte?.id, 'carte-pdf', 'la carte se retrouve par sa branche');
  assert.equal(k.lierLesCartes(P, [{ ...avant, branche: null }])[0].carte, null, 'sans carte ni branche, aucun lien');

  assert.equal(k.corrigerEntreeDuChangelog(P, avant.id!, { titre: '  ', poids: 'detail' }).ok, false, 'titre vide refusé');
  assert.equal(k.corrigerEntreeDuChangelog(P, avant.id!, { titre: 'Les PDF', poids: 'gros' }).ok, false, 'poids inconnu refusé');
  assert.equal(k.corrigerEntreeDuChangelog('autre-projet', avant.id!, { titre: 'Les PDF', poids: 'detail' }).ok, false, 'une entrée d’un autre projet ne se touche pas');
  const r = k.corrigerEntreeDuChangelog(P, avant.id!, { titre: 'Les PDF se fabriquent sur place', explication: '', poids: 'grande-nouveaute' });
  assert.ok(r.ok);
  assert.equal(r.ok && r.entree.corrigee, true);
  assert.equal(r.ok && r.entree.carte?.titre, 'PDF sur place');

  const { empreinte } = getDb().prepare('SELECT empreinte FROM changelog_entrees WHERE id = ?').get(avant.id) as { empreinte: string };
  assert.equal(k.reecrireLeChangelog(P, [{ empreinte, titre: 'Réécriture automatique des PDF', poids: 'detail' }]).reecrites, 0, 'la reprise du passé ne réécrit pas une correction');
  const [apres] = k.entreesDuChangelog(P);
  assert.equal(apres.titre, 'Les PDF se fabriquent sur place');
  assert.equal(apres.poids, 'grande-nouveaute');
  assert.equal(apres.categorie, 'Ajouté');
  assert.equal(apres.explication, null);
});

test('l’accueil tient sous son plafond, séparateurs et note finale compris', () => {
  const unite = (i: number, importance: 'P0' | 'P1') =>
    ({ id: `MEM-${i}`, portee: PROJET, type: 'lesson', importance, titre: `Leçon numéro ${i}`, resume: 'Une phrase de résumé assez longue pour remplir vite le plafond. '.repeat(3), jamaisSupposer: false }) as unknown as Unite;
  for (const plafond of [1500, 2400, 9000]) {
    const texte = texteDAccueilConnaissances({
      nomDuProjet: 'Journal',
      tete: [unite(0, 'P0')],
      jamaisSupposer: [unite(1, 'P0'), unite(2, 'P0')],
      vitales: Array.from({ length: 120 }, (_, i) => unite(i + 3, i % 2 ? 'P1' : 'P0')),
      changelog: Array.from({ length: 12 }, (_, i) => entree({ texte: `Entrée du journal ${i}`, at: i })),
      totalUnites: 123,
      plafond,
    });
    assert.ok(texte.length <= plafond, `${texte.length} signes pour un plafond de ${plafond}`);
    assert.match(texte, /hors plafond/);
  }
});

test('le compte rendu d’un agent se lit de l’analyse à l’impact', () => {
  const md = '# Carte\n\n## La conversation\n\n## 1. Analyse\n\nConstat.\n\n## 2. Ce qui est fait\n\nFait.\n\n## 5. Évolutions possibles\n\n- rien\n\n## 6. Coûts\n\n1 h';
  const extrait = extraitDuCompteRendu(md);
  assert.match(extrait, /Constat[\s\S]*Fait\./);
  assert.doesNotMatch(extrait, /Évolutions|Coûts/);
});
