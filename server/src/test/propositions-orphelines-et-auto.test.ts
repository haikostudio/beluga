/**
 * LES PROPOSITIONS DE CARTE ET LE MODE AUTO (carte « Icônes, contrastes et artefacts », 15/11/2026) : une proposition
 * restée en suspens se retire quand sa carte rend le travail (même projet seulement), et en Auto tout se fait dans la
 * même carte — refus pour le même projet, création d'office pour un autre, une seule génération.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  issueDePropositionEnAuto,
  propositionsARetirerAuRendu,
  REFUS_AUTO_MEME_PROJET,
  travailRendu,
} from '@beluga/shared';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, '../../..');
const lire = (fichier: string) => fs.readFileSync(path.join(racine, fichier), 'utf8');

test('au rendu, seules les propositions EN ATTENTE du MÊME projet se retirent', () => {
  const ids = propositionsARetirerAuRendu(
    [
      { id: 'a', decision: 'pending', projetDAccueil: 'P' },
      { id: 'b', decision: 'pending', projetDAccueil: 'Q' },
      { id: 'c', decision: 'accepted', projetDAccueil: 'P' },
      { id: 'd', decision: 'pending', projetDAccueil: null },
      { id: 'e', decision: 'pending', projetDAccueil: 'P' },
    ],
    'P',
  );
  assert.deepEqual(ids, ['a', 'e']);
});

test('« À déployer » et « Archivé » sont les colonnes d’un travail rendu', () => {
  assert.ok(travailRendu('to_deploy'));
  assert.ok(travailRendu('archived'));
  assert.ok(!travailRendu('running'));
  assert.ok(!travailRendu('planned'));
});

test('hors Auto, une proposition reste ordinaire', () => {
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: false, projetDeLaCarte: 'P', projetDAccueil: 'P', carteNeeDAuto: false }), 'ordinaire');
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: false, projetDeLaCarte: 'P', projetDAccueil: 'Q', carteNeeDAuto: false }), 'ordinaire');
});

test('en Auto, le même projet est refusé, un autre projet reçoit sa carte d’office — une seule génération', () => {
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: true, projetDeLaCarte: 'P', projetDAccueil: 'P', carteNeeDAuto: false }), 'refus-meme-projet');
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: true, projetDeLaCarte: 'P', projetDAccueil: 'P', carteNeeDAuto: true }), 'refus-meme-projet');
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: true, projetDeLaCarte: 'P', projetDAccueil: 'Q', carteNeeDAuto: false }), 'creation-d-office');
  assert.equal(issueDePropositionEnAuto({ carteEnAuto: true, projetDeLaCarte: 'P', projetDAccueil: 'Q', carteNeeDAuto: true }), 'ordinaire');
  assert.match(REFUS_AUTO_MEME_PROJET, /dans cette carte/);
  assert.match(REFUS_AUTO_MEME_PROJET, /continue/);
});

test('les deux outils de proposition passent par la règle Auto, et le rendu retire les orphelines', () => {
  const outils = lire('server/src/tools.ts');
  for (const outil of ["case 'board_create_card'", "case 'propose_task'"]) {
    const debut = outils.indexOf(outil);
    const bloc = outils.slice(debut, outils.indexOf('\n    case ', debut + 10));
    assert.match(bloc, /issueEnAutoDeLaProposition\(/, `${outil} lit la règle Auto`);
    assert.match(bloc, /REFUS_AUTO_MEME_PROJET/, `${outil} refuse le même projet`);
    assert.match(bloc, /creationDOfficeEnAuto\(/, `${outil} crée d’office pour un autre projet`);
  }
  const runtime = lire('server/src/runtime.ts');
  assert.match(runtime, /retirerLesPropositionsOrphelines\(updated\.id\)/, 'la fin de tour retire les orphelines');
  assert.match(lire('server/src/scheduler.ts'), /rattraperLesPropositionsOrphelines\(\)/, 'le démarrage rattrape les cartes déjà rendues');
  const retrait = lire('server/src/propositions-orphelines.ts');
  assert.match(retrait, /decideProposal\(proposal\.id, 'refused'\)/, 'le retrait suit le chemin d’un refus');
  assert.match(retrait, /signalAttention\(\)/, 'le signal d’attention se recalcule');
});
