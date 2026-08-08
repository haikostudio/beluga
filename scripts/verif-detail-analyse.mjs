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
  'Analyse initiale',
  'Exécution réelle',
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

const debutAnalyse = source.indexOf('moment="analyse-initiale"');
const debutExecution = source.indexOf('moment="execution-reelle"');
const blocAnalyse = source.slice(debutAnalyse, debutExecution);
const blocExecution = source.slice(debutExecution, source.indexOf('/** Une étape bien délimitée', debutExecution));
verifier('l’analyse initiale paraît avant l’exécution réelle', debutAnalyse !== -1 && debutExecution > debutAnalyse);
verifier(
  'les prévisions restent dans la zone d’analyse initiale',
  blocAnalyse.includes('Durée machine prévue') && blocAnalyse.includes('Heures développeur senior'),
);
verifier(
  'les consommations restent dans la zone d’exécution réelle',
  blocExecution.includes('Durée réelle') && blocExecution.includes('Jetons consommés'),
);
verifier(
  'les deux moments portent des repères visibles et testables',
  source.includes('data-moment-detail={moment}') &&
    source.includes("moment: 'analyse-initiale' | 'execution-reelle'"),
);

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
