#!/usr/bin/env node
/*
 * LE DÉTAIL D'UNE CARTE : le parcours mesuré, et la prévision à part.
 *
 * L'onglet montrait sept encadrés — « Analyse initiale », « Exécution réelle »,
 * la ventilation, la projection, les jetons par agent — qui disaient chacun une
 * part de la même histoire, dans le désordre, et dont deux comptaient les mêmes
 * jetons deux fois. Il montre désormais UNE ligne de temps : une étape par
 * moment réel, du tri par le chef d'orchestre jusqu'à la mise en production.
 *
 * Ce contrôle vérifie les deux choses qui font tenir cette lecture :
 *   — chaque étape porte ce qu'elle est allée CHERCHER et ce qu'elle a
 *     RÉELLEMENT consommé, jamais une estimation ;
 *   — le PRÉVU vit dans un bloc séparé, nommé prévision, sous le parcours.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalJetonsMesures, totalMesureEnClair } from '../shared/dist/analyse-cout.js';
import { construireParcours, totalDuParcours } from '../shared/dist/parcours-carte.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parcours = fs.readFileSync(path.join(RACINE, 'web/src/components/parcours-tache.tsx'), 'utf8');
const panneau = fs.readFileSync(path.join(RACINE, 'web/src/components/card-panel.tsx'), 'utf8');

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

/* ------------------------------------------------------------------ */
/* Le calcul                                                           */
/* ------------------------------------------------------------------ */

verifier(
  'le total additionne entrée, cache et sortie',
  totalJetonsMesures({ inputTokens: 12, cachedInputTokens: 8, outputTokens: 5 }) === 25,
);
verifier(
  'un cache non communiqué est nommé indisponible',
  /indisponible/.test(totalMesureEnClair({ inputTokens: 12, outputTokens: 5 })),
);

const tour = (entree, cache, sortie) => ({
  at: 1,
  model: 'claude-sonnet-5',
  inputTokens: entree,
  cachedTokens: cache,
  outputTokens: sortie,
  tokens: entree + cache + sortie,
  seconds: 5,
});
const etapes = construireParcours({
  origin: 'agent',
  createdAt: 1,
  autorisee: true,
  colonne: 'done',
  doneAt: 9,
  tri: { tours: [tour(300, 100, 40)], sujetsMemoire: ['cartes'] },
  agents: [
    {
      id: 'a1',
      role: 'task',
      createdAt: 2,
      tours: [tour(1000, 500, 200)],
      sujetsMemoire: ['interface'],
      accueil: { instructions: true, competences: true, memoire: true },
    },
  ],
});

verifier('le parcours ouvre sur le tri du chef', etapes[0]?.cle === 'tri');
verifier('le parcours finit par le travail de l’agent', etapes[etapes.length - 1]?.cle === 'execution');
verifier(
  'chaque étape mesurée porte son total, sans recouvrement',
  totalDuParcours(etapes)?.total === 440 + 1700,
);
verifier(
  'chaque étape dit ce qu’elle est allée chercher',
  etapes.every((etape) => Array.isArray(etape.cherche)) &&
    etapes.some((etape) => etape.cherche.some((l) => l.includes('cartes'))) &&
    etapes.some((etape) => etape.cherche.some((l) => l.includes('interface'))),
);
verifier(
  'une étape sans mesure dit POURQUOI, jamais un zéro',
  etapes.every((etape) => etape.mesure || etape.sansMesure),
);

/* ------------------------------------------------------------------ */
/* Ce que la page affiche                                              */
/* ------------------------------------------------------------------ */

for (const libelle of ['Le parcours de cette tâche', 'Ce qu’elle est allée chercher', 'Prompts envoyés']) {
  verifier(`le parcours affiche « ${libelle} »`, parcours.includes(libelle));
}

verifier('le parcours porte un repère testable', parcours.includes('data-parcours-tache'));
verifier('chaque étape porte sa clé et son état', parcours.includes('data-etape=') && parcours.includes('data-etat='));
verifier(
  'le détail d’une étape se replie, il ne s’empile pas',
  parcours.includes('data-detail-etape') && parcours.includes('aria-expanded'),
);
verifier(
  'plus aucun compteur de jetons dans le parcours — durée et francs seulement',
  !parcours.includes('jetons(') && !/\btokens\b/.test(parcours) && !parcours.includes('Entrée hors cache'),
);
verifier(
  'le lecteur de prompts partagé équipe le volet Détails',
  parcours.includes("from '@/components/lecteur-prompt'") && parcours.includes('<LecteurPrompt'),
);

for (const libelle of ['Ce qui était prévu', 'Durée machine prévue', 'Heures développeur senior']) {
  verifier(`le bloc de prévision affiche « ${libelle} »`, panneau.includes(libelle));
}
verifier('le bloc de prévision a son repère testable', panneau.includes('data-ce-qui-etait-prevu'));
verifier(
  'la prévision se dit prévision, jamais mesure',
  panneau.includes('Ce ne sont pas des mesures'),
);
verifier(
  'la projection de jetons — non fiable — a disparu du détail d’une carte',
  !panneau.includes('data-projection-execution') && !panneau.includes('Jetons projetés — estimation future'),
);
verifier(
  'la part de quota RÉELLE remplace la projection, dans le parcours',
  parcours.includes('data-quota-reel-parcours') && parcours.includes('Part de quota réellement consommée'),
);
verifier(
  'le parcours paraît AVANT le bloc de prévision',
  panneau.indexOf('<ParcoursTache') !== -1 &&
    panneau.indexOf('<ParcoursTache') < panneau.indexOf('<CeQuiEtaitPrevu'),
);
// On vise les REPÈRES de l'ancienne présentation, pas les mots : le commentaire
// qui explique ce qu'elle était a le droit de la nommer.
verifier(
  'les anciens encadrés qui doublaient les chiffres ont disparu',
  !panneau.includes('data-moment-detail') &&
    !panneau.includes('data-detail-cout-analyse') &&
    !panneau.includes('data-ventilation-analyse') &&
    !panneau.includes('MomentDetail'),
);

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
