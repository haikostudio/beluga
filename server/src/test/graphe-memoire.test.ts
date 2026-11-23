import test from 'node:test';
import assert from 'node:assert/strict';
import {
  construireLArbre,
  disposerLArbre,
  elementsDuGraphe,
  familleDeLaFiche,
  grouperLesUnitesParTheme,
  idDeCategorieDuGraphe,
  idDeProjetDuGraphe,
  idDeThemeDuGraphe,
  ID_DU_NOYAU,
  joursDeLaMemoire,
  niveauxALaDate,
  periodeDuJour,
  visibiliteALaDate,
  sujetDeProjetDeCompetence,
  themeDeLUnite,
  trierParDateDeCreation,
  uniteReprise,
  type ElementDuGraphe,
  type Unite,
} from '@beluga/shared';

/*
 * LE GRAPHE DE LA MÉMOIRE (`shared/src/graphe-memoire.ts`) : noyau → projet →
 * catégorie → thème → élément ; une compétence propre à un projet pend à ce
 * projet ; la mise en place ne fait chevaucher aucune sous-branche ; et la
 * liste refaite trie par date de création.
 */

type U = Pick<Unite, 'id' | 'portee' | 'type' | 'source' | 'sujets' | 'titre' | 'titreHumain' | 'importance' | 'creeLe'>;

const unite = (id: string, portee: string, type: Unite['type'], sujets: string[], extra: Partial<U> = {}): U => ({
  id,
  portee,
  type,
  sujets,
  titre: `Titre ${id}`,
  importance: 'P2',
  creeLe: 1_000,
  source: { genre: 'carte', ref: 'tache/x' },
  ...extra,
});

const PROJETS = [
  { id: 'p-kipou', name: 'Kipou' },
  { id: 'p-beluga', name: 'Beluga' },
];
const PORTEES = [{ id: 'global', nom: 'Global' }, ...PROJETS.map((p) => ({ id: p.id, nom: p.name }))];

test('une compétence propre à un projet pend à la catégorie Compétences de ce projet, une commune au noyau', () => {
  const competence = (nom: string, sujets: string[]) => unite(`MEM-${nom}`, 'global', 'operation', sujets, { source: { genre: 'competence', ref: nom } });
  const elements = elementsDuGraphe(
    [
      competence('1', ['competences', sujetDeProjetDeCompetence('Kipou'), 'mobile', 'ios']),
      competence('2', ['competences', 'publication']),
      competence('3', ['competences', sujetDeProjetDeCompetence('Archive'), 'interface']),
      unite('DEC-001', 'p-beluga', 'decision', ['publication']),
    ],
    PROJETS,
  );
  const par = new Map(elements.map((e) => [e.id, e]));
  assert.deepEqual([par.get('MEM-1')!.branche, par.get('MEM-1')!.fiche, par.get('MEM-1')!.theme], ['p-kipou', '13_skills', 'mobile'], 'le thème d’une compétence est son premier thème déclaré');
  assert.deepEqual([par.get('MEM-2')!.branche, par.get('MEM-2')!.fiche], ['global', '07_skills']);
  assert.equal(par.get('MEM-3')!.branche, 'global', 'un projet archivé ou inconnu laisse la compétence au noyau');
  assert.equal(par.get('MEM-1')!.competence, true);
  assert.deepEqual([par.get('DEC-001')!.branche, par.get('DEC-001')!.fiche, par.get('DEC-001')!.competence], ['p-beluga', '05_decisions', undefined]);
  assert.equal(themeDeLUnite({ sujets: ['competences', 'bibliotheque-capgo'], source: { genre: 'competence', ref: 'x' } }), 'divers');
});

test('les familles de couleur : six familles de catégories, et les compétences à part', () => {
  assert.equal(familleDeLaFiche('p-beluga', '05_decisions'), 'decisions');
  assert.equal(familleDeLaFiche('global', '03_decisions'), 'decisions');
  assert.equal(familleDeLaFiche('p-beluga', '13_skills'), 'competences');
  assert.equal(familleDeLaFiche('global', '07_skills'), 'competences');
  assert.equal(familleDeLaFiche('p-beluga', '12_lessons'), familleDeLaFiche('global', '06_lessons'));
  assert.equal(familleDeLaFiche('p-beluga', '06_components'), 'architecture');
});

