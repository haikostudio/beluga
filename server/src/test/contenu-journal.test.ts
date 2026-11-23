import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIBELLE_DE_CHAMP,
  LIBELLE_ETAT_POINT,
  champsLisibles,
  dejaDitDans,
  entreeDejaDite,
  genreDAction,
  libelleDEtat,
  objetJson,
  reponseALaQuestion,
  resumeDeLEntree,
  texteDeReponseALaQuestion,
  vueDeLEntree,
  type EntreeJournal,
} from '@beluga/shared';

/**
 * CE QUE LE FLUX MONTRE D'UNE ENTRÉE — ÉPROUVÉ SUR LES VRAIS NOMS.
 *
 * `vueDeLEntree` reconnaît les paramètres que les moteurs emploient
 * (`file_path`, `old_string`, `command`…) et ceux du démon (`sujet`, `rang`).
 * Ces noms sont des faits extérieurs : ils ne se devinent pas et ils bougent.
 * Les figer ici est la seule façon de savoir qu'un jour ils ont changé, au lieu
 * de découvrir un écran retombé en vrac sur son refuge.
 */

function entree(partiel: Partial<EntreeJournal> & { rang: number }): EntreeJournal {
  return {
    id: `e${partiel.rang}`,
    cardId: 'c1',
    phase: 'execution',
    nature: 'requete',
    at: 1_000 + partiel.rang,
    libelle: '',
    ...partiel,
  };
}

/** Une requête d'outil telle que le journal l'écrit : params en JSON, résultat en texte. */
function requete(outil: string, params: unknown, resultat = ''): EntreeJournal {
  return entree({ rang: 1, outil, libelle: outil, params: JSON.stringify(params), resultat });
}

test('un texte JSON ne rend un objet que s’il en est vraiment un', () => {
  assert.deepEqual(objetJson('{"a":1}'), { a: 1 });
  assert.equal(objetJson('[1,2]'), null);
  assert.equal(objetJson('"phrase"'), null);
  assert.equal(objetJson('12'), null);
  assert.equal(objetJson(undefined), null);
  assert.equal(objetJson(''), null);
  /* Le journal BORNE ses paramètres : un JSON coupé en deux ne fait pas tomber
     l'écran, il retombe sur le texte brut. */
  assert.equal(objetJson('{"a":1, "b":"début du te'), null);
});

test('les champs d’un objet se lisent nommés, à plat, et dans l’ordre des connus', () => {
  const champs = champsLisibles({ inconnu: 'x', file_path: '/a/b.ts', offset: 12 });
  assert.deepEqual(
    champs.map((c) => [c.cle, c.libelle, c.valeur]),
    [
      ['file_path', 'Fichier', '/a/b.ts'],
      ['offset', 'À partir de la ligne', '12'],
      ['inconnu', 'inconnu', 'x'],
    ],
  );
});

test('un champ absent du catalogue garde le nom que le moteur lui a donné', () => {
  const [champ] = champsLisibles({ someUnknownKey: 'valeur' });
  assert.equal(champ.libelle, 'someUnknownKey');
  assert.equal(LIBELLE_DE_CHAMP.someUnknownKey, undefined);
});

test('les vrai/faux se disent en mots, les listes se posent à la suite, un objet s’ouvre d’un étage', () => {
  const champs = champsLisibles({ replace_all: true, mots: ['a', 'b'], donnees: { moteur: 'claude' } });
  const par = new Map(champs.map((c) => [c.cle, c.valeur]));
  assert.equal(par.get('replace_all'), 'oui');
  assert.equal(par.get('mots'), 'a, b');
  assert.equal(par.get('moteur'), 'claude');
  /* Un étage, pas deux : l'objet porteur ne reparaît pas en JSON à côté. */
  assert.equal(par.has('donnees'), false);
});

test('une valeur vide ne fait pas de champ, une valeur longue demande son propre bloc', () => {
  assert.deepEqual(champsLisibles({ vide: '', blanc: '   ' }), []);
  const [long] = champsLisibles({ content: 'a\nb' });
  assert.equal(long.long, true);
  const [court] = champsLisibles({ nom: 'abc' });
  assert.equal(court.long, false);
});

test('la réponse à une question se lit sans la consigne qui la suit', () => {
  const rendu = texteDeReponseALaQuestion('la deuxième option');
  assert.equal(reponseALaQuestion(rendu), 'la deuxième option');
  const avecFichiers = texteDeReponseALaQuestion('oui', ['capture.png']);
  assert.equal(reponseALaQuestion(avecFichiers), 'oui');
  assert.equal(reponseALaQuestion(undefined), undefined);
  /* Un texte qui ne porte pas la formule se rend entier : mieux vaut tout
     montrer que de perdre une réponse au motif qu'elle est mal formée. */
  assert.equal(reponseALaQuestion('réponse brute'), 'réponse brute');
});

