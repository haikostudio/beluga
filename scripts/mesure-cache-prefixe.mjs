#!/usr/bin/env node
/*
 * CE QUE COÛTE UNE CONSIGNE SYSTÈME QUI CHANGE EN COURS DE SESSION.
 *
 * Sous Claude, `--append-system-prompt` est réappliqué à CHAQUE invocation, et
 * ce texte se pose TOUT DEVANT la conversation. Deux tours d'une même session
 * qui ne portent pas le même entête n'ont donc plus le même début : tout ce qui
 * suit — la conversation entière — doit être RÉÉCRIT dans le cache du moteur au
 * lieu d'être RELU. Ce script ne raisonne pas : il fait tourner le moteur pour
 * de vrai, deux fois deux tours, et lit les compteurs que le moteur rend.
 *
 *   variante « stable »   : tour 1 et tour 2 avec le MÊME entête
 *   variante « changeant » : tour 1 avec l'entête entier, tour 2 avec le rappel court
 *
 * Ce qu'on regarde au tour 2 : `cache_read_input_tokens` (relu, dix fois moins
 * cher) contre `cache_creation_input_tokens` (réécrit, un quart plus cher que
 * du neuf). Le script ne vise JAMAIS l'application publiée et ne reprend aucun
 * jeton d'agent : il appelle l'outil en ligne de commande déjà identifié.
 *
 *   node scripts/mesure-cache-prefixe.mjs
 *   MESURE_MODELE=sonnet node scripts/mesure-cache-prefixe.mjs
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// La consigne réelle du projet est lue dans le serveur compilé, et le serveur
// ouvre sa base au chargement : on lui en donne une JETABLE, avant tout import.
const BASE_JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-cache-'));
process.env.HAIKODEV_DATA = BASE_JETABLE;
process.on('exit', () => fs.rmSync(BASE_JETABLE, { recursive: true, force: true }));

const runtime = await import(path.join(RACINE, 'server/dist/runtime.js'));
const ENTETE_ENTIER = runtime.rolePrompt('task', true, 'claude');
const ENTETE_RAPPEL = runtime.rappelDeMethode('claude');

const MOTEUR = process.env.HAIKODEV_CLAUDE_BIN || 'claude';
const MODELE = process.env.MESURE_MODELE || 'haiku';

/*
 * Le tour 1 doit poser une conversation ASSEZ GROSSE pour qu'on voie la
 * différence : c'est elle que le tour 2 relit ou réécrit. Un texte quelconque
 * mais STABLE (aucune date, aucun hasard) — les deux variantes doivent partir
 * du même tour 1, sinon on compare deux conversations différentes.
 */
const REMPLISSAGE = Array.from(
  { length: 220 },
  (_, i) =>
    `Ligne ${i + 1} — note de travail sans importance, gardée telle quelle pour donner du volume à la conversation mesurée : ` +
    `elle ne demande rien, ne cite aucun fichier et n'attend aucune action de ta part.`,
).join('\n');

const DEMANDE_1 = `${REMPLISSAGE}\n\nNe fais rien de tout cela. Réponds exactement : OK.`;
const DEMANDE_2 = 'Réponds exactement : OK.';

