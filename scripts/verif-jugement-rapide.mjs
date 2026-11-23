#!/usr/bin/env node
/*
 * LE JUGE RAPIDE NE PASSE QUE PAR JEV, NE PART QUE VERS L'ADRESSE DE SA FICHE,
 * ET NE BLOQUE JAMAIS RIEN.
 *
 *   npm run build:server && node scripts/verif-jugement-rapide.mjs
 *
 * Rejoue, sur le code construit de CE dépôt et dans un bac à sable (jamais la
 * base servie, jamais le service réel) :
 *   1. AUCUNE SORTIE RÉSEAU hors du faux serveur local : `fetch`, `http`,
 *      `https` et les connexions TCP sont comptés ; seule l'adresse rangée sur
 *      la fiche d'essai du coffre est permise.
 *   2. SANS CLÉ AU COFFRE : aucun appel ; la jauge est notée par les règles,
 *      les autres jugements rendent « rien », sans lever, et laissent leur trace.
 *   3. UN USAGE ÉTEINT n'interroge pas Jev, même avec une clé.
 *   4. CLÉ RANGÉE (faux serveur) : un appel par jugement, des verdicts, des
 *      traces en JSON valide qui comptent les jetons.
 *   5. SERVICE MUET : « rien » en temps borné, et la jauge reste notée.
 *
 * Code de sortie non nul au premier contrat rompu.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script : lancé depuis une copie de travail, il juge CE
   code-là, jamais celui du dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* LE FAUX JEV, PUIS LE COMPTEUR DE SORTIES RÉSEAU                     */
/* ------------------------------------------------------------------ */

let appelsAuFaux = 0;
let muet = false;
const faux = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (bout) => (corps += bout));
  req.on('end', () => {
    appelsAuFaux += 1;
    if (muet) return;
    const answers = {};
    for (const [cle, q] of Object.entries(JSON.parse(corps).questions)) {
      if (q.type === 'noul') answers[cle] = { type: 'noul', noul: 0.9 };
      else if (q.type === 'choice') answers[cle] = { type: 'choice', choice: Object.keys(q.criteria)[0], probabilities: {}, confidence: 0.9 };
      else answers[cle] = { type: 'score', score: q.criteria.length - 1, confidence: 0.9 };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-essai', answers, usage: { input_tokens: 90, output_tokens: 6 } }));
  });
});
await new Promise((resolve) => faux.listen(0, '127.0.0.1', resolve));
const PORT = faux.address().port;
const ADRESSE = `http://127.0.0.1:${PORT}/v1/systemone`;

const sorties = [];
const fetchReel = globalThis.fetch;
globalThis.fetch = async (cible, ...reste) => {
  if (String(cible) === ADRESSE) return fetchReel(cible, ...reste);
  sorties.push(`fetch ${String(cible)}`);
  throw new Error('réseau interdit pendant ce contrôle');
};
for (const [nom, module] of [
  ['http', http],
  ['https', https],
]) {
  for (const methode of ['request', 'get']) {
    module[methode] = () => {
      sorties.push(`${nom}.${methode}`);
      throw new Error('réseau interdit pendant ce contrôle');
    };
  }
}
const connecter = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  /* Une socket locale (fichier, tube d'un processus enfant) n'est pas du réseau. */
  const locale = typeof options === 'string' || (options && typeof options === 'object' && options.path);
  const versLeFaux = options && typeof options === 'object' && Number(options.port) === PORT;
  if (!locale && !versLeFaux) sorties.push(`tcp ${JSON.stringify(options)}`);
  return connecter.apply(this, args);
};
syncBuiltinESMExports();

/* ------------------------------------------------------------------ */
/* UNE BASE À SOI, ET LE JUGE COMPILÉ                                  */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-juge-rapide-'));
process.env.BELUGA_DATA = bacASable;
delete process.env.BELUGA_URL;
delete process.env.BELUGA_TOKEN;

const compile = path.join(RACINE, 'server/dist/jugement-rapide.js');
if (!fs.existsSync(compile)) {
  console.error(`introuvable : ${compile} — construire d'abord (npm run build:server)`);
  process.exit(2);
}
const store = await import(path.join(RACINE, 'server/dist/store.js'));
const coffre = await import(path.join(RACINE, 'server/dist/coffre-fort.js'));
const juge = await import(compile);
const { dossierAJuger, USAGES_JUGE } = await import(path.join(RACINE, 'shared/dist/index.js'));

const DOSSIER = dossierAJuger({
  title: 'Ranger la carte au clic',
  parcours: {
    comprehension: {
      texte: 'Le bouton d’arrêt doit ranger la carte en « Planifié », exactement comme la sortie à la souris.',
      hypotheses: ['Le raccourci clavier suit le même chemin.'],
      partieTechnique: {
        taches: [{ titre: 'Ranger la carte', description: 'au clic comme à la sortie' }],
        faits: ['Un arrêt à la main ramène la carte en « Planifié ».'],
        risques: 'Le balayage de nuit pourrait la reprendre.',
      },
    },
  },
});
const CARTE = { id: 'carte-verif', projectId: 'projet-verif' };

