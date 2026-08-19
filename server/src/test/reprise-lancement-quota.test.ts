import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrageAutomatiqueAutorise } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UN LANCEMENT REFUSÉ FAUTE DE QUOTA SE REJOUE TOUT SEUL              */
/*                                                                     */
/* Le geste a eu lieu : seul le quota manquait, et il revient à sa      */
/* remise à zéro. Sans marque, la carte restait dans « Planifié » avec  */
/* sa phrase d'attente et personne ne repassait la voir —              */
/* `demarrageAutomatiqueAutorise` ne reprend qu'une carte « Dès que     */
/* possible », datée, ou DÉJÀ partie une fois, ce qui n'était pas le    */
/* cas d'un premier départ refusé.                                     */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SERVEUR = (fichier: string) => fs.readFileSync(path.resolve(ICI, `../../src/${fichier}`), 'utf8');
const SCHEDULER = SERVEUR('scheduler.ts');

test('une carte jamais partie, refusée faute de quota, est reprise d’office', () => {
  const jamaisPartie = { asap: false, attempts: 0, restarts: 0 };
  assert.equal(demarrageAutomatiqueAutorise(jamaisPartie), false, 'sans marque, elle attend un clic');
  assert.equal(
    demarrageAutomatiqueAutorise({ ...jamaisPartie, reprendreDesQuePossible: true }),
    true,
    'avec la marque, l’ordonnanceur rejoue le lancement demandé',
  );
});

test('un arrêt à la main l’emporte sur la reprise armée', () => {
  assert.equal(
    demarrageAutomatiqueAutorise({ asap: false, attempts: 0, restarts: 0, reprendreDesQuePossible: true, suspendu: true }),
    false,
  );
});

test('seules les portes qui se rouvrent seules arment la reprise', () => {
  const portes = SCHEDULER.split('export async function portesDures(')[1].split('\n}')[0];
  // Machine pleine et quota épuisé : deux refus passagers.
  assert.equal(portes.split('reprisePossible: true').length - 1, 2);
  // Dépôt absent, dossier occupé : rien n'est armé, il faut agir.
  const definitifs = portes.split('\n').filter((l) => l.includes('dossier.raison') || l.includes('depot.raison'));
  assert.equal(definitifs.length, 2);
  for (const ligne of definitifs) assert.doesNotMatch(ligne, /reprisePossible/);
});

test('le refus écrit la marque, et un refus définitif la retire', () => {
  const corps = SCHEDULER.split('function refus(')[1].split('\n}')[0];
  assert.match(corps, /reprisePossible = false/);
  assert.match(corps, /reprendreDesQuePossible: reprisePossible \? true : undefined/);
});

test('un vrai départ consomme la marque', () => {
  const bloc = SCHEDULER.split('const running = store.saveCard({')[1].split('});')[0];
  assert.match(bloc, /suspendu: false/);
  assert.match(bloc, /reprendreDesQuePossible: undefined/);
});

test('la boucle repasse aussi voir les cartes armées hors de « Planifié »', () => {
  const bloc = SCHEDULER.split('const armees = store')[1].split('\n    }')[0];
  assert.match(bloc, /card\.scheduling\?\.reprendreDesQuePossible && !card\.scheduling\.suspendu/);
  assert.match(bloc, /!COLONNES_HORS_REPRISE\.includes\(card\.column\)/, 'une fin de parcours ne se rouvre pas seule');
  assert.match(bloc, /await startCard\(card\.id\);/);
});

test('ranger une carte à la main désarme la reprise', () => {
  const corps = SERVEUR('deplacement-carte.ts').split('export function rangerLaCarte(')[1].split('\n}')[0];
  assert.match(corps, /reprendreDesQuePossible: undefined/);
});
