#!/usr/bin/env node
/**
 * Supprime une carte complètement de la base de données.
 * Usage: node scripts/nettoyer-carte.mjs <card-id>
 *
 * Supprime:
 * - La carte elle-même
 * - Ses étiquettes
 * - Ses pièces jointes
 * - Ses commentaires
 * - Les agents en train de travailler dessus
 * - Les messages des agents
 * - Les éléments en file d'attente de l'agent
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', 'data', 'haikodev.db');

const cardId = process.argv[2];
if (!cardId) {
  console.error('Usage: node scripts/nettoyer-carte.mjs <card-id>');
  process.exit(1);
}

console.log(`🗑️  Suppression de la carte ${cardId}...`);

try {
  const db = new Database(dbPath);

  // Vérifier que la carte existe
  const card = db.prepare('SELECT id, project_id FROM cards WHERE id = ?').get(cardId);
  if (!card) {
    console.error(`❌ Carte ${cardId} introuvable dans la base`);
    process.exit(1);
  }

  console.log(`   Projet : ${card.project_id}`);

  db.transaction(() => {
    // Trouver les agents liés à cette carte
    const agentIds = db
      .prepare('SELECT id FROM agents WHERE card_id = ?')
      .all(cardId)
      .map(r => r.id);

    console.log(`   ${agentIds.length} agent(s) lié(s)`);

    // Supprimer pour chaque agent
    for (const agentId of agentIds) {
      const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE agent_id = ?').get(agentId).cnt;
      const queueCount = db.prepare('SELECT COUNT(*) as cnt FROM queue WHERE agent_id = ?').get(agentId).cnt;

      if (msgCount) {
        console.log(`     - ${msgCount} message(s) de l'agent ${agentId}`);
        db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
      }
      if (queueCount) {
        console.log(`     - ${queueCount} élément(s) en queue`);
        db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agentId);
      }

      db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    }

    // Supprimer les étiquettes
    const labelCount = db.prepare('SELECT COUNT(*) as cnt FROM card_labels WHERE card_id = ?').get(cardId).cnt;
    if (labelCount) {
      console.log(`   ${labelCount} étiquette(s)`);
      db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(cardId);
    }

    // Supprimer les pièces jointes
    const attachmentCount = db.prepare('SELECT COUNT(*) as cnt FROM card_attachments WHERE card_id = ?').get(cardId).cnt;
    if (attachmentCount) {
      console.log(`   ${attachmentCount} pièce(s) jointe(s)`);
      db.prepare('DELETE FROM card_attachments WHERE card_id = ?').run(cardId);
    }

    // Supprimer les commentaires
    const commentCount = db.prepare('SELECT COUNT(*) as cnt FROM card_comments WHERE card_id = ?').get(cardId).cnt;
    if (commentCount) {
      console.log(`   ${commentCount} commentaire(s)`);
      db.prepare('DELETE FROM card_comments WHERE card_id = ?').run(cardId);
    }

    // Supprimer la carte elle-même
    db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);

    console.log(`✅ Carte ${cardId} supprimée avec succès`);
  })();

  db.close();
  process.exit(0);
} catch (err) {
  console.error(`❌ Erreur : ${err.message}`);
  process.exit(1);
}
