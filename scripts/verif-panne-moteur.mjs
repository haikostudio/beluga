#!/usr/bin/env node
/**
 * UNE ERREUR 500 DU MOTEUR NE DOIT PLUS TUER LA TÂCHE.
 *
 * Constat qui a produit ce contrôle : une carte tombait en plein vol après
 * plusieurs dizaines d'étapes réussies, sur « API Error: 500 Internal server
 * error » ou « API Error: Server error mid-response ». Le moteur sortait en code
 * 1, la conversation affichait un bandeau rouge « Le moteur s'est arrêté (code
 * 1) », et le travail restait à moitié fait — alors que la panne venait du
 * FOURNISSEUR et qu'elle passe toute seule.
 *
 * Rien n'est simulé à moitié ici : on fabrique un FAUX MOTEUR (un petit
 * programme qui parle le même format que Claude Code), et on le fait tomber sur
 * une vraie 500. L'adaptateur réel le lance, lit sa sortie, constate son code 1 ;
 * la boucle de relance du démon fait le reste.
 *
 * Quatre situations rejouées :
 *   1. deux 500 d'affilée, puis le moteur répond → le tour RETENTE et ABOUTIT,
 *      sans aucune erreur rouge, et la consigne de reprise dit de continuer ;
 *   2. une panne qui dure → nombre d'essais BORNÉ, cause dite en clair,
 *      jamais un « code 1 » ;
 *   3. une demande refusée (400) → aucun nouvel essai : la retenter répéterait
 *      le refus ;
 *   4. un arrêt demandé à la main pendant l'attente → plus rien ne repart.
 *
 *   npm run build:server && node scripts/verif-panne-moteur.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Le serveur ouvre sa base au chargement : on lui en donne une JETABLE.
const BASE_JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-panne-'));
process.env.HAIKODEV_DATA = BASE_JETABLE;

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/*
 * LE FAUX MOTEUR. Il parle le format de Claude Code (« stream-json ») : une
 * ligne « system » avec l'identifiant de session, une ligne « assistant » avec
 * du texte, puis il sort. Un fichier témoin dit combien d'appels doivent
 * tomber : c'est ce qui permet de rejouer « deux pannes puis ça repart ».
 */
