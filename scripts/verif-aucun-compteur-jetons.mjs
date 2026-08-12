#!/usr/bin/env node
/*
 * PLUS AUCUN COMPTEUR DE JETONS VISIBLE NULLE PART (`docs/plans/refonte-visualisation-prompts.md`,
 * plan validé). Contrôle STATIQUE, sans navigateur : il grep les fichiers web qui affichaient un
 * compteur de jetons et vérifie que le texte affiché à l'écran n'en montre plus — la mesure continue
 * d'exister côté serveur, elle ne doit simplement plus apparaître dans l'interface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

const composer = lire('web/src/components/composer.tsx');
verifier(
  'le composeur n’affiche plus de pourcentage de contexte',
  !composer.includes('CapsuleContexte') && !composer.includes('data-pourcentage-contexte'),
);

const parcours = lire('web/src/components/parcours-tache.tsx');
verifier(
  'le volet Détails n’affiche plus de jetons (entrée/cache/sortie)',
  !parcours.includes("jetons(") && !parcours.includes('Entrée hors cache') && !parcours.includes('Relu du cache'),
);

const messageView = lire('web/src/components/message-view.tsx');
verifier(
  'le tiroir Contexte envoyé n’affiche plus de tokens',
  !messageView.includes('nombre(') && !/function Chiffre\(/.test(messageView) && !/\btokens\}/.test(messageView),
);

const settings = lire('web/src/components/settings-view.tsx');
verifier(
  'l’onglet Consommation des réglages n’affiche plus de tokens ni de part de cache',
  !/\{.*tokens.*toLocaleString/.test(settings) && !settings.includes('PartDeCacheBloc'),
);

const dashboard = lire('web/src/components/dashboard.tsx');
verifier(
  'le tableau de bord montre le temps de travail, pas des tokens',
  !dashboard.includes('Tokens consommés') && !dashboard.includes('tokensTotal'),
);

const quotaBadge = lire('web/src/components/quota-badge.tsx');
verifier('le journal des amorces n’affiche plus de tokens', !quotaBadge.includes('tokens'));

const lecteur = lire('web/src/components/lecteur-prompt.tsx');
verifier(
  'le lecteur de prompts partagé existe et ne montre aucun chiffre',
  lecteur.includes('export function LecteurPrompt') && !/\d[\s]*tokens?\b/i.test(lecteur),
);

const cardPanel = lire('web/src/components/card-panel.tsx');
verifier(
  'le chiffrage d’une carte reste en heures et en francs, jamais en jetons',
  cardPanel.includes('Heures développeur senior') && !cardPanel.includes('Jetons projetés'),
);

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
