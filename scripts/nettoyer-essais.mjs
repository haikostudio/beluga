#!/usr/bin/env node
/**
 * Retire tout ce que les vérifications ont pu laisser derrière elles.
 * À lancer après « verify-ui.mjs » : le vrai tableau doit rester propre.
 */
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const TITRES = ['%Vérification automatique%', "%Carte d'essai%", '%témoin%', '%Essai création%'];
const db = new Database('/root/haikodev/data/haikodev.db');

let cartes = 0;
for (const motif of TITRES) {
  for (const carte of db.prepare('SELECT id FROM cards WHERE title LIKE ?').all(motif)) {
    for (const agent of db.prepare('SELECT id FROM agents WHERE card_id = ?').all(carte.id)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM cards WHERE id = ?').run(carte.id);
    cartes += 1;
  }
}

// Les projets d'essai créés par les scripts d'agents.
let projets = 0;
for (const projet of db.prepare("SELECT id, path FROM projects WHERE path LIKE '%bac-a-sable%' OR path LIKE '%essai-creation%'").all()) {
  db.prepare('DELETE FROM cards WHERE project_id = ?').run(projet.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(projet.id);
  projets += 1;
}

console.log(`ménage : ${cartes} carte(s) et ${projets} projet(s) d'essai retirés`);
