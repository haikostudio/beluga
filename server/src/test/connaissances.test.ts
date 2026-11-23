import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NON_RENSEIGNE, rendreUnite, sectionsDuDetail } from '@beluga/shared';

/*
 * LA BASE DE CONNAISSANCES, SUR UNE BASE JETABLE (`server/src/connaissances.ts`) :
 * la porte d'écriture (création, doublon fusionné, remplacement relié, refus
 * avec raison, versions gardées), la recherche pondérée, le rendu des fiches en
 * fichiers, le changelog (une entrée par carte, publication marquée), le
 * brouillon purgé, l'accueil borné, et l'import rejouable d'un lot de génération.
 */

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'connaissances-'));
process.env.BELUGA_DATA = DONNEES;
const k = await import('../connaissances.js');
const { getDb } = await import('../db.js');

const PROJET = 'p-essai';
getDb()
  .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
  .run(PROJET, 'Essai', DONNEES, '{}', Date.now(), Date.now());

const DECISION = {
  type: 'decision',
  importance: 'P1',
  titre: 'La base de connaissances fait foi',
  resume: 'Les unités vivent en base, et les fichiers Markdown numérotés sont régénérés depuis elle à chaque écriture.',
  raisonnement: 'La recherche pondérée et le dédoublonnage ont besoin de la base.',
  sujets: ['memoire'],
};

test('la porte crée une unité avec son identifiant, et un doublon devient une mise à jour qui garde la version', () => {
  const premier = k.proposerUnite(PROJET, DECISION, { auteur: 'tache/essai-1' });
  assert.equal(premier.ok && premier.geste, 'cree');
  assert.equal(premier.ok && premier.unite.id, 'DEC-001');

  const pareil = k.proposerUnite(PROJET, DECISION, { auteur: 'tache/essai-2' });
  assert.equal(pareil.ok && pareil.geste, 'deja-la');

  const doublon = k.proposerUnite(PROJET, { ...DECISION, titre: 'La base de connaissances fait foi !', resume: `${DECISION.resume} Les fichiers ne se modifient jamais à la main.` }, { auteur: 'tache/essai-3' });
  assert.equal(doublon.ok && doublon.geste, 'mis-a-jour');
  assert.equal(doublon.ok && doublon.fusionneAvec, 'DEC-001');
  assert.equal(k.unitesDeLaPortee(PROJET).length, 1, 'aucun doublon créé');
  assert.equal(k.lireUnite('DEC-001')?.version, 2);
  assert.match(k.versionsDeLUnite('DEC-001')[0].unite.resume, /chaque écriture\.$/);
});

test('une fiche proposée dans un projet, déjà présente dans le classeur global, fusionne au lieu de créer un doublon', () => {
  const avant = k.unitesDeLaPortee(PROJET).length;
  const global = k.proposerUnite(
    'global',
    { type: 'convention', importance: 'P1', titre: 'innerText rend le texte tel qu\'affiché', resume: 'Comparer le texte affiché sans tenir compte de la casse.', sujets: ['interface'] },
    { auteur: 'tache/global-1' },
  );
  assert.equal(global.ok && global.geste, 'cree');
  const idGlobal = global.ok ? global.unite.id : '';

  const depuisLeProjet = k.proposerUnite(
    PROJET,
    { type: 'convention', importance: 'P1', titre: 'innerText rend le texte tel qu\'affiché', resume: 'Comparer le texte affiché sans tenir compte de la casse.', sujets: ['interface'] },
    { auteur: 'tache/projet-1' },
  );
  assert.equal(depuisLeProjet.ok && depuisLeProjet.geste, 'deja-la', 'la porte du projet voit la fiche déjà écrite au global');
  assert.equal(depuisLeProjet.ok && depuisLeProjet.unite.id, idGlobal);
  assert.equal(k.unitesDeLaPortee(PROJET).length, avant, 'aucune fiche créée dans le projet');
});

