import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELAI_AVANT_VEILLE_MS,
  PAS_DES_RAFALES_MS,
  PAS_DE_REVISION_DE_VEILLE_MS,
  attenteAvantAvis,
  detailDansLePerimetre,
  doitVeiller,
  prochaineRevisionDeVeille,
  reperesDeLEvenement,
  detailToujoursEnvoye,
  retenirDansLePerimetre,
  ECART_DE_GEL_MS,
  PAS_DU_TEMOIN_D_HORLOGE_MS,
  pageSortieDUnGel,
} from '@beluga/shared';

const SOURCES_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/src');

const T = 1_700_000_000_000;

test('une page à l’écran ne dort jamais', () => {
  assert.equal(doitVeiller({ cacheDepuis: null, gardes: 0 }, T), false);
  assert.equal(prochaineRevisionDeVeille({ cacheDepuis: null, gardes: 0 }, T), null);
});

test('une bascule d’une seconde vers une autre fenêtre ne coupe rien', () => {
  assert.equal(doitVeiller({ cacheDepuis: T - 1_000, gardes: 0 }, T), false);
  assert.equal(prochaineRevisionDeVeille({ cacheDepuis: T - 1_000, gardes: 0 }, T), DELAI_AVANT_VEILLE_MS - 1_000);
});

test('une page cachée depuis le délai se met en veille', () => {
  assert.equal(doitVeiller({ cacheDepuis: T - DELAI_AVANT_VEILLE_MS, gardes: 0 }, T), true);
  assert.equal(prochaineRevisionDeVeille({ cacheDepuis: T - DELAI_AVANT_VEILLE_MS, gardes: 0 }, T), 0);
});

test('une conversation vocale ou un enregistrement tient la page éveillée, aussi longtemps qu’il dure', () => {
  assert.equal(doitVeiller({ cacheDepuis: T - 3_600_000, gardes: 1 }, T), false);
  assert.equal(doitVeiller({ cacheDepuis: T - 3_600_000, gardes: 1, gelee: true }, T), false);
  assert.equal(prochaineRevisionDeVeille({ cacheDepuis: T - 3_600_000, gardes: 2 }, T), PAS_DE_REVISION_DE_VEILLE_MS);
});

test('une page gelée par le système dort tout de suite, sans attendre le délai', () => {
  assert.equal(doitVeiller({ cacheDepuis: T, gardes: 0, gelee: true }, T), true);
});

test('un événement isolé est annoncé sans attendre, une rafale au plus une fois par pas', () => {
  assert.equal(attenteAvantAvis(null, T), 0);
  assert.equal(attenteAvantAvis(T - 5_000, T), 0);
  assert.equal(attenteAvantAvis(T - 30, T), PAS_DES_RAFALES_MS - 30);
  // Une horloge qui recule ne bloque jamais l'écran.
  assert.equal(attenteAvantAvis(T + 10_000, T), 0);
});

const perimetre = (projet: string | null, agents: string[] = [], cartes: string[] = []) => ({
  projet,
  agents: new Set(agents),
  cartes: new Set(cartes),
});

test('seuls les événements de détail sont situés ; le reste part toujours', () => {
  assert.equal(reperesDeLEvenement({ type: 'card.upsert', card: { id: 'c' } }), null);
  assert.equal(reperesDeLEvenement({ type: 'agent.upsert', agent: { id: 'a' } }), null);
  assert.equal(reperesDeLEvenement({ type: 'attention' }), null);
  assert.deepEqual(reperesDeLEvenement({ type: 'message.upsert', message: { agentId: 'a' } }), { agentId: 'a' });
  assert.deepEqual(reperesDeLEvenement({ type: 'queue.etat', agentId: 'a' }), { agentId: 'a' });
  assert.deepEqual(reperesDeLEvenement({ type: 'journal.entree', entree: { cardId: 'c' } }), { cardId: 'c' });
  assert.deepEqual(reperesDeLEvenement({ type: 'carnet.lignes', cardId: 'c' }), { cardId: 'c' });
});

