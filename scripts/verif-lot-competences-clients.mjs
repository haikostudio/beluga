#!/usr/bin/env node
/**
 * LE LOT DE COMPÉTENCES DES SERVEURS CLIENTS, DE BOUT EN BOUT.
 *
 *   HAIKO_LOT_PORT=7461 node scripts/verif-lot-competences-clients.mjs
 *
 * Fabrique un VRAI lot (même code que la machine de l'auteur) depuis un pool
 * piégé, l'extrait comme le ferait l'agent d'hôte dans `data/competences-fournies`
 * d'un démon d'essai sur l'OFFRE HÉBERGÉE, puis vérifie :
 *   1. le tri : fiche sensible (IP réelle, `projets:`) écartée, fiche protégée chiffrée ;
 *   2. le disque du serveur : aucun fichier en clair de la fiche protégée ;
 *   3. l'écran : la liste montre la fiche protégée par son nom et une ligne,
 *      `competence.lire` et le mode d'emploi ne rendent pas son texte ;
 *   4. la fiche du client du même nom PRIME sur celle du lot ;
 *   5. le terminal est refusé (sans session), et seulement sur l'offre hébergée ;
 *   6. un tour qui valide la fiche protégée reçoit un mode d'emploi lisible,
 *      sans son texte dans le briefing, et le dossier déchiffré disparaît au
 *      rangement du tour (`retirerLeTourVivant` le porte dans le code construit).
 *
 * Démon d'essai à soi : jamais `BELUGA_URL` ni `BELUGA_TOKEN`. Construire avant.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';
import { Session } from './lib/session-beluga.mjs';

const PORT = Number(process.env.HAIKO_LOT_PORT || 7461);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'PHRASE-SECRETE-DU-CERVEAU-42';
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const lot = await import(pathToFileURL(path.join(RACINE, 'server/dist/lot-competences-clients.js')).href);
const partage = await import(pathToFileURL(path.join(RACINE, 'shared/dist/index.js')).href);

/* ---------- 1. Le pool piégé de l'auteur, et le lot ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-lot-clients-'));
const POOL = path.join(TMP, 'auteur', 'competences');
const fiche = (nom, tete, corps) => `---\nname: ${nom}\ndescription: À utiliser pour ${nom}, quand il le faut.\n${tete}\n---\n\n# ${nom}\n\n${corps}\n\n## Vérification\n\nRelire.\n`;
const poser = (racine, nom, texte, annexes = {}) => {
  fs.mkdirSync(path.join(racine, nom), { recursive: true });
  fs.writeFileSync(path.join(racine, nom, 'SKILL.md'), texte);
  for (const [relatif, contenu] of Object.entries(annexes)) {
    fs.mkdirSync(path.dirname(path.join(racine, nom, relatif)), { recursive: true });
    fs.writeFileSync(path.join(racine, nom, relatif), contenu);
  }
};
poser(POOL, 'bouton-propre', fiche('bouton-propre', 'themes: interface', 'Un bouton net.'));
poser(POOL, 'cerveau-essai-brain', fiche('cerveau-essai-brain', 'license: Proprietary source-available', `Le savoir protégé : ${SECRET}.`), {
  'wiki/page.md': `Détail protégé : ${SECRET}`,
  'LICENSE': 'Contact : hello@auteur-tiers.studio',
  '.raw/secrets/client.md': 'jamais transporté',
});
poser(POOL, 'fiche-sensible', fiche('fiche-sensible', 'themes: serveur', 'Le serveur 91.98.12.34 répond.'));
poser(POOL, 'fiche-projet', fiche('fiche-projet', 'projets: Clientissime', 'Propre au client.'));
fs.writeFileSync(
  path.join(POOL, partage.FICHIER_REGISTRE_BIBLIOTHEQUES),
  JSON.stringify({ 'digital-tales-essai': { source: 'https://github.com/digital-tales-cerveaux/essai-brain.git', importeeLe: 1, competences: ['cerveau-essai-brain'] } }),
);
const CLE = crypto.randomBytes(32);
const fabrique = lot.fabriquerLeLot({
  pool: POOL,
  sortie: path.join(TMP, 'auteur', 'lots'),
  cle: CLE,
  nomsPrives: ['Clientissime'],
  protegees: new Set(['cerveau-essai-brain']),
});
const verdict = (nom) => fabrique.verdicts.find((v) => v.nom === nom);
noter('fiche sensible (IP réelle) écartée', !verdict('fiche-sensible').part, verdict('fiche-sensible').raison);
noter('fiche propre à un projet écartée', !verdict('fiche-projet').part, verdict('fiche-projet').raison);
noter('cerveau de l’organisation protégée : part chiffré', verdict('cerveau-essai-brain').part && verdict('cerveau-essai-brain').protegee);

/* ---------- 2. Le serveur loué : le lot extrait, une fiche du client du même nom ---------- */
const { DATA, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  port: PORT,
  tmp: path.join(TMP, 'serveur'),
  depot: false,
  env: {
    BELUGA_OFFRE: 'hebergee',
    BELUGA_HEBERGE: '1',
    [partage.VARIABLE_CLE_COMPETENCES]: CLE.toString('hex'),
    BELUGA_FICHIER_ENV_HOTE: path.join(TMP, 'absent.env'),
    BELUGA_DECHIFFREMENTS: path.join(TMP, 'ouvertes'),
    BELUGA_MACHINE_AUTEUR: '0',
  },
  dossiers: [],
});
const FOURNI = path.join(DATA, partage.DOSSIER_COMPETENCES_FOURNIES);
fs.mkdirSync(FOURNI, { recursive: true });
execFileSync('tar', ['-xzf', fabrique.archive, '-C', FOURNI]);
poser(path.join(DATA, 'competences'), 'bouton-propre', fiche('bouton-propre', 'themes: interface', 'La version DU CLIENT.').replace('À utiliser pour bouton-propre', 'Version du client'));

