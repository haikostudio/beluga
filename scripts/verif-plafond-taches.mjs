#!/usr/bin/env node
/*
 * LE PLAFOND DE TÂCHES EST UN VERROU, ET IL DOIT ÊTRE POSÉ LÀ OÙ LE SERVICE TOURNE.
 *
 * Contrôle en LECTURE SEULE : il lit des fichiers du dépôt, interroge systemd et lit le cgroup.
 * Il ne pose aucun réglage, ne redémarre rien, n'appelle aucun moteur et ne dépense pas un jeton.
 *
 * POURQUOI. Le 08.09.2026, une publication est tombée sur « sh: 1: Cannot fork » avec 2,9 Go de
 * mémoire libre : le service tenait 501 tâches sur les 512 de son cgroup, et 716 lancements avaient
 * déjà été refusés. Deux pièges se cachaient là :
 *   1. le plafond de TÂCHES n'était lu nulle part — la jauge ne comptait que des octets ;
 *   2. relever `TasksMax` dans l'unité du dépôt ne change RIEN tant que la machine tourne sous une
 *      autre unité : le verrou vit sur l'unité ACTIVE, pas sur le fichier qu'on préférerait.
 *
 * Ce contrôle vise donc les deux : la valeur déclarée UNE SEULE FOIS dans le dépôt, et sa présence
 * réelle sur l'unité qui porte le service. Il vise le dépôt d'où il PART (`import.meta.url`), jamais
 * un chemin en dur : lancé depuis une copie de travail, il juge cette copie.
 *
 *   node scripts/verif-plafond-taches.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Le plancher acceptable. 512 est la valeur qui a refusé les `fork` du 08.09.2026 ; l'unité en
 * déclare 4096. On n'exige pas un chiffre exact — il peut monter — mais il ne doit plus jamais
 * redescendre dans la zone qui a bloqué une publication.
 */
const PLANCHER = 2048;

const resultats = [];
const verifier = (nom, ok, detail) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const dire = (texte) => console.log(`  ····  ${texte}`);

const lire = (relatif) => {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return '';
  }
};

/* ------------------------------------------------------------------ */
/* Volet DÉPÔT : la valeur est déclarée une fois, et l'installation la pose */
/* ------------------------------------------------------------------ */

console.log('\n— Le dépôt —');

const unite = lire('scripts/beluga.service');
const declare = /^TasksMax=(\d+)$/m.exec(unite);
verifier(
  'l’unité du dépôt déclare un plafond de tâches numérique',
  !!declare,
  declare ? `TasksMax=${declare[1]}` : 'aucun `TasksMax=<nombre>` dans scripts/beluga.service',
);
const plafondDepot = declare ? Number(declare[1]) : 0;
verifier(
  'ce plafond est très au-dessus de celui qui a bloqué la publication',
  plafondDepot >= PLANCHER,
  `${plafondDepot || '—'} déclaré, plancher ${PLANCHER} (512 refusait les \`fork\` le 08.09.2026)`,
);
verifier(
  'le service compte ses tâches (sans quoi le plafond ne se lirait pas)',
  /^TasksAccounting=true$/m.test(unite),
  'TasksAccounting=true',
);

const applique = lire('scripts/appliquer-plafond-taches.sh');
verifier('le script qui pose le plafond existe', applique.length > 0, 'scripts/appliquer-plafond-taches.sh');
/*
 * UNE SEULE VÉRITÉ. Si le script recopiait le chiffre, changer l'unité laisserait une valeur
 * périmée derrière — exactement le genre d'écart qui a maintenu 512 en place.
 */
verifier(
  'il RELIT la valeur de l’unité au lieu de la recopier',
  applique.includes('beluga.service') && !/TasksMax=\d+/.test(applique),
  'aucun chiffre en dur dans le script',
);
/*
 * Élever un plafond de tâches ne demande aucun redémarrage, et la règle du projet interdit de
 * couper le démon tant qu'une publication ou une tâche tourne.
 */
verifier(
  'il ne coupe ni ne redémarre le service',
  !/systemctl\s+(restart|stop|kill)/.test(applique),
  'aucun restart/stop/kill',
);
verifier(
  'il agit sur l’unité ACTIVE, quelle qu’elle soit',
  applique.includes('is-active') && applique.includes('set-property'),
  'systemctl is-active puis set-property',
);

const installeur = lire('scripts/installer-services.sh');
verifier(
  'l’installation pose le plafond en fin de course',
  installeur.includes('appliquer-plafond-taches.sh'),
  'installer-services.sh appelle le script',
);

