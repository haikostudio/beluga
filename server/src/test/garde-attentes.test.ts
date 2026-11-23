import test from 'node:test';
import assert from 'node:assert/strict';
import { commandeAttendEnVain, dureeEnSecondes, lanceUnServeur, refusDesAttentes, sansHeredocs } from '@beluga/shared';

const refusee = (commande: string, arrierePlan = false) => commandeAttendEnVain(commande, { arrierePlan }).refusee;

test('les attentes en boucle non bornées sont refusées, avec leurs issues', () => {
  const verdict = commandeAttendEnVain('until curl -s localhost:7099 >/dev/null; do sleep 2; done; echo pret');
  assert.equal(verdict.refusee, true);
  assert.equal(verdict.genre, 'boucle');
  const texte = refusDesAttentes(verdict);
  assert.match(texte, /arrière-plan/);
  assert.match(texte, /timeout 120/);
  assert.match(texte, /curl --retry/);
  assert.equal(refusee('while ! grep -q fini /tmp/j.log; do sleep 5; done'), true);
});

test('une boucle bornée, lancée en fond ou en arrière-plan passe', () => {
  assert.equal(refusee("timeout 60 bash -c 'until curl -s localhost:7099; do sleep 1; done'"), false);
  assert.equal(refusee('while true; do date; sleep 30; done &'), false);
  assert.equal(refusee('until curl -s x; do sleep 2; done', true), false);
  // Une borne trop large ne compte pas.
  assert.equal(refusee("timeout 900 bash -c 'while true; do sleep 5; done'"), true);
});

test('un long sommeil au premier plan est refusé, un court passe', () => {
  assert.equal(commandeAttendEnVain('sleep 120 && tail -n 20 /tmp/j.log').genre, 'sommeil');
  assert.equal(refusee('sleep 2m'), true);
  assert.equal(refusee('sleep 5 && curl -s localhost:7099'), false);
  assert.equal(refusee('sleep 20'), false);
  assert.equal(refusee('sleep 300', true), false);
  assert.equal(dureeEnSecondes('1.5m'), 90);
});

test('un serveur d\'essai au premier plan est refusé ; en fond, borné ou construit, il passe', () => {
  assert.equal(commandeAttendEnVain('npm run dev --workspace web -- --port 7099').genre, 'serveur');
  assert.equal(refusee('cd web && npx vite --port 7099'), true);
  assert.equal(refusee('pnpm dev'), true);
  assert.equal(refusee('npm start'), true);
  assert.equal(refusee('python3 -m http.server 8000'), true);
  assert.equal(refusee('docker compose up'), true);
  assert.equal(refusee('node server/dist/main.js'), true);
  // Les formes qui rendent la main.
  assert.equal(refusee('npm run dev --workspace web -- --port 7099 > /tmp/dev.log 2>&1 &'), false);
  assert.equal(refusee('nohup npm run dev > /tmp/dev.log 2>&1 & sleep 3; curl -s localhost:7099'), false);
  assert.equal(refusee('npm run dev', true), false);
  assert.equal(refusee('timeout 60 npm run dev'), false);
  assert.equal(refusee('docker compose up -d'), false);
  assert.equal(refusee('npm run build && npm test'), false);
  assert.equal(refusee('npx vite build'), false);
  assert.equal(refusee('npm run devtools-check'), false);
  assert.equal(refusee('npm install'), false);
});

test('un suivi sans fin est refusé, une lecture bornée passe', () => {
  assert.equal(commandeAttendEnVain('tail -f /tmp/dev.log').genre, 'suivi');
  assert.equal(refusee('journalctl -u beluga -f'), true);
  assert.equal(refusee('tail -n 80 /tmp/dev.log'), false);
  assert.equal(refusee('timeout 20 tail -f /tmp/dev.log'), false);
});

test('le texte écrit (heredoc, guillemets) n\'est jamais pris pour une commande', () => {
  const ecriture = "cat > README.md <<'EOF'\nLancer :\nnpm run dev\ntail -f journal\nEOF\necho ok";
  assert.equal(sansHeredocs(ecriture).includes('npm run dev'), false);
  assert.equal(refusee(ecriture), false);
  assert.equal(refusee('git commit -m "npm run dev ne bloque plus ; sleep 300"'), false);
  assert.equal(refusee('grep -rn "npm run dev" docs/'), false);
});

test('le repérage d\'un serveur ne prend que les formes sûres', () => {
  assert.equal(lanceUnServeur('npm run preview'), 'npm run preview');
  assert.equal(lanceUnServeur('npm --prefix web run dev'), 'npm run dev');
  assert.equal(lanceUnServeur('npm run test'), null);
  assert.equal(lanceUnServeur('npx next build'), null);
});
