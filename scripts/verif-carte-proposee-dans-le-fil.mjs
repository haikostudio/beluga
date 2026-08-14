#!/usr/bin/env node
/**
 * UNE CARTE PROPOSÉE S'AFFICHE-T-ELLE DANS LE FIL DE LA CONVERSATION QUI L'A
 * DEMANDÉE — quel que soit le moteur ?
 *
 * La panne constatée le 14/08/2026 : sous Cursor, le chef d'un projet proposait
 * une carte, disait l'avoir proposée, et rien n'apparaissait dans son fil. La
 * carte s'écrivait dans la conversation d'un agent d'un AUTRE projet, terminé
 * deux heures plus tôt ; l'utilisateur ne la retrouvait qu'en suivant la cloche
 * et un lien.
 *
 * La cause, prouvée ici sur le VRAI CLI : `cursor-agent` ne lit pas
 * `.cursor/mcp.json` dans le dossier du tour, mais à la RACINE DU DÉPÔT qui le
 * contient — et NULLE PART AILLEURS. Le bac du chef bridé
 * (`<données>/chef-scratch/<projet>`) étant un sous-dossier du dépôt d'HaikoDev,
 * le CLI y lisait la configuration laissée par le dernier tour d'HaikoDev, donc
 * l'identifiant d'un AUTRE agent.
 *
 *   node scripts/verif-carte-proposee-dans-le-fil.mjs
 *
 * AUCUN moteur appelé, aucun jeton dépensé : `cursor-agent mcp list` est une
 * lecture locale. Le contrôle se passe même de clé — si le CLI n'est pas sur la
 * machine, la partie « vrai CLI » est annoncée comme non jouée, jamais tue.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { poserLaConfigurationMcp } = await import(path.join(RACINE, 'server/dist/engines/cursor.js'));
const { appelDuPontRecevable, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION, MARQUE_DE_RACINE } =
  await import(path.join(RACINE, 'shared/dist/index.js'));

const CLI = process.env.HAIKODEV_CURSOR_BIN || '/usr/local/bin/cursor-agent';
const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-carte-dans-le-fil-'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Ce que le CLI dit lire comme serveurs d'outils depuis un dossier donné. */
function serveursVusParLeCli(cwd) {
  return execFileSync(CLI, ['mcp', 'list'], { cwd, encoding: 'utf8', timeout: 60_000, env: { ...process.env, FORCE_COLOR: '0' } });
}

try {
  /* ------------------------------------------------------------------ */
  /* 1. Le dépôt et son sous-dossier, comme sur le serveur               */
  /* ------------------------------------------------------------------ */
  const depot = path.join(DOSSIER, 'haikodev-pour-de-faux');
  const bac = path.join(depot, 'data', 'chef-scratch', 'projet-x');
  fs.mkdirSync(bac, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: depot, stdio: 'ignore' });

  // La configuration laissée à la racine par un autre agent : c'est elle qui
  // parlait à la place de la bonne.
  fs.mkdirSync(path.join(depot, DOSSIER_CONFIGURATION), { recursive: true });
  fs.writeFileSync(
    path.join(depot, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION),
    JSON.stringify({ mcpServers: { outilsDunAutreAgent: { command: 'true' } } }),
    'utf8',
  );

  const cliPresent = fs.existsSync(CLI);
  if (cliPresent) {
    const avant = serveursVusParLeCli(bac);
    noter(
      "le CLI lit bien la racine du dépôt, pas le dossier du tour (c'est la cause)",
      avant.includes('outilsDunAutreAgent'),
      avant.trim().split('\n')[0],
    );
  } else {
    noter('le CLI « cursor-agent » est sur la machine', false, `absent de ${CLI} — la partie « vrai CLI » n'est pas jouée`);
  }

  /* ------------------------------------------------------------------ */
  /* 2. La pose du démon isole le dossier du tour                        */
  /* ------------------------------------------------------------------ */
  const source = path.join(DOSSIER, 'mcp-agent-du-projet-x.json');
  fs.writeFileSync(source, JSON.stringify({ mcpServers: { outilsDuProjetX: { command: 'true' } } }), 'utf8');
  poserLaConfigurationMcp(bac, source);

  noter(
    'le dossier du tour est devenu une racine à lui',
    fs.existsSync(path.join(bac, MARQUE_DE_RACINE)),
  );
  noter(
    'la configuration du tour est posée dans SON dossier',
    fs.existsSync(path.join(bac, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION)),
  );
  noter(
    "rien n'a été écrit par-dessus le dépôt voisin",
    fs
      .readFileSync(path.join(depot, DOSSIER_CONFIGURATION, FICHIER_CONFIGURATION), 'utf8')
      .includes('outilsDunAutreAgent'),
  );

  if (cliPresent) {
    const apres = serveursVusParLeCli(bac);
    noter(
      'le CLI lit maintenant les outils DE CE TOUR',
      apres.includes('outilsDuProjetX') && !apres.includes('outilsDunAutreAgent'),
      apres.trim().split('\n')[0],
    );
  }

  /* ------------------------------------------------------------------ */
  /* 3. Le second verrou : un appel d'outil appartient au tour qui tourne */
  /* ------------------------------------------------------------------ */
  noter(
    "un appel venu d'un tour terminé est refusé",
    appelDuPontRecevable({ tourAnnonce: 'tour-1', tourEnCours: undefined }).ok === false,
  );
  noter(
    "un appel venu du tour d'un AUTRE agent est refusé",
    appelDuPontRecevable({ tourAnnonce: 'tour-1', tourEnCours: 'tour-2' }).ok === false,
  );
  noter(
    "l'appel du tour qui tourne passe",
    appelDuPontRecevable({ tourAnnonce: 'tour-2', tourEnCours: 'tour-2' }).ok === true,
  );
} finally {
  fs.rmSync(DOSSIER, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