test('une question rend sa question, ses choix et la réponse donnée', () => {
  const vue = vueDeLEntree(
    requete(
      'mcp__beluga__ask_user',
      { question: 'On garde le nom ?', kind: 'single', options: [{ label: 'Oui' }, { label: 'Non', description: 'on renomme' }] },
      texteDeReponseALaQuestion('Oui'),
    ),
  );
  assert.equal(vue.sorte, 'question');
  if (vue.sorte !== 'question') return;
  assert.equal(vue.question, 'On garde le nom ?');
  assert.equal(vue.choix, 'single');
  assert.deepEqual(vue.options.map((o) => o.label), ['Oui', 'Non']);
  assert.equal(vue.options[1].description, 'on renomme');
  assert.equal(vue.reponse, 'Oui');
});

test('une question sans choix annoncé est une réponse libre, et sans réponse elle n’en invente pas', () => {
  const vue = vueDeLEntree(requete('ask_user', { question: 'Et sinon ?' }));
  assert.equal(vue.sorte, 'question');
  if (vue.sorte !== 'question') return;
  assert.equal(vue.choix, 'text');
  assert.deepEqual(vue.options, []);
  assert.equal(vue.reponse, undefined);
});

test('une commande rend sa ligne, son intention et sa sortie', () => {
  const vue = vueDeLEntree(requete('Bash', { command: 'npm test', description: 'les tests du démon' }, 'ok\n'));
  assert.equal(vue.sorte, 'commande');
  if (vue.sorte !== 'commande') return;
  assert.equal(vue.commande, 'npm test');
  assert.equal(vue.intention, 'les tests du démon');
  assert.equal(vue.sortie, 'ok\n');
});

test('une lecture rend le fichier et sa ligne de départ, jamais son JSON', () => {
  const vue = vueDeLEntree(requete('Read', { file_path: '/root/beluga/web/src/app.tsx', offset: 120 }, 'export function App'));
  assert.equal(vue.sorte, 'fichier');
  if (vue.sorte !== 'fichier') return;
  assert.equal(vue.chemin, '/root/beluga/web/src/app.tsx');
  assert.equal(vue.depuis, 120);
  assert.equal(vue.extrait, 'export function App');
});

test('une modification rend son avant et son après', () => {
  const vue = vueDeLEntree(requete('Edit', { file_path: '/a/b.ts', old_string: 'avant', new_string: 'après' }));
  assert.equal(vue.sorte, 'modification');
  if (vue.sorte !== 'modification') return;
  assert.equal(vue.avant, 'avant');
  assert.equal(vue.apres, 'après');
});

test('un fichier écrit d’un bloc n’a pas d’avant', () => {
  const vue = vueDeLEntree(requete('Write', { file_path: '/a/b.ts', content: 'tout le fichier' }));
  assert.equal(vue.sorte, 'modification');
  if (vue.sorte !== 'modification') return;
  assert.equal(vue.avant, undefined);
  assert.equal(vue.apres, 'tout le fichier');
});

test('une recherche rend son motif, son périmètre et ses lignes', () => {
  const vue = vueDeLEntree(requete('Grep', { pattern: 'journal', path: 'web/src' }, 'a.ts:1\n\nb.ts:2\n'));
  assert.equal(vue.sorte, 'recherche');
  if (vue.sorte !== 'recherche') return;
  assert.equal(vue.motif, 'journal');
  assert.equal(vue.ou, 'web/src');
  assert.deepEqual(vue.lignes, ['a.ts:1', 'b.ts:2']);
});

test('la mémoire du projet rend son sujet et son texte', () => {
  const vue = vueDeLEntree(requete('mcp__beluga__project_memory', { sujet: 'publication' }, 'ce que le projet sait'));
  assert.equal(vue.sorte, 'memoire');
  if (vue.sorte !== 'memoire') return;
  assert.equal(vue.sujet, 'publication');
  assert.equal(vue.texte, 'ce que le projet sait');
});

test('une adresse consultée rend son adresse et sa consigne', () => {
  const vue = vueDeLEntree(requete('WebFetch', { url: 'https://exemple.test', prompt: 'le prix' }, 'la page'));
  assert.equal(vue.sorte, 'web');
  if (vue.sorte !== 'web') return;
  assert.equal(vue.adresse, 'https://exemple.test');
  assert.equal(vue.intention, 'le prix');
});

