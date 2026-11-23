#!/usr/bin/env node
/*
 * LA VEILLE DES SOURCES DE COMPÉTENCES, REJOUÉE À BLANC.
 *
 * Aucun agent lancé, aucune base, aucun réseau : le contrôle construit la consigne
 * à partir du VRAI pool (`data/competences` du dépôt d'où il part) et passe la
 * décision de départ sur une semaine entière, heure par heure. Il prouve que :
 *   - la veille ne part qu'UNE fois par semaine, dans son créneau ;
 *   - la consigne nomme les fiches et les bibliothèques déjà là, sans X ;
 *   - le plafond de sources par passage est dit à l'agent.
 *
 * Usage : node scripts/verif-veille-competences.mjs   (construire shared avant)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = await import(path.join(racine, 'shared/dist/index.js'));
const { decisionDeLaVeille, consigneDeVeilleDeCompetences, ATTENTE_PLACE_MAX_MS, SOURCES_MAX_PAR_PASSAGE } = shared;

let echecs = 0;
const verifier = (ok, texte) => {
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '}${texte}`);
  if (!ok) echecs += 1;
};

// 1. Une semaine entière, heure par heure, sans aucun passage antérieur.
let departs = 0;
let dernierPassage;
const debut = new Date(2026, 9, 5, 0, 0).getTime(); // un lundi
for (let h = 0; h < 14 * 24; h += 1) {
  const maintenant = debut + h * 3600 * 1000;
  const d = new Date(maintenant);
  const decision = decisionDeLaVeille({
    projetPresent: true,
    dernierPassage,
    maintenant,
    jourCourant: d.getDay(),
    heureCourante: d.getHours(),
    placeLibre: true,
    autreRendezVousEnCours: false,
    attenteMaxMs: ATTENTE_PLACE_MAX_MS,
  });
  if (decision.lancer) {
    departs += 1;
    dernierPassage = maintenant;
    verifier(d.getDay() === 0, `départ le dimanche (${d.toISOString()})`);
  }
}
verifier(departs === 2, `deux semaines → deux passages (trouvé ${departs})`);

// 2. La consigne, bâtie sur le vrai pool.
const pool = path.join(racine, 'data', 'competences');
let fiches = [];
let importees = [];
if (fs.existsSync(pool)) {
  fiches = fs.readdirSync(pool, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  try {
    const registre = JSON.parse(fs.readFileSync(path.join(pool, '.bibliotheques.json'), 'utf8'));
    importees = Object.values(registre).map((e) => e.source).filter(Boolean);
  } catch {}
} else {
  console.log('(pas de pool dans ce dépôt : consigne vérifiée avec un pool vide)');
}
const consigne = consigneDeVeilleDeCompetences({ fichesDuPool: fiches, bibliothequesImportees: importees, sourcesVues: [] });
verifier(/N'EXPLORE PAS X/.test(consigne), 'la consigne exclut X');
verifier(/TU NE MODIFIES ET N'IMPORTES RIEN/.test(consigne), 'la consigne interdit de modifier et d’importer');
verifier(consigne.includes(`${SOURCES_MAX_PAR_PASSAGE} SOURCES AU PLUS`), 'le plafond de sources est dit');
for (const adresse of importees) verifier(consigne.includes(adresse), `bibliothèque déjà importée nommée : ${adresse}`);
console.log(`\nConsigne : ${consigne.length} signes, ${fiches.length} fiche(s) du pool, ${importees.length} bibliothèque(s).`);

if (echecs) {
  console.error(`\n${echecs} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('\nVeille des compétences : tous les contrôles passent.');