test('un message qui porte une question ouverte ou une proposition en attente part toujours (capture #7b1a)', () => {
  const question = { type: 'message.upsert', message: { agentId: 'a', questions: [{ id: 'q', question: 'Oui ?' }], proposals: [] } };
  assert.equal(detailToujoursEnvoye(question), true);
  assert.equal(reperesDeLEvenement(question), null);
  const repondue = { type: 'message.upsert', message: { agentId: 'a', questions: [{ id: 'q', question: 'Oui ?', answer: 'oui' }], proposals: [] } };
  assert.equal(detailToujoursEnvoye(repondue), false);
  assert.deepEqual(reperesDeLEvenement(repondue), { agentId: 'a' });
  const proposition = { type: 'message.upsert', message: { agentId: 'a', questions: [], proposals: [{ decision: 'pending' }] } };
  assert.equal(detailToujoursEnvoye(proposition), true);
  // un fragment de réponse ordinaire reste trié
  assert.equal(detailToujoursEnvoye({ type: 'message.upsert', message: { agentId: 'a', content: 'texte' } }), false);
});

test('le détail du projet affiché part, celui d’un autre projet non', () => {
  assert.equal(detailDansLePerimetre({ projectId: 'p1', agentId: 'a' }, perimetre('p1')), true);
  assert.equal(detailDansLePerimetre({ projectId: 'p2', agentId: 'a' }, perimetre('p1')), false);
});

test('une conversation ou une carte demandée par l’écran part, quel que soit son projet', () => {
  assert.equal(detailDansLePerimetre({ projectId: 'p2', agentId: 'a' }, perimetre('p1', ['a'])), true);
  assert.equal(detailDansLePerimetre({ projectId: 'p2', agentId: 'a', cardId: 'c' }, perimetre('p1', [], ['c'])), true);
  assert.equal(detailDansLePerimetre({ projectId: 'p2', agentId: 'b', cardId: 'd' }, perimetre('p1', ['a'], ['c'])), false);
});

test('dans le doute, on envoie : lieu inconnu, ou écran qui n’a encore rien ouvert', () => {
  assert.equal(detailDansLePerimetre({ agentId: 'a' }, perimetre('p1')), true);
  assert.equal(detailDansLePerimetre({ projectId: 'p2', agentId: 'a' }, perimetre(null)), true);
});

test('le périmètre retenu est borné, le plus ancien sort en premier', () => {
  const vus = new Set<string>();
  for (const id of ['a', 'b', 'c', 'a', 'd']) retenirDansLePerimetre(vus, id, 3);
  assert.deepEqual([...vus], ['c', 'a', 'd']);
});

/* ------------------------------------------------------------------ */
/* Le gel silencieux de l'iPhone se reconnaît au trou dans le temps     */
/* ------------------------------------------------------------------ */

test('un battement à l’heure n’est pas un gel ; un fil principal occupé non plus', () => {
  assert.equal(pageSortieDUnGel(1_000, 1_000 + PAS_DU_TEMOIN_D_HORLOGE_MS), false);
  assert.equal(pageSortieDUnGel(1_000, 1_000 + ECART_DE_GEL_MS - 1), false);
  assert.ok(ECART_DE_GEL_MS >= 4 * PAS_DU_TEMOIN_D_HORLOGE_MS, 'le seuil laisse large place à une page occupée');
});

test('un trou dans le temps est un gel : la page repasse par la veille', () => {
  assert.equal(pageSortieDUnGel(1_000, 1_000 + ECART_DE_GEL_MS), true);
  assert.equal(pageSortieDUnGel(1_000, 1_000 + 10 * 60_000), true);
});

test('un témoin qui ne battait pas (page cachée, veille) ne juge rien', () => {
  assert.equal(pageSortieDUnGel(null, Date.now()), false);
});

test('l’écran branche le témoin : retour sans départ annoncé, et battement en retard', () => {
  const veille = fs.readFileSync(path.join(SOURCES_WEB, 'lib', 'veille.ts'), 'utf8');
  const retour = veille.slice(veille.indexOf('function revenirALEcran'));
  assert.ok(
    retour.slice(0, 400).includes('sortirDUnGelSilencieux()'),
    'un retour sans départ annoncé (focus, pageshow, resume) consulte le témoin au lieu de sortir sans rien faire',
  );
  const gel = veille.slice(veille.indexOf('function sortirDUnGelSilencieux'));
  assert.ok(gel.includes('basculer(true);') && gel.includes('basculer(false);'), 'le gel passe par la veille : canal refait');
  assert.ok(veille.includes('arreterLeTemoin();'), 'le témoin se tait page cachée');
});
