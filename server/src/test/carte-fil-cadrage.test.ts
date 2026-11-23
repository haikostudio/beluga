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
  contexteDeDepart,
  discussionDeCadrage,
  niveauDAccueil,
  titreDepuisLaDiscussion,
  titreEclairDeLaDemande,
  titreDeCarteADonner,
  titreEnConstruction,
  MAX_SIGNES_TITRE_ECLAIR,
  titreDeBloc,
  titreEncoreVide,
  carteDeCadrageEstVide,
  CONSIGNE_CADRAGE,
} from '@beluga/shared';

/* Une base jetable : le tour d'écriture de la carte passe par le VRAI outil. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-fil-cadrage-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard, toolsFor, CADRAGE_BLOCKED_TOOLS } = await import('../tools.js');

test('le titre en construction se lit à l’écran, sans toucher au verrou', () => {
  // Vide ou « Nouvelle tâche » : rien n'est encore posé.
  assert.equal(titreEnConstruction({ title: TITRE_CARTE_DE_CADRAGE }), true);
  assert.equal(titreEnConstruction({ title: '  ' }), true);
  // Titre éclair recopié de la demande : tient la place, reste en construction.
  assert.equal(titreEnConstruction({ title: 'Générer le titre plus vite', titreProvisoire: true }), true);
  // Titre posé par l'agent ou à la main : affiché tel quel.
  assert.equal(titreEnConstruction({ title: 'Titre éclair de la carte' }), false);
  assert.equal(titreEnConstruction({ title: 'Titre éclair de la carte', titreProvisoire: false }), false);
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

test('le plan retenu part en clair avec la discussion, à part d’elle', () => {
  const bloc = contexteDeDepart([{ role: 'user', content: 'Un bouton.' }], [], { numero: 2, texte: '# Plan v2\n\n## Faisabilité\nOui.' });
  assert.match(bloc, /LE PLAN RETENU \(version 2\)/);
  assert.match(bloc, /# Plan v2/);
  assert.match(bloc, /FIN DU PLAN RETENU\./);
  // Un plan sans discussion pose quand même son bloc : il est le chemin lancé.
  assert.match(contexteDeDepart([], [], { numero: 1, texte: '# P' }), /LE PLAN RETENU/);
});

test('une discussion vide ne pose aucun bloc', () => {
  assert.equal(contexteDeDepart([]), '');
  assert.equal(contexteDeDepart([{ role: 'user', content: '   ' }]), '');
  assert.equal(discussionDeCadrage([{ role: 'system', content: 'bonjour' }]), '');
});

test('les fiches déjà lues par le cadrage sont rappelées, pour ne pas les rouvrir', () => {
  const messages = [{ role: 'user', content: 'Un bug dans les cartes.' } as const];
  // Sans liste : pas de rappel, le comportement d'avant ne bouge pas.
  assert.equal(/FICHES DE MÉMOIRE DÉJÀ LUES/.test(contexteDeDepart(messages)), false);
  const bloc = contexteDeDepart(messages, ['cartes', 'publication', 'cartes', '  ', '']);
  assert.match(bloc, /FICHES DE MÉMOIRE DÉJÀ LUES PENDANT CE CADRAGE : cartes, publication\./);
  assert.match(bloc, /Rouvre-les avec l'outil « memoire » seulement/);
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

test('les tags « [fichier: …] » ne salissent jamais le titre généré', () => {
  assert.equal(
    titreDepuisLaDiscussion([
      {
        role: 'user',
        content:
          '[fichier: IMG_7055.jpeg] [fichier: IMG_7056.jpeg]il faut générer un titre lisible et adapté à la carte',
      },
    ]),
    'Générer un titre lisible et adapté à la carte',
  );
  // Une ligne qui n'est FAITE que de tags : on descend à la ligne suivante.
  assert.equal(
    titreDepuisLaDiscussion([
      { role: 'user', content: '[fichier: capture.png]\nRendre le tableau plus lisible' },
    ]),
    'Rendre le tableau plus lisible',
  );
});

test('le titre éclair se tire de la demande, court, propre et vivant', () => {
  // La phrase de l'utilisateur, allégée : tags retirés, amorce creuse coupée,
  // majuscule posée, point final enlevé.
  assert.equal(
    titreEclairDeLaDemande('[fichier: image.png]peux-tu générer le titre plus vite ?'),
    'Générer le titre plus vite',
  );
  assert.equal(titreEclairDeLaDemande('Bonjour, il faudrait exporter la liste en CSV.'), 'Exporter la liste en CSV');
  assert.equal(
    titreEclairDeLaDemande('J’aimerais que le tableau se charge plus vite. Et sans clignoter.'),
    'Le tableau se charge plus vite',
  );
  // Rien à tirer : on n'invente pas.
  assert.equal(titreEclairDeLaDemande('   '), '');
  assert.equal(titreEclairDeLaDemande('[fichier: capture.png]'), '');
  // Un titre reste un titre : plafond court, coupé sur un mot entier.
  const long = titreEclairDeLaDemande('Refondre '.repeat(40));
  assert.ok(long.length <= MAX_SIGNES_TITRE_ECLAIR + 1, `titre trop long : ${long.length}`);
  assert.ok(long.endsWith('…'), long);
});

test('un titre provisoire ne vaut pas un titre posé par l’agent', () => {
  // Rien d'écrit : rien de donné.
  assert.equal(titreDeCarteADonner({ title: TITRE_CARTE_DE_CADRAGE }), false);
  // Le titre éclair tient la place, mais le temps 2 reste dû.
  assert.equal(titreDeCarteADonner({ title: 'Générer le titre plus vite', titreProvisoire: true }), false);
  // Écrit par l'agent ou à la main : plus rien ne le remplace.
  assert.equal(titreDeCarteADonner({ title: 'Titre éclair de la carte' }), true);
  assert.equal(titreDeCarteADonner({ title: 'Titre éclair de la carte', titreProvisoire: false }), true);
});

/* ------------------------------------------------------------------ */
/* Le rôle « cadrage » : accueil léger, frontière du code               */
/* ------------------------------------------------------------------ */