test('un doublon de titre sous un autre type fusionne dans le type déjà là, sans faire ping-pong au réimport', () => {
  const composant = k.proposerUnite(
    PROJET,
    { type: 'component', importance: 'P2', titre: 'Le tiroir de publication est une vraie timeline', resume: 'Le tiroir affiche chaque étape de publication dans une ligne du temps verticale.' },
    { auteur: 'tache/x' },
  );
  assert.equal(composant.ok && composant.geste, 'cree');
  const idComposant = composant.ok ? composant.unite.id : '';

  // Même titre, autre type, proposé par une simple création (pas un « update » explicite) :
  // fusionne dans l'unité déjà là, garde SON type — ne le change jamais tout seul.
  const decision = k.proposerUnite(
    PROJET,
    { type: 'decision', importance: 'P2', titre: 'Le tiroir de publication est une vraie timeline', resume: 'Le tiroir de publication devient une timeline verticale.', raisonnement: 'Lisibilité du suivi.' },
    { auteur: 'tache/y' },
  );
  assert.equal(decision.ok && decision.geste, 'mis-a-jour');
  assert.equal(decision.ok && decision.fusionneAvec, idComposant);
  assert.equal(k.lireUnite(idComposant)?.type, 'component', 'le type ne change pas tout seul');

  // Rejouer EXACTEMENT les mêmes propositions ne doit plus rien créer ni faire basculer le type.
  const rejeu1 = k.proposerUnite(
    PROJET,
    { type: 'component', importance: 'P2', titre: 'Le tiroir de publication est une vraie timeline', resume: 'Le tiroir affiche chaque étape de publication dans une ligne du temps verticale.' },
    { auteur: 'tache/x' },
  );
  const rejeu2 = k.proposerUnite(
    PROJET,
    { type: 'decision', importance: 'P2', titre: 'Le tiroir de publication est une vraie timeline', resume: 'Le tiroir de publication devient une timeline verticale.', raisonnement: 'Lisibilité du suivi.' },
    { auteur: 'tache/y' },
  );
  assert.ok(rejeu1.ok && rejeu2.ok);
  assert.equal(k.lireUnite(idComposant)?.type, 'component');
  assert.equal(k.unitesDeLaPortee(PROJET).filter((u) => u.titre === 'Le tiroir de publication est une vraie timeline').length, 1, 'toujours une seule unité active pour ce titre');
});

test('deprecierEnFaveurDe garde la version et relie sans rien supprimer', () => {
  const a = k.proposerUnite(PROJET, { type: 'lesson', importance: 'P3', titre: 'Deux fiches disent la même chose', resume: 'Un cas à rapprocher à la main, titres trop différents pour le rapprochement automatique.' }, { auteur: 'tache/z1' });
  const b = k.proposerUnite(PROJET, { type: 'convention', importance: 'P3', titre: 'La même idée sous un autre habillage', resume: 'Le même fait, dit autrement, à fusionner à la main.' }, { auteur: 'tache/z2' });
  assert.ok(a.ok && b.ok);
  const idA = a.ok ? a.unite.id : '';
  const idB = b.ok ? b.unite.id : '';
  const r = k.deprecierEnFaveurDe(idB, idA, 'fusion-manuelle', 'doublon de contenu fusionné à la main');
  assert.equal(r.ok && r.unite.statut, 'deprecated');
  const perdante = k.lireUnite(idB)!;
  assert.equal(perdante.statut, 'deprecated');
  assert.equal(perdante.supersededBy, idA);
  assert.equal(k.lireUnite(idA)?.statut, 'active');
  assert.equal(k.versionsDeLUnite(idB)[0].unite.titre, 'La même idée sous un autre habillage', 'la version d’avant reste consultable');
});

test('une unité qui en remplace une autre la déprécie et les relie', () => {
  const ancienne = k.proposerUnite(
    PROJET,
    { type: 'environment', importance: 'P0', titre: 'Le démon écoute sur le port 7000', resume: 'Le démon de Beluga Build écoute sur le port 7000 de la machine.' },
    { auteur: 'tache/a' },
  );
  assert.ok(ancienne.ok);
  const neuve = k.proposerUnite(
    PROJET,
    { type: 'environment', importance: 'P0', titre: 'Le démon écoute sur le port 7070', resume: 'Le démon écoute désormais sur le port 7070, derrière Caddy.', remplace: ancienne.ok ? ancienne.unite.id : '' },
    { auteur: 'tache/b' },
  );
  assert.equal(neuve.ok && neuve.geste, 'cree');
  const avant = k.lireUnite(ancienne.ok ? ancienne.unite.id : '')!;
  assert.equal(avant.statut, 'deprecated');
  assert.equal(avant.supersededBy, neuve.ok ? neuve.unite.id : '');
  assert.equal(neuve.ok && neuve.unite.supersedes, avant.id);
});

