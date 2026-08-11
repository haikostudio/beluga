#!/usr/bin/env node
/*
 * Le relevé AVANT / APRÈS du bouton « repartir de zéro ».
 *
 * Ce qui part au moteur à chaque message du chef d'orchestre, ce n'est pas
 * seulement la demande : la conversation entière repart avec elle, puisque le
 * moteur reprend sa session. Plus le fil est long, plus chaque message coûte.
 *
 * On mesure donc deux choses sur une VRAIE conversation lue dans la base :
 *   AVANT — l'historique rejoué + le rappel de gabarit + la demande ;
 *   APRÈS — plus aucun historique, mais le briefing et la mémoire du projet
 *           renvoyés une fois, comme au premier message.
 *
 * Rien n'est modifié : la base est ouverte en lecture seule.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { wrapPrompt } from '../shared/dist/templates.js';
import { messagesDepuis } from '../shared/dist/nouveau-depart.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? path.join(RACINE, 'data', 'haikodev.db');

/** Estimation maison, la même que le démon : environ quatre signes par jeton. */
const jetons = (texte) => Math.round(texte.length / 4);
const nombre = (n) => n.toLocaleString('fr-CH').replace(/ | /g, ' ');

if (!fs.existsSync(BASE)) {
  console.error(`Base introuvable : ${BASE}`);
  process.exit(1);
}

const db = new Database(BASE, { readonly: true, fileMustExist: true });

/* La conversation de chef d'orchestre la plus fournie : c'est là que le
   problème se voit, et c'est elle que le bouton soulage. */
const agent = db
  .prepare(
    `SELECT a.id, a.data, COUNT(m.id) AS n
     FROM agents a JOIN messages m ON m.agent_id = a.id
     WHERE a.role = 'orchestrator'
     GROUP BY a.id ORDER BY n DESC LIMIT 1`,
  )
  .get();

if (!agent) {
  console.error("Aucune conversation de chef d'orchestre dans cette base.");
  process.exit(1);
}

const depart = db.prepare("SELECT value FROM meta WHERE key = ?").get(`chat.depart.${agent.id}`);
const tous = db
  .prepare('SELECT data FROM messages WHERE agent_id = ? ORDER BY created_at')
  .all(agent.id)
  .map((r) => JSON.parse(r.data));

/** Ce que pèse un message quand le moteur rejoue la conversation. */
const poidsFil = (liste) =>
  liste.reduce(
    (total, m) =>
      total +
      jetons(m.content ?? '') +
      jetons(JSON.stringify(m.steps ?? [])) +
      jetons(JSON.stringify(m.todos ?? [])),
    0,
  );

const DEMANDE = 'Où en est la carte des quotas ?';

// AVANT : la session est ouverte, le fil entier repart, le gabarit se rappelle
// en une ligne.
const avantFil = poidsFil(tous);
const avantEnveloppe = jetons(wrapPrompt('free', DEMANDE, '', { rappel: true, ampleur: 'breve' }));

// APRÈS : plus d'historique du tout. Le briefing et la mémoire du projet
// repartent une fois — c'est le prix, honnête, du nouveau départ.
// Ce qui repart vraiment : l'index de la mémoire, pas ses fichiers par sujet.
const memory = await import(path.join(RACINE, 'server/dist/memory.js'));
const briefing = memory.blocMemoire(RACINE);
const apresEnveloppe = jetons(
  wrapPrompt('free', DEMANDE, briefing, { rappel: false, ampleur: 'breve' }),
);

const avant = avantFil + avantEnveloppe;
const apres = apresEnveloppe;
const chute = avant ? Math.round(((avant - apres) / avant) * 100) : 0;

console.log(`Conversation mesurée : ${tous.length} messages (chef d'orchestre).`);
if (depart?.value) {
  console.log(`Déjà un nouveau départ posé : ${messagesDepuis(tous, Number(depart.value)).length} messages après lui.`);
}
console.log('');
console.log(`AVANT le clic  : ${nombre(avant)} jetons envoyés au moteur`);
console.log(`  · fil rejoué : ${nombre(avantFil)}`);
console.log(`  · enveloppe  : ${nombre(avantEnveloppe)} (rappel de gabarit)`);
console.log(`APRÈS le clic  : ${nombre(apres)} jetons envoyés au moteur`);
console.log(`  · fil rejoué : 0`);
console.log(`  · enveloppe  : ${nombre(apresEnveloppe)} (gabarit entier + mémoire du projet, une fois)`);
console.log('');
console.log(`Chute : ${chute} % sur le premier message qui suit le clic.`);

if (apres >= avant) {
  console.error("La conversation est encore trop courte pour que le bouton fasse gagner quoi que ce soit.");
  process.exit(2);
}