/** Les trois jugements, chacun gardé : une exception est un ÉCHEC du contrat. */
async function lesTrois() {
  const rendus = {};
  for (const [nom, appel] of [
    ['comprehension', () => juge.jugerLaComprehension(CARTE, DOSSIER)],
    ['interet', () => juge.noterUneProposition({ titre: 'Accélérer le tableau', description: 'Poser les cartes par paquets.' }, {})],
    ['urgence', () => juge.jugerLUrgence({ titre: 'Le site est en panne', description: 'Erreur 502 partout.', origine: 'surveillance' }, {})],
  ]) {
    try {
      rendus[nom] = { valeur: await appel() };
    } catch (err) {
      rendus[nom] = { exception: err?.message ?? String(err) };
    }
  }
  return rendus;
}
const sansException = (rendus) => Object.values(rendus).every((r) => !('exception' in r));
const tracesValides = (traces) =>
  traces.every((trace) => {
    try {
      JSON.parse(trace.question);
      return true;
    } catch {
      return false;
    }
  });

try {
  /* ---- 2. Sans clé ------------------------------------------------------ */
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  noter('sans clé : le juge se dit éteint', juge.etatDuJuge().allume === false);
  const sansCle = await lesTrois();
  noter(
    'sans clé : la jauge est notée par les règles, les autres rendent « rien », sans lever',
    sansException(sansCle) &&
      sansCle.comprehension.valeur?.source === 'regles' &&
      sansCle.interet.valeur === undefined &&
      sansCle.urgence.valeur === undefined,
    JSON.stringify(sansCle.comprehension.valeur),
  );
  const tracesSansCle = juge.listerLesTraces(10);
  noter(
    'sans clé : chaque échec laisse une trace lisible',
    tracesSansCle.length === 3 && tracesSansCle.every((t) => t.issue === 'echec' && /aucune clé/.test(t.reponse)) && tracesValides(tracesSansCle),
  );
  noter('sans clé : aucun appel au faux serveur', appelsAuFaux === 0);

  /* ---- 3. Usages éteints ----------------------------------------------- */
  coffre.enregistrerAcces({ nom: 'TypeSafe — essai', type: 'cle-api', champs: { service: 'TypeSafe', cle: 'cle-essai', adresse: ADRESSE } });
  store.saveSettings({ jugeEteints: [...USAGES_JUGE], jugeAllumes: [] });
  const avantEteints = juge.listerLesTraces(100).length;
  const eteints = await lesTrois();
  noter(
    'usages éteints : aucun verdict, aucune trace, aucun appel',
    sansException(eteints) &&
      Object.values(eteints).every((r) => r.valeur === undefined) &&
      juge.listerLesTraces(100).length === avantEteints &&
      appelsAuFaux === 0,
  );

  /* ---- 4. Clé rangée, faux serveur -------------------------------------- */
  store.saveSettings({ jugeEteints: [], jugeAllumes: [...USAGES_JUGE] });
  noter('clé rangée : le juge se dit allumé', juge.etatDuJuge().allume === true);
  const avecCle = await lesTrois();
  noter(
    'clé rangée : un appel par jugement, et trois verdicts',
    sansException(avecCle) &&
      appelsAuFaux === 3 &&
      avecCle.comprehension.valeur?.source === 'jev' &&
      avecCle.interet.valeur !== undefined &&
      avecCle.urgence.valeur?.signal === true,
    `${appelsAuFaux} appel(s)`,
  );
  const [trace] = juge.listerLesTraces(1);
  noter('clé rangée : la trace compte les jetons, en JSON valide', trace.issue === 'repondu' && trace.jetonsEntree === 90 && tracesValides([trace]));
  noter('le bouton « tester » voit la clé acceptée', (await juge.testerLaCle()).etat === 'acceptee');

  /* ---- 5. Service muet ------------------------------------------------- */
  muet = true;
  const depart = Date.now();
  const sansReponse = await lesTrois();
  const duree = Date.now() - depart;
  noter(
    'service muet : « rien » en temps borné, et la jauge reste notée',
    sansException(sansReponse) && sansReponse.comprehension.valeur?.source === 'regles' && duree < 3 * 4500,
    `${duree} ms`,
  );
} finally {
  faux.closeAllConnections();
  faux.close();
  fs.rmSync(bacASable, { recursive: true, force: true });
}

/* ---- 1. Le réseau ------------------------------------------------------ */
noter('aucune sortie réseau hors du faux serveur', sorties.length === 0, sorties.join(' ; '));

const echecs = resultats.filter((r) => !r.ok).length;
console.log(echecs ? `\n${echecs} contrat(s) rompu(s).` : '\nTout est conforme.');
process.exit(echecs ? 1 : 0);
