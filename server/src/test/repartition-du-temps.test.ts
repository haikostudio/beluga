import test from 'node:test';
import assert from 'node:assert/strict';
import { estUneAide } from '@beluga/shared';

test('les aides se reconnaissent par leur outil, sous Claude comme ailleurs', () => {
  assert.equal(estUneAide({ outil: 'Agent', label: '' }), true);
  assert.equal(estUneAide({ outil: 'Task', label: '' }), true);
  assert.equal(estUneAide({ outil: 'Bash', label: '' }), false);
  assert.equal(estUneAide({ label: 'Délégation à un sous-agent' }), true);
});
