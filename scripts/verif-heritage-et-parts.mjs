#!/usr/bin/env node
/*
 * LE PARTAGE PLATEFORME / PROJET DU BRIEFING.
 *
 * Une promesse, éprouvée de bout en bout sur un faux dépôt jetable : le tiroir
 * « Contexte envoyé » sépare ce qui décrit CE projet de ce qui vient du socle
 * de la plateforme, et il pose de quoi le voir à l'œil.
 *
 * L'héritage de mémoire d'un projet « socle » a disparu avec l'arbre de
 * fichiers : les classeurs n'héritent plus que du classeur global. Ce volet
 * n'a donc plus rien à éprouver ici.
 *
 * Aucun moteur, aucun navigateur, aucun réseau : le mécanisme tout seul, plus
 * une lecture des écrans pour vérifier qu'ils portent bien ce qu'il faut.
 *
 *   node scripts/verif-heritage-et-parts.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-heritage-data-'));
process.env.BELUGA_DATA = bacASable;

const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

const jetables = [];
function depot(nom) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `beluga-${nom}-`));
  jetables.push(dossier);
  return dossier;
}

/* ------------------------------------------------------------------ */
console.log('\n1. Le briefing sépare la part du projet de celle de la plateforme');
/* ------------------------------------------------------------------ */

const PROJET = depot('briefing');
const { sansMemoire, socle: socleEnvoye } = memory.briefingSepare(PROJET, 'Essai', true);

verifier(/Projet : Essai/.test(sansMemoire), 'la part PROJET porte son dossier et ses fichiers d’instructions');
verifier(Boolean(socleEnvoye), 'la part PLATEFORME est isolée');
verifier(
  /GITHUB EST DIRECTEMENT ACCESSIBLE/.test(socleEnvoye ?? '') && /RÈGLE DURABLE APPRISE/.test(socleEnvoye ?? ''),
  'elle porte ce qui serait identique sur n’importe quel projet',
);
verifier(!/RÈGLE DURABLE APPRISE/.test(sansMemoire), 'et ce socle n’est plus compté du côté du projet');

/* Rien n'a été perdu au découpage : le briefing complet dit toujours tout. */
const entier = memory.briefing(PROJET, 'Essai', true);
verifier(
  entier.includes(sansMemoire) && entier.includes(socleEnvoye ?? ''),
  'le briefing complet porte toujours les deux parts, rien n’est tombé au découpage',
);

/* ------------------------------------------------------------------ */
console.log('\n2. Le partage, additionné puis arrondi sans mentir');
/* ------------------------------------------------------------------ */

const blocs = [
  { kind: 'briefing', label: 'Briefing du projet', characters: sansMemoire.length, origine: 'projet' },
  { kind: 'briefing', label: 'Socle de la plateforme', characters: (socleEnvoye ?? '').length, origine: 'plateforme' },
  { kind: 'request', label: 'Demande utilisateur', characters: 120, origine: 'demande' },
];
const parts = partage.partsDuContexte(blocs);
const lignes = partage.partagePourLOeil(parts);
console.log(`  mesuré : ${lignes.map((l) => `${l.nom} ${l.part} %`).join(' · ')} (${parts.total} signes)`);

verifier(
  parts.plateforme + parts.projet + parts.demande === parts.total,
  'chaque signe est compté une fois et une seule',
);
verifier(
  lignes.reduce((n, l) => n + l.part, 0) === 100,
  'les pourcentages font exactement 100 — trois arrondis ne laissent pas de trou',
);
verifier(parts.plateforme > 0 && parts.projet > 0, 'les deux parts sont réellement peuplées sur un vrai briefing');
verifier(partage.partagePourLOeil(partage.partsDuContexte([])).length === 0, 'un tour vide ne rend pas une ligne de zéros');

/* Les tours enregistrés AVANT ce partage : rangés sur leur genre, sans invention. */
verifier(
  partage.origineDuBloc({ kind: 'format' }) === 'plateforme' &&
    partage.origineDuBloc({ kind: 'request' }) === 'demande' &&
    partage.origineDuBloc({ kind: 'memory' }) === 'projet',
  'un tour ancien, sans étiquette, se range sur son genre',
);
verifier(
  partage.origineDuBloc({ kind: 'briefing', origine: 'plateforme' }) === 'plateforme',
  'une étiquette POSÉE l’emporte toujours sur la déduction',
);

/* ------------------------------------------------------------------ */
console.log('\n3. Les écrans portent de quoi le voir');
/* ------------------------------------------------------------------ */

const lireSiPresent = (relatif) => {
  const chemin = path.join(RACINE, relatif);
  return fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
};

/*
 * Le tiroir « Contexte envoyé » qui portait cette barre a depuis disparu : le
 * prompt envoyé se lit désormais en bulles de message (`message-view.tsx`),
 * plus aucun tiroir. `lecteur-prompt.tsx` est donc parti avec lui. UN ÉCRAN
 * SUPPRIMÉ N'EST PAS UN CONTRÔLE EN ÉCHEC (même principe que
 * `verif-aucun-compteur-jetons.mjs`) : son absence est constatée, pas subie.
 */
const lecteur = lireSiPresent('web/src/components/lecteur-prompt.tsx');
if (lecteur === null) {
  verifier(true, 'le tiroir « Contexte envoyé » est resté supprimé (remplacé par les bulles de message)');
} else {
  verifier(lecteur.includes('data-partage-contexte'), 'le tiroir pose la barre de partage, repérable');
  verifier(lecteur.includes('data-partage-barre'), 'chaque part de la barre est repérable une par une');
  verifier(lecteur.includes('data-origine'), 'chaque bloc porte sa pastille d’origine');
  verifier(
    lecteur.includes('partsDuContexte') && lecteur.includes('origineDuBloc'),
    'l’écran ne recalcule rien : il lit les règles pures',
  );
  verifier(!/\d[\s ]*(tokens?|jetons?)\b/i.test(lecteur), 'aucun compteur de jetons n’a été réintroduit');
}

/* ------------------------------------------------------------------ */

for (const dossier of jetables) fs.rmSync(dossier, { recursive: true, force: true });
fs.rmSync(bacASable, { recursive: true, force: true });

console.log('');
if (echecs.length) {
  console.error(`ÉCHEC — ${echecs.length} constat(s) :`);
  for (const e of echecs) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('Tout est vert : le briefing dit ce qui vient du projet et ce qui vient de la plateforme.');
