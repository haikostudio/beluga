import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAIL_ETAPE_MAX,
  REFLEXION_DE_FUSION,
  annonceDeHeurts,
  detailDeLEtape,
  lignesNouvelles,
  mentionDeLOrdre,
  ordreDeFusion,
  passesDeResolution,
  runDeFusionLegere,
  selectionSansHeurts,
  type MoteurCatalogue,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LA FUSION DU LOT : qui résout, dans quel ordre, ce qui s'écrit       */
/* ------------------------------------------------------------------ */

/*
 * Les quatre règles nées de l'audit du 18/08/2026
 * (`docs/audit-fusion-deploiement.md`). Toutes PURES : ni base, ni disque, ni
 * git — un catalogue de moteurs et des listes, rien d'autre.
 */

function modele(id: string, appetite?: 'light' | 'medium' | 'heavy', thinking = ['none', 'medium', 'high']) {
  return { id, label: id.replaceAll('-', ' '), thinking: thinking.map((t) => ({ id: t })), appetite };
}

const CLAUDE: MoteurCatalogue = {
  id: 'claude',
  label: 'Claude',
  installed: true,
  comptesDisponibles: 2,
  models: [modele('claude-opus-5', 'heavy'), modele('claude-sonnet-5', 'medium'), modele('claude-haiku-4-5', 'light')],
};

const CODEX: MoteurCatalogue = {
  id: 'codex',
  label: 'Codex',
  installed: true,
  comptesDisponibles: 1,
  models: [modele('gpt-5.6-sol', 'heavy'), modele('gpt-5.4-mini')],
};

/* 1. Le modèle qui résout un conflit --------------------------------- */

test('la première passe descend sur le modèle léger du MÊME moteur', () => {
  const leger = runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5', thinking: 'high' }, [CLAUDE, CODEX]);
  assert.equal(leger?.engine, 'claude');
  assert.equal(leger?.model, 'claude-haiku-4-5');
  assert.equal(leger?.thinking, REFLEXION_DE_FUSION);
});

test('sans appétit annoncé, la famille légère du moteur suffit', () => {
  const leger = runDeFusionLegere({ engine: 'codex', model: 'gpt-5.6-sol', thinking: 'xhigh' }, [CLAUDE, CODEX]);
  assert.equal(leger?.model, 'gpt-5.4-mini');
});

test('la réflexion voulue est ramenée à ce que le modèle propose vraiment', () => {
  const sansMedium: MoteurCatalogue = { ...CLAUDE, models: [modele('claude-haiku-4-5', 'light', ['none'])] };
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5' }, [sansMedium])?.thinking, 'none');
});

test('rien à alléger : moteur inconnu, aucun modèle léger, ou carte déjà légère', () => {
  assert.equal(runDeFusionLegere({ engine: 'cursor', model: 'x' }, [CLAUDE]), undefined);
  const lourdSeul: MoteurCatalogue = { ...CLAUDE, models: [modele('claude-opus-5', 'heavy')] };
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-opus-5' }, [lourdSeul]), undefined);
  assert.equal(runDeFusionLegere({ engine: 'claude', model: 'claude-haiku-4-5' }, [CLAUDE]), undefined);
});

test('deux passes quand il y a de quoi alléger, la légère D’ABORD', () => {
  const passes = passesDeResolution({ engine: 'claude', model: 'claude-opus-5', thinking: 'high' }, [CLAUDE]);
  assert.deepEqual(
    passes.map((p) => p.nom),
    ['legere', 'carte'],
  );
  assert.equal(passes[0].run?.model, 'claude-haiku-4-5');
  assert.equal(passes[1].run?.model, 'claude-opus-5');
});

test('une seule passe quand il n’y a rien à alléger : jamais deux fois le même modèle', () => {
  const passes = passesDeResolution({ engine: 'claude', model: 'claude-haiku-4-5' }, [CLAUDE]);
  assert.deepEqual(
    passes.map((p) => p.nom),
    ['carte'],
  );
});

/* 2. L'ordre de fusion ------------------------------------------------ */

test('les branches sans heurt passent devant, chacune gardant sa place', () => {
  const lot = [
    { cardId: 'a', heurte: true },
    { cardId: 'b', heurte: false },
    { cardId: 'c', heurte: true },
    { cardId: 'd', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['b', 'd', 'a', 'c'],
  );
});

test('sans prévision de heurt, l’ordre d’origine ne bouge pas', () => {
  const lot = [
    { cardId: 'a', heurte: false },
    { cardId: 'b', heurte: false },
  ];
  assert.deepEqual(
    ordreDeFusion(lot).map((b) => b.cardId),
    ['a', 'b'],
  );
  assert.equal(mentionDeLOrdre(0, 2), null);
  // Tout se heurte : réordonner n'apprend rien, on ne dit rien.
  assert.equal(mentionDeLOrdre(2, 2), null);
  assert.match(mentionDeLOrdre(1, 3) ?? '', /2 branche\(s\) sans heurt/);
});

/* 3. Le détail d'une étape -------------------------------------------- */

test('le détail s’ajoute, sans recopier ce qui y est déjà', () => {
  assert.equal(detailDeLEtape('', 'a'), 'a');
  assert.equal(detailDeLEtape('a', 'b'), 'a\nb');
  assert.equal(detailDeLEtape('a\nb', ''), 'a\nb');
});

test('un détail trop long garde ses DEUX bouts et dit ce qui manque', () => {
  const tete = 'PREMIÈRE BRANCHE';
  const queue = 'DERNIÈRE BRANCHE';
  const long = `${tete}${'x'.repeat(DETAIL_ETAPE_MAX * 2)}${queue}`;
  const rendu = detailDeLEtape('', long);
  assert.ok(rendu.length <= DETAIL_ETAPE_MAX);
  assert.ok(rendu.startsWith(tete), 'la tête du détail est perdue');
  assert.ok(rendu.endsWith(queue), 'la fin du détail est perdue');
  assert.match(rendu, /milieu a été retiré/);
});

test('seule la SUITE part au détail : c’est ce qui recopiait le journal', () => {
  const lignes = ['un', 'deux', 'trois'];
  assert.equal(lignesNouvelles(lignes, 0), 'un\ndeux\ntrois');
  assert.equal(lignesNouvelles(lignes, 2), 'trois');
  assert.equal(lignesNouvelles(lignes, 3), '');
});

/* 4. Prévenir avant de lancer un gros lot ------------------------------ */

test('l’annonce ne paraît que si elle apprend quelque chose', () => {
  assert.equal(annonceDeHeurts(0, 10), null);
  assert.equal(annonceDeHeurts(1, 1), null);
  assert.match(annonceDeHeurts(3, 10) ?? '', /3 tâches sur 10 se heurtent/);
  assert.match(annonceDeHeurts(1, 4) ?? '', /1 tâche sur 4 se heurte/);
});

test('publier en deux fois ne garde que les tâches qui ne heurtent rien', () => {
  const lot = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual([...selectionSansHeurts(lot, ['b'])], ['a', 'c']);
  assert.deepEqual([...selectionSansHeurts(lot, [])], ['a', 'b', 'c']);
  assert.equal(selectionSansHeurts(lot, ['a', 'b', 'c']).size, 0);
});
