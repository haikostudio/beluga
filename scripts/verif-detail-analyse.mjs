#!/usr/bin/env node
/** Contrôle ciblé du calcul et des libellés du détail d'une carte analysée. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalJetonsMesures, totalMesureEnClair } from '../shared/dist/analyse-cout.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(RACINE, 'web/src/components/card-panel.tsx'), 'utf8');
const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

verifier('le total additionne entrée, cache et sortie', totalJetonsMesures({ inputTokens: 12, cachedInputTokens: 8, outputTokens: 5 }) === 25);
verifier(
  'un cache non communiqué est nommé indisponible',
  /indisponible/.test(totalMesureEnClair({ inputTokens: 12, outputTokens: 5 })),
);
for (const libelle of [
  'Analyse mesurée — déjà consommée',
  'Entrée hors cache',
  'Déjà en cache',
  'Lectures faites par l’agent',
  'Exécution projetée — estimation future',
  'Formule',
]) {
  verifier(`le détail affiche « ${libelle} »`, source.includes(libelle));
}
verifier('la mesure et la projection ont deux repères distincts', source.includes('data-detail-cout-analyse') && source.includes('data-projection-execution'));

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