test('l’agent de cadrage discute AVEC la mémoire du projet, sans ouvrir ses fichiers', () => {
  assert.equal(niveauDAccueil({ role: 'cadrage' }), 'cadrage');
  assert.equal(niveauDAccueil({ role: 'task' }), 'complet');
});

test('le fil de la carte nomme le bloc de cadrage', () => {
  assert.equal(titreDeBloc('cadrage'), 'Cadrage de la tâche');
  assert.equal(titreDeBloc('task'), 'Exécution de la tâche');
});

test('le cadrage garde SA carte, et ne peut qu’en PROPOSER une autre', () => {
  const noms = toolsFor('cadrage').map((outil) => outil.name);
  for (const interdit of CADRAGE_BLOCKED_TOOLS) {
    assert.equal(noms.includes(interdit), false, `« ${interdit} » ne doit pas être offert au cadrage`);
  }
  // Une partie à part se PROPOSE (vignette « Créer la carte ») : rien ne naît sans clic.
  assert.ok(noms.includes('board_create_card'));
  assert.equal(noms.includes('propose_task'), false);
  // Il garde de quoi écrire SA carte et poser SA question.
  assert.ok(noms.includes('board_update_card'));
  assert.ok(noms.includes('ask_user'));
  // Et les deux outils qui écrivent son parcours : la compréhension, le plan.
  assert.ok(noms.includes('rendre_comprehension'));
  assert.ok(noms.includes('rendre_plan'));
  // L'agent de tâche, lui, garde tout — sauf ces deux-là, qui ne parlent que du cadrage.
  const tache = toolsFor('task').map((outil) => outil.name);
  assert.ok(tache.includes('board_create_card'));
  assert.equal(tache.includes('rendre_plan'), false);
  assert.equal(tache.includes('rendre_comprehension'), false);
});