const surLeDisque = (dossier) => {
  const trouves = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && fs.readFileSync(path.join(e.parentPath, e.name)).includes(SECRET)) trouves.push(path.join(e.parentPath, e.name));
  }
  return trouves;
};
noter('aucun fichier en clair de la fiche protégée sur le serveur', surLeDisque(DATA).length === 0, surLeDisque(DATA).join(', '));
noter('le caché du cerveau (.raw) n’a pas voyagé', !fs.existsSync(path.join(FOURNI, 'cerveau-essai-brain', '.raw')));

try {
  if (!(await attendrePort(90_000))) throw new Error(`le démon d'essai ne répond pas :\n${journal.join('').slice(-2000)}`);
  const jeton = crypto.randomBytes(32).toString('hex');
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'), maintenant, maintenant + 3600_000, 'vérification lot de compétences',
  );
  db.close();
  const cookie = `beluga_session=${jeton}`;
  const session = new Session(BASE, cookie);
  await session.connect();

  /* ---------- 3. L'écran ---------- */
  const { fiches } = await session.call({ type: 'installation.competences' });
  const protegee = fiches.find((f) => f.nom === 'cerveau-essai-brain');
  noter('la liste montre la fiche protégée par son nom', !!protegee);
  noter('…avec sa seule ligne de description', !!protegee && !protegee.description.includes(SECRET) && !protegee.description.includes('\n'));
  noter('la fiche sensible n’existe pas chez le client', !fiches.some((f) => f.nom === 'fiche-sensible' || f.nom === 'fiche-projet'));
  const bouton = fiches.filter((f) => f.nom === 'bouton-propre');
  noter('la fiche du client du même nom prime', bouton.length === 1 && bouton[0].description.startsWith('Version du client'), bouton[0]?.description);
  const lue = await session.call({ type: 'competence.lire', nom: 'cerveau-essai-brain' });
  noter('competence.lire ne rend pas le texte protégé', !JSON.stringify(lue).includes(SECRET) && lue.protegee === true);
  const mode = await session.call({ type: 'installation.competence', nom: 'cerveau-essai-brain' });
  noter('le mode d’emploi affiché ne rend pas le texte protégé', !JSON.stringify(mode).includes(SECRET));

  /* ---------- 5. Le terminal ---------- */
  const terminal = await new Promise((resolve) => {
    const recu = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${partage.ROUTE_TERMINAL}?colonnes=80&lignes=24`, { headers: { cookie } });
    ws.on('message', (m) => recu.push(JSON.parse(String(m))));
    ws.on('close', (code) => resolve({ code, recu }));
    ws.on('error', (err) => resolve({ code: -1, recu, erreur: err.message }));
    setTimeout(() => resolve({ code: 0, recu, delai: true }), 10_000);
  });
  noter(
    'le terminal est refusé sur l’offre hébergée',
    terminal.code === 4403 && terminal.recu.some((m) => m.type === 'panne' && m.message === partage.TERMINAL_FERME_SUR_UN_SERVEUR_LOUE),
    `code ${terminal.code}${terminal.erreur ? `, ${terminal.erreur}` : ''}`,
  );
  noter('…sans aucune session créée', !terminal.recu.some((m) => m.type === 'pret' || m.type === 'sortie'));
  session.close();
} finally {
  nettoyer();
}

/* ---------- 5 bis. Hors offre hébergée, le terminal reste (règle du démon) ---------- */
const horsOffre = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(path.join(RACINE, 'server/dist/offre-hebergee.js')).href)}); console.log(m.machineHebergee() ? 'hebergee' : 'propre');`],
  { env: { ...process.env, BELUGA_OFFRE: '', BELUGA_HEBERGE: '' }, encoding: 'utf8' },
);
noter('une installation faite par son propriétaire garde son terminal', horsOffre.stdout.trim() === 'propre', horsOffre.stderr.trim().slice(0, 200));