const FAUX_MOTEUR = path.join(BASE_JETABLE, 'faux-moteur.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
const temoin = process.env.TEMOIN_PANNE;
const etat = JSON.parse(fs.readFileSync(temoin, 'utf8'));
etat.appels += 1;
// La demande arrive par l'entrée standard, comme le démon la passe au moteur.
let demande = '';
process.stdin.on('data', (c) => (demande += c));
process.stdin.on('end', () => {
  etat.demandes.push(demande);
  fs.writeFileSync(temoin, JSON.stringify(etat));
  const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  dire({ type: 'system', subtype: 'init', session_id: 'session-d-essai' });
  if (etat.appels <= etat.pannes) {
    dire({ type: 'assistant', message: { content: [{ type: 'text', text: etat.banniere }] } });
    process.exit(1);
  }
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Travail terminé.' }] } });
  process.exit(0);
});
`,
  { mode: 0o755 },
);

const TEMOIN = path.join(BASE_JETABLE, 'temoin.json');
function preparerLeMoteur(pannes, banniere) {
  fs.writeFileSync(TEMOIN, JSON.stringify({ appels: 0, pannes, banniere, demandes: [] }));
  return () => JSON.parse(fs.readFileSync(TEMOIN, 'utf8'));
}

// L'adaptateur lit `HAIKODEV_CLAUDE_BIN` au chargement : la variable est posée
// AVANT l'import. Le faux moteur est exécutable, son shebang appelle Node.
process.env.HAIKODEV_CLAUDE_BIN = FAUX_MOTEUR;
process.env.TEMOIN_PANNE = TEMOIN;

const { claudeAdapter } = await import(path.join(RACINE, 'server/dist/engines/claude.js'));
const { lancerAvecRelances } = await import(path.join(RACINE, 'server/dist/relance-moteur.js'));
const { ESSAIS_MAX, attenteAvantNouvelEssai, demandeDeRepriseApresPanne, messageDePanneDefinitive } = await import(
  path.join(RACINE, 'shared/dist/index.js')
);

/**
 * Un tour du démon, réduit à ce que la relance a besoin de savoir : le texte
 * écrit par le moteur, l'erreur vue pendant le tour, et l'attente remplacée par
 * un simple relevé — un contrôle n'attend pas une minute pour prouver une règle.
 */
async function tourAvecRelances({ pannes, banniere, arretApresAttente = false }) {
  const lire = preparerLeMoteur(pannes, banniere);
  const etat = { texte: '', erreur: undefined, arretDemande: false };
  const attentes = [];
  const etapes = [];

  const relance = await lancerAvecRelances({
    lancer: (essai, motif) => {
      etat.erreur = undefined;
      return claudeAdapter.run({
        cwd: BASE_JETABLE,
        prompt: essai === 0 ? 'Fais le travail.' : demandeDeRepriseApresPanne(motif, essai),
        fullAccess: true,
        env: { TEMOIN_PANNE: TEMOIN },
        onEvent: (event) => {
          if (event.kind === 'text' && event.text) etat.texte += (etat.texte ? '\n' : '') + event.text;
          if (event.kind === 'error') etat.erreur = event.error;
        },
      });
    },
    etat: () => ({ erreur: etat.erreur, texte: etat.texte, arretDemande: etat.arretDemande }),
    avantNouvelEssai: (info) => etapes.push(info),
    attendre: async (ms) => {
      attentes.push(ms);
      if (arretApresAttente) etat.arretDemande = true;
    },
  });

  return { relance, etat, attentes, etapes, moteur: lire() };
}

try {
  /* 1. Deux 500, puis le moteur répond. */
  const bannier500 =
    'API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment.';
  const un = await tourAvecRelances({ pannes: 2, banniere: bannier500 });
  noter('deux erreurs 500 : le tour retente et aboutit', un.relance.result.ok && un.relance.essais === 2,
    `${un.relance.essais} essai(s), moteur appelé ${un.moteur.appels} fois`);
  noter('aucune panne ne reste à afficher : pas d’erreur rouge', un.relance.panne === null);
  noter(
    'l’attente est croissante',
    un.attentes.length === 2 && un.attentes[1] > un.attentes[0] && un.attentes[0] === attenteAvantNouvelEssai(1),
    un.attentes.join(' ms, ') + ' ms',
  );
  noter(
    'la reprise dit de continuer, jamais de repartir de zéro',
    un.moteur.demandes.slice(1).every((d) => /CONTINUE EXACTEMENT OÙ TU T'ES ARRÊTÉ/.test(d)),
  );
  noter(
    'le fil est repris, pas rouvert',
    un.etapes.every((etape) => etape.motif === 'erreur-serveur'),
    un.etapes.map((e) => e.motif).join(', '),
  );

  /* 2. Une panne qui dure. */
  const deux = await tourAvecRelances({ pannes: 99, banniere: 'API Error: Server error mid-response.' });
  noter('une panne qui dure : le nombre d’essais est borné', deux.relance.essais === ESSAIS_MAX,
    `${deux.relance.essais} essais`);
  noter('la cause est rendue au démon', deux.relance.panne === 'erreur-serveur');
  const message = deux.relance.panne ? messageDePanneDefinitive(deux.relance.panne, deux.relance.essais) : '';
  noter('la cause s’affiche en clair, sans « code 1 »', /interrompu/i.test(message) && !/code 1/.test(message), message);

  /* 3. Une demande refusée. */
  const trois = await tourAvecRelances({ pannes: 99, banniere: 'API Error: 400 invalid request' });
  noter('une demande refusée ne se retente pas', trois.relance.essais === 0 && trois.moteur.appels === 1);

  /* 4. Un arrêt demandé pendant l’attente. */
  const quatre = await tourAvecRelances({ pannes: 99, banniere: bannier500, arretApresAttente: true });
  noter('un arrêt à la main ferme la porte', quatre.moteur.appels === 1, `${quatre.moteur.appels} appel(s)`);
} finally {
  fs.rmSync(BASE_JETABLE, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
