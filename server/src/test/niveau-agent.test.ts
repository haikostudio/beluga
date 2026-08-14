import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_NIVEAU_AGENT,
  DEFINITIONS_NIVEAU,
  NIVEAUX_AGENT,
  NIVEAU_PAR_DEFAUT,
  type MoteurCatalogue,
  niveauDemande,
  reglagesDeLaProposition,
  reglagesDuNiveau,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* Le chef choisit un NIVEAU, HaikoDev choisit le modèle                */
/* ------------------------------------------------------------------ */

/*
 * Le chef d'orchestre ne nomme plus un modèle : il dit à quelle ambition la
 * carte doit être exécutée. Ces contrôles rejouent la traduction, qui ne connaît
 * ni base ni disque — seulement un catalogue de moteurs.
 */

function modele(id: string, appetite?: 'light' | 'medium' | 'heavy', thinking = ['none', 'medium', 'high']) {
  return { id, label: id.replaceAll('-', ' '), thinking: thinking.map((t) => ({ id: t })), appetite };
}

const CLAUDE: MoteurCatalogue = {
  id: 'claude',
  label: 'Claude',
  installed: true,
  comptesDisponibles: 2,
  models: [
    modele('claude-opus-5', 'heavy'),
    modele('claude-sonnet-5', 'medium'),
    modele('claude-haiku-4-5', 'light', ['none']),
  ],
};

test('les trois paliers existent, du plus économe au plus ample', () => {
  assert.deepEqual(NIVEAUX_AGENT, ['leger', 'standard', 'approfondi']);
  assert.deepEqual(
    NIVEAUX_AGENT.map((id) => DEFINITIONS_NIVEAU[id].appetit),
    ['light', 'medium', 'heavy'],
  );
});

test('chaque palier retient un modèle de son appétit, dans le catalogue réel', () => {
  assert.equal(reglagesDuNiveau(CLAUDE, 'leger').model, 'claude-haiku-4-5');
  assert.equal(reglagesDuNiveau(CLAUDE, 'standard').model, 'claude-sonnet-5');
  assert.equal(reglagesDuNiveau(CLAUDE, 'approfondi').model, 'claude-opus-5');
});

test('la réflexion suit le palier, mais jamais au-delà de ce que le modèle propose', () => {
  assert.equal(reglagesDuNiveau(CLAUDE, 'standard').thinking, 'medium');
  assert.equal(reglagesDuNiveau(CLAUDE, 'approfondi').thinking, 'high');
  // Haiku n'offre que « none » : on ne lui invente pas un niveau de réflexion.
  assert.equal(reglagesDuNiveau(CLAUDE, 'leger').thinking, 'none');
});

test('sans appétit annoncé, la famille du modèle prend le relais', () => {
  const sansAppetit: MoteurCatalogue = {
    ...CLAUDE,
    models: [modele('claude-opus-5'), modele('claude-sonnet-5'), modele('claude-haiku-4-5')],
  };
  assert.equal(reglagesDuNiveau(sansAppetit, 'leger').model, 'claude-haiku-4-5');
  assert.equal(reglagesDuNiveau(sansAppetit, 'approfondi').model, 'claude-opus-5');
});

test('un palier ne rend JAMAIS rien : à défaut, le modèle par défaut du moteur', () => {
  const inconnu: MoteurCatalogue = {
    ...CLAUDE,
    defaultModel: 'moteur-maison-2',
    models: [modele('moteur-maison-1'), modele('moteur-maison-2')],
  };
  for (const niveau of NIVEAUX_AGENT) {
    assert.equal(reglagesDuNiveau(inconnu, niveau).model, 'moteur-maison-2', niveau);
  }
});

test('un catalogue vide ne fait pas inventer de modèle', () => {
  assert.equal(reglagesDuNiveau({ ...CLAUDE, models: [] }, 'standard').model, undefined);
});

/* ------------------------------------------------------------------ */
/* Le mot employé par le moteur                                         */
/* ------------------------------------------------------------------ */

test('le niveau se reconnaît malgré l’accent, la casse et les synonymes', () => {
  assert.equal(niveauDemande('léger'), 'leger');
  assert.equal(niveauDemande('  LEGER '), 'leger');
  assert.equal(niveauDemande('light'), 'leger');
  assert.equal(niveauDemande('normal'), 'standard');
  assert.equal(niveauDemande('approfondi'), 'approfondi');
});

test('un mot inconnu ne devient pas un palier au hasard', () => {
  for (const valeur of ['', 'énorme', undefined, 12, null]) {
    assert.equal(niveauDemande(valeur), undefined, String(valeur));
  }
});

/* ------------------------------------------------------------------ */
/* Le niveau l'emporte sur le modèle de la conversation                 */
/* ------------------------------------------------------------------ */

/*
 * C'est le point qui protège l'exécution : le chef trie désormais sur un modèle
 * économe. Recopier SON modèle sur la carte ferait exécuter tout le tableau au
 * rabais — le niveau annoncé décide donc, et le moteur seul est hérité.
 */

test('le niveau décide du modèle, pas la conversation du chef', () => {
  const retenu = reglagesDeLaProposition({ engine: 'claude', niveau: 'approfondi' }, [CLAUDE]);
  assert.equal(retenu?.model, 'claude-opus-5');
  assert.equal(retenu?.thinking, 'high');
  assert.equal(retenu?.niveau, 'approfondi');
});

test('un modèle déjà choisi n’est pas réécrit par le palier du chef', () => {
  const retenu = reglagesDeLaProposition(
    { engine: 'claude', model: 'claude-haiku-4-5', thinking: 'none', niveau: 'approfondi' },
    [CLAUDE],
  );
  assert.equal(retenu?.model, 'claude-haiku-4-5');
  assert.equal(retenu?.thinking, 'none');
  assert.equal(retenu?.niveau, 'approfondi');
});

test('sans niveau annoncé, l’héritage de la conversation ne bouge pas', () => {
  const retenu = reglagesDeLaProposition({ engine: 'claude', model: 'claude-sonnet-5', thinking: 'high' }, [CLAUDE]);
  assert.equal(retenu?.model, 'claude-sonnet-5');
  assert.equal(retenu?.thinking, 'high');
  assert.equal(retenu?.niveau, undefined);
});

test('le MOTEUR reste celui de la conversation, quel que soit le niveau', () => {
  const codex: MoteurCatalogue = {
    id: 'codex',
    label: 'Codex',
    installed: true,
    comptesDisponibles: 1,
    models: [modele('gpt-5.6-terra', 'heavy', ['medium', 'high']), modele('gpt-5.4', 'medium', ['medium', 'high'])],
  };
  const retenu = reglagesDeLaProposition({ engine: 'codex', niveau: 'approfondi' }, [CLAUDE, codex]);
  assert.equal(retenu?.engine, 'codex');
  assert.equal(retenu?.model, 'gpt-5.6-terra');
});

test('la consigne du niveau ne nomme aucun modèle ni aucun outil de moteur', () => {
  assert.doesNotMatch(CONSIGNE_NIVEAU_AGENT, /haiku|sonnet|opus|gpt-/i);
  assert.doesNotMatch(CONSIGNE_NIVEAU_AGENT, /TaskCreate|update_plan/);
  for (const id of NIVEAUX_AGENT) assert.ok(CONSIGNE_NIVEAU_AGENT.includes(id), id);
  assert.ok(CONSIGNE_NIVEAU_AGENT.includes(NIVEAU_PAR_DEFAUT));
});
