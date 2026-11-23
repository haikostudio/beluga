import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  convertirEnFiche,
  detailDeLUniteDeCompetence,
  enTeteAvecCles,
  gesteDeSynchro,
  idDeSujetDUnite,
  nomDeFicheSansCollision,
  propositionDeLaCompetence,
  raisonsDeRefusDeLImport,
  registreDepuisTexte,
  sourceDeBibliotheque,
  texteDesCompetences,
  texteDuRegistre,
  uniteAJour,
  titresDescendus,
  type Competence,
} from '@beluga/shared';

/*
 * LES COMPÉTENCES DANS LA MÉMOIRE, ET LES BIBLIOTHÈQUES.
 *
 * 1. Chaque fiche du pool devient une unité « operation » du classeur GLOBAL,
 *    par la porte d'écriture unique ; la synchronisation est IDEMPOTENTE, suit
 *    l'état de la fiche, et déprécier l'unité ARCHIVE la fiche (sans boucle).
 * 2. Une bibliothèque tierce s'importe d'un geste depuis un dépôt git : les
 *    SKILL.md sont copiés, un nom maison n'est jamais écrasé, un réimport met à
 *    jour et retire du service ce qui a disparu.
 * 3. Une fiche de bibliothèque est servie PAR LA MÉMOIRE SEULEMENT : ni
 *    briefing, ni coffre des comptes Claude.
 */

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'competences-memoire-'));
const POOL = path.join(RACINE, 'competences');
fs.mkdirSync(POOL, { recursive: true });
process.env.BELUGA_COMPETENCES = POOL;
process.env.BELUGA_DATA = path.join(RACINE, 'donnees');

const sync = await import('../competences-memoire.js');
const k = await import('../connaissances.js');
const pool = await import('../competences.js');
const biblio = await import('../bibliotheques-competences.js');

function poser(racine: string, nom: string, entete: string, corps = `# ${nom}\n\n## Procédure\n\nFaire.\n\n## Vérification\n\nOn relance.\n`): string {
  const dossier = path.join(racine, nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'SKILL.md'), `${entete}\n\n${corps}`, 'utf8');
  return dossier;
}

const FICHE: Competence = {
  nom: 'compta',
  description: 'Créer des offres et des factures. À utiliser dès qu’on parle de facture.',
  dossier: '/pool/compta',
  fichier: '/pool/compta/SKILL.md',
  etat: 'active',
  themes: ['facturation'],
  symptomes: ['créer une offre'],
  projets: [],
  provenance: {},
  annexes: ['scripts/compta.mjs'],
  anomalies: [],
};

/* ------------------------------------------------------------------ */
/* Les règles pures                                                     */
/* ------------------------------------------------------------------ */