test('une élision française ne bloque plus le rapprochement de deux titres qui disent la même chose', () => {
  const premiere = k.proposerUnite(
    PROJET,
    {
      type: 'convention',
      importance: 'P2',
      titre: "L'échéance d'une limite de compte est signalée à l'avance",
      resume: "Une limite de compte prévient bien avant l'échéance, pour laisser le temps d'agir.",
    },
    { auteur: 'tache/elision-a' },
  );
  assert.equal(premiere.ok && premiere.geste, 'cree');

  const seconde = k.proposerUnite(
    PROJET,
    {
      type: 'convention',
      importance: 'P2',
      titre: "Une limite de compte est signalée bien à l'avance",
      resume: "Une limite de compte prévient largement avant l'échéance, pour laisser le temps d'agir.",
    },
    { auteur: 'tache/elision-b' },
  );
  assert.equal(seconde.ok && seconde.geste, 'mis-a-jour', 'deux tournures avec élision différente restent le même fait');
  assert.equal(seconde.ok && seconde.fusionneAvec, premiere.ok ? premiere.unite.id : '');
});

test('deux numéros de port différents restent deux unités distinctes, élision ou pas', () => {
  const premiere = k.proposerUnite(
    PROJET,
    { type: 'environment', importance: 'P2', titre: "Le service écoute sur le port 7000 en direct", resume: "Le service écoute sur le port 7000 en direct, sans détour." },
    { auteur: 'tache/port-a' },
  );
  assert.equal(premiere.ok && premiere.geste, 'cree');

  const seconde = k.proposerUnite(
    PROJET,
    { type: 'environment', importance: 'P2', titre: "Le service écoute sur le port 7070 en direct", resume: "Le service écoute sur le port 7070 en direct, sans détour." },
    { auteur: 'tache/port-b' },
  );
  assert.equal(seconde.ok && seconde.geste, 'cree', 'deux ports différents ne sont jamais un doublon');
});

test('un petit mot (« à », « a », « y ») ou un nombre d\'un seul côté ne sépare pas deux titres du même sujet', async () => {
  const base = k.proposerUnite(
    PROJET,
    {
      type: 'convention',
      importance: 'P2',
      titre: 'Le registre des sauvegardes se range à part du dossier courant pour 15 jours',
      resume: 'Le registre des sauvegardes se range à part du dossier courant pendant quinze jours avant nettoyage.',
      sujets: ['petitsmots'],
    },
    { auteur: 'tache/petits-mots-a' },
  );
  assert.equal(base.ok && base.geste, 'cree');

  // « à » retiré, « a » ajouté, nombre absent : même sujet, donc rapproché.
  const proche = await k.proposerReglesDeNuit(
    PROJET,
    'petitsmots',
    {
      titre: 'Le registre des sauvegardes a un rangement à part du dossier courant',
      resume: 'Le registre des sauvegardes se range à part du dossier courant pendant quinze jours avant nettoyage.',
      detail: '',
      source: undefined as never,
    },
    { auteur: 'nuit' },
  );
  assert.ok(proche.ok);
  assert.notEqual(proche.geste, 'cree', 'un petit mot ou un nombre d\'un seul côté ne crée pas une jumelle');
});