/** Un tour de moteur, rendu avec les compteurs d'entrée du résultat. */
function tour({ sessionId, reprise, entete, demande }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', MODELE];
  args.push(reprise ? '--resume' : '--session-id', sessionId);
  args.push('--permission-mode', 'manual');
  args.push('--append-system-prompt', entete);

  return new Promise((resolve, reject) => {
    // La demande part par l'entrée standard, comme le démon la passe au moteur.
    const enfant = spawn(MOTEUR, args, {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    enfant.stdin.write(demande);
    enfant.stdin.end();
    let reste = '';
    let mesure = null;
    let erreur = '';

    const ligne = (texte) => {
      const t = texte.trim();
      if (!t.startsWith('{')) return;
      let evenement;
      try {
        evenement = JSON.parse(t);
      } catch {
        return;
      }
      if (evenement.type === 'result' && evenement.usage) {
        const u = evenement.usage;
        mesure = {
          neuf: u.input_tokens ?? 0,
          ecrit: u.cache_creation_input_tokens ?? 0,
          relu: u.cache_read_input_tokens ?? 0,
          sortie: u.output_tokens ?? 0,
        };
      }
    };

    enfant.stdout.on('data', (bloc) => {
      reste += bloc.toString('utf8');
      const lignes = reste.split('\n');
      reste = lignes.pop() ?? '';
      for (const l of lignes) ligne(l);
    });
    enfant.stderr.on('data', (bloc) => {
      erreur += bloc.toString('utf8');
    });
    enfant.on('error', reject);
    enfant.on('close', (code) => {
      if (reste.trim()) ligne(reste);
      if (!mesure) {
        reject(new Error(`Le moteur n'a rendu aucune mesure (code ${code}). ${erreur.trim().slice(-400)}`));
        return;
      }
      resolve(mesure);
    });
  });
}

/** Une variante entière : deux tours dans une session neuve. */
async function variante(nom, enteteDuSecondTour) {
  const sessionId = randomUUID();
  const premier = await tour({ sessionId, reprise: false, entete: ENTETE_ENTIER, demande: DEMANDE_1 });
  const second = await tour({ sessionId, reprise: true, entete: enteteDuSecondTour, demande: DEMANDE_2 });
  return { nom, premier, second };
}

const nombre = (n) => n.toLocaleString('fr-CH');

function afficher({ nom, premier, second }) {
  console.log(`\n— ${nom}`);
  for (const [titre, m] of [
    ['tour 1', premier],
    ['tour 2', second],
  ]) {
    const entree = m.neuf + m.ecrit + m.relu;
    const part = entree ? Math.round((100 * m.relu) / entree) : 0;
    console.log(
      `  ${titre} : neuf ${nombre(m.neuf)} · réécrit dans le cache ${nombre(m.ecrit)} · relu au cache ${nombre(m.relu)}` +
        ` (${part} % relu)`,
    );
  }
}

/*
 * Le prix relatif d'une entrée, chez Anthropic : relire au cache coûte 0,1 fois
 * une entrée neuve, l'y écrire 1,25 fois. On ne facture rien ici — on met les
 * deux variantes sur la même échelle, sinon « 40 000 réécrits » et « 40 000
 * relus » se ressembleraient.
 */
const poids = (m) => m.neuf + m.ecrit * 1.25 + m.relu * 0.1;

console.log('Mesure du préfixe de session — moteur Claude, modèle ' + MODELE);
console.log(`Entête entier : ${ENTETE_ENTIER.length} signes · rappel court : ${ENTETE_RAPPEL.length} signes`);

const stable = await variante('entête STABLE (le même aux deux tours)', ENTETE_ENTIER);
const changeant = await variante('entête CHANGEANT (entier puis rappel)', ENTETE_RAPPEL);

afficher(stable);
afficher(changeant);

const ecart = poids(changeant.second) - poids(stable.second);
console.log('\n— Au tour 2, à conversation égale');
console.log(`  entête stable    : ${nombre(Math.round(poids(stable.second)))} jetons d'entrée pondérés`);
console.log(`  entête changeant : ${nombre(Math.round(poids(changeant.second)))} jetons d'entrée pondérés`);
console.log(
  `  écart : ${ecart >= 0 ? '+' : ''}${nombre(Math.round(ecart))} jetons pondérés pour le changeant` +
    (poids(stable.second) ? ` (${Math.round((100 * ecart) / poids(stable.second))} %)` : ''),
);
console.log(
  ecart > 0
    ? "\nConclusion : garder le MÊME entête d'un tour à l'autre coûte moins cher que d'en envoyer un plus court."
    : "\nConclusion : l'entête court reste avantageux — le préfixe ne se perd pas.",
);
