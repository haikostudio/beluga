#!/usr/bin/env node
/**
 * LE RÉVEIL « Dis Haiko » SUR DE LA VRAIE PAROLE.
 *
 * `verif-reveil-vocal.mjs` juge l'écran : il injecte des phrases déjà écrites et
 * regarde le module réagir. Il ne pouvait donc RIEN dire du seul endroit où la
 * chaîne cassait vraiment : entre le son et le texte. « Haiko » n'est pas un mot
 * de la langue — le moteur de transcription écrit « D'y éco », « Dièco »,
 * « 10 écho », et le réveil ne partait jamais.
 *
 * Ce contrôle-ci ferme ce trou. Il fabrique de la PAROLE avec les voix du
 * projet (Piper), la fait relire par le moteur de transcription du dépôt jugé
 * (`scripts/transcribe.py`), puis demande aux règles pures si le réveil est
 * reconnu. Aucun navigateur, aucun serveur, aucun quota : de la voix, du texte,
 * et une règle.
 *
 *   node scripts/verif-transcription-reveil.mjs
 *
 * Piper et le moteur de transcription vivent dans les données du serveur, hors
 * dépôt : sans eux, le contrôle ne se déclare pas vert, il DIT ce qui manque et
 * s'arrête. Le dossier des données se change par HAIKODEV_DATA.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La racine se déduit du script lui-même : lancé depuis une copie de travail, il
// juge CE dépôt, jamais le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';

const PIPER = path.join(DONNEES, 'venv', 'bin', 'piper');
const PYTHON = path.join(DONNEES, 'venv', 'bin', 'python');
const VOIX = path.join(DONNEES, 'models', 'piper');
const TRANSCRIRE = path.join(RACINE, 'scripts', 'transcribe.py');

const { contientLeReveil, formesDeReveil, lireParole } = await import(
  path.join(RACINE, 'shared', 'dist', 'index.js')
);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Dépôt jugé : ${RACINE}`);

const manquant = [
  [PIPER, 'la synthèse Piper'],
  [PYTHON, 'le Python du serveur'],
  [TRANSCRIRE, 'le script de transcription'],
].find(([chemin]) => !fs.existsSync(chemin));
if (manquant) {
  console.log(`\nRien à juger : ${manquant[1]} est absent (${manquant[0]}).`);
  console.log('Ce contrôle a besoin de Piper et du moteur de transcription du serveur.');
  process.exit(2);
}

const modeles = fs
  .readdirSync(VOIX)
  .filter((f) => f.endsWith('.onnx'))
  .map((f) => path.join(VOIX, f));
if (!modeles.length) {
  console.log(`\nRien à juger : aucune voix installée dans ${VOIX}.`);
  process.exit(2);
}

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-reveil-'));
process.on('exit', () => fs.rmSync(dossier, { recursive: true, force: true }));

/** Faire DIRE une phrase par une voix du projet, et rendre le fichier obtenu. */
function direAuMicro(modele, phrase, nom) {
  const fichier = path.join(dossier, `${nom}.wav`);
  execFileSync(PIPER, ['--model', modele, '--output_file', fichier], {
    input: phrase,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  return fichier;
}

/** Ce que le moteur de transcription a ENTENDU dans ce fichier. */
function entendu(fichier) {
  return execFileSync(PYTHON, [TRANSCRIRE, fichier], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, OMP_NUM_THREADS: '1' },
  }).trim();
}

const reveil = formesDeReveil('Dis Haiko');
const DEMANDE = 'ouvre le tableau de bord';

for (const modele of modeles) {
  const voix = path.basename(modele, '.onnx');
  const phrase = `Dis Haiko, ${DEMANDE}.`;
  let texte;
  try {
    texte = entendu(direAuMicro(modele, phrase, voix));
  } catch (e) {
    noter(`voix « ${voix} » : la parole est transcrite`, false, String(e.message).slice(0, 160));
    continue;
  }
  noter(`voix « ${voix} » : la transcription rend quelque chose`, Boolean(texte), `« ${texte} »`);
  if (!texte) continue;
  const lu = lireParole(texte, false, reveil);
  noter(`voix « ${voix} » : le réveil est reconnu`, lu.reveil === true, `entendu « ${texte} »`);
  // La demande doit survivre au réveil : c'est elle qui part ensuite.
  noter(
    `voix « ${voix} » : la demande suit le réveil`,
    lu.reveil && lu.suite.length > 0,
    `suite « ${lu.suite} »`,
  );
}

/* Le revers : de la parole ordinaire ne doit RIEN réveiller. */
for (const banale of ['Bonjour, je regarde le tableau des tâches.', 'Il disait quoi, au juste ?']) {
  let texte;
  try {
    texte = entendu(direAuMicro(modeles[0], banale, `banale-${resultats.length}`));
  } catch (e) {
    noter(`une phrase ordinaire est transcrite`, false, String(e.message).slice(0, 160));
    continue;
  }
  noter(
    `une phrase ordinaire ne réveille pas — « ${banale} »`,
    !contientLeReveil(texte, reveil),
    `entendu « ${texte} »`,
  );
}

const tombes = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - tombes.length}/${resultats.length} contrôles passés.`);
if (tombes.length) {
  console.log('Contrôles tombés :');
  for (const t of tombes) console.log(`  - ${t.nom}`);
}
process.exit(tombes.length ? 1 : 0);
