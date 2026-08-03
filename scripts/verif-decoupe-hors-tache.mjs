#!/usr/bin/env node
/**
 * Chaque fonctionnalité enregistrée sans carte part-elle sur SA branche ?
 *
 * On fabrique un dépôt d'essai jetable, on y enregistre quatre travaux — dont
 * deux qui touchent la même ligne —, puis on demande le découpage. On attend
 * quatre branches, la dernière EMPILÉE sur l'avant-dernière (elles se
 * partagent des lignes), et la branche de départ rendue à son état d'avant.
 *
 * Rien n'est touché dans le vrai dépôt : tout se passe dans un dossier
 * temporaire, effacé en partant.
 *
 *   npm run build:server && node scripts/verif-decoupe-hors-tache.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isoleChaqueGroupe, commitsDuTour, repereAvant } from '../server/dist/hors-tache.js';
import { groupesHorsTache } from '../shared/dist/index.js';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-decoupe-'));
const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

try {
  g('init', '-b', 'main');
  g('config', 'user.email', 'essai@haikodev.local');
  g('config', 'user.name', 'Essai');
  fs.writeFileSync(path.join(dir, 'partage.txt'), 'ligne1\nligne2\nligne3\n');
  g('add', '.');
  g('commit', '-m', 'Base');

  const avant = await repereAvant(dir);

  // Deux fonctionnalités bien séparées…
  fs.writeFileSync(path.join(dir, 'b.txt'), 'fonction b\n');
  g('add', 'b.txt');
  g('commit', '-m', 'Ajoute la fonction B');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'fonction c\n');
  g('add', 'c.txt');
  g('commit', '-m', 'Ajoute la fonction C');
  // …puis deux qui se disputent la même ligne.
  fs.writeFileSync(path.join(dir, 'partage.txt'), 'ligne1\nMODIF D\nligne3\n');
  g('add', 'partage.txt');
  g('commit', '-m', 'Change la ligne du milieu');
  fs.writeFileSync(path.join(dir, 'partage.txt'), 'ligne1\nMODIF E\nligne3\n');
  g('add', 'partage.txt');
  g('commit', '-m', 'Change encore la ligne du milieu');

  const groupes = groupesHorsTache(await commitsDuTour(dir, avant));
  noter('quatre enregistrements font quatre fonctionnalités', groupes.length === 4, `${groupes.length} groupe(s)`);

  const parts = (await isoleChaqueGroupe(dir, avant, groupes)) ?? [];
  noter('chaque fonctionnalité a sa branche', parts.length === 4, `${parts.length} branche(s)`);

  const seules = parts.filter((part) => !part.empileeSur);
  noter('trois branches tiennent seules', seules.length === 3, `${seules.length} indépendante(s)`);

  const empilee = parts.find((part) => part.empileeSur);
  noter(
    'celle qui touche les mêmes lignes est empilée sur la précédente',
    !!empilee && empilee.empileeSur === parts[2]?.branche,
    empilee ? `${empilee.branche} sur ${empilee.empileeSur}` : 'aucune',
  );

  noter('le dossier est rendu à sa branche de départ', g('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main');
  noter('la branche de départ est revenue à son état d’avant', g('rev-parse', 'HEAD').trim() === avant.tete);

  const isolees = parts.filter(
    (part) => Number(g('rev-list', '--count', `${avant.tete}..${part.branche}`).trim()) === 1,
  );
  noter('une branche indépendante ne porte que son propre travail', isolees.length === 3, `${isolees.length}/4`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
process.exit(echecs.length ? 1 : 0);