test('une fiche devient une unité operation du classeur global, en P2 (P3 pour une bibliothèque), reconnue par sa source', () => {
  const p = propositionDeLaCompetence(FICHE, '---\nname: compta\n---\n# Compta\n\n## Procédure\n\nLancer le script.', { confiance: 0.5 });
  assert.equal(p.type, 'operation');
  assert.equal(p.importance, 'P2');
  assert.deepEqual(p.source, { genre: 'competence', ref: 'compta' });
  assert.match(String(p.detail), /### Quand s'en servir/);
  assert.ok(!String(p.detail).includes(FICHE.description), 'la description reste dans le résumé seul');
  assert.equal(p.resume, FICHE.description.replace(/\s+/g, ' ').trim());
  const unite = { titre: p.titre, resume: p.resume, detail: p.detail, importance: p.importance, confiance: p.confiance, relue: false, statut: 'active', sujets: ((p.sujets ?? []) as string[]).map((x) => idDeSujetDUnite(x)) } as Parameters<typeof uniteAJour>[0];
  assert.equal(uniteAJour(unite, propositionDeLaCompetence(FICHE, '---\nname: compta\n---\n# Compta\n\n## Procédure\n\nLancer le script.', { confiance: 0.5 })), true, 'pas de réécriture en boucle');
  assert.match(String(p.detail), /#### Compta/, 'les titres du SKILL.md descendent sous ceux de l’unité');
  assert.match(String(p.detail), /\/pool\/compta\/SKILL\.md/, 'l’unité renvoie au texte entier');
  assert.match(String(p.detail), /scripts\/compta\.mjs/);
  const importee = propositionDeLaCompetence({ ...FICHE, bibliotheque: 'anthropics-skills' }, '', { confiance: 0.4 });
  assert.equal(importee.importance, 'P3');
  assert.ok((importee.sujets as string[]).includes('bibliotheque-anthropics-skills'));
});

test('le mode d’emploi trop long est coupé et renvoie au SKILL.md ; un bloc de code garde ses « # »', () => {
  const long = `---\nname: x\n---\n${'mot '.repeat(4000)}`;
  const detail = detailDeLUniteDeCompetence(FICHE, long);
  assert.ok(detail.length <= 12_000);
  assert.match(detail, /Suite dans le texte entier/);
  assert.equal(titresDescendus('```\n# commentaire\n```\n## Titre'), '```\n# commentaire\n```\n##### Titre');
});

test('le geste de synchro suit l’état de la fiche', () => {
  assert.equal(gesteDeSynchro({ etat: 'active' }, undefined), 'creer');
  assert.equal(gesteDeSynchro({ etat: 'depreciee' }, { statut: 'active' }), 'mettre-a-jour');
  assert.equal(gesteDeSynchro({ etat: 'archivee' }, { statut: 'active' }), 'deprecier');
  assert.equal(gesteDeSynchro({ etat: 'archivee' }, { statut: 'deprecated' }), 'rien');
  assert.equal(gesteDeSynchro(undefined, { statut: 'active' }), 'deprecier');
  assert.equal(gesteDeSynchro({ etat: 'active' }, { statut: 'deprecated' }), 'mettre-a-jour', 'une fiche remise en service réactive son unité');
});

test('la source d’une bibliothèque : mot connu, propriétaire/dépôt, adresse, chemin', () => {
  assert.deepEqual(sourceDeBibliotheque('anthropic'), { genre: 'git', adresse: 'https://github.com/anthropics/skills.git', id: 'anthropics-skills' });
  assert.equal(sourceDeBibliotheque('codex')?.id, 'openai-skills');
  assert.equal(sourceDeBibliotheque('https://github.com/openai/skills/tree/main/skills/.curated')?.adresse, 'https://github.com/openai/skills.git');
  assert.deepEqual(sourceDeBibliotheque('/srv/mes-regles/'), { genre: 'local', adresse: '/srv/mes-regles', id: 'mes-regles' });
  assert.equal(sourceDeBibliotheque('n’importe quoi'), null);
});

test('un nom maison ou d’une autre bibliothèque n’est jamais écrasé ; la même bibliothèque garde le sien', () => {
  const occupants = new Map<string, string | null>([
    ['compta', null],
    ['pdf', 'openai-skills'],
    ['docx', 'anthropics-skills'],
  ]);
  assert.equal(nomDeFicheSansCollision('compta', 'anthropics-skills', occupants), 'compta-anthropics-skills');
  assert.equal(nomDeFicheSansCollision('pdf', 'anthropics-skills', occupants), 'pdf-anthropics-skills');
  assert.equal(nomDeFicheSansCollision('docx', 'anthropics-skills', occupants), 'docx');
  assert.equal(nomDeFicheSansCollision('libre', 'anthropics-skills', occupants), 'libre');
});

test('contrôle minimal d’une fiche importée, en-tête enrichi sans toucher au texte, conversion d’une règle Cursor', () => {
  assert.deepEqual(raisonsDeRefusDeLImport('---\nname: a\ndescription: Faire quelque chose quand il le faut.\n---\n'), []);
  assert.equal(raisonsDeRefusDeLImport('# pas d’en-tête').length > 0, true);
  assert.match(raisonsDeRefusDeLImport('---\nname: a\n---\n').join(), /description/);
  assert.deepEqual(raisonsDeRefusDeLImport('---\nname: a\ndescription: >-\n  Une description\n  sur deux lignes.\n---\n'), [], 'une description multi-ligne est lue en entier');

  const enrichi = enTeteAvecCles('---\nname: a\ndescription: b\n---\n# Corps\n', { name: 'a-x', 'provenance-bibliotheque': 'x' });
  assert.equal(enrichi, '---\nname: a-x\ndescription: b\nprovenance-bibliotheque: x\n---\n# Corps\n');

  const cursor = convertirEnFiche('cursor', '---\ndescription: Règles de style React à appliquer quand on écrit un composant.\nglobs: "*.tsx"\n---\nToujours des fonctions.', 'react-style.mdc', 'rules');
  assert.equal(cursor.ok && cursor.nom, 'react-style');
  assert.match(cursor.ok ? cursor.texte : '', /^---\nname: react-style\ndescription: Règles de style React/);
  assert.equal(convertirEnFiche('cursor', 'court', 'x.mdc', 'rules').ok, false);
});

test('le registre se relit à l’identique, et un registre illisible vaut un registre vide', () => {
  const registre = { 'anthropics-skills': { source: 'https://github.com/anthropics/skills.git', importeeLe: 1, competences: ['pdf', 'docx'] } };
  assert.deepEqual(registreDepuisTexte(texteDuRegistre(registre))['anthropics-skills'].competences, ['docx', 'pdf']);
  assert.deepEqual(registreDepuisTexte('{pas du json'), {});
});

test('le briefing n’énumère pas les fiches de bibliothèque : il les compte et dit où les chercher', () => {
  const texte = texteDesCompetences([FICHE, { ...FICHE, nom: 'pdf', bibliotheque: 'anthropics-skills' }, { ...FICHE, nom: 'docx', bibliotheque: 'anthropics-skills' }], '/pool');
  assert.match(texte, /COMPÉTENCES PARTAGÉES \(1\)/);
  assert.doesNotMatch(texte, /pdf|docx/);
  assert.match(texte, /2 autres compétences viennent de bibliothèques importées/);
  assert.match(texte, /outil « memoire »/);
  // Rien que des fiches de bibliothèque : une ligne, jamais un titre vide.
  assert.match(texteDesCompetences([{ ...FICHE, bibliotheque: 'x' }]), /^1 autre compétence vient de bibliothèques importées/);
});

/* ------------------------------------------------------------------ */
/* La synchronisation, sur une base jetable                             */
/* ------------------------------------------------------------------ */

const ENTETE = '---\nname: facturer\ndescription: Créer une facture dans le logiciel. À utiliser dès qu’on parle de facture.\nthemes: facturation\n---';

function unitesDe(nom: string) {
  return k.unitesDeLaSource('global', 'competence', nom);
}

test('la synchro crée une unité par fiche, et la relancer ne crée aucun doublon ni aucune version', () => {
  poser(POOL, 'facturer', ENTETE);
  const premier = sync.synchroniserCompetencesVersLaBase();
  assert.deepEqual(premier.creees, ['facturer']);
  const [unite] = unitesDe('facturer');
  assert.equal(unite.type, 'operation');
  assert.equal(unite.portee, 'global');
  assert.equal(unite.importance, 'P2');
  assert.equal(unite.titre, 'Compétence « facturer »');

  const second = sync.synchroniserCompetencesVersLaBase();
  assert.deepEqual(second.creees, []);
  assert.deepEqual(second.misesAJour, []);
  assert.deepEqual(second.inchangees, ['facturer']);
  assert.equal(unitesDe('facturer').length, 1);
  assert.equal(k.lireUnite(unite.id)?.version, 1);

  // La recherche de la mémoire la trouve.
  const trouvees = k.chercherUnites('facture logiciel', { projectId: null });
  assert.ok(trouvees.some((t) => t.unite.id === unite.id), 'la recherche rend l’unité de la compétence');
});

test('la fiche change, l’unité suit ; la confiance mesurée descend aussi', () => {
  poser(POOL, 'facturer', ENTETE, '# facturer\n\n## Procédure\n\nNouvelle procédure.\n\n## Vérification\n\nOn relance.\n');
  const r = sync.synchroniserCompetencesVersLaBase({ noms: ['facturer'] });
  assert.deepEqual(r.misesAJour, ['facturer']);
  const [unite] = unitesDe('facturer');
  assert.match(unite.detail, /Nouvelle procédure/);

  pool.compter('facturer', 'contredite', 2);
  sync.synchroniserCompetencesVersLaBase({ noms: ['facturer'] });
  assert.ok(k.lireUnite(unite.id)!.confiance < 0.5, 'une contradiction fait BAISSER la confiance de l’unité');
});

test('une fiche archivée déprécie son unité ; déprécier l’unité à l’écran archive la fiche, sans boucle', () => {
  const [unite] = unitesDe('facturer');
  pool.changerLEtat('facturer', 'archivee', POOL);
  const r = sync.synchroniserCompetencesVersLaBase();
  assert.deepEqual(r.depreciees, ['facturer']);
  assert.equal(k.lireUnite(unite.id)?.statut, 'deprecated');
  // Remise en service : l'unité se réactive.
  pool.changerLEtat('facturer', 'active', POOL);
  sync.synchroniserCompetencesVersLaBase();
  assert.equal(k.lireUnite(unite.id)?.statut, 'active');

  // Dans l'autre sens : l'écran déprécie l'unité, la fiche sort du service.
  sync.brancherLesCompetencesSurLaMemoire();
  const d = k.proposerUnite('global', { action: 'deprecate', id: unite.id, raisonnement: 'dépréciée à l’écran' }, { auteur: 'écran' });
  assert.equal(d.ok && d.geste, 'deprecie');
  assert.equal(pool.lirePool(POOL).fiches.find((f) => f.nom === 'facturer')?.etat, 'archivee');
  const apres = sync.synchroniserCompetencesVersLaBase();
  assert.deepEqual([...apres.creees, ...apres.misesAJour, ...apres.depreciees], [], 'aucune écriture de plus : pas de boucle');
  assert.equal(unitesDe('facturer').length, 1);
});

/* ------------------------------------------------------------------ */
/* L'import d'une bibliothèque, depuis un dépôt git factice             */
/* ------------------------------------------------------------------ */

function depotFactice(): string {
  const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'bibliotheque-factice-'));
  poser(path.join(depot, 'skills'), 'pdf', '---\nname: pdf\ndescription: Lire et remplir des PDF. Use when the user mentions a PDF.\n---');
  fs.mkdirSync(path.join(depot, 'skills', 'pdf', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(depot, 'skills', 'pdf', 'scripts', 'remplir.py'), 'print("ok")\n');
  poser(path.join(depot, 'skills'), 'docx', '---\nname: docx\ndescription: >-\n  Créer des documents Word.\n  Use when a .docx is asked.\n---');
  // Même nom qu'une fiche MAISON : elle ne doit pas l'écraser.
  poser(path.join(depot, 'skills'), 'facturer', '---\nname: facturer\ndescription: Une autre façon de facturer, à utiliser quand on veut.\n---');
  // Sans description : écartée, avec sa raison.
  poser(path.join(depot, 'skills'), 'bancale', '---\nname: bancale\n---');
  // Une règle Cursor : ignorée, puisque la bibliothèque a de vrais SKILL.md.
  fs.writeFileSync(path.join(depot, 'style.mdc'), '---\ndescription: Une règle de style à appliquer partout dans le code.\n---\nCorps.\n');
  // Le modèle de fiche : jamais importé.
  poser(depot, 'template', '---\nname: template-skill\ndescription: Replace with a description of when to use it.\n---');
  fs.writeFileSync(path.join(depot, 'LICENSE'), 'Licence MIT\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: depot, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return depot;
}

test('importer une bibliothèque copie ses fiches, garde les noms maison, écarte ce qui est bancal et dit tout', async () => {
  const depot = depotFactice();
  const bilan = await biblio.importerUneBibliotheque({ source: depot, nom: 'factice' }, { racine: POOL });
  assert.equal(bilan.ok, true, bilan.erreur);
  assert.deepEqual([...bilan.creees].sort(), ['docx', 'facturer-factice', 'pdf']);
  assert.deepEqual(bilan.renommees, ['facturer → facturer-factice']);
  assert.deepEqual(bilan.refusees.map((r) => r.nom), ['skills/bancale']);
  assert.match(bilan.commit ?? '', /^[0-9a-f]{40}$/);

  // Une vraie copie, avec ses fichiers de détail et la licence, jamais un lien.
  assert.equal(fs.lstatSync(path.join(POOL, 'pdf')).isSymbolicLink(), false);
  assert.ok(fs.existsSync(path.join(POOL, 'pdf', 'scripts', 'remplir.py')));
  assert.ok(fs.existsSync(path.join(POOL, 'pdf', 'LICENSE')));
  assert.equal(fs.existsSync(path.join(POOL, 'template-skill')), false);
  // La fiche maison n'a pas bougé.
  assert.match(fs.readFileSync(path.join(POOL, 'facturer', 'SKILL.md'), 'utf8'), /Créer une facture dans le logiciel/);

  const fiches = pool.lirePool(POOL).fiches;
  const pdf = fiches.find((f) => f.nom === 'pdf')!;
  assert.equal(pdf.bibliotheque, 'factice');
  assert.equal(fiches.find((f) => f.nom === 'docx')?.description, 'Créer des documents Word. Use when a .docx is asked.');
  assert.equal(fiches.find((f) => f.nom === 'facturer')?.bibliotheque, undefined);
  assert.deepEqual(pool.lireLeRegistre(POOL).factice.competences, ['docx', 'facturer-factice', 'pdf']);

  // Servie par la mémoire : une unité P3 du classeur global.
  sync.synchroniserCompetencesVersLaBase();
  const [unite] = unitesDe('pdf');
  assert.equal(unite.importance, 'P3');
  assert.ok(unite.sujets.includes('bibliotheque-factice'));
  // Mais JAMAIS annoncée en tête de session.
  const annonce = texteDesCompetences(pool.listerCompetences(POOL), POOL);
  assert.doesNotMatch(annonce, /\bpdf\b|\bdocx\b/);
  assert.match(annonce, /bibliothèques importées/);

  // Réimporter sans changement : rien ne bouge.
  const encore = await biblio.importerUneBibliotheque({ source: depot, nom: 'factice' }, { racine: POOL });
  assert.deepEqual(encore.creees, []);
  assert.deepEqual(encore.misesAJour, []);
  assert.equal(encore.inchangees.length, 3);

  // Le CLASSEMENT posé dans le pool (thèmes, symptômes) : un réimport identique ne bouge rien…
  const fichierPdf = path.join(POOL, 'pdf', 'SKILL.md');
  fs.writeFileSync(fichierPdf, enTeteAvecCles(fs.readFileSync(fichierPdf, 'utf8'), { themes: 'documents, pdf', symptomes: 'remplir un formulaire PDF', 'resume-fr': 'À utiliser quand il faut lire, remplir ou fusionner un PDF.' }));
  const classee = await biblio.importerUneBibliotheque({ source: depot, nom: 'factice' }, { racine: POOL });
  assert.deepEqual(classee.misesAJour, [], 'des thèmes posés ici ne font pas une mise à jour');

  // La source change : une fiche modifiée, une disparue.
  fs.appendFileSync(path.join(depot, 'skills', 'pdf', 'SKILL.md'), '\n## Nouveau\n\nUne étape de plus.\n');
  fs.rmSync(path.join(depot, 'skills', 'docx'), { recursive: true });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'maj'], { cwd: depot, stdio: 'ignore' });
  const maj = await biblio.importerUneBibliotheque({ source: depot, nom: 'factice' }, { racine: POOL });
  assert.deepEqual(maj.misesAJour, ['pdf']);
  // …et une vraie mise à jour garde le classement, puisque la source n'en déclare pas.
  const pdfAJour = pool.lirePool(POOL).fiches.find((f) => f.nom === 'pdf')!;
  assert.deepEqual(pdfAJour.themes, ['documents', 'pdf']);
  assert.deepEqual(pdfAJour.symptomes, ['remplir un formulaire PDF']);
  // …et le RÉSUMÉ EN FRANÇAIS aussi, sans que la description d'origine soit réécrite.
  assert.equal(pdfAJour.resumeFr, 'À utiliser quand il faut lire, remplir ou fusionner un PDF.');
  assert.doesNotMatch(pdfAJour.description, /À utiliser quand il faut lire/);
  // L'unité de mémoire le prend pour résumé (c'est la tête du texte vectorisé), la description suit dans le détail.
  sync.synchroniserCompetencesVersLaBase();
  const [unitePdf] = unitesDe('pdf');
  assert.equal(unitePdf.resume, 'À utiliser quand il faut lire, remplir ou fusionner un PDF.');
  assert.match(unitePdf.detail, /Description d'origine : /);
  assert.match(fs.readFileSync(fichierPdf, 'utf8'), /Une étape de plus/);
  assert.deepEqual(maj.retirees, ['docx']);
  assert.ok(fs.existsSync(path.join(POOL, 'docx', 'SKILL.md')), 'rien ne s’efface');
  assert.equal(pool.lirePool(POOL).fiches.find((f) => f.nom === 'docx')?.etat, 'archivee');
  assert.equal(pool.lirePool(POOL).fiches.find((f) => f.nom === 'docx')?.bibliotheque, 'factice');
});

test('une source introuvable ou un sous-dossier qui remonte est refusé, avec sa raison', async () => {
  const absent = await biblio.importerUneBibliotheque({ source: '/dossier/qui/nexiste/pas' }, { racine: POOL });
  assert.equal(absent.ok, false);
  assert.match(absent.erreur ?? '', /n'existe pas/);
  const remonte = await biblio.importerUneBibliotheque({ source: '/tmp', sousDossier: '../etc' }, { racine: POOL });
  assert.equal(remonte.ok, false);
  assert.match(remonte.erreur ?? '', /sans remontée/);
});

test('les coffres des comptes Claude ne portent pas les fiches de bibliothèque, et un lien déjà posé est retiré', async () => {
  pool.changerLEtat('facturer', 'active', POOL);
  const coffre = path.join(RACINE, 'coffre-claude');
  const { saveAccountRecord } = await import('../accounts.js');
  saveAccountRecord({ id: 'claude-essai', engine: 'claude', label: 'Essai', priority: 1, configDir: coffre });
  // Un lien posé AVANT la règle vers une fiche de bibliothèque.
  fs.mkdirSync(path.join(coffre, 'skills'), { recursive: true });
  fs.symlinkSync(path.join(POOL, 'pdf'), path.join(coffre, 'skills', 'pdf'), 'dir');
  // Un VRAI dossier de l'utilisateur au nom d'une fiche de bibliothèque : on n'y touche jamais.
  fs.mkdirSync(path.join(coffre, 'skills', 'facturer-factice'), { recursive: true });

  const bilan = pool.relierCompetencesAuxCoffres();
  assert.ok(bilan.retirees.includes('claude-essai/pdf'));
  assert.equal(fs.existsSync(path.join(coffre, 'skills', 'pdf')), false);
  assert.ok(fs.statSync(path.join(coffre, 'skills', 'facturer-factice')).isDirectory(), 'le dossier de l’utilisateur reste');
  assert.equal(fs.existsSync(path.join(coffre, 'skills', 'docx')), false);
  // Les fiches maison en service y sont bien.
  assert.ok(fs.lstatSync(path.join(coffre, 'skills', 'facturer')).isSymbolicLink());
});

test('la relecture automatique laisse les compétences au pool : synchro, relecture, synchro ne font aucune version de plus', async () => {
  const relecture = await import('../relecture-memoire.js');
  poser(POOL, 'va-et-vient', '---\nname: va-et-vient\ndescription: Une fiche de test pour la relecture. À utiliser quand on teste la relecture.\n---');
  sync.synchroniserCompetencesVersLaBase({ noms: ['va-et-vient'] });
  const [unite] = unitesDe('va-et-vient');
  assert.ok(k.unitesPeuSures(50).some((u) => u.id === unite.id), 'la fiche est bien « peu sûre » au départ');
  const autre = k.proposerUnite('global', { type: 'convention', importance: 'P1', titre: 'Une règle sans fichier cité', resume: 'Une règle de test que la relecture ne sait pas trancher.', sujets: ['methode'], confiance: 0.4 }, { auteur: 'essai' });
  assert.ok(autre.ok);
  const idAutre = autre.ok ? autre.unite.id : '';

  const version = k.lireUnite(unite.id)!.version;
  const rapport = await relecture.relireLaMemoire();
  assert.equal(k.lireUnite(unite.id)!.version, version, 'la relecture ne touche pas à la fiche');
  assert.equal(k.lireUnite(unite.id)!.relue, false);
  assert.ok(relecture.unitesIndecisesPourLaNuit().includes(idAutre), 'les autres unités peu sûres sont toujours examinées');
  assert.ok(!relecture.unitesIndecisesPourLaNuit().includes(unite.id));
  assert.ok(rapport.lots >= 1);

  const bilan = sync.synchroniserCompetencesVersLaBase({ noms: ['va-et-vient'] });
  assert.deepEqual(bilan.misesAJour, []);
  assert.equal(k.lireUnite(unite.id)!.version, version, 'la synchro suivante n’écrit rien');
});

test('une unité RELUE n’est pas réécrite tant que la mesure ne dépasse pas la valeur relue', () => {
  const u = { titre: 'T', resume: 'R', detail: 'D', importance: 'P2', confiance: 0.7, relue: true, statut: 'active', sujets: [] as string[] } as Parameters<typeof uniteAJour>[0];
  const p = { type: 'operation', importance: 'P2', titre: 'T', resume: 'R', detail: 'D', sujets: [], confiance: 0.43 } as never;
  assert.equal(uniteAJour(u, p), true, 'relue à 0,7, mesurée 0,43 : à jour');
  assert.equal(uniteAJour({ ...u, relue: false }, p), false, 'non relue : la mesure reprend la main');
  assert.equal(uniteAJour(u, { ...(p as object), confiance: 0.8 } as never), false, 'la mesure dépasse la valeur relue');
  assert.equal(uniteAJour(u, { ...(p as object), resume: 'autre' } as never), false, 'texte changé');
});

test('deux synchros autour d’une relecture ne font aucune version de plus', () => {
  poser(POOL, 'relue-stable', '---\nname: relue-stable\ndescription: Une fiche relue et stable. À utiliser pour tester la boucle.\n---');
  sync.synchroniserCompetencesVersLaBase({ noms: ['relue-stable'] });
  const [unite] = unitesDe('relue-stable');
  k.marquerRelue(unite.id, 0.7, 'relecture automatique', 'essai');
  const apres = k.lireUnite(unite.id)!;
  assert.ok(apres.relue && apres.confiance >= 0.7);
  const versions = k.versionsDeLUnite(unite.id).length;
  const bilan = sync.synchroniserCompetencesVersLaBase({ noms: ['relue-stable'] });
  sync.synchroniserCompetencesVersLaBase({ noms: ['relue-stable'] });
  assert.deepEqual(bilan.misesAJour, []);
  assert.equal(k.lireUnite(unite.id)!.version, apres.version);
  assert.equal(k.versionsDeLUnite(unite.id).length, versions);
});

test('une fiche à plus de douze thèmes ne fait pas une version de plus à chaque synchro', () => {
  const themes = Array.from({ length: 14 }, (_, i) => `theme-${i}`).join(', ');
  poser(POOL, 'treize-themes', `---\nname: treize-themes\ndescription: Une fiche très classée. À utiliser pour tester le plafond des sujets.\nthemes: ${themes}\n---`);
  sync.synchroniserCompetencesVersLaBase({ noms: ['treize-themes'] });
  const [unite] = unitesDe('treize-themes');
  const versions = k.versionsDeLUnite(unite.id).length;
  const bilan = sync.synchroniserCompetencesVersLaBase({ noms: ['treize-themes'] });
  assert.deepEqual(bilan.misesAJour, []);
  assert.equal(k.versionsDeLUnite(unite.id).length, versions);
});
