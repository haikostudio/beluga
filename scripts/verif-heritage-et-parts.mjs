#!/usr/bin/env node
/*
 * L'HÉRITAGE RÉGLABLE, ET LE PARTAGE PLATEFORME / PROJET.
 *
 * Deux promesses, éprouvées de bout en bout sur de faux dépôts jetables :
 *
 *  1. un projet désigne SA source d'héritage — HaikoDev par défaut, un autre
 *     projet s'il le veut, rien du tout s'il le décide — et la règle servie DIT
 *     d'où elle vient ;
 *  2. le tiroir « Contexte envoyé » sépare ce qui décrit CE projet de ce qui
 *     vient du socle de la plateforme, et il pose de quoi le voir à l'œil.
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

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-heritage-data-'));
process.env.HAIKODEV_DATA = bacASable;

const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const projects = await import(path.join(RACINE, 'server/dist/projects.js'));
const store = await import(path.join(RACINE, 'server/dist/store.js'));
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
function depot(nom, regles) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `haikodev-${nom}-`));
  jetables.push(dossier);
  if (regles) {
    fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
    for (const [sujet, texte] of Object.entries(regles)) {
      fs.writeFileSync(path.join(dossier, 'docs', 'regles', `${sujet}.md`), texte, 'utf8');
    }
  }
  return dossier;
}

function inscrire(nom, dossier, heriteDe) {
  return store.saveProject(
    partage.Project.parse({
      id: store.newId(),
      name: nom,
      path: dossier,
      heriteDe,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
}

/* ------------------------------------------------------------------ */
console.log('\n1. Un projet désigne SA source, et la règle servie dit d’où elle vient');
/* ------------------------------------------------------------------ */

const SOCLE = depot('socle', {
  publication: '# Publication\n\n- **ON NE PUBLIE PAS SANS L’ACCORD DU CLIENT** : la mise en ligne est un geste humain.\n',
});
const AVAL = depot('aval', {});
const AUTRE = depot('autre', {});

const socle = inscrire('Socle Agence', SOCLE);
const aval = inscrire('Site client', AVAL, socle.id);
const parDefaut = inscrire('Sans réglage', AUTRE);

const source = projects.sourceDHeritageDuProjet(aval);
verifier(source?.nom === 'Socle Agence' && source?.chemin === SOCLE, 'la source réglée est résolue en NOM et en dossier', source?.nom);
verifier(
  projects.sourceDHeritageDuProjet(parDefaut)?.nom === 'HaikoDev',
  'sans réglage, la source reste HaikoDev — rien ne change pour qui ne touche à rien',
);

const orphelin = inscrire('Orphelin', depot('orphelin', {}), partage.HERITAGE_AUCUN);
verifier(projects.sourceDHeritageDuProjet(orphelin) === undefined, '« aucun héritage » coupe vraiment l’étage du dessus');

const perdu = inscrire('Source disparue', depot('perdu', {}), 'projet-qui-n-existe-plus');
verifier(
  projects.sourceDHeritageDuProjet(perdu) === undefined,
  'une source SUPPRIMÉE depuis son réglage ne fait pas tomber le projet en panne',
);

const servi = memory.detailProjet(AVAL, 'publication', [], source);
verifier(/HÉRITÉ DE SOCLE AGENCE/.test(servi.texte), 'la règle héritée NOMME la source dont elle vient');
verifier(/ACCORD DU CLIENT/.test(servi.texte), 'et elle porte bien le texte du socle');
verifier(!/HaikoDev/.test(servi.texte), 'la plateforme n’est plus nommée quand la source est ailleurs');

/* Le projet a sa propre règle : rien ne doit monter d'un cran. */
fs.writeFileSync(
  path.join(AVAL, 'docs', 'regles', 'publication.md'),
  '# Publication\n\n- **LA RÈGLE DU PROJET** : c’est elle qui fait foi.\n',
  'utf8',
);
const local = memory.detailProjet(AVAL, 'publication', [], source);
verifier(
  /RÈGLE DU PROJET/.test(local.texte) && !/ACCORD DU CLIENT/.test(local.texte),
  'quand le projet A sa règle, la règle héritée ne vient PAS la contredire',
);