test('les marqueurs réellement différents restent séparés, par la porte normale comme par le rangement de nuit', async () => {
  const carteA = k.proposerUnite(
    PROJET,
    { type: 'convention', importance: 'P2', titre: 'Le tableau range la carte A en première colonne', resume: 'Le tableau range la carte A en première colonne dès son arrivée.', sujets: ['cartesab'] },
    { auteur: 'tache/ab-a' },
  );
  assert.equal(carteA.ok && carteA.geste, 'cree');
  const carteB = k.proposerUnite(
    PROJET,
    { type: 'convention', importance: 'P2', titre: 'Le tableau range la carte B en première colonne', resume: 'Le tableau range la carte B en première colonne dès son arrivée.', sujets: ['cartesab'] },
    { auteur: 'tache/ab-b' },
  );
  assert.equal(carteB.ok && carteB.geste, 'cree', 'carte A / carte B restent deux fiches');
  const nuit = await k.proposerReglesDeNuit(
    PROJET,
    'cartesab',
    { titre: 'Le tableau range la carte C en première colonne', resume: 'Le tableau range la carte C en première colonne dès son arrivée.', detail: '', source: undefined as never },
    { auteur: 'nuit' },
  );
  assert.ok(nuit.ok);
  assert.equal(nuit.geste, 'cree', 'le rangement de nuit sépare aussi carte A / carte C');
});

test('un update qui change le type reclasse : même identifiant si le préfixe tient, relais tracé sinon', () => {
  const langue = k.proposerUnite(
    PROJET,
    {
      type: 'domain',
      importance: 'P2',
      titre: 'La langue préférée est stockée chiffrée',
      resume: 'La langue préférée d’un utilisateur est stockée chiffrée dans la table des utilisateurs.',
      detail: '### Entités\n\n_Non renseigné._\n\n### États\n\nEn clair avant la migration, chiffrée après.',
    },
    { auteur: 'tache/a' },
  );
  assert.ok(langue.ok);
  const id = langue.ok ? langue.unite.id : '';
  const u = k.lireUnite(id)!;
  const deplacee = k.proposerUnite(PROJET, { ...u, action: 'update', id, type: 'security' }, { auteur: 'reclassement', sansQuatreQuestions: true });
  assert.equal(deplacee.ok && deplacee.unite.id, id);
  const apres = k.lireUnite(id)!;
  assert.equal(apres.type, 'security');
  assert.equal(apres.version, u.version + 1);
  assert.equal(apres.detail, '### États\n\nEn clair avant la migration, chiffrée après.');
  assert.match(k.versionsDeLUnite(id)[0].motif, /reclassée : domain → security/);

  const choix = k.proposerUnite(PROJET, { ...apres, action: 'update', id, type: 'decision', raisonnement: 'Le RGPD impose le chiffrement.' }, { auteur: 'reclassement', sansQuatreQuestions: true });
  assert.ok(choix.ok && /^DEC-/.test(choix.unite.id));
  const ancienne = k.lireUnite(id)!;
  assert.equal(ancienne.statut, 'deprecated');
  assert.equal(ancienne.supersededBy, choix.ok ? choix.unite.id : '');
  assert.equal(choix.ok && choix.unite.supersedes, id);
  assert.match(k.versionsDeLUnite(id)[0].motif, /remplacée par DEC-/);
});

test('un refus rend ses raisons et reste noté', () => {
  const r = k.proposerUnite(PROJET, { type: 'lesson', titre: 'Livraison du jour', resume: 'La carte a ajouté un écran de mémoire refait aujourd’hui.' }, { auteur: 'tache/c' });
  assert.equal(r.ok, false);
  assert.match(k.texteDuResultat(r), /Durable \?/);
  assert.equal(k.refusRecents(PROJET)[0].titre, 'Livraison du jour');
});

test('la recherche pondère : l’unité vitale et pertinente passe devant', () => {
  k.proposerUnite(PROJET, { type: 'lesson', importance: 'P3', titre: 'Port du serveur de développement', resume: 'Le serveur de développement de l’interface écoute en IPv6 sur localhost.' }, { auteur: 'x' });
  const trouvees = k.chercherUnites('port du démon', { projectId: PROJET });
  assert.ok(trouvees.length >= 2);
  assert.match(trouvees[0].unite.titre, /7070/);
  assert.match(k.rendreUnitesTrouvees('port du démon', trouvees), /MEM-\d{4} · environment · P0/);
  assert.equal(k.chercherUnites('port', { projectId: PROJET, deprecies: false }).some((t) => t.unite.statut === 'deprecated'), false);
});

