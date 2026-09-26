import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { demandeDeRedactionChangelog, lireRedactionsDuModele, type Card } from '@beluga/shared';
import { CONFIG } from './config.js';
import { ajouterAuChangelog, entreeDeCarteRedigee } from './connaissances.js';
import { log } from './logger.js';

/**
 * LA RÉDACTION DE REPLI D'UNE ENTRÉE DE CHANGELOG. L'agent qui a fait le travail
 * rédige lui-même l'entrée de sa carte (outil « memoire », geste « changelog ») ;
 * quand il ne l'a pas fait, la clôture pose le titre nu de la carte, puis cette
 * rédaction le complète EN ARRIÈRE-PLAN, à partir de ce que la carte a vraiment
 * fait : sa description, l'explication de sa facturation et son compte rendu.
 * Jamais le titre recopié tel quel comme « explication ». Une panne ici ne
 * retient rien : l'entrée reste avec son titre, et la reprise du passé
 * (`scripts/reecrire-changelog.mjs`) pourra la compléter.
 */

export const MODELE_REDACTION_CHANGELOG = 'claude-haiku-4-5-20251001';
const DELAI_REDACTION_MS = 3 * 60_000;

/** Le compte rendu d'un agent, de « 1. Analyse » à « 4. Impact » : ce qu'il a fait et ce que ça change. */
export function extraitDuCompteRendu(markdown: string, max = 3000): string {
  const debut = markdown.lastIndexOf('## 1. Analyse');
  if (debut < 0) return '';
  const reste = markdown.slice(debut);
  const fin = reste.search(/\n## [56]\. /);
  return (fin > 0 ? reste.slice(0, fin) : reste).trim().slice(0, max);
}

/** Le document de clôture d'une carte : `data/documents/<titre>-<8 premiers signes de l'id>.md`. */
export function documentDeLaCarte(cardId: string, dossier = path.join(CONFIG.dataDir, 'documents')): string | null {
  try {
    const suffixe = `-${cardId.slice(0, 8)}.md`;
    const nom = fs.readdirSync(dossier).find((f) => f.endsWith(suffixe));
    return nom ? path.join(dossier, nom) : null;
  } catch {
    return null;
  }
}

export function contexteDeLaCarte(card: Pick<Card, 'id' | 'title' | 'description' | 'billing'>): string {
  const blocs: string[] = [];
  if (card.description?.trim()) blocs.push(`Demande : ${card.description.trim().slice(0, 1200)}`);
  if (card.billing?.clientExplanation?.trim()) blocs.push(`Explication donnée au client : ${card.billing.clientExplanation.trim()}`);
  const document = documentDeLaCarte(card.id);
  if (document) {
    try {
      const extrait = extraitDuCompteRendu(fs.readFileSync(document, 'utf8'));
      if (extrait) blocs.push(`Compte rendu de l’agent :\n${extrait}`);
    } catch {
      /* document illisible : on fait avec le reste */
    }
  }
  return blocs.join('\n\n');
}

export function redigerLEntreeDeLaCarte(card: Card, nomDuProjet: string): boolean {
  // Les tests et un démon d'essai ne paient pas de modèle.
  if (process.env.NODE_TEST_CONTEXT || process.env.BELUGA_REDACTION_CHANGELOG === '0') return false;
  if (entreeDeCarteRedigee(card.projectId, card.id)) return false;
  const contexte = contexteDeLaCarte(card);
  if (contexte.length < 80) return false;
  const demande = demandeDeRedactionChangelog({
    nomDuProjet,
    entrees: [{ cle: 'carte', jour: new Date().toISOString().slice(0, 10), texte: card.title, contexte }],
  });
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BELUGA_TOKEN;
  let enfant;
  try {
    enfant = spawn('claude', ['-p', '--output-format', 'json', '--model', MODELE_REDACTION_CHANGELOG, '--max-turns', '1'], { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    log.warn(`changelog de « ${card.title} » : rédaction de repli impossible — ${(err as Error).message}`);
    return false;
  }
  let sortie = '';
  const minuteur = setTimeout(() => enfant.kill('SIGKILL'), DELAI_REDACTION_MS);
  enfant.stdout.on('data', (d) => (sortie += d));
  enfant.on('error', (err) => log.warn(`changelog de « ${card.title} » : rédaction de repli tombée — ${err.message}`));
  enfant.on('close', () => {
    clearTimeout(minuteur);
    try {
      const reponse = JSON.parse(sortie) as { result?: string; is_error?: boolean };
      if (reponse.is_error || typeof reponse.result !== 'string') throw new Error('réponse sans texte');
      const r = lireRedactionsDuModele(reponse.result)[0];
      if (!r) throw new Error('aucune entrée relue');
      const ajout = ajouterAuChangelog({ projectId: card.projectId, texte: card.title, titre: r.titre, explication: r.explication, poids: r.poids, cardId: card.id, source: 'carte' });
      if (!ajout.ok) throw new Error(ajout.raison);
    } catch (err) {
      log.warn(`changelog de « ${card.title} » : rédaction de repli non retenue — ${(err as Error).message}`);
    }
  });
  enfant.stdin.end(demande);
  return true;
}
