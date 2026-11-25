/**
 * L'HISTORIQUE D'UN AGENT DE SERVICE — la lecture des événements de son SUJET (carte « Sécurité : bilan, écran et
 * historique », 25/11/2026). La mise en mots et la forme vivent dans `shared/src/historique-de-service.ts`.
 *
 * Chaque service relie son agent à un sujet par sa propre table (le projet suivi, le site surveillé, le site
 * sauvegardé, le dossier marketing, la création du Studio, l'agent personnalisé). Ce module retrouve le sujet à partir
 * de l'agent, puis lit les événements datés que le service garde déjà : rien n'est copié ni stocké en plus.
 *
 * JAMAIS D'EXCEPTION : une table absente (base d'essai partielle), un service sans événement ou un agent sans sujet
 * rendent une liste vide — le fil reste celui des messages. Aucune valeur secrète n'y passe : seulement des états,
 * des dates et des titres.
 */
import {
  contientLesMots,
  historiqueEnTexte,
  phraseDAudit,
  reperesTries,
  transitionsDeSurveillance,
  type RepereDeService,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

/** Le sujet d'un agent de service : le service et l'identifiant de l'élément qu'il sert. */
export type SujetDeLAgent =
  | { service: 'securite'; id: string }
  | { service: 'surveillance'; id: string }
  | { service: 'backups'; id: string }
  | { service: 'marketing'; id: string }
  | { service: 'studio'; id: string }
  | { service: 'agents'; id: string };

function une<T>(sql: string, ...params: unknown[]): T | undefined {
  try {
    return getDb().prepare(sql).get(...params) as T | undefined;
  } catch {
    return undefined;
  }
}

function toutes<T>(sql: string, ...params: unknown[]): T[] {
  try {
    return getDb().prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

/** Le sujet que sert cet agent, ou `null` (un agent de carte ordinaire, l'assistant, un agent disparu). */
export function sujetDeLAgent(agentId: string): SujetDeLAgent | null {
  if (!agentId) return null;
  const securite = une<{ project_id: string }>('SELECT project_id FROM securite_projets WHERE agent_id = ?', agentId);
  if (securite) return { service: 'securite', id: securite.project_id };
  const surveille = une<{ id: string }>('SELECT id FROM sites_surveilles WHERE agent_id = ?', agentId);
  if (surveille) return { service: 'surveillance', id: surveille.id };
  const sauvegarde = une<{ id: string }>(
    "SELECT id FROM backup_sites WHERE recette_agent_id = ? OR json_extract(data, '$.assistantId') = ? LIMIT 1",
    agentId,
    agentId,
  );
  if (sauvegarde) return { service: 'backups', id: sauvegarde.id };
  const dossier = une<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'strategie.marketing2.agent.%' AND value = ? LIMIT 1", agentId);
  if (dossier) return { service: 'marketing', id: dossier.key.slice('strategie.marketing2.agent.'.length) };
  const creation = une<{ id: string }>('SELECT id FROM studio_creations WHERE agent_id = ? LIMIT 1', agentId);
  if (creation) return { service: 'studio', id: creation.id };
  const perso = une<{ id: string }>('SELECT id FROM agents_perso WHERE agent_id = ? LIMIT 1', agentId);
  if (perso) return { service: 'agents', id: perso.id };
  return null;
}

/* ------------------------------------------------------------------ */
/* Les événements de chaque service                                     */
/* ------------------------------------------------------------------ */

function reperesDeSecurite(projectId: string): RepereDeService[] {
  const reperes: RepereDeService[] = [];
  for (const a of toutes<{ id: string; lance: number; fini: number | null; declencheur: string; rapport: string | null; erreur: string | null }>(
    'SELECT id, lance, fini, declencheur, rapport, erreur FROM securite_audits WHERE project_id = ? AND fini IS NOT NULL ORDER BY lance DESC LIMIT 200',
    projectId,
  )) {
    let n: number | null = null;
    let graves = 0;
    if (a.rapport) {
      try {
        const constats = (JSON.parse(a.rapport) as { constats?: { gravite?: string }[] }).constats ?? [];
        n = constats.length;
        graves = constats.filter((c) => c.gravite === 'critique' || c.gravite === 'elevee').length;
      } catch {
        n = null;
      }
    }
    reperes.push({ id: `audit:${a.id}`, le: a.fini ?? a.lance, icone: 'audit', texte: phraseDAudit(a.declencheur, n, a.erreur), ...(n === null || graves ? { alerte: true } : {}) });
  }
  const cartes = toutes<{ card_id: string }>('SELECT DISTINCT card_id FROM securite_points WHERE project_id = ? AND card_id IS NOT NULL', projectId);
  for (const { card_id } of cartes) {
    const carte = store.getCard(card_id);
    if (!carte) continue;
    reperes.push({ id: `correction:${carte.id}`, le: carte.createdAt, icone: 'correction', texte: `Correction lancée · « ${carte.title} »` });
  }
  return reperes;
}

function reperesDeSurveillance(siteId: string): RepereDeService[] {
  /* Les derniers contrôles seulement, remis dans l'ordre : une panne se lit à sa TRANSITION, pas à chaque contrôle. */
  const controles = toutes<{ instant: number; etat: string; raison: string | null }>(
    'SELECT instant, etat, raison FROM controles_surveillance WHERE site_id = ? ORDER BY instant DESC LIMIT 3000',
    siteId,
  ).reverse();
  return transitionsDeSurveillance(controles, siteId);
}

function reperesDeSauvegardes(siteId: string): RepereDeService[] {
  return toutes<{ id: string; debut: number; statut: string }>(
    'SELECT id, debut, statut FROM backup_points WHERE site_id = ? ORDER BY debut DESC LIMIT 120',
    siteId,
  ).map((p) =>
    p.statut === 'reussi'
      ? { id: `sauvegarde:${p.id}`, le: p.debut, icone: 'sauvegarde' as const, texte: 'Sauvegarde réussie' }
      : { id: `sauvegarde:${p.id}`, le: p.debut, icone: 'echec' as const, texte: p.statut === 'echec' ? 'Sauvegarde échouée' : `Sauvegarde · ${p.statut}`, alerte: p.statut === 'echec' },
  );
}

function reperesDuMarketing(dossierId: string): RepereDeService[] {
  const reperes: RepereDeService[] = [];
  for (const m of toutes<{ id: string; genre: string; etat: string; cree_le: number; debut: number | null; fin: number | null }>(
    'SELECT id, genre, etat, cree_le, debut, fin FROM strategie_missions WHERE dossier_id = ? ORDER BY cree_le DESC LIMIT 60',
    dossierId,
  )) {
    const quoi = m.genre === 'pre-audit' ? 'Pré-diagnostic' : 'Étude complète';
    reperes.push({ id: `mission:${m.id}:debut`, le: m.debut ?? m.cree_le, icone: 'etude', texte: `${quoi} lancé${m.genre === 'pre-audit' ? '' : 'e'}` });
    if (m.fin) {
      const livre = m.etat === 'completed' || m.etat === 'partially_completed';
      reperes.push({
        id: `mission:${m.id}:fin`,
        le: m.fin,
        icone: livre ? 'etude' : 'echec',
        texte: livre ? `${quoi} livré${m.genre === 'pre-audit' ? '' : 'e'}${m.etat === 'partially_completed' ? ' en partie' : ''}` : `${quoi} interrompu${m.genre === 'pre-audit' ? '' : 'e'}`,
        ...(livre ? {} : { alerte: true }),
      });
    }
  }
  return reperes;
}

function reperesDuStudio(creationId: string): RepereDeService[] {
  return toutes<{ id: string; format: string; etat: string; cree_le: number; termine_le: number | null }>(
    'SELECT id, format, etat, cree_le, termine_le FROM studio_exports WHERE creation_id = ? ORDER BY cree_le DESC LIMIT 80',
    creationId,
  )
    .filter((e) => e.etat === 'pret' || e.etat === 'echoue')
    .map((e) => ({
      id: `export:${e.id}`,
      le: e.termine_le ?? e.cree_le,
      icone: e.etat === 'pret' ? ('export' as const) : ('echec' as const),
      texte: e.etat === 'pret' ? `Export prêt · ${e.format}` : `Export échoué · ${e.format}`,
      ...(e.etat === 'pret' ? {} : { alerte: true }),
    }));
}

function reperesDeLAgentPerso(agentPersoId: string): RepereDeService[] {
  return toutes<{ id: string; date: number; resume: string; issue: string }>(
    'SELECT id, date, resume, issue FROM agents_perso_journal WHERE agent_perso_id = ? ORDER BY date DESC LIMIT 120',
    agentPersoId,
  ).map((j) => ({
    id: `journal:${j.id}`,
    le: j.date,
    icone: 'agent' as const,
    texte: j.resume.replace(/\s+/g, ' ').trim().slice(0, 160),
    ...(j.issue === 'echec' ? { alerte: true } : {}),
  }));
}

/** Les repères du sujet de l'agent, du plus ancien au plus récent. Liste vide pour un agent sans sujet. */
export function reperesDeLAgent(agentId: string): RepereDeService[] {
  const sujet = sujetDeLAgent(agentId);
  if (!sujet) return [];
  try {
    switch (sujet.service) {
      case 'securite':
        return reperesTries(reperesDeSecurite(sujet.id));
      case 'surveillance':
        return reperesTries(reperesDeSurveillance(sujet.id));
      case 'backups':
        return reperesTries(reperesDeSauvegardes(sujet.id));
      case 'marketing':
        return reperesTries(reperesDuMarketing(sujet.id));
      case 'studio':
        return reperesTries(reperesDuStudio(sujet.id));
      case 'agents':
        return reperesTries(reperesDeLAgentPerso(sujet.id));
    }
  } catch (err) {
    log.warn(`historique de l'agent ${agentId} : repères illisibles`, err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* L'outil « historique_du_service »                                   */
/* ------------------------------------------------------------------ */

/** L'agent sert-il un sujet de service ? (l'outil ne se sert qu'à lui) */
export function estAgentDeService(agentId: string): boolean {
  return sujetDeLAgent(agentId) !== null;
}

/**
 * CE QUE L'AGENT RELIT DE SON HISTORIQUE : ses messages — ceux d'avant un « Repartir de zéro » compris, que son
 * contexte ne porte plus — et les repères de son sujet, en texte compact daté. `avant` (ms) remonte dans le temps ;
 * `chercher` garde les éléments qui contiennent tous les mots ; `limite` borne le nombre d'éléments (≤ 50).
 */
export function historiquePourLAgent(agentId: string, options: { avant?: unknown; chercher?: unknown; limite?: unknown } = {}): string {
  const avant = Number(options.avant) > 0 ? Number(options.avant) : Infinity;
  const mots = String(options.chercher ?? '').trim();
  const limite = Math.max(1, Math.min(50, Math.round(Number(options.limite) || 30)));
  const messages = store
    .listMessages(agentId, 5000)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ genre: 'message' as const, le: m.createdAt, role: m.role, texte: String(m.content ?? '') }))
    .filter((m) => m.texte.trim());
  const reperes = reperesDeLAgent(agentId).map((r) => ({ genre: 'repere' as const, le: r.le, texte: r.texte }));
  const tout = [...messages, ...reperes]
    .filter((e) => e.le < avant && (!mots || contientLesMots(e.texte, mots)))
    .sort((a, b) => a.le - b.le);
  const garde = tout.slice(Math.max(0, tout.length - limite));
  const plusAncien = garde[0]?.le;
  const reste = tout.length - garde.length;
  return [
    historiqueEnTexte(garde),
    reste && plusAncien ? `\n(${reste} élément(s) plus ancien(s) : rappelle l'outil avec « avant » = ${plusAncien} pour remonter.)` : '',
  ].join('');
}