/* ------------------------------------------------------------------ */
/* Volet RÈGLE PURE : un refus de lancement n'est pas un code fautif    */
/* ------------------------------------------------------------------ */

console.log('\n— La règle pure —');

const { saturationDeCommande, placeDeConstruction, TACHES_RESERVEES_CONSTRUCTION } = await import(
  path.join(RACINE, 'shared/dist/index.js')
);

// La sortie RÉELLE du 08.09.2026, telle que la publication l'a reçue.
const sortieDuJour = ['sh: 1: Cannot fork', 'sh: 1: Cannot fork', 'npm error code 1', 'sh: 1: Cannot fork'].join('\n');
verifier(
  'la sortie du 08.09.2026 est reconnue comme une saturation',
  saturationDeCommande(sortieDuJour) === 'fork-refuse',
  'et non plus comme « le code ne compile pas »',
);
verifier(
  'une vraie erreur de compilation reste une erreur de compilation',
  saturationDeCommande(`${sortieDuJour}\nsrc/a.ts(12,3): error TS2345: Argument of type…`) === null,
  'même accompagnée d’un refus de lancement isolé',
);
verifier(
  'une sortie ordinaire n’est jamais prise pour une saturation',
  saturationDeCommande('Build terminé en 12 s') === null,
  'dans le doute, un échec reste un échec',
);
verifier(
  'la place de construire exige une réserve de tâches',
  placeDeConstruction({ tachesCourantes: 4090, tachesMax: 4096, memLibreMb: 8000 }).possible === false &&
    placeDeConstruction({ tachesCourantes: 400, tachesMax: 4096, memLibreMb: 8000 }).possible === true,
  `${TACHES_RESERVEES_CONSTRUCTION} tâches gardées devant la compilation`,
);

/* ------------------------------------------------------------------ */
/* Volet MACHINE : le verrou est-il posé LÀ OÙ LE SERVICE TOURNE ?      */
/* ------------------------------------------------------------------ */

console.log('\n— La machine —');

const systemctl = (...args) => {
  try {
    return execFileSync('systemctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const uniteActive = ['beluga.service'].find(
  (nom) => systemctl('is-active', nom) === 'active',
);

if (!uniteActive) {
  dire('aucune unité Beluga active ici : le volet machine est SAUTÉ (contrôle lancé hors serveur).');
} else {
  const plafondActif = Number(systemctl('show', uniteActive, '-p', 'TasksMax', '--value'));
  const courant = Number(systemctl('show', uniteActive, '-p', 'TasksCurrent', '--value'));
  dire(`unité active : ${uniteActive} — ${courant} tâches sur ${plafondActif}`);
  verifier(
    'l’unité ACTIVE porte bien le plafond déclaré dans le dépôt',
    Number.isFinite(plafondActif) && plafondActif >= plafondDepot,
    plafondActif >= plafondDepot
      ? `${plafondActif} ≥ ${plafondDepot}`
      : `${plafondActif} sur la machine contre ${plafondDepot} dans le dépôt — lancer : sudo scripts/appliquer-plafond-taches.sh`,
  );
  verifier(
    'il reste de la place pour construire',
    plafondActif - courant > TACHES_RESERVEES_CONSTRUCTION,
    `${plafondActif - courant} tâches libres, ${TACHES_RESERVEES_CONSTRUCTION} nécessaires`,
  );

  /*
   * LE COMPTEUR SE LIT SUR LE CGROUP RÉEL, jamais sur un nom d'unité supposé : c'est ainsi que
   * `compteursDeTaches()` procède dans le démon, et c'est ce qui lui permet de dire vrai sur une
   * machine encore installée sous l'ancien nom.
   */
  const monCgroup = /^0::(.+)$/m.exec(fs.readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
  const base = monCgroup ? `/sys/fs/cgroup${monCgroup === '/' ? '' : monCgroup}` : '';
  const lu = (fichier) => {
    try {
      return fs.readFileSync(`${base}/${fichier}`, 'utf8').trim();
    } catch {
      return '';
    }
  };
  verifier(
    'le cgroup réel expose ses compteurs de tâches',
    !!base && /^\d+$/.test(lu('pids.current')) && !!lu('pids.max'),
    base ? `${base} : pids.current=${lu('pids.current')}, pids.max=${lu('pids.max')}` : '/proc/self/cgroup illisible',
  );
  const refus = /^max (\d+)$/m.exec(lu('pids.events'))?.[1];
  if (refus !== undefined) {
    dire(
      refus === '0'
        ? 'aucun lancement refusé par ce plafond depuis le démarrage.'
        : `${refus} lancement(s) déjà refusés par ce plafond depuis le démarrage — la trace d'une saturation passée.`,
    );
  }
}

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