test('l’arbre : noyau → catégories du Global et projets → catégories → thèmes → éléments', () => {
  const elements: ElementDuGraphe[] = [
    ...['a', 'b', 'c'].map((x) => ({ id: `MEM-p${x}`, branche: 'p-beluga', fiche: '05_decisions', theme: 'publication', titre: x, importance: 'P2' as const, creeLe: 1 })),
    { id: 'MEM-seul', branche: 'p-beluga', fiche: '05_decisions', theme: 'voix', titre: 'seul', importance: 'P2', creeLe: 1 },
    { id: 'MEM-g', branche: 'global', fiche: '01_conventions', theme: 'interface', titre: 'g', importance: 'P0', creeLe: 1 },
    { id: 'MEM-perdu', branche: 'p-archive', fiche: '05_decisions', theme: 'x', titre: 'x', importance: 'P2', creeLe: 1 },
  ];
  const arbre = construireLArbre(elements, PORTEES);
  const n = (id: string) => arbre.noeuds[arbre.index.get(id)!]!;
  assert.equal(arbre.noeuds[0]!.id, ID_DU_NOYAU);
  assert.equal(n(idDeCategorieDuGraphe('global', '01_conventions')).parent, 0, 'les catégories du Global pendent au noyau');
  assert.equal(n(idDeProjetDuGraphe('p-kipou')).poids, 0, 'un projet sans mémoire reste dessiné');
  const decisions = n(idDeCategorieDuGraphe('p-beluga', '05_decisions'));
  assert.equal(decisions.poids, 4);
  assert.deepEqual(
    decisions.enfants.map((i) => arbre.noeuds[i]!.theme),
    ['publication', 'autres'],
    'un thème trop maigre rejoint « Autres sujets »',
  );
  assert.equal(arbre.index.has('MEM-perdu'), false, 'un projet archivé n’est pas dessiné');
  for (const [i, noeud] of arbre.noeuds.entries()) if (noeud.parent >= 0) assert.ok(noeud.parent < i, 'un parent précède ses enfants');
});

