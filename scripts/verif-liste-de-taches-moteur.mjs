#!/usr/bin/env node
/**
 * L'AGENT A-T-IL SEULEMENT L'OUTIL POUR ANNONCER SES SOUS-TÂCHES ?
 *
 * Le coffre réparé (`verif-coffre-des-comptes.mjs`) ne suffit pas : depuis le
 * CLI 2.1.233, le moteur ne DÉCLARE plus « TaskCreate » / « TaskUpdate » aux
 * modèles récents (Sonnet 5, Opus 5, Fable 5). La consigne « annonce ta liste
 * de tâches » tombe alors dans le vide et les TROIS affichages d'avancement
 * s'éteignent : le volet dépliable au-dessus de la barre d'écriture, le
 * pourcentage en tête de la colonne « En cours », celui de la ligne du projet.
 * La porte laissée par le CLI est une variable d'environnement, posée par
 * `shared/src/liste-de-taches-du-moteur.ts` à chaque lancement.
 *
 * Ce contrôle lance le VRAI moteur et le coupe à sa première ligne de
 * protocole : le message « init » porte la liste des outils, et il arrive AVANT
 * que la moindre demande parte au modèle. Aucun jeton n'est donc dépensé.
 *
 *   node scripts/verif-liste-de-taches-moteur.mjs
 *
 * Le modèle jugé se change par HAIKO_LISTE_TACHES_MODELE (défaut : sonnet 5,
 * celui des agents de tâche).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { environnementDeLaListeDeTaches, VARIABLE_LISTE_DE_TACHES } = await import(
  path.join(RACINE, 'shared/dist/liste-de-taches-du-moteur.js')
);

const BINAIRE = process.env.HAIKODEV_CLAUDE_BIN || 'claude';
const MODELE = process.env.HAIKO_LISTE_TACHES_MODELE || 'claude-sonnet-5';
/** Les outils sans lesquels aucun agent ne peut annoncer son déroulé. */
const INDISPENSABLES = ['TaskCreate', 'TaskUpdate'];

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Les outils que le moteur annonce, pour cet environnement-là. On coupe dès la
 * ligne « init » : rien n'est demandé au modèle.
 */
function outilsAnnonces(env) {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(
      BINAIRE,
      ['-p', '--output-format', 'stream-json', '--verbose', '--model', MODELE, '--permission-mode', 'bypassPermissions'],
      { cwd: RACINE, env: { ...env, FORCE_COLOR: '0' }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let reste = '';
    let rendu = false;
    const minuteur = setTimeout(() => {
      if (rendu) return;
      rendu = true;
      enfant.kill('SIGKILL');
      rejeter(new Error('le moteur n’a pas annoncé ses outils en 90 s'));
    }, 90_000);
    const finir = (valeur, erreur) => {
      if (rendu) return;
      rendu = true;
      clearTimeout(minuteur);
      enfant.kill('SIGKILL');
      if (erreur) rejeter(erreur);
      else resoudre(valeur);
    };
    enfant.stdout.on('data', (morceau) => {
      reste += morceau.toString('utf8');
      const lignes = reste.split('\n');
      reste = lignes.pop() ?? '';
      for (const ligne of lignes) {
        const propre = ligne.trim();
        if (!propre.startsWith('{')) continue;
        let evenement;
        try {
          evenement = JSON.parse(propre);
        } catch {
          continue;
        }
        if (evenement.subtype === 'init' && Array.isArray(evenement.tools)) finir(evenement.tools);
      }
    });
    enfant.on('error', (erreur) => finir(null, erreur));
    enfant.on('close', () => finir(null, new Error('le moteur s’est arrêté sans annoncer ses outils')));
    enfant.stdin.write('ok');
    enfant.stdin.end();
  });
}

console.log(`Moteur jugé : ${BINAIRE} — modèle ${MODELE}`);

// 1. La règle elle-même : que pose-t-elle, et qu'épargne-t-elle ?
const ajout = environnementDeLaListeDeTaches({});
noter(
  'la règle pose la variable qui rouvre les outils',
  ajout[VARIABLE_LISTE_DE_TACHES] === '1',
  `${VARIABLE_LISTE_DE_TACHES}=${ajout[VARIABLE_LISTE_DE_TACHES] ?? 'rien'}`,
);
noter(
  'un réglage déjà posé sur la machine n’est pas écrasé',
  Object.keys(environnementDeLaListeDeTaches({ [VARIABLE_LISTE_DE_TACHES]: '0' })).length === 0,
);

// L'environnement d'un lancement, DÉBARRASSÉ de la variable : c'est celui du
// démon, qui ne l'a jamais eue. Un agent qui lance ce contrôle, lui, l'a
// héritée — la retirer ici est ce qui rend le constat honnête.
const nu = { ...process.env };
delete nu[VARIABLE_LISTE_DE_TACHES];

let outilsSansVariable;
try {
  outilsSansVariable = await outilsAnnonces(nu);
} catch (erreur) {
  noter('le moteur répond et annonce ses outils', false, erreur.message);
  console.log('\nContrôle interrompu : le moteur n’a pas parlé.');
  process.exit(1);
}
noter('le moteur répond et annonce ses outils', true, `${outilsSansVariable.length} outils`);

// 2. Le constat qui justifie la règle. Ce n'est PAS un échec : si un jour le
//    CLI les rend d'office, la variable devient inutile et on le saura ici.
const manquantsSansVariable = INDISPENSABLES.filter((outil) => !outilsSansVariable.includes(outil));
console.log(
  manquantsSansVariable.length
    ? `  NOTE  sans la variable, ce modèle n’a PAS ${manquantsSansVariable.join(' ni ')} — la règle est donc bien nécessaire`
    : '  NOTE  ce modèle annonce déjà ses outils de liste sans la variable (le CLI a changé)',
);

// 3. Ce qui compte : l'environnement RÉEL d'un lancement HaikoDev.
const lancement = { ...nu, ...environnementDeLaListeDeTaches(nu) };
let outilsDuLancement;
try {
  outilsDuLancement = await outilsAnnonces(lancement);
} catch (erreur) {
  noter('le lancement HaikoDev offre la liste de tâches', false, erreur.message);
  console.log('\nContrôle interrompu : le moteur n’a pas parlé.');
  process.exit(1);
}
for (const outil of INDISPENSABLES) {
  noter(`le lancement HaikoDev offre « ${outil} »`, outilsDuLancement.includes(outil));
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