/* ---------- 6. Le tour : la fiche validée s'ouvre, puis disparaît ---------- */
const DATA_TOUR = path.join(TMP, 'tour', 'data');
fs.mkdirSync(path.join(DATA_TOUR, partage.DOSSIER_COMPETENCES_FOURNIES), { recursive: true });
execFileSync('tar', ['-xzf', fabrique.archive, '-C', path.join(DATA_TOUR, partage.DOSSIER_COMPETENCES_FOURNIES)]);
const OUVERTES = path.join(TMP, 'ouvertes-tour');
const tour = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
    const lot = await import(${JSON.stringify(pathToFileURL(path.join(RACINE, 'server/dist/lot-competences-clients.js')).href)});
    lot.retenirLaCleDesCompetences();
    const { briefingDesCompetencesValidees } = await import(${JSON.stringify(pathToFileURL(path.join(RACINE, 'server/dist/proposition-competences.js')).href)});
    const fs = await import('node:fs');
    const carte = { parcours: { competencesProposees: [{ nom: 'cerveau-essai-brain', etat: 'utilisee', questionId: 'q', messageId: 'm' }] } };
    const texte = briefingDesCompetencesValidees(carte, 'agent-essai');
    const chemin = /Fichier : (.*)/.exec(texte)?.[1]?.trim();
    const lisible = chemin && fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : '';
    lot.effacerLesDechiffrementsDeLAgent('agent-essai');
    console.log(JSON.stringify({ texteSansSecret: !texte.includes(${JSON.stringify(SECRET)}), consigne: texte.includes('COMPÉTENCE PROTÉGÉE'), lisible: lisible.includes(${JSON.stringify(SECRET)}), efface: !!chemin && !fs.existsSync(chemin), cleRetiree: !process.env.${partage.VARIABLE_CLE_COMPETENCES} }));
    process.exit(0);
    `,
  ],
  {
    env: {
      ...process.env,
      BELUGA_DATA: DATA_TOUR,
      BELUGA_OFFRE: 'hebergee',
      [partage.VARIABLE_CLE_COMPETENCES]: CLE.toString('hex'),
      BELUGA_FICHIER_ENV_HOTE: path.join(TMP, 'absent.env'),
      BELUGA_DECHIFFREMENTS: OUVERTES,
    },
    encoding: 'utf8',
    timeout: 120_000,
  },
);
let issue = {};
try {
  issue = JSON.parse(tour.stdout.trim().split('\n').pop() || '{}');
} catch {
  /* sortie illisible : les contrôles échouent ci-dessous */
}
noter('le briefing du tour ne porte pas le texte protégé', issue.texteSansSecret === true && issue.consigne === true, tour.stderr.trim().slice(-300));
noter('le mode d’emploi remis à l’agent est lisible pendant le tour', issue.lisible === true);
noter('le dossier déchiffré disparaît au rangement du tour', issue.efface === true);
noter('la clé quitte l’environnement hérité', issue.cleRetiree === true);
const runtime = fs.readFileSync(path.join(RACINE, 'server/dist/runtime.js'), 'utf8');
const rangement = /function retirerLeTourVivant\([^)]*\) \{[\s\S]{0,400}effacerLesDechiffrementsDeLAgent\(/.test(runtime);
noter('le rangement de TOUT tour (arrêt, panne, suspension) efface le dossier déchiffré', rangement);

fs.rmSync(TMP, { recursive: true, force: true });
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôle(s) passé(s).`);
process.exitCode = echecs.length ? 1 : 0;