test('le découpage reconnaît les titres ## hors code et le rendu masque les sections vides', () => {
  const sections = sectionsDuDetail('## Rôle\n\nVisible.\n\n```md\n## Dans le code\n```\n\n## Contrôles\n\nÀ vérifier.');
  assert.deepEqual(sections.map((s) => s.titre), ['Rôle', 'Contrôles']);
  assert.match(sections[0].texte, /## Dans le code/);

  const proposee = k.proposerUnite(PROJET, {
    type: 'component',
    importance: 'P2',
    titre: 'Rendu sans rubrique vide',
    resume: 'Le rendu conserve les informations utiles.',
    detail: `### Rôle\n\nVisible.\n\n${NON_RENSEIGNE}\n\n### Contrôles\n\n${NON_RENSEIGNE}`,
  }, { auteur: 'tache/memoire-sans-rubriques-vides' });
  assert.ok(proposee.ok);
  if (!proposee.ok) return;
  assert.match(proposee.unite.detail, /_Non renseigné\._/);
  const rendu = rendreUnite(proposee.unite);
  assert.match(rendu, /### Rôle\n\nVisible\./);
  assert.doesNotMatch(rendu, /_Non renseigné\._/);
  assert.doesNotMatch(rendu, /### Contrôles/);
});

test('les fichiers MEMORY sont rendus : fiches numérotées, archive des dépréciées, changelog', () => {
  k.ajouterAuChangelog({ projectId: PROJET, texte: 'Base de connaissances structurée', branche: 'tache/base-1234ab', cardId: 'carte-1', source: 'carte' });
  const ecrits = k.rendreLesFichiers(PROJET);
  assert.ok(ecrits >= 14);
  const dossier = k.dossierDeLaPortee(PROJET);
  assert.match(dossier, /MEMORY\/PROJECTS\/essai-pessai$/);
  assert.match(fs.readFileSync(path.join(dossier, '05_decisions.md'), 'utf8'), /## DEC-001 — La base de connaissances fait foi/);
  assert.match(fs.readFileSync(path.join(dossier, '00_project.md'), 'utf8'), /## À ne jamais supposer/);
  assert.match(fs.readFileSync(path.join(dossier, 'archive', '09_environment.md'), 'utf8'), /port 7000/);
  assert.match(fs.readFileSync(path.join(dossier, 'CHANGELOG.md'), 'utf8'), /### Améliorations\n\n- \*\*Base de connaissances structurée\*\*/);
  assert.equal(k.rendreLesFichiers(PROJET), 0, 'rien de réécrit quand rien n’a changé');
});

test('le changelog : une seule entrée par carte, l’entrée rédigée par l’agent l’emporte, la publication la marque', () => {
  const pauvre = k.ajouterAuChangelog({ projectId: PROJET, texte: 'Mémoire typée', branche: 'tache/base-1234ab', cardId: 'carte-1', source: 'agent' });
  assert.equal(pauvre.ok, false, 'une ligne sans explication ni poids est refusée');
  const agent = k.ajouterAuChangelog({
    projectId: PROJET,
    titre: 'Une mémoire rangée par sujets',
    explication: 'Les faits du projet sont rangés en fiches numérotées, chacune avec son importance. Un agent retrouve ce qui compte sans relire tout l’historique.',
    poids: 'grande-nouveaute',
    branche: 'tache/base-1234ab',
    cardId: 'carte-1',
    source: 'agent',
  });
  assert.deepEqual(agent, { ok: true, ajoutee: false });
  const cloture = k.ajouterAuChangelog({ projectId: PROJET, texte: 'Base de connaissances structurée', cardId: 'carte-1', source: 'carte' });
  assert.deepEqual(cloture, { ok: true, ajoutee: false });
  const repli = k.ajouterAuChangelog({ projectId: PROJET, texte: 'Base de connaissances structurée', titre: 'Autre titre de repli', explication: 'Une phrase de repli assez longue. Et une seconde phrase complète.', poids: 'amelioration', cardId: 'carte-1', source: 'carte' });
  assert.deepEqual(repli, { ok: true, ajoutee: false });
  const entrees = k.entreesDuChangelog(PROJET);
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].titre, 'Une mémoire rangée par sujets', 'la rédaction de repli ne remplace pas celle de l’agent');
  assert.equal(entrees[0].poids, 'grande-nouveaute');
  assert.equal(entrees[0].categorie, 'Ajouté');
  assert.equal(k.entreeDeCarteRedigee(PROJET, 'carte-1'), true);
  assert.equal(k.marquerLaPublication(PROJET, 'publiée le 2026-09-13', 'carte-1'), 1);
  assert.equal(k.entreesDuChangelog(PROJET)[0].publication, 'publiée le 2026-09-13');
});

test('le brouillon d’une carte se purge à sa fermeture', () => {
  assert.deepEqual(k.noterAuBrouillon({ cardId: 'carte-2', projectId: PROJET, texte: 'Piste : regarder le vectoriseur' }), { ok: true, nombre: 1 });
  assert.equal(k.purgerLeBrouillon('carte-2'), 1);
  assert.equal(k.purgerLeBrouillon('carte-2'), 0, 'plus rien à purger');
  assert.deepEqual(k.noterAuBrouillon({ cardId: 'carte-2', projectId: PROJET, texte: 'Nouvelle piste' }), { ok: true, nombre: 1 });
});

test('l’accueil lit la tête, les P0/P1 et le changelog récent', () => {
  k.proposerUnite(PROJET, { type: 'project', importance: 'P0', titre: 'Essai pilote des agents', resume: 'Le projet Essai pilote des agents de programmation depuis un tableau de cartes.' }, { auteur: 'x' });
  const accueil = k.accueilDesConnaissances(PROJET, 'Essai');
  assert.match(accueil, /00 — PROJET\n- \[P0\] MEM-\d{4} \(project\) Essai pilote des agents/);
  assert.match(accueil, /UNITÉS P0 ET P1[\s\S]*DEC-001/);
  assert.match(accueil, /CHANGELOG RÉCENT[\s\S]*Grande nouveauté · Une mémoire rangée par sujets — Les faits du projet/);
  assert.doesNotMatch(accueil, /port 7000/, 'une unité dépréciée ne part jamais');
});

test('un lot de génération s’importe par la porte, et rejoué il ne double rien', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'lots-'));
  fs.writeFileSync(
    path.join(dossier, `${PROJET}.json`),
    JSON.stringify({
      portee: PROJET,
      nom: 'Essai',
      propositions: [
        { type: 'convention', importance: 'P2', titre: 'Les scripts visent le serveur de développement', resume: 'Un script de vérification vise le serveur de développement, jamais l’application publiée.' },
        { type: 'lesson', importance: 'P2', titre: 'Hypothèse', resume: 'Le démon plante probablement au démarrage à cause du vectoriseur.' },
      ],
      changelog: [{ projectId: PROJET, jour: '2026-09-01', categorie: 'Ajouté', texte: 'Premier écran', branche: null, commits: ['abc'], cartes: [], unites: [], publication: null, source: 'git', at: 1 }],
    }),
  );
  const [premier] = k.importerLesLots({ dossier });
  assert.equal(premier.creees, 1);
  assert.equal(premier.refusees.length, 1);
  assert.equal(premier.changelog.ajoutees, 1);
  assert.deepEqual(k.importerLesLots({ dossier }), [], 'un lot déjà importé à l’identique est sauté');
  const [rejoue] = k.importerLesLots({ dossier, force: true });
  assert.equal(rejoue.creees, 0);
  assert.equal(rejoue.dejaLa, 1);
  assert.equal(rejoue.changelog.ajoutees, 0);
  assert.equal(k.dernierRapportDeGeneration(PROJET)?.dejaLa, 1);
});

test('remember : « replaces » retrouve l’unité par le début de son titre', () => {
  const cible = k.uniteARemplacer(PROJET, 'Les scripts visent');
  assert.match(cible?.titre ?? '', /serveur de développement/);
  assert.equal(k.uniteARemplacer(PROJET, 'rien de tel'), null);
});
