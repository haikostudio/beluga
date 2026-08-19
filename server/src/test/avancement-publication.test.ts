import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avancementApresLaFusion,
  avancementDeLaBranche,
  avancementDeLaFusion,
  avancementDuFlux,
  type EtapePourAvancement,
  type TacheDuLot,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* LE CHIFFRE DE LA MISE EN LIGNE : par branche, et pour tout le flux   */
/* ------------------------------------------------------------------ */

/*
 * Toutes ces règles sont PURES : des états et des listes, rien d'autre — ni
 * base, ni disque, ni horloge. Ce qu'elles verrouillent tient en une phrase :
 * un pourcentage qui ment est pire que pas de pourcentage.
 */

const SEPT: EtapePourAvancement['key'][] = ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'];

/** Une publication dont les `faites` premières étapes sont passées. */
function etapes(faites: number, enCours = false): EtapePourAvancement[] {
  return SEPT.map((key, i) => ({
    key,
    state: i < faites ? 'done' : i === faites && enCours ? 'running' : 'todo',
  }));
}

function tache(cardId: string, etat: TacheDuLot['etat']): TacheDuLot {
  return { cardId, titre: `carte ${cardId}`, etat };
}

test('la fusion d’une branche se chiffre, et ce qui est écarté ne se chiffre pas', () => {
  assert.equal(avancementDeLaFusion('attente'), 0);
  assert.equal(avancementDeLaFusion('fusion'), 0.4);
  // Un conflit est plus AVANCÉ qu'une fusion en cours : le heurt est trouvé.
  assert.ok((avancementDeLaFusion('conflit') ?? 0) > (avancementDeLaFusion('fusion') ?? 0));
  assert.equal(avancementDeLaFusion('fusionnee'), 1);
  assert.equal(avancementDeLaFusion('recollee'), 1);
  assert.equal(avancementDeLaFusion('en-ligne'), 1);
  assert.equal(avancementDeLaFusion('ecartee'), null);
  assert.equal(avancementDeLaFusion('absente'), null);
});

test('une branche écartée n’a AUCUN pourcentage : elle n’avance plus', () => {
  assert.equal(avancementDeLaBranche('ecartee', etapes(4)), null);
  assert.equal(avancementDeLaBranche('absente', etapes(4)), null);
});

test('la fusion vaut la moitié du chemin d’une branche, le reste du flux l’autre moitié', () => {
  // Rien n'a commencé : la branche attend, donc 0 %.
  assert.equal(avancementDeLaBranche('attente', etapes(0))?.pourcent, 0);
  // Fusionnée alors que rien d'autre n'est passé : la moitié, pas plus.
  assert.equal(avancementDeLaBranche('fusionnee', etapes(1))?.pourcent, 50);
  // Fusionnée, et trois des six étapes suivantes passées : 50 + 25.
  assert.equal(avancementDeLaBranche('fusionnee', etapes(4))?.pourcent, 75);
  // En ligne : le bout du chemin, et lui seul vaut 100 %.
  const enLigne = avancementDeLaBranche('en-ligne', etapes(7));
  assert.equal(enLigne?.pourcent, 100);
  assert.equal(enLigne?.termine, true);
});

test('une branche PAS ENCORE fusionnée ne gagne rien sur les étapes suivantes', () => {
  const conflit = avancementDeLaBranche('conflit', etapes(6));
  assert.equal(conflit?.fusionnee, false);
  // 70 % de sa moitié, et rien du chemin commun qu'elle n'a pas pris.
  assert.equal(conflit?.pourcent, 35);
});

test('les arrondis ne mentent pas aux deux bouts', () => {
  // Presque tout est fait, mais pas tout : jamais 100 %.
  const presque = avancementDeLaBranche('fusionnee', [
    ...etapes(6),
    { key: 'extra', state: 'todo' },
  ]);
  assert.ok(presque && presque.pourcent < 100);
  // Un tout petit quelque chose de fait : jamais 0 %.
  const tresPeu = avancementDuFlux({
    state: 'running',
    steps: [
      { key: 'merge', state: 'running' },
      ...SEPT.slice(1).map((key) => ({ key, state: 'todo' as const })),
      ...Array.from({ length: 300 }, (_, i) => ({ key: `x${i}`, state: 'todo' as const })),
    ],
    taches: [tache('a', 'fusion')],
  });
  assert.ok(tresPeu && tresPeu.pourcent >= 1);
});

test('une étape SAUTÉE ne pèse ni au numérateur ni au dénominateur', () => {
  const avec = avancementDuFlux({
    state: 'running',
    steps: [
      { key: 'merge', state: 'done' },
      { key: 'commit', state: 'done' },
      { key: 'push', state: 'skipped' },
      { key: 'verify', state: 'todo' },
    ],
  });
  assert.equal(avec?.etapes, 3);
  assert.equal(avec?.faites, 2);
  assert.equal(avec?.pourcent, 67);
});

test('la fusion en cours vaut ce que ses branches ont réellement passé', () => {
  const flux = avancementDuFlux({
    state: 'running',
    steps: etapes(0, true),
    taches: [tache('a', 'fusionnee'), tache('b', 'attente')],
  });
  // La fusion compte pour 0,5 (une passée sur deux), sur sept étapes.
  assert.equal(flux?.pourcent, 7);
  // Les branches ÉCARTÉES ne font pas reculer le chiffre.
  const avecEcart = avancementDuFlux({
    state: 'running',
    steps: etapes(0, true),
    taches: [tache('a', 'fusionnee'), tache('b', 'attente'), tache('c', 'ecartee')],
  });
  assert.equal(avecEcart?.pourcent, flux?.pourcent);
});

test('une publication réussie est à 100 %, une publication tombée FIGE son chiffre et le dit', () => {
  const reussie = avancementDuFlux({ state: 'success', steps: etapes(7) });
  assert.equal(reussie?.pourcent, 100);
  assert.equal(reussie?.termine, true);
  assert.equal(reussie?.arrete, false);

  const tombee = avancementDuFlux({
    state: 'failed',
    steps: [
      { key: 'merge', state: 'done' },
      { key: 'commit', state: 'failed' },
      { key: 'push', state: 'todo' },
      { key: 'verify', state: 'todo' },
    ],
  });
  assert.equal(tombee?.arrete, true);
  assert.equal(tombee?.termine, false);
  // Une étape TOMBÉE ne compte pas comme faite.
  assert.equal(tombee?.faites, 1);
  assert.equal(tombee?.pourcent, 25);
});

test('sans étape, il n’y a rien à chiffrer — jamais un 0 % inventé', () => {
  assert.equal(avancementDuFlux({ state: 'running', steps: [] }), null);
  assert.equal(avancementApresLaFusion([{ key: 'merge', state: 'done' }]), 0);
});
