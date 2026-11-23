#!/usr/bin/env node
/*
 * LE DÉTAIL D'UNE CARTE : L'ONGLET « DÉTAILS » A DISPARU, LE CONTRÔLE LE CONSTATE.
 *
 * Ce script vérifiait autrefois l'onglet « Détails » d'une carte — sa ligne de
 * temps (`parcours-tache.tsx`), son lecteur de prompts (`lecteur-prompt.tsx`)
 * et le bloc de prévision de `card-panel.tsx`. L'onglet entier a depuis été
 * retiré de l'interface (voir le commentaire dans `card-panel.tsx` : « L'onglet
 * « Détails » a disparu ») et le module qui le nourrissait,
 * `shared/src/parcours-carte.ts`, a été supprimé avec lui.
 *
 * UN ÉCRAN SUPPRIMÉ N'EST PAS UN CONTRÔLE EN ÉCHEC (même principe que
 * `verif-aucun-compteur-jetons.mjs`) : ce script constate que l'ancien onglet
 * est bien resté supprimé, et rend un verdict complet au lieu de planter sur
 * un fichier absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const existe = (relatif) => fs.existsSync(path.join(RACINE, relatif));

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

verifier(
  'l’ancienne ligne de temps du parcours est restée supprimée',
  !existe('web/src/components/parcours-tache.tsx'),
);
verifier(
  'l’ancien lecteur de prompts est resté supprimé',
  !existe('web/src/components/lecteur-prompt.tsx'),
);
verifier(
  'le module de calcul du parcours est resté supprimé',
  !existe('shared/src/parcours-carte.ts'),
);

const panneau = fs.readFileSync(path.join(RACINE, 'web/src/components/card-panel.tsx'), 'utf8');
verifier(
  'la carte ne réintroduit pas le bloc de prévision de l’ancien onglet',
  !panneau.includes('<ParcoursTache') &&
    !panneau.includes('<CeQuiEtaitPrevu') &&
    !panneau.includes('data-ce-qui-etait-prevu'),
);

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
