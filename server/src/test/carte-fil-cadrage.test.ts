import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOUTON_LANCER_LA_TACHE,
  MOT_CADRAGE,
  PLAFOND_DISCUSSION,
  RAISONS_DU_BOUTON_LANCER,
  TITRE_CARTE_DE_CADRAGE,
  boutonLancerLaTache,
  contexteDeDepart,
  discussionDeCadrage,
  niveauDAccueil,
  modePlanFermeLEcriture,
  titreDepuisLaDiscussion,
  titreDeBloc,
  titreEncoreVide,
} from '@haikodev/shared';

/* Une base jetable : le tour d'écriture de la carte passe par le VRAI outil. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-fil-cadrage-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard, toolsFor, CADRAGE_BLOCKED_TOOLS } = await import('../tools.js');

/* ------------------------------------------------------------------ */
/* Le bouton « Lancer la tâche »                                       */
/* ------------------------------------------------------------------ */

test('le bouton ne paraît que dans une carte de cadrage encore en « Planifié »', () => {
  const base = { agentAuTravail: false, messages: 3 } as const;
  assert.equal(boutonLancerLaTache({ ...base, colonne: 'planned', roleAgent: 'cadrage' }).affiche, true);
  // Une carte déjà lancée, une note, une carte rangée : rien à lancer d'ici.
  assert.equal(boutonLancerLaTache({ ...base, colonne: 'running', roleAgent: 'cadrage' }).affiche, false);
  assert.equal(boutonLancerLaTache({ ...base, colonne: 'notes', roleAgent: 'cadrage' }).affiche, false);
  // Un agent de tâche parle dans la même colonne : ce n'est pas un cadrage.
  assert.equal(boutonLancerLaTache({ ...base, colonne: 'planned', roleAgent: 'task' }).affiche, false);
  assert.equal(boutonLancerLaTache({ ...base, colonne: 'planned' }).affiche, false);
});

test('le bouton attend qu’on ait parlé, et que le tour en cours soit fini', () => {
  const vide = boutonLancerLaTache({ colonne: 'planned', roleAgent: 'cadrage', agentAuTravail: false, messages: 0 });
  assert.equal(vide.affiche, true);
  assert.equal(vide.possible, false);
  assert.equal(vide.raison, RAISONS_DU_BOUTON_LANCER[1]);

  const occupe = boutonLancerLaTache({ colonne: 'planned', roleAgent: 'cadrage', agentAuTravail: true, messages: 4 });
  assert.equal(occupe.possible, false);
  assert.equal(occupe.raison, RAISONS_DU_BOUTON_LANCER[0]);

  const pret = boutonLancerLaTache({ colonne: 'planned', roleAgent: 'cadrage', agentAuTravail: false, messages: 1 });
  assert.equal(pret.possible, true);
  assert.equal(pret.raison, undefined);
});

/* ------------------------------------------------------------------ */
/* La discussion devenue contexte de départ                            */
/* ------------------------------------------------------------------ */

test('la discussion part en entier dans la demande de lancement', () => {
  const bloc = contexteDeDepart([
    { role: 'user', content: 'Je veux un bouton pour exporter la liste.' },
    { role: 'assistant', content: 'En CSV ou en PDF ?' },
    { role: 'user', content: 'En CSV.' },
    // Un appel d'outil n'est pas de la parole : il ne voyage pas.
    { role: 'tool', content: 'board_update_card(…)' },
  ]);
  assert.match(bloc, /Je veux un bouton pour exporter la liste\./);
  assert.match(bloc, /En CSV ou en PDF \?/);
  assert.match(bloc, /En CSV\./);
  assert.equal(bloc.includes('board_update_card(…)'), false);
  assert.match(bloc, /FIN DE LA CONVERSATION DE CADRAGE\./);
});

test('une discussion vide ne pose aucun bloc', () => {
  assert.equal(contexteDeDepart([]), '');
  assert.equal(contexteDeDepart([{ role: 'user', content: '   ' }]), '');
  assert.equal(discussionDeCadrage([{ role: 'system', content: 'bonjour' }]), '');
});

test('une discussion trop longue garde sa FIN, et dit ce qu’elle a laissé', () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${'m'.repeat(600)} #${i}`,
  }));
  const texte = discussionDeCadrage(messages);
  assert.ok(texte.length <= PLAFOND_DISCUSSION + 200, `discussion trop lourde : ${texte.length}`);
  // La FIN est là (c'est elle qui porte les décisions), le début ne l'est plus.
  assert.match(texte, /#39/);
  assert.equal(texte.includes('#0\n'), false);
  assert.match(texte, /échange\(s\) plus ancien\(s\) non recopié\(s\)/);
});