/* ------------------------------------------------------------------ */
console.log('\n2. Le briefing sépare la part du projet de celle de la plateforme');
/* ------------------------------------------------------------------ */

const PROJET = depot('briefing', {});
memory.appendMemory(PROJET, 'Quota : la place restante n’est pas 100 %.');
const { sansMemoire, socle: socleEnvoye, memoire } = memory.briefingSepare(PROJET, 'Essai', true);

verifier(/Projet : Essai/.test(sansMemoire), 'la part PROJET porte son dossier et ses fichiers d’instructions');
verifier(Boolean(socleEnvoye), 'la part PLATEFORME est isolée');
verifier(
  /GITHUB EST DIRECTEMENT ACCESSIBLE/.test(socleEnvoye ?? '') && /RÈGLE DURABLE APPRISE/.test(socleEnvoye ?? ''),
  'elle porte ce qui serait identique sur n’importe quel projet',
);
verifier(
  !/RÈGLE DURABLE APPRISE/.test(sansMemoire) && !/RÈGLE DURABLE APPRISE/.test(memoire ?? ''),
  'et ce socle n’est plus compté du côté du projet',
);
verifier(/CARTE de l'arbre/.test(memoire ?? ''), 'la mémoire du projet reste un bloc à elle');

/* Rien n'a été perdu au découpage : le briefing complet dit toujours tout. */
const entier = memory.briefing(PROJET, 'Essai', true);
verifier(
  entier.includes(sansMemoire) && entier.includes(socleEnvoye ?? '') && entier.includes(memoire ?? ''),
  'le briefing complet porte toujours les trois parts, rien n’est tombé au découpage',
);

/* ------------------------------------------------------------------ */
console.log('\n3. Le partage, additionné puis arrondi sans mentir');
/* ------------------------------------------------------------------ */

const blocs = [
  { kind: 'briefing', label: 'Briefing du projet', characters: sansMemoire.length, origine: 'projet' },
  { kind: 'briefing', label: 'Socle de la plateforme', characters: (socleEnvoye ?? '').length, origine: 'plateforme' },
  { kind: 'memory', label: 'Carte de la mémoire', characters: (memoire ?? '').length, origine: 'projet' },
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
console.log('\n4. Les écrans portent de quoi le voir');
/* ------------------------------------------------------------------ */

const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const reglages = lire('web/src/components/project-settings.tsx');
verifier(reglages.includes('data-heritage-choix'), 'le volet des réglages porte le choix de la source, repérable');
verifier(
  reglages.includes('HERITAGE_AUCUN') && reglages.includes("t('HaikoDev (par défaut)')"),
  'il propose les trois cas : la plateforme, aucun héritage, un autre projet',
);
verifier(
  reglages.includes('p.id !== projetCourant.id'),
  'et il ne se propose jamais lui-même comme source',
);
verifier(reglages.includes('heriteDe: heriteDe.trim() || undefined'), 'le réglage part bien à l’enregistrement');

const lecteur = lire('web/src/components/lecteur-prompt.tsx');
verifier(lecteur.includes('data-partage-contexte'), 'le tiroir pose la barre de partage, repérable');
verifier(lecteur.includes('data-partage-barre'), 'chaque part de la barre est repérable une par une');
verifier(lecteur.includes('data-origine'), 'chaque bloc porte sa pastille d’origine');
verifier(
  lecteur.includes('partsDuContexte') && lecteur.includes('origineDuBloc'),
  'l’écran ne recalcule rien : il lit les règles pures',
);
verifier(!/\d[\s ]*(tokens?|jetons?)\b/i.test(lecteur), 'aucun compteur de jetons n’a été réintroduit');

/* ------------------------------------------------------------------ */

for (const dossier of jetables) fs.rmSync(dossier, { recursive: true, force: true });
fs.rmSync(bacASable, { recursive: true, force: true });

console.log('');
if (echecs.length) {
  console.error(`ÉCHEC — ${echecs.length} constat(s) :`);
  for (const e of echecs) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('Tout est vert : la source d’héritage se règle, et le tiroir dit ce qui vient d’où.');
