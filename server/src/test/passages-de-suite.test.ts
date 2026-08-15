import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARGE_SEUIL_SUITE,
  PASSAGES_SUITE_MAX,
  PLAFOND_PASSAGES_JETONS,
  PLAFOND_PASSAGES_SUITE_JETONS,
  SCORE_MINIMUM,
  bullesDuPromptEnvoye,
  clePassage,
  libelleDesPassagesDeSuite,
  passagesInedits,
  raisonAbsenceDePassages,
  seuilDeSuite,
  texteDesPassagesDeSuite,
  type PassageClasse,
  type SentContextSnapshot,
} from '@haikodev/shared';

/*
 * LA RECHERCHE RELANCÉE À CHAQUE DEMANDE.
 *
 * Jusqu'ici la mémoire n'était fouillée qu'au premier tour d'une session : dès
 * le deuxième message, la bulle ne portait plus qu'un rappel générique
 * (« reprise de session »), qui ne disait rien de la question posée. Ces règles
 * pures tiennent le nouveau contrat : on cherche à chaque message, on ne renvoie
 * jamais deux fois le même passage, et on reste plus léger qu'au lancement.
 */

function passage(source: string, titre: string, score = 0.5): PassageClasse {
  return {
    source,
    titre,
    sujet: 'essai',
    priorite: 1,
    texte: `le texte de ${titre}`,
    score,
    sens: score,
    mots: score,
    jetons: 20,
  };
}

test('un tour de suite pèse moins lourd qu’un lancement, et rend moins de passages', () => {
  assert.ok(PLAFOND_PASSAGES_SUITE_JETONS < PLAFOND_PASSAGES_JETONS);
  assert.ok(PLAFOND_PASSAGES_SUITE_JETONS > 0);
  assert.ok(PASSAGES_SUITE_MAX >= 1 && PASSAGES_SUITE_MAX <= 4);
});

test('le seuil d’un tour de suite est plus exigeant que celui du lancement', () => {
  assert.equal(seuilDeSuite(SCORE_MINIMUM), SCORE_MINIMUM + MARGE_SEUIL_SUITE);
  assert.ok(seuilDeSuite(SCORE_MINIMUM) > SCORE_MINIMUM);
  // C'est un ÉCART : il s'applique aussi à l'échelle de la recherche par le sens.
  assert.ok(seuilDeSuite(0.24) > 0.24);
});

test('un passage déjà servi dans la session ne repart pas', () => {
  const candidats = [passage('docs/regles/cartes.md', 'Cartes'), passage('docs/regles/voix.md', 'Voix')];
  const inedits = passagesInedits(candidats, [clePassage(candidats[0])]);
  assert.deepEqual(
    inedits.map((p) => p.titre),
    ['Voix'],
  );
});

test('rien de déjà servi : tous les candidats passent', () => {
  const candidats = [passage('a.md', 'A'), passage('b.md', 'B')];
  assert.equal(passagesInedits(candidats, []).length, 2);
});

test('le bloc envoyé dit qu’il répond à LA demande et qu’il n’est qu’un complément', () => {
  const texte = texteDesPassagesDeSuite([passage('docs/regles/cartes.md', 'Cartes')]);
  assert.match(texte, /pour LA demande/);
  assert.match(texte, /complément/);
  assert.match(texte, /docs\/regles\/cartes\.md/);
  assert.match(texte, /project_memory/);
});

test('aucun passage : aucun bloc, jamais un encadré vide', () => {
  assert.equal(texteDesPassagesDeSuite([]), '');
});

test('le nom du bloc parle de la DEMANDE, pas de la session', () => {
  const libelle = libelleDesPassagesDeSuite(2);
  assert.match(libelle, /cette demande/);
  assert.match(libelle, /\(2\)/);
});

test('une recherche qui a tourné sans rien trouver le DIT, au lieu de « reprise de session »', () => {
  const raison = raisonAbsenceDePassages({
    nouvelleSession: false,
    accueilEmporteLaMemoire: true,
    rechercheTentee: true,
  });
  assert.match(raison, /a bien tourné sur cette demande/);
  assert.ok(!/Reprise de session/.test(raison));
});

test('la bulle de mémoire nomme la demande, pas la mémoire du projet en général', () => {
  const tour = {
    engine: 'claude',
    model: 'claude-sonnet-5',
    session: 'new',
    prompt: 'salut',
    systemInstruction: { kind: 'full', content: 'MÉTHODE', transport: 'separate' },
    blocks: [{ kind: 'request', label: 'Demande utilisateur', characters: 5, text: 'salut' }],
    passages: [{ source: 'docs/regles/cartes.md', titre: 'Cartes', score: 0.6, tokens: 12, texte: 'une règle' }],
    history: 'none',
    sentAt: 1_000,
  } as SentContextSnapshot;
  const bulles = bullesDuPromptEnvoye(tour);
  const memoire = bulles.find((b) => b.cle === 'memoire');
  assert.match(memoire?.titre ?? '', /cette demande/);
  assert.match(memoire?.texte ?? '', /docs\/regles\/cartes\.md/);
});