test('un point de travail rend son état et son rang', () => {
  const vue = vueDeLEntree(
    entree({ rang: 3, nature: 'point', libelle: 'Écrire les tests', etat: 'running', donnees: JSON.stringify({ rang: 2, sur: 5 }) }),
  );
  assert.equal(vue.sorte, 'point');
  if (vue.sorte !== 'point') return;
  assert.equal(vue.etat, 'running');
  assert.equal(vue.rang, 2);
  assert.equal(vue.sur, 5);
});

test('les quatre états d’un point se disent en français, un état inconnu garde son mot', () => {
  assert.deepEqual(Object.keys(LIBELLE_ETAT_POINT), ['todo', 'running', 'done', 'unfinished']);
  assert.equal(libelleDEtat('running'), 'En cours');
  assert.equal(libelleDEtat('inconnu'), 'inconnu');
  assert.equal(libelleDEtat(undefined), undefined);
});

test('la demande, le plan et la réponse se lisent comme des textes', () => {
  for (const libelle of ['Demande', 'Plan proposé', 'Réponse rendue']) {
    const vue = vueDeLEntree(entree({ rang: 1, nature: 'jalon', libelle, resultat: '# Un titre\ndu texte' }));
    assert.equal(vue.sorte, 'texte', libelle);
  }
});

test('le départ d’un tour n’a pas de texte : il rend ses champs, nommés', () => {
  const vue = vueDeLEntree(
    entree({
      rang: 1,
      nature: 'jalon',
      libelle: 'Tour lancé',
      donnees: JSON.stringify({ moteur: 'claude', modele: 'opus', reflexion: 'haute', session: 'nouvelle', mode: 'normal' }),
    }),
  );
  assert.equal(vue.sorte, 'champs');
  if (vue.sorte !== 'champs') return;
  assert.deepEqual(
    vue.champs.map((c) => c.libelle),
    ['Moteur', 'Modèle', 'Réflexion', 'Session', 'Mode'],
  );
});

test('une entrée qui n’a pas ce qu’il faut pour sa sorte retombe sur le refuge, jamais sur du JSON brut', () => {
  /* Une lecture sans chemin : le genre dit « lecture », mais il n'y a pas de
     fichier à montrer. On nomme ce qu'on a plutôt que d'afficher un bloc vide. */
  const vue = vueDeLEntree(requete('Read', { autre: 'chose' }, 'du texte'));
  assert.equal(vue.sorte, 'champs');
  if (vue.sorte !== 'champs') return;
  assert.deepEqual(vue.champs.map((c) => c.cle), ['autre']);
  assert.equal(vue.texte, 'du texte');
});

test('une entrée sans rien du tout rend un refuge vide, et ne casse pas', () => {
  /* SANS MÊME UN NOM D'OUTIL : une étape de moteur, une vieille entrée. C'est
     le seul cas qui reste au refuge — un outil NOMMÉ a son propre bloc. */
  const vue = vueDeLEntree(entree({ rang: 1, libelle: 'Inconnu' }));
  assert.equal(vue.sorte, 'champs');
  if (vue.sorte !== 'champs') return;
  assert.deepEqual(vue.champs, []);
  assert.equal(vue.texte, undefined);
});

test('un appel d’outil NOMMÉ a son propre bloc : le nom, puis les données rendues', () => {
  const vue = vueDeLEntree(requete('coffre_fort', { action: 'lister' }, 'trois accès'));
  assert.equal(vue.sorte, 'outil');
  if (vue.sorte !== 'outil') return;
  assert.equal(vue.nom, 'coffre_fort');
  assert.deepEqual(vue.champs.map((c) => c.cle), ['action']);
  assert.equal(vue.texte, 'trois accès');
});

test('la demande porte ses pièces jointes ; sans pièce, elle reste un simple texte', () => {
  const avec = vueDeLEntree(
    entree({
      rang: 1,
      nature: 'jalon',
      libelle: 'Demande',
      resultat: 'regarde cette capture',
      donnees: JSON.stringify({ messageId: 'm1', pieces: ['a1', 'a2'] }),
    }),
  );
  assert.equal(avec.sorte, 'demande');
  if (avec.sorte !== 'demande') return;
  assert.deepEqual(avec.pieces, ['a1', 'a2']);

  const sans = vueDeLEntree(
    entree({ rang: 1, nature: 'jalon', libelle: 'Demande', resultat: 'juste une phrase' }),
  );
  assert.equal(sans.sorte, 'texte');
});

test('la ligne repliée dit CE QUE l’entrée a touché, pas seulement le nom de l’outil', () => {
  assert.equal(resumeDeLEntree(requete('Read', { file_path: '/root/beluga/web/src/app.tsx' })), 'app.tsx');
  assert.equal(resumeDeLEntree(requete('Bash', { command: 'npm test' })), 'npm test');
  assert.equal(resumeDeLEntree(requete('Grep', { pattern: 'journal' })), 'journal');
  assert.equal(resumeDeLEntree(requete('mcp__beluga__project_memory', { sujet: 'cartes' }, 'des faits')), 'cartes');
  assert.equal(resumeDeLEntree(requete('ask_user', { question: 'On y va ?' })), 'On y va ?');
});

