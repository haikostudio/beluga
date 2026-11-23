import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGNES_DU_JOURNAL, opaciteDuJournal, phrasesDuJournal } from '@beluga/shared';

test('le journal garde six phrases au plus, la plus récente en dernier', () => {
  const steps = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `Action ${i}`, state: 'done', startedAt: i }));
  const p = phrasesDuJournal([{ id: 'm1', role: 'assistant', createdAt: 0, steps }]);
  assert.equal(p.length, LIGNES_DU_JOURNAL);
  assert.equal(p.at(-1)?.texte, 'Action 8');
  assert.equal(p[0]?.texte, 'Action 3');
});

test('les répétitions collées se fondent, les outils muets et les tours d’avant sont écartés', () => {
  const p = phrasesDuJournal(
    [
      { id: 'ancien', role: 'assistant', createdAt: 10, steps: [{ id: 'a', label: 'Vieux travail' }] },
      { id: 'u', role: 'user', createdAt: 100, steps: [{ id: 'x', label: 'Jamais' }] },
      {
        id: 'm',
        role: 'assistant',
        createdAt: 200,
        steps: [
          { id: '1', label: 'Lecture d’un fichier', outil: 'Read' },
          { id: '2', label: 'Lecture d’un fichier', outil: 'Read' },
          { id: '3', label: 'Recherche d’outils', outil: 'ToolSearch' },
          { id: '4', label: 'Création d’une carte', outil: 'mcp__beluga__board_create_card' },
        ],
      },
    ],
    100,
  );
  assert.deepEqual(p.map((x) => x.texte), ['Lecture d’un fichier', 'Création d’une carte']);
});

test('l’opacité décroît vers le haut : la plus récente pleine, la sixième à 10 %, la cinquième à 30 %', () => {
  assert.equal(opaciteDuJournal(0), 1);
  assert.equal(opaciteDuJournal(4), 0.3);
  assert.equal(opaciteDuJournal(5), 0.1);
  assert.equal(opaciteDuJournal(12), 0.1);
  for (let i = 1; i < 6; i++) assert.ok(opaciteDuJournal(i) < opaciteDuJournal(i - 1));
});