/* ------------------------------------------------------------------ */
/* Le titre d'une carte qui n'en a pas encore                          */
/* ------------------------------------------------------------------ */

test('une carte sans titre en reçoit un tiré de la première demande', () => {
  assert.equal(titreEncoreVide(TITRE_CARTE_DE_CADRAGE), true);
  assert.equal(titreEncoreVide('   '), true);
  assert.equal(titreEncoreVide('Exporter la liste en CSV'), false);

  assert.equal(
    titreDepuisLaDiscussion([
      { role: 'assistant', content: 'Bonjour' },
      { role: 'user', content: 'Exporter la liste en CSV\nEt garder les colonnes.' },
    ]),
    'Exporter la liste en CSV',
  );
  // Rien à tirer : on garde le mot de secours plutôt que d'inventer.
  assert.equal(titreDepuisLaDiscussion([], 'Nouvelle tâche'), 'Nouvelle tâche');

  const long = titreDepuisLaDiscussion([{ role: 'user', content: 'a'.repeat(300) }]);
  assert.ok(long.length <= 81, `titre trop long : ${long.length}`);
});

/* ------------------------------------------------------------------ */
/* Le rôle « cadrage » : accueil léger, frontière du code               */
/* ------------------------------------------------------------------ */

test('l’agent de cadrage n’ouvre pas le projet : accueil de TRI, comme le chef', () => {
  assert.equal(niveauDAccueil({ role: 'cadrage' }), 'tri');
  assert.equal(niveauDAccueil({ role: 'task' }), 'complet');
});

test('le mode plan ne retire pas ses outils au cadrage', () => {
  assert.equal(modePlanFermeLEcriture('plan', 'cadrage'), false);
  assert.equal(modePlanFermeLEcriture('plan', 'task'), true);
});

test('le fil de la carte nomme le bloc de cadrage', () => {
  assert.equal(titreDeBloc('cadrage'), 'Cadrage de la tâche');
  assert.equal(titreDeBloc('task'), 'Exécution de la tâche');
});

test('le cadrage ne peut pas proposer une AUTRE carte : cette conversation EST la carte', () => {
  const noms = toolsFor('cadrage').map((outil) => outil.name);
  for (const interdit of CADRAGE_BLOCKED_TOOLS) {
    assert.equal(noms.includes(interdit), false, `« ${interdit} » ne doit pas être offert au cadrage`);
  }
  // Mais il garde de quoi écrire SA carte et poser SA question.
  assert.ok(noms.includes('board_update_card'));
  assert.ok(noms.includes('ask_user'));
  // L'agent de tâche, lui, garde tout.
  assert.ok(toolsFor('task').map((outil) => outil.name).includes('board_create_card'));
});

/* ------------------------------------------------------------------ */
/* Le niveau écrit par le cadrage sur SA carte                          */
/* ------------------------------------------------------------------ */

test('« board_update_card » retient le niveau d’exécution demandé', async () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Cadrage',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const carte = createCard(projet.id, { title: TITRE_CARTE_DE_CADRAGE, origin: 'user' });

  const resultat = await callTool(
    { agentId: 'a1', projectId: projet.id, role: 'cadrage', cardId: carte.id },
    'board_update_card',
    { cardId: carte.id, title: 'Exporter la liste en CSV', description: 'Un bouton dans la barre.', niveau: 'leger' },
  );
  assert.equal(resultat.ok, true);

  const relue = store.getCard(carte.id)!;
  assert.equal(relue.title, 'Exporter la liste en CSV');
  assert.equal(relue.description, 'Un bouton dans la barre.');
  assert.equal(relue.run?.niveau, 'leger');
});

test('le champ « niveau » est vraiment offert par l’outil, et ses trois paliers avec', () => {
  const outil = toolsFor('cadrage').find((item) => item.name === 'board_update_card')!;
  const champ = (outil.inputSchema as any).properties.niveau;
  assert.deepEqual(champ.enum, ['leger', 'standard', 'approfondi']);
});

/* ------------------------------------------------------------------ */
/* Les mots affichés vivent dans la règle, pas dans l'écran            */
/* ------------------------------------------------------------------ */

test('les textes du cadrage sont dans le catalogue partagé', () => {
  assert.equal(BOUTON_LANCER_LA_TACHE, 'Lancer la tâche');
  assert.ok(MOT_CADRAGE.titre.length > 0 && MOT_CADRAGE.indice.length > 0);
  assert.equal(RAISONS_DU_BOUTON_LANCER.length, 2);
});
