import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COLUMN_LABELS } from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';
import { isRunning } from './runtime.js';
import { appendHistory } from './memory.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * L'archivage (PLAN §11) : il fait trois choses, dans cet ordre.
 * 1. le document de clôture s'écrit AVANT de tout fermer ;
 * 2. la branche est refermée et l'espace de travail nettoyé ;
 * 3. la carte part dans « Archivé ».
 *
 * Et jamais tant qu'un agent parle encore (PLAN §30).
 */
export async function archiveCard(
  cardId: string,
  context: { url?: string; commit?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, error: 'carte introuvable' };

  if (card.agentId && isRunning(card.agentId)) {
    return { ok: false, error: "l'agent parle encore : l'archivage attend qu'il se taise" };
  }

  const project = store.getProject(card.projectId);
  if (!project) return { ok: false, error: 'projet introuvable' };

  // 1. La conversation figée en document, écrite AVANT toute fermeture.
  const docPath = writeClosureDocument(card.id, context);

  // 2. La branche refermée.
  const branch = card.github?.branch;
  if (branch) {
    try {
      await execFileAsync('bash', ['-lc', `git branch -m ${branch} archive/${branch} 2>/dev/null || true`], {
        cwd: project.path,
        timeout: 20000,
      });
    } catch (err) {
      log.warn('fermeture de branche impossible', err);
    }
  }

  // 3. La carte part dans « Archivé », avec son document consultable.
  const archived = store.saveCard({
    ...card,
    column: 'archived',
    position: store.nextPosition(card.projectId, 'archived'),
    closureDoc: docPath ?? card.closureDoc,
    // La date du passage : elle survit à une sortie d'archive, c'est ce qui
    // permet de lire plus tard que la carte y était allée, et quand.
    archivedAt: Date.now(),
  });
  bus.emit({ type: 'card.upsert', card: archived });

  // La clôture alimente l'HISTORIQUE, pas la mémoire : « telle carte livrée le
  // 3 août » se relit à la main, mais n'apprend rien à un agent au travail et
  // occupait près d'un quart du contexte envoyé à chaque lancement.
  const line = summariseForMemory(card.id);
  if (line) appendHistory(project.path, line);

  return { ok: true };
}

function summariseForMemory(cardId: string): string | null {
  const card = store.getCard(cardId);
  if (!card) return null;
  const when = new Date().toLocaleDateString('fr-CH');
  const what = card.title.replace(/\s+/g, ' ').slice(0, 120);
  return `${when} : « ${what} » livrée${card.deployedAt ? ' et publiée' : ''}.`;
}

/** L'échange complet figé en Markdown, attaché à la carte. */
export function writeClosureDocument(cardId: string, context: { url?: string; commit?: string } = {}): string | null {
  const card = store.getCard(cardId);
  if (!card) return null;
  const project = store.getProject(card.projectId);
  const agent = card.agentId ? store.getAgent(card.agentId) : null;
  const messages = agent ? store.listMessages(agent.id, 500) : [];

  const lines: string[] = [];
  lines.push(`# ${card.title}`, '');
  lines.push(`_Projet : ${project?.name ?? '—'} · carte archivée le ${new Date().toLocaleString('fr-CH')}_`, '');

  lines.push('## La demande', '', card.description || '_(pas de description)_', '');

  if (card.estimate && !card.estimate.failed) {
    lines.push('## Ce qui était prévu', '');
    if (card.estimate.machineSeconds)
      lines.push(`- Durée machine annoncée : ${Math.round(card.estimate.machineSeconds / 60)} min`);
    if (card.estimate.seniorHours) lines.push(`- Estimation développeur senior : ${card.estimate.seniorHours} h`);
    if (card.estimate.summary) lines.push('', card.estimate.summary);
    lines.push('');
  }

  if (card.consumption) {
    lines.push('## Ce qui a réellement été consommé', '');
    if (card.consumption.machineSeconds)
      lines.push(`- Durée réelle : ${Math.round(card.consumption.machineSeconds / 60)} min`);
    if (card.consumption.tokens) lines.push(`- Jetons : ${card.consumption.tokens.toLocaleString('fr-CH')}`);
    if (card.consumption.account) lines.push(`- Compte utilisé : ${card.consumption.account}`);
    lines.push('');
  }

  if (card.github?.branch) {
    lines.push('## Dépôt', '', `- Branche : ${card.github.branch}`);
    if (card.github.prNumber) lines.push(`- Demande de fusion : #${card.github.prNumber} (${card.github.prState ?? '—'})`);
    for (const commit of card.github.commits.slice(0, 10)) {
      lines.push(`- ${commit.sha.slice(0, 7)} ${commit.message}`);
    }
    lines.push('');
  }

  if (card.deployedAt) {
    lines.push('## Publication', '');
    lines.push(`- Date : ${new Date(card.deployedAt).toLocaleString('fr-CH')}`);
    if (context.url) lines.push(`- Adresse : ${context.url}`);
    if (context.commit) lines.push(`- Commit publié : ${context.commit}`);
    lines.push('');
  }

  lines.push('## La conversation complète', '');
  for (const message of messages) {
    const who = message.role === 'user' ? 'Vous' : message.role === 'assistant' ? "L'agent" : message.role;
    lines.push(`### ${who} — ${new Date(message.createdAt).toLocaleString('fr-CH')}`, '');
    if (message.todos.length) {
      lines.push('_Liste des tâches :_');
      for (const todo of message.todos) {
        lines.push(`- [${todo.state === 'done' ? 'x' : ' '}] ${todo.label}`);
      }
      lines.push('');
    }
    if (message.steps.length) {
      lines.push('_Étapes :_');
      for (const step of message.steps) {
        const mark = step.state === 'done' ? 'x' : step.state === 'failed' ? '!' : ' ';
        lines.push(`- [${mark}] ${step.label}`);
      }
      lines.push('');
    }
    if (message.content.trim()) lines.push(message.content.trim(), '');
    if (message.error) lines.push(`> Erreur : ${message.error}`, '');
  }

  lines.push('---', '', `_Carte ${card.id} — colonne finale : ${COLUMN_LABELS.archived}._`);

  const slug = card.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const file = path.join(PATHS.docs, `${slug || 'carte'}-${card.id.slice(0, 8)}.md`);
  fs.mkdirSync(PATHS.docs, { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}