test('la mise en place : déterministe, sans chevauchement entre sous-branches sœurs, rapide sur 6 000 éléments', () => {
  const themes = ['interface', 'publication', 'cartes', 'tests', 'mobile', 'voix', 'agents', 'memoire'];
  const fiches = ['04_conventions', '05_decisions', '06_components', '12_lessons'];
  const elements: ElementDuGraphe[] = [];
  let k = 0;
  for (const branche of ['global', 'p-beluga', 'p-kipou']) {
    const nombre = branche === 'p-beluga' ? 4000 : 1000;
    for (let i = 0; i < nombre; i += 1) {
      const fiche = branche === 'global' ? ['01_conventions', '03_decisions', '07_skills'][i % 3]! : fiches[i % fiches.length]!;
      elements.push({ id: `MEM-${k++}`, branche, fiche, theme: themes[(i * 7) % themes.length]!, titre: `t${i}`, importance: 'P2', creeLe: i });
    }
  }
  const debut = performance.now();
  const arbre = disposerLArbre(construireLArbre(elements, PORTEES));
  const duree = performance.now() - debut;
  assert.ok(duree < 400, `${Math.round(duree)} ms pour ${elements.length} éléments`);
  const encore = disposerLArbre(construireLArbre(elements, PORTEES));
  assert.deepEqual(
    encore.noeuds.slice(0, 50).map((n) => [Math.round(n.x * 100), Math.round(n.y * 100)]),
    arbre.noeuds.slice(0, 50).map((n) => [Math.round(n.x * 100), Math.round(n.y * 100)]),
  );
  for (const n of arbre.noeuds) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} placé`);
  // Deux sous-branches sœurs ne se chevauchent jamais.
  for (const parent of arbre.noeuds) {
    if (parent.genre === 'theme') continue;
    const freres = parent.enfants.map((i) => arbre.noeuds[i]!);
    for (let a = 0; a < freres.length; a += 1) {
      for (let b = a + 1; b < freres.length; b += 1) {
        const d = Math.hypot(freres[a]!.x - freres[b]!.x, freres[a]!.y - freres[b]!.y);
        assert.ok(d + 0.5 >= freres[a]!.etendue + freres[b]!.etendue, `${freres[a]!.id} et ${freres[b]!.id} se chevauchent (${d.toFixed(1)})`);
      }
    }
  }
  // Chaque élément reste dans le disque de son thème.
  for (const n of arbre.noeuds) {
    if (n.genre !== 'element') continue;
    const t = arbre.noeuds[n.parent]!;
    assert.ok(Math.hypot(n.x - t.x, n.y - t.y) <= t.etendue + 0.01, `${n.id} hors de son thème`);
  }
  // Le cadre d'un projet contient tous ses éléments.
  const beluga = arbre.noeuds[arbre.index.get(idDeProjetDuGraphe('p-beluga'))!]!;
  assert.ok(beluga.cadre.x1 - beluga.cadre.x0 > 0 && beluga.poids === 4000);
});

test('la liste refaite : les plus récentes d’abord, l’importance départage, les thèmes au dernier ajout', () => {
  const u = (id: string, creeLe: number, importance: Unite['importance'] = 'P2', sujets = ['interface']) =>
    ({ id, creeLe, importance, sujets, titre: id, resume: '' }) as Pick<Unite, 'id' | 'creeLe' | 'importance' | 'sujets' | 'titre' | 'resume'>;
  assert.deepEqual(
    trierParDateDeCreation([u('MEM-0001', 10), u('MEM-0002', 30), u('MEM-0003', 30, 'P0'), u('MEM-0004', 20)]).map((x) => x.id),
    ['MEM-0003', 'MEM-0002', 'MEM-0004', 'MEM-0001'],
  );
  const themes = grouperLesUnitesParTheme(
    [u('MEM-0001', 10, 'P2', ['cartes']), u('MEM-0002', 11, 'P2', ['cartes']), u('MEM-0005', 12, 'P2', ['cartes']), u('MEM-0003', 50), u('MEM-0004', 5), u('MEM-0006', 6)],
    { tri: 'date' },
  );
  assert.deepEqual(themes.map((t) => [t.theme, t.dernierAjout, t.unites[0]!.id]), [['interface', 50, 'MEM-0003'], ['cartes', 12, 'MEM-0005']]);
  assert.equal(grouperLesUnitesParTheme([u('MEM-0001', 1)], 1)[0]!.theme, 'interface', 'l’ancien seuil en nombre reste accepté');
  assert.equal(uniteReprise({ source: { genre: 'note', ref: 'X' } }), true);
  assert.equal(uniteReprise({ source: { genre: 'carte', ref: 'X' } }), false);
});

test('remonter le temps : la vraie photo du moment, retirées comprises, et l’avant-période estompée', () => {
  const jour = (j: number, h = 12) => new Date(2026, 8, j, h).getTime();
  const nee = (id: string, j: number, retire?: number, theme = 'publication'): ElementDuGraphe => ({
    id,
    branche: 'p-beluga',
    fiche: '05_decisions',
    theme,
    titre: id,
    importance: 'P2',
    creeLe: jour(j),
    ...(retire != null ? { retireLe: jour(retire, 18) } : {}),
  });
  const elements = [nee('A', 13), nee('B', 13, 15), nee('C', 15), nee('D', 16), nee('E', 16, 16, 'voix'), nee('F', 16, 16, 'voix'), nee('G', 16, 16, 'voix')];

  // Aujourd'hui : toute la mémoire active, rien de retiré.
  assert.deepEqual(elements.map((e) => visibiliteALaDate(e, null)), ['plein', 'masque', 'plein', 'plein', 'masque', 'masque', 'masque']);
  // Fin du 14 : A et B (retirée le 15, donc encore là), rien d'après.
  const au14 = { debut: periodeDuJour('2026-09-13').debut, fin: periodeDuJour('2026-09-14').fin };
  assert.deepEqual(elements.map((e) => visibiliteALaDate(e, au14)), ['plein', 'plein', 'masque', 'masque', 'masque', 'masque', 'masque']);
  // Période du 15 au 16 : A né avant le début → estompé ; B retirée le 15 → masquée ; C et D pleins.
  const du15 = { debut: periodeDuJour('2026-09-15').debut, fin: periodeDuJour('2026-09-16').fin };
  assert.deepEqual(elements.slice(0, 4).map((e) => visibiliteALaDate(e, du15)), ['estompe', 'masque', 'plein', 'plein']);

  // Les niveaux de l'arbre : un thème sans élément visible s'efface, le projet reste.
  const portees = [{ id: 'global', nom: 'Global' }, { id: 'p-beluga', nom: 'Beluga' }];
  const arbre = disposerLArbre(construireLArbre(elements, portees));
  const auJour = niveauxALaDate(arbre, null);
  assert.equal(auJour.visibles, 3);
  assert.equal(auJour.comptes[0], 3, 'le noyau compte les seuls éléments visibles');
  assert.equal(auJour.niveaux[arbre.index.get(idDeThemeDuGraphe('p-beluga', '05_decisions', 'voix'))!], 0, 'le thème des seules retirées s’efface');
  assert.equal(auJour.niveaux[arbre.index.get(idDeProjetDuGraphe('p-beluga'))!], 2);
  assert.equal(auJour.niveaux[0], 2);
  const periode = niveauxALaDate(arbre, du15);
  assert.equal(periode.niveaux[arbre.index.get('A')!], 1);
  assert.equal(periode.niveaux[arbre.index.get(idDeThemeDuGraphe('p-beluga', '05_decisions', 'publication'))!], 2, 'un thème prend le niveau du plus vivant de ses éléments');
  // Les places ne bougent pas : l'arbre est le même quelle que soit la date.
  assert.equal(arbre.noeuds.filter((n) => n.genre === 'element').length, elements.length);

  // Les jours : du plus récent au premier jour de la mémoire, ajouts et retraits compris.
  const jours = joursDeLaMemoire(elements, jour(18));
  assert.deepEqual(jours.map((j) => j.jour), ['2026-09-18', '2026-09-17', '2026-09-16', '2026-09-15', '2026-09-14', '2026-09-13']);
  assert.deepEqual(jours.find((j) => j.jour === '2026-09-16'), { jour: '2026-09-16', ajouts: 4, retraits: 3 });
  assert.deepEqual(jours.find((j) => j.jour === '2026-09-15'), { jour: '2026-09-15', ajouts: 1, retraits: 1 });
  assert.deepEqual(jours.at(-1), { jour: '2026-09-13', ajouts: 2, retraits: 0 });
  assert.deepEqual(joursDeLaMemoire([]), []);
  // Un jour en heure locale : de minuit à minuit.
  const p = periodeDuJour('2026-09-13');
  assert.equal(new Date(p.debut).getHours(), 0);
  assert.equal(p.fin - p.debut, 24 * 3600_000 - 1);
});
