import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* LA BARRE D'ÉCRITURE NE RÉPOND JAMAIS À UNE QUESTION.                */
/*                                                                     */
/* Un message écrit pendant que l'agent attend la réponse à sa         */
/* question (`ask_user`) s'empile comme quand l'agent travaille : il   */
/* partira à la fin du tour. On répond DANS la bulle de la question.   */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (relatif: string) => fs.readFileSync(path.resolve(ICI, relatif), 'utf8');
const WS = lire('../../src/ws.ts');
const RUNTIME = lire('../../src/runtime.ts');
const ATTENTE = lire('../../src/attente-question.ts');

test('« agent.prompt » ne se détourne plus vers « question.answer »', () => {
  const debut = WS.indexOf("case 'agent.prompt'");
  assert.ok(debut > 0, 'le traitement de agent.prompt doit exister');
  const suite = WS.slice(debut, debut + 9000);
  assert.doesNotMatch(suite, /type: 'question\.answer'/, 'le message de la barre ne répond pas à la question');
  assert.doesNotMatch(WS, /texteRepondALaQuestion|reponseParLaBarre|questionEnAttenteDeLAgent/);
});

test('le tour reste vivant pendant l’attente : le message s’empile', () => {
  assert.match(
    RUNTIME,
    /if \(live\.has\(agentId\) \|\| demarrant\.has\(agentId\)\) \{\n\s+const queued = store\.enqueuePrompt\(/,
    'sendPrompt empile dès qu’un tour vit, donc pendant une question d’outil',
  );
});

test('l’attente d’une réponse ne dépile jamais la file', () => {
  assert.doesNotMatch(ATTENTE, /dequeuePrompt|enchainerLaFile/);
});
