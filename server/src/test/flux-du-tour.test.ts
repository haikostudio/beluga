import assert from 'node:assert/strict';
import test from 'node:test';
import { JALON_NOTE_DE_L_AGENT, fluxDesEntrees, libelleDuGroupe, paquetsDuFlux, type EntreeJournal } from '@beluga/shared';

/**
 * LE FIL D'UN TOUR, FAÇON EXTENSION CHROME (13/11/2026, captures #322f et #de1b, maquette A #1a2b) :
 * notes en clair, actions groupées et nommées en toutes lettres, question et capture à leur place.
 */

let rang = 0;
function entree(partiel: Partial<EntreeJournal>): EntreeJournal {
  rang += 1;
  return { id: `e${rang}`, cardId: 'c1', phase: 'execution', nature: 'requete', at: 1_000 + rang, rang, libelle: '', ...partiel } as EntreeJournal;
}
const requete = (outil: string, params: unknown, resultat = '') => entree({ outil, libelle: outil, params: JSON.stringify(params), resultat });
const note = (texte: string) => entree({ nature: 'jalon', libelle: JALON_NOTE_DE_L_AGENT, resultat: texte });
const lire = (f: string) => requete('Read', { file_path: `/root/x/${f}` }, 'contenu');
const cherche = (motif: string) => requete('Grep', { pattern: motif }, 'a');
const commande = (c: string) => requete('Bash', { command: c, description: c }, 'ok');

test('les notes de l’agent se lisent en clair et coupent les groupes d’actions, dans l’ordre réel', () => {
  const flux = fluxDesEntrees([
    note('Je regarde comment le fil range la réponse.'),
    lire('a.ts'),
    lire('b.ts'),
    cherche('reponse'),
    note('L’ordre vient d’un choix d’octobre.'),
    commande('npm test'),
  ]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['note', 'actions', 'note', 'actions'],
  );
  const premier = flux[1] as Extract<(typeof flux)[number], { sorte: 'actions' }>;
  assert.equal(premier.entrees.length, 3);
  assert.deepEqual(premier.libelle, [
    { motif: '{v0} fichiers lus', valeurs: { v0: 2 } },
    { motif: '1 recherche' },
  ]);
  assert.equal(premier.dominant, 'lecture');
});

test('une question et une capture se posent à leur place et ferment le groupe', () => {
  const flux = fluxDesEntrees([
    lire('a.ts'),
    requete('mcp__beluga__ask_user', { question: 'On garde le bandeau ?' }, 'Réponse : non'),
    lire('b.ts'),
    requete('Read', { file_path: '/root/data/attachments/capture.png' }, ''),
    lire('c.ts'),
  ]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['actions', 'question', 'actions', 'capture', 'actions'],
  );
});

test('un groupe surtout fait dans Chrome se dit comme dans l’extension', () => {
  const chrome = (geste: string) => requete('mcp__beluga__chrome', { geste }, 'ok');
  assert.deepEqual(libelleDuGroupe([chrome('ouvrir'), chrome('cliquer'), chrome('lire')])?.libelle, [
    { motif: 'A utilisé Chrome ({v0} actions)', valeurs: { v0: 3 } },
  ]);
  assert.deepEqual(libelleDuGroupe([chrome('ouvrir')])?.libelle, [{ motif: 'A utilisé Chrome (1 action)' }]);
  assert.equal(libelleDuGroupe([chrome('ouvrir')])?.dominant, 'chrome');
});

test('le genre le plus fréquent vient en tête, le singulier garde son nombre', () => {
  const nom = libelleDuGroupe([cherche('x'), commande('a'), commande('b'), commande('c')]);
  assert.deepEqual(nom?.libelle, [
    { motif: '{v0} commandes lancées', valeurs: { v0: 3 } },
    { motif: '1 recherche' },
  ]);
  assert.equal(nom?.dominant, 'commande');
});

test('les lignes de la liste de tâches n’entrent pas dans le fil, ni ne coupent un groupe', () => {
  const flux = fluxDesEntrees([lire('a.ts'), entree({ nature: 'point', libelle: 'Lire le code', etat: 'running' }), lire('b.ts')]);
  assert.equal(flux.length, 1);
  assert.equal(flux[0]!.sorte, 'actions');
});