test('ce qui est demandé dans une carte s’y fait : une carte à part seulement après un « oui »', () => {
  assert.match(CONSIGNE_CADRAGE, /CE QUI EST DEMANDÉ DANS UNE CARTE SE FAIT DANS CETTE CARTE/);
  assert.match(CONSIGNE_CADRAGE, /JAMAIS d'office une carte à part/);
  assert.match(CONSIGNE_CADRAGE, /que s'il répond OUI — dans le même tour/);
  // La règle de la suite reste, derrière le même « oui ».
  assert.match(CONSIGNE_CADRAGE, /UNE SEULE SUITE/);
  assert.doesNotMatch(CONSIGNE_CADRAGE, /MÉRITE SA PROPRE CARTE SE PROPOSE POUR DE VRAI/);
  const outil = toolsFor('cadrage').find((o) => o.name === 'board_create_card');
  assert.match(outil?.description ?? '', /jamais de carte à part proposée d'office/);
});

/* ------------------------------------------------------------------ */
/* Le niveau écrit par le cadrage sur SA carte                          */
/* ------------------------------------------------------------------ */

test('un titre provisoire tient la place sans dispenser l’agent de titrer', async () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Titre provisoire',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  /* Ce que le démon pose à l'arrivée de la demande, sans moteur. */
  const carte = createCard(projet.id, {
    title: titreEclairDeLaDemande('[fichier: image.png]il faut générer le titre plus vite'),
    origin: 'user',
  });
  store.saveCard({ ...store.getCard(carte.id)!, titreProvisoire: true });
  assert.equal(store.getCard(carte.id)!.title, 'Générer le titre plus vite');

  const contexte = { agentId: 'titre-1', projectId: projet.id, role: 'cadrage' as const, cardId: carte.id };

  /* LE TEMPS 2 RESTE DÛ : le titre provisoire ne rouvre aucun autre geste. */
  const memoireTropTot = await callTool(contexte, 'memoire', { geste: 'chercher', demande: 'cartes' });
  assert.equal(memoireTropTot.ok, false);
  assert.match(memoireTropTot.text, /board_update_card/);

  /* Et le titre de l'agent REMPLACE le provisoire, au lieu d'être ignoré. */
  const pose = await callTool(contexte, 'board_update_card', {
    cardId: carte.id,
    title: 'Titre éclair de la carte',
  });
  assert.equal(pose.ok, true);
  const apres = store.getCard(carte.id)!;
  assert.equal(apres.title, 'Titre éclair de la carte');
  assert.equal(apres.titreProvisoire, undefined);
  assert.equal(titreDeCarteADonner(apres), true);

  /* Le verrou est levé pour de bon. */
  assert.equal((await callTool(contexte, 'memoire', { geste: 'chercher', demande: 'cartes' })).ok, true);
});

test('« board_update_card » retient le niveau d’exécution demandé', async () => {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Cadrage',
    path: bacASable,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
  const carte = createCard(projet.id, { title: TITRE_CARTE_DE_CADRAGE, origin: 'user' });

  const contexte = { agentId: 'a1', projectId: projet.id, role: 'cadrage' as const, cardId: carte.id };
  const ecrire = () =>
    callTool(contexte, 'board_update_card', {
      cardId: carte.id,
      title: 'Exporter la liste en CSV',
      description: 'Un bouton dans la barre.',
      niveau: 'leger',
    });

  /*
   * LE TEMPS 2 D'ABORD. Tant que la carte s'appelle « Nouvelle tâche », le seul
   * geste servi est « board_update_card » avec le seul champ « title » : même
   * « memoire » attend son tour.
   */
  const avantLeTitre = await ecrire();
  assert.equal(avantLeTitre.ok, false);
  assert.match(avantLeTitre.text, /title/);
  assert.equal(store.getCard(carte.id)!.title, TITRE_CARTE_DE_CADRAGE);

  const memoireTropTot = await callTool(contexte, 'memoire', { geste: 'chercher', demande: 'cartes' });
  assert.equal(memoireTropTot.ok, false);

  const titre = await callTool(contexte, 'board_update_card', {
    cardId: carte.id,
    title: 'Exporter la liste',
  });
  assert.equal(titre.ok, true);

  /*
   * LA CARTE S'ÉCRIT APRÈS L'ANALYSE. Un cadrage qui n'a ouvert aucun sujet de
   * la mémoire cadrerait la carte sur ce qu'il imagine du projet : le geste est
   * refusé, et le refus dit quoi faire à la place.
   */
  const tropTot = await ecrire();
  assert.equal(tropTot.ok, false);
  assert.match(tropTot.text, /« memoire »/);

  await callTool(contexte, 'memoire', { geste: 'chercher', demande: 'cartes' });
  const resultat = await ecrire();
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
  // Trois raisons : le tour en cours, la demande pas encore dite, le plan pas encore rendu.
  assert.equal(RAISONS_DU_BOUTON_LANCER.length, 3);
});

test('le serveur ne range une carte que si rien, nulle part, n\'y a été écrit', () => {
  const vide = { nbMessages: 0, brouillons: [undefined, ''], nbPiecesJointes: 0, titre: TITRE_CARTE_DE_CADRAGE, agentAuTravail: false };
  assert.equal(carteDeCadrageEstVide(vide), true);
  // brouillon pas encore rattaché à un agent (clé « aucun ») ou d'un agent de la carte
  assert.equal(carteDeCadrageEstVide({ ...vide, brouillons: [undefined, 'Un long texte en cours'] }), false);
  assert.equal(carteDeCadrageEstVide({ ...vide, brouillons: ['Un texte', ''] }), false);
  // pièce jointe seule
  assert.equal(carteDeCadrageEstVide({ ...vide, nbPiecesJointes: 1 }), false);
  // messages
  assert.equal(carteDeCadrageEstVide({ ...vide, nbMessages: 2 }), false);
  // titre déjà choisi, description, agent au travail
  assert.equal(carteDeCadrageEstVide({ ...vide, titre: 'Exporter en CSV' }), false);
  assert.equal(carteDeCadrageEstVide({ ...vide, description: 'Un besoin' }), false);
  assert.equal(carteDeCadrageEstVide({ ...vide, agentAuTravail: true }), false);
});

test('le cadrage ne demande jamais de valider un plan : « Lancer » est le seul départ', async () => {
  const { CONSIGNE_CADRAGE } = await import('@beluga/shared');
  assert.match(CONSIGNE_CADRAGE, /Il n'existe AUCUNE validation de plan/);
  assert.match(CONSIGNE_CADRAGE, /SEUL bouton « Lancer »/);
});