test('le résumé d’un texte est son premier titre, débarrassé de ses dièses', () => {
  const vue = entree({ rang: 1, nature: 'jalon', libelle: 'Plan proposé', resultat: '\n\n## 2. Déroulé\nla suite' });
  assert.equal(resumeDeLEntree(vue), '2. Déroulé');
});

test('une étape du moteur porte son outil BRUT, et se lit comme un appel ordinaire', () => {
  /* Le moteur annonce ses étapes avec une étiquette FRANÇAISE (« Lecture de
     web/src/app.tsx ») et son outil brut à côté. C'est l'outil brut qui décide
     la sorte : sans lui, toutes les étapes retombaient sur le refuge, sans un
     seul champ à montrer. */
  const etape = entree({
    rang: 1,
    outil: 'Read',
    libelle: 'Lecture de web/src/app.tsx',
    params: JSON.stringify({ file_path: '/root/beluga/web/src/app.tsx' }),
    resultat: '/root/beluga/web/src/app.tsx',
  });
  assert.equal(genreDAction(etape), 'lecture');
  assert.equal(vueDeLEntree(etape).sorte, 'fichier');
  assert.equal(resumeDeLEntree(etape), 'app.tsx');
});

test('la mise à jour du plan est un plan, pas une écriture de fichier', () => {
  assert.equal(genreDAction({ nature: 'requete', outil: 'TodoWrite', libelle: 'Mise à jour du plan' }), 'plan');
  /* …et une commande qui parle de plan reste une commande : le motif vise un
     nom d'outil entier, pas un mot croisé dans une ligne de commande. */
  assert.equal(genreDAction({ nature: 'requete', outil: 'Bash', libelle: 'Commande : cat plan.md' }), 'commande');
});

test('un refuge ne résume que ce qui tient sur une ligne', () => {
  /* Le bloc d'un outil se résume comme le refuge : par son premier paramètre,
     seul repère qui distingue dix appels du même outil. */
  assert.equal(resumeDeLEntree(requete('Inconnu', { nom: 'court' })), 'court');
  assert.equal(resumeDeLEntree(requete('Inconnu', { content: 'une ligne\nune autre' })), undefined);
});

test('une intention déjà enchâssée dans la phrase du bloc ne se redit pas', () => {
  const phrase = 'Je lance une commande pour lire le module de TVA.';
  assert.equal(dejaDitDans(phrase, 'Lire le module de TVA'), true);
  assert.equal(dejaDitDans('Je lance une commande pour voir les occurrences de note-tva trouvées.', 'Voir les occurrences de note-tva trouvées'), true);
  /* Une autre intention, ou un bout de mot, reste montrée. */
  assert.equal(dejaDitDans(phrase, 'Lire le module de paiement'), false);
  assert.equal(dejaDitDans(phrase, 'TV'), false);
  /* Une phrase coupée ne contient plus le texte entier. */
  assert.equal(dejaDitDans('Je lance une commande pour lire le module de…', 'Lire le module de TVA'), false);
  assert.equal(dejaDitDans(undefined, 'x'), false);
  assert.equal(dejaDitDans(phrase, ''), false);
});

test('les outils du tableau nomment la carte visée, en français', () => {
  const champs = champsLisibles({ cardId: 'ba69aea9-ca55-4540-b959-bdc93e7b8a47', title: 'Ordre de la démo' });
  assert.deepEqual(
    champs.map((champ) => [champ.cle, champ.libelle]),
    [
      ['title', 'Titre'],
      ['cardId', 'Carte'],
    ],
  );
});

test("une note de l'agent déjà lue dans la phrase du bloc n'a rien à déplier (capture #b37f)", () => {
  const texte = "Je lis maintenant les fiches complètes des annonces d'application ou de plateforme, pour y trouver les budgets précis et le profil du client.";
  assert.equal(entreeDejaDite(texte, { sorte: 'texte', texte }), true);
  /* Une note plus longue que sa phrase coupée reste montrée. */
  assert.equal(entreeDejaDite('Je lis maintenant les fiches…', { sorte: 'texte', texte }), false);
  /* Une vraie action garde toujours son résultat, même si son intention est redite. */
  assert.equal(entreeDejaDite('Je lance une commande pour lire le module de TVA.', { sorte: 'commande', intention: 'Lire le module de TVA' } as any), false);
});