test('un outil sans genre à lui se NOMME dans son groupe, jamais « 1 outil utilisé »', () => {
  const nom = libelleDuGroupe([
    requete('mcp__beluga__exemple_de_choix', { question: 'x' }),
    requete('mcp__beluga__exemple_de_choix', { question: 'y' }),
    requete('mcp__beluga__rendre_comprehension', { texte: 'z' }),
  ]);
  assert.deepEqual(nom?.libelle, [
    { motif: 'Outil « {v0} » ({v1} fois)', valeurs: { v0: 'Maquette d’un choix', v1: 2 } },
    { motif: 'Outil « {v0} »', valeurs: { v0: 'Compréhension rendue' } },
  ]);
  assert.equal(nom?.dominant, 'outil');
});

/* LES IMAGES ENVOYÉES À LA SUITE FORMENT UN PAQUET (carte « Images groupées dans le fil », capture #347e). */
/* Le démon écrit « Capture jointe : … » pour une image jointe : c'est ce libellé qui en fait une capture. */
const joindre = (f: string) =>
  entree({ outil: 'mcp__beluga__attach_file', libelle: `Capture jointe : x/${f}`, params: JSON.stringify({ path: `/root/x/${f}` }), resultat: 'Fichier joint' });
const regarder = (f: string) => requete('Read', { file_path: `/root/data/attachments/${f}` }, '');

test('des images jointes d’affilée forment un paquet, les commandes intercalées passent après lui', () => {
  const groupe = paquetsDuFlux(
    fluxDesEntrees([joindre('a.png'), joindre('b.png'), commande('ls'), joindre('c.png'), joindre('d.png'), joindre('e.png')]),
  );
  assert.deepEqual(groupe.map((e) => e.sorte), ['paquet', 'actions']);
  const paquet = groupe[0] as Extract<(typeof groupe)[number], { sorte: 'paquet' }>;
  assert.equal(paquet.captures.length, 5);
  assert.equal(paquet.famille, 'jointe');
  assert.equal(paquet.intercalees.length, 1);
});

test('une note, une question ou un changement de famille coupent le paquet', () => {
  const groupe = paquetsDuFlux(
    fluxDesEntrees([
      joindre('a.png'),
      joindre('b.png'),
      note('Voici maintenant la seconde série.'),
      joindre('c.png'),
      joindre('d.png'),
      requete('mcp__beluga__ask_user', { question: 'Laquelle ?' }, ''),
      joindre('e.png'),
      regarder('f.png'),
    ]),
  );
  assert.deepEqual(groupe.map((e) => e.sorte), ['paquet', 'note', 'paquet', 'question', 'capture', 'capture']);
});

test('une image seule reste une capture, et des actions après la dernière image restent à leur place', () => {
  const groupe = paquetsDuFlux(fluxDesEntrees([lire('a.ts'), joindre('a.png'), commande('ls'), note('Fini.')]));
  assert.deepEqual(groupe.map((e) => e.sorte), ['actions', 'capture', 'actions', 'note']);
});

test('une note de fiche d’agent personnalisé se lit en clair, jamais repliée en « Outil « Fiche de l’agent » »', () => {
  const fiche = entree({ outil: 'mcp__beluga__agent_fiche', libelle: 'Nom noté : Veilleur des demandes', resultat: 'Rubrique « nom » écrite.' });
  const flux = fluxDesEntrees([lire('a.ts'), fiche, lire('b.ts')]);
  assert.deepEqual(
    flux.map((e) => e.sorte),
    ['actions', 'note', 'actions'],
  );
  const laNote = flux[1] as Extract<(typeof flux)[number], { sorte: 'note' }>;
  assert.equal(laNote.entree.resultat, 'Nom noté : Veilleur des demandes', 'le texte lu est le libellé de la note, pas la réponse brute de l’outil');
  // Un autre appel de l'outil (lecture de la fiche) reste une action ordinaire.
  const lecture = entree({ outil: 'mcp__beluga__agent_fiche', libelle: 'agent_fiche', resultat: '{}' });
  assert.equal(fluxDesEntrees([lecture])[0]?.sorte, 'actions');
});
