/**
 * LES AGENTS PERSONNALISÉS D'UN PROJET (carte « Agents personnalisés dans les projets », 24/11/2026). Les règles pures
 * vivent dans `shared/src/agents-personnalises.ts` ; ici, le stockage, la naissance, les passages et leurs déclencheurs.
 *
 * SIX PRINCIPES.
 *
 *  1. **UN AGENT DE VOLET.** Chaque agent a sa conversation, portée par une carte SANS branche ni copie (étiquette
 *     `agent-perso`, `ouvrirCarteDAgent`), née rangée comme celle de l'agent de sécurité : aucun tour ne part à la
 *     naissance, un message écrit dans sa page ne rouvre jamais de cadrage, sa carte ramène à sa page.
 *  2. **LA FICHE FAIT FOI, HORS DU FIL.** L'agent l'écrit rubrique par rubrique (outil `agent_fiche`) ; chaque tour
 *     reçoit un relais complet — consigne, fiche, journal récent, événement — au lieu de l'historique de la
 *     conversation. Les gestes verrouillés sont refusés par l'outil, même demandés.
 *  3. **ALLUMER EST LE GESTE.** Aucun passage automatique tant que l'utilisateur n'a pas cliqué « Allumer l'agent »
 *     sur une fiche complète (règle P0 « rien ne s'exécute sans geste explicite »). Publier, envoyer à un client,
 *     payer et programmer restent des gestes humains : l'agent PRÉPARE (réponse sous un bouton « Envoyer au client »,
 *     carte proposée qui arrive dans « Planifié »).
 *  4. **LE RYTHME SE RECALCULE.** Une tournée à la minute lance les passages horaires DUS depuis le dernier passage :
 *     un redémarrage ne double ni ne perd un passage. Aucun minuteur long.
 *  5. **LA DÉPENSE EST BORNÉE.** Un seul passage à la fois par agent ; les événements arrivés pendant un passage sont
 *     FUSIONNÉS en UN passage de suite, et ceux qui arrivent pendant cette suite sont écartés (pas de chaîne : un
 *     agent ne peut pas se relancer en boucle) ; à la limite, l'agent se met en pause et le journal le dit ; sans
 *     compte disponible, le passage attend en file au lieu d'être perdu.
 *  6. **LE JOURNAL NE FAIT QUE S'ALLONGER.** Seule la ligne d'un passage « en cours » reçoit ensuite son issue.
 *
 * Les déclencheurs des services (`declencherLesAgents`) sont appelés HORS de leur chemin : une erreur ici se
 * journalise, elle ne fait jamais échouer une demande client, une surveillance, une mise en ligne ni une sauvegarde.
 */
import {
  LABEL_AGENT_PERSO,
  LIBELLE_DE_SOURCE,
  contexteDeLAgentPerso,
  compteRenduDuPassage,
  ecrireRubrique,
  ficheComplete,
  ficheLue,
  ficheVide,
  limiteAtteinte,
  passageHoraireDu,
  pointDuMatin,
  prochainPassageHoraire,
  debutDeLaPeriode,
  reglagesDuNiveau,
  rubriquesRemplies,
  RUBRIQUES_DE_LA_FICHE,
  type AgentPerso,
  type FicheDAgent,
  type GenreDeLigne,
  type IssueDeLigne,
  type LigneDeJournal,
  type PointDuMatin,
  type SourceDEvenement,
} from '@beluga/shared';
import { bus } from './bus.js';
import { reglageDeConversation } from './puissance-des-agents.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

/* ------------------------------------------------------------------ */
/* Lignes de base                                                      */
/* ------------------------------------------------------------------ */

interface LigneAgent {
  id: string;
  project_id: string;
  agent_id: string | null;
  card_id: string | null;
  fiche: string;
  actif: number;
  cree_le: number;
  mis_a_jour_le: number;
  allume_le: number | null;
  dernier_horaire: number | null;
}

interface LigneJournal {
  id: string;
  agent_perso_id: string;
  project_id: string;
  date: number;
  genre: string;
  source: string | null;
  resume: string;
  issue: string;
  jetons: number | null;
}

function ficheDeLigne(l: LigneAgent): FicheDAgent {
  try {
    return ficheLue(JSON.parse(l.fiche));
  } catch {
    return ficheVide();
  }
}

function ligneDeJournal(l: LigneJournal): LigneDeJournal {
  return {
    id: l.id,
    agentPersoId: l.agent_perso_id,
    date: l.date,
    genre: l.genre as GenreDeLigne,
    ...(l.source ? { source: l.source as SourceDEvenement } : {}),
    resume: l.resume,
    issue: l.issue as IssueDeLigne,
    ...(l.jetons !== null && l.jetons !== undefined ? { jetons: l.jetons } : {}),
  };
}

function ligneAgent(id: string): LigneAgent | null {
  return (getDb().prepare('SELECT * FROM agents_perso WHERE id = ?').get(id) as LigneAgent | undefined) ?? null;
}

/** Le journal d'un agent, du plus récent au plus ancien. */
export function journalDeLAgent(id: string, limite = 200): LigneDeJournal[] {
  return (getDb().prepare('SELECT * FROM agents_perso_journal WHERE agent_perso_id = ? ORDER BY date DESC, rowid DESC LIMIT ?').all(id, limite) as LigneJournal[]).map(
    ligneDeJournal,
  );
}

/** Ajoute une ligne au journal (ajout seul). Rend son identifiant. */
function noter(l: LigneAgent, ligne: { genre: GenreDeLigne; source?: SourceDEvenement; resume: string; issue: IssueDeLigne; date?: number }): string {
  const id = store.newId();
  getDb()
    .prepare('INSERT INTO agents_perso_journal (id, agent_perso_id, project_id, date, genre, source, resume, issue, jetons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)')
    .run(id, l.id, l.project_id, ligne.date ?? Date.now(), ligne.genre, ligne.source ?? null, ligne.resume.slice(0, 400), ligne.issue);
  return id;
}

/** La SEULE réécriture permise : l'issue d'un passage « en cours ». */
function finirLaLigne(ligneId: string, resume: string, issue: IssueDeLigne, jetons?: number): void {
  getDb()
    .prepare("UPDATE agents_perso_journal SET resume = ?, issue = ?, jetons = ? WHERE id = ? AND issue = 'en_cours'")
    .run(resume.slice(0, 400), issue, jetons ?? null, ligneId);
}

/** Prévenir les écrans ouverts : ils relisent ce qu'ils montrent (aucune donnée ne voyage dans l'événement). */
function diffuser(projectId: string): void {
  bus.emit({ type: 'agentsPerso', projectId });
}

/* ------------------------------------------------------------------ */
/* Ce qui attend un geste                                              */
/* ------------------------------------------------------------------ */

/**
 * LES DEMANDES D'ACCORD ENCORE OUVERTES DE L'AGENT : ses cartes proposées non tranchées, et ses questions ouvertes
 * (dont les réponses préparées sous « Envoyer au client »). Ce sont elles qui font « À valider » et allument la cloche
 * (`store.decisionsEnAttente`, qui lit les agents personnalisés même carte rangée).
 */
export function attentesDeLAgent(agentId: string | null): number {
  if (!agentId) return 0;
  const db = getDb();
  const propositions = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM proposals p JOIN messages m ON m.id = p.message_id WHERE m.agent_id = ? AND p.decision = 'pending'`,
      )
      .get(agentId) as { n: number }
  ).n;
  let questions = 0;
  for (const l of db.prepare("SELECT json_extract(data, '$.questions') AS q FROM messages WHERE agent_id = ? AND a_questions = 1").all(agentId) as { q: string | null }[]) {
    try {
      for (const question of (l.q ? JSON.parse(l.q) : []) as { answer?: unknown; cancelled?: boolean }[]) if (!question.answer && !question.cancelled) questions++;
    } catch {
      /* message illisible : ignoré */
    }
  }
  return propositions + questions;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Les passages qui tournent, et ceux qui attendent un compte. */
const enPassage = new Map<string, { ligneId: string; depuis: number; suite: boolean }>();
/** Les événements arrivés pendant un passage : UN passage de suite les reprendra. */
const enSuite = new Map<string, { genre: GenreDeLigne; source?: SourceDEvenement; details: string[] }>();
/** Les passages qui attendent un compte avec du quota (rejoués par la tournée). */
const enAttenteDeQuota = new Map<string, { genre: GenreDeLigne; source?: SourceDEvenement; details?: string; ligneId: string }>();

function agentDeLigne(l: LigneAgent, maintenant = Date.now()): AgentPerso {
  const fiche = ficheDeLigne(l);
  const journal = journalDeLAgent(l.id, 60);
  const derniere = journal.find((j) => j.issue !== 'en_cours') ?? null;
  const passages = journal.filter((j) => j.genre === 'manuel' || j.genre === 'horaire' || j.genre === 'evenement' || j.genre === 'veille');
  return {
    id: l.id,
    projectId: l.project_id,
    agentId: l.agent_id,
    cardId: l.card_id,
    fiche,
    actif: l.actif === 1,
    creeLe: l.cree_le,
    misAJourLe: l.mis_a_jour_le,
    allumeLe: l.allume_le,
    dernierPassage: passages[0]?.date ?? null,
    dernierPassageHoraire: l.dernier_horaire,
    enPassage: enPassage.has(l.id),
    attendUnCompte: enAttenteDeQuota.has(l.id),
    attentes: attentesDeLAgent(l.agent_id),
    derniereAction: derniere ? { date: derniere.date, resume: derniere.resume, issue: derniere.issue } : null,
    prochainPassage: l.actif === 1 && ficheComplete(fiche) ? prochainPassageHoraire(fiche.declencheurs, maintenant) : null,
    enPauseLimite: ficheComplete(fiche) && limiteAtteinte(journalDeLaPeriode(l.id, fiche, maintenant), fiche.limite, maintenant),
  };
}

/** Le journal de la période de la limite (assez pour la compter, jamais tout l'historique). */
function journalDeLaPeriode(id: string, fiche: FicheDAgent, maintenant: number): LigneDeJournal[] {
  if (!fiche.limite || fiche.limite === 'aucune') return [];
  const debut = debutDeLaPeriode(fiche.limite.periode, maintenant);
  return (getDb().prepare('SELECT * FROM agents_perso_journal WHERE agent_perso_id = ? AND date >= ?').all(id, debut) as LigneJournal[]).map(ligneDeJournal);
}

/** Les agents d'un projet, du plus ancien au plus récent. */
export function listerAgents(projectId: string, maintenant = Date.now()): AgentPerso[] {
  return (getDb().prepare('SELECT * FROM agents_perso WHERE project_id = ? ORDER BY cree_le ASC').all(projectId) as LigneAgent[]).map((l) =>
    agentDeLigne(l, maintenant),
  );
}

/** Un agent de ce projet, ou une erreur en clair (un identifiant d'un autre projet est refusé). */
export function lireAgent(projectId: string, id: string): AgentPerso {
  const l = ligneAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  return agentDeLigne(l);
}

/** Le point du matin du projet. */
export function pointDuMatinDuProjet(projectId: string, maintenant = Date.now()): PointDuMatin {
  const agents = listerAgents(projectId, maintenant);
  const journal = (
    getDb().prepare('SELECT * FROM agents_perso_journal WHERE project_id = ? AND date >= ?').all(projectId, maintenant - 2 * 86_400_000) as LigneJournal[]
  ).map(ligneDeJournal);
  return pointDuMatin(agents, journal, maintenant);
}

/**
 * LES AGENTS DE PLUSIEURS PROJETS (onglet « Agents » des Tableaux de bord, 24/11/2026) : une seule lecture, du plus
 * ancien au plus récent. Le démon passe les projets que la session a le droit de voir — rien d'autre ne filtre ici.
 */
export function listerTousLesAgents(projectIds: readonly string[], maintenant = Date.now()): AgentPerso[] {
  if (!projectIds.length) return [];
  const trous = projectIds.map(() => '?').join(', ');
  return (getDb().prepare(`SELECT * FROM agents_perso WHERE project_id IN (${trous}) ORDER BY cree_le ASC`).all(...projectIds) as LigneAgent[]).map((l) =>
    agentDeLigne(l, maintenant),
  );
}

/** Le point du matin de ces projets réunis : chaque entrée cite son agent, dont la liste dit le projet. */
export function pointDuMatinGlobal(projectIds: readonly string[], maintenant = Date.now()): PointDuMatin {
  const agents = listerTousLesAgents(projectIds, maintenant);
  const trous = projectIds.map(() => '?').join(', ');
  const journal = projectIds.length
    ? (
        getDb()
          .prepare(`SELECT * FROM agents_perso_journal WHERE project_id IN (${trous}) AND date >= ?`)
          .all(...projectIds, maintenant - 2 * 86_400_000) as LigneJournal[]
      ).map(ligneDeJournal)
    : [];
  return pointDuMatin(agents, journal, maintenant);
}

/** L'agent personnalisé dont cet agent de conversation est la voix, ou `null`. */
export function agentPersoDeLAgent(agentId: string | null | undefined): LigneAgent | null {
  if (!agentId) return null;
  try {
    return (getDb().prepare('SELECT * FROM agents_perso WHERE agent_id = ?').get(agentId) as LigneAgent | undefined) ?? null;
  } catch {
    return null;
  }
}

export function estAgentPerso(agentId: string | null | undefined): boolean {
  return agentPersoDeLAgent(agentId) !== null;
}

/* ------------------------------------------------------------------ */
/* Naissance, fiche, interrupteur                                      */
/* ------------------------------------------------------------------ */

/**
 * UN NOUVEL AGENT : sa ligne « Nouvel agent » (brouillon) et sa conversation, sa carte d'abord, rangée aussitôt —
 * aucun tour ne part. L'agent ouvre l'échange quand l'utilisateur lui écrit (la page le lui propose).
 */
export async function creerAgent(projectId: string, maintenant = Date.now()): Promise<AgentPerso> {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  if (projet.archived) throw new Error('un projet archivé ne reçoit pas de nouvel agent');
  const id = store.newId();
  getDb()
    .prepare('INSERT INTO agents_perso (id, project_id, agent_id, card_id, fiche, actif, cree_le, mis_a_jour_le) VALUES (?, ?, NULL, NULL, ?, 0, ?, ?)')
    .run(id, projectId, JSON.stringify(ficheVide()), maintenant, maintenant);
  const l = ligneAgent(id)!;
  noter(l, { genre: 'creation', resume: 'Agent créé : sa fiche se remplit dans la conversation.', issue: 'note', date: maintenant });
  await assurerLaConversation(id);
  diffuser(projectId);
  return lireAgent(projectId, id);
}

/** La conversation de l'agent : créée une fois, comme celle de l'agent de sécurité (MEM-7506). */
async function assurerLaConversation(id: string): Promise<string> {
  const l = ligneAgent(id);
  if (!l) throw new Error('agent introuvable');
  if (l.agent_id && store.getAgent(l.agent_id)) return l.agent_id;
  const projet = store.getProject(l.project_id);
  if (!projet) throw new Error('projet introuvable');
  const [{ ouvrirCarteDAgent, rangerCarteDAgent }, { catalogueMoteurs }] = await Promise.all([
    import('./carte-d-agent-demon.js'),
    import('./catalogue-moteurs.js'),
  ]);
  const catalogue = await catalogueMoteurs().catch(() => []);
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  const reglages = reglageDeConversation(claude);
  const relue = ligneAgent(id);
  if (relue?.agent_id && store.getAgent(relue.agent_id)) return relue.agent_id;
  const nom = ficheDeLigne(l).nom;
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: l.project_id,
    titre: nom,
    description: `Un agent personnalisé de « ${projet.name} » (onglet « Agents ») : sa fiche se remplit dans sa conversation, il travaille seul une fois allumé.`,
    labels: [LABEL_AGENT_PERSO],
    role: 'task',
    run: { engine: 'claude', model: reglages.model, thinking: reglages.thinking as any, ...(reglages.niveau ? { niveau: reglages.niveau } : {}) },
  });
  rangerCarteDAgent(card.id, agentId, 'archived', null);
  getDb().prepare('UPDATE agents_perso SET agent_id = ?, card_id = ? WHERE id = ?').run(agentId, card.id, id);
  return agentId;
}

/** Le nom de l'agent suit sur sa carte et sa conversation (la colonne « En cours », la cloche le montrent). */
function renommer(l: LigneAgent, nom: string): void {
  const carte = l.card_id ? store.getCard(l.card_id) : null;
  if (carte && carte.title !== nom) bus.emit({ type: 'card.upsert', card: store.saveCard({ ...carte, title: nom }) });
  const agent = l.agent_id ? store.getAgent(l.agent_id) : null;
  if (agent && agent.title !== nom) bus.emit({ type: 'agent.upsert', agent: store.saveAgent({ ...agent, title: nom }) });
}

/**
 * L'OUTIL `agent_fiche` ÉCRIT UNE RUBRIQUE. Rend le texte de l'outil : la fiche à jour, ou le refus en clair (geste
 * verrouillé, valeur secrète, forme illisible).
 */
export function ecrireRubriqueDeLAgent(agentId: string, rubrique: string, valeur: unknown): { ok: boolean; texte: string } {
  const l = agentPersoDeLAgent(agentId);
  if (!l) return { ok: false, texte: 'Seul un agent personnalisé a une fiche.' };
  const fiche = ficheDeLigne(l);
  const r = ecrireRubrique(fiche, rubrique, valeur);
  if (!r.ok) {
    if (/^REFUSÉ/.test(r.raison)) noter(l, { genre: 'refus', resume: r.raison.replace(/^REFUSÉ : /, 'Refusé : ').slice(0, 300), issue: 'note' });
    diffuser(l.project_id);
    return { ok: false, texte: r.raison };
  }
  getDb().prepare('UPDATE agents_perso SET fiche = ?, mis_a_jour_le = ? WHERE id = ?').run(JSON.stringify(r.fiche), Date.now(), l.id);
  if (rubrique === 'nom') renommer(l, r.fiche.nom);
  diffuser(l.project_id);
  const complete = ficheComplete(r.fiche);
  return {
    ok: true,
    texte: complete
      ? `Rubrique « ${rubrique} » écrite. LA FICHE EST COMPLÈTE : dis-le en une phrase et invite l’utilisateur à cliquer « Allumer l’agent » (tu n’es PAS allumé avant ce clic).`
      : `Rubrique « ${rubrique} » écrite. Il reste à définir : ${RUBRIQUES_DE_LA_FICHE.filter((x) => !rubriquesRemplies(r.fiche).includes(x)).join(', ')}. Une question à la fois.`,
  };
}

/** La fiche en clair, pour l'outil (« lire »). */
export function lireLaFicheDeLAgent(agentId: string): string {
  const l = agentPersoDeLAgent(agentId);
  if (!l) return 'Seul un agent personnalisé a une fiche.';
  return JSON.stringify({ fiche: ficheDeLigne(l), actif: l.actif === 1, complete: ficheComplete(ficheDeLigne(l)) }, null, 2);
}

/** « Allumer l'agent » : le geste qui autorise ses passages. Refusé tant que la fiche n'est pas complète. */
export function allumer(projectId: string, id: string, maintenant = Date.now()): AgentPerso {
  const l = ligneAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  if (!ficheComplete(ficheDeLigne(l))) throw new Error('La fiche de l’agent n’est pas complète : terminez-la dans la conversation.');
  if (l.actif !== 1) {
    getDb().prepare('UPDATE agents_perso SET actif = 1, allume_le = ?, mis_a_jour_le = ? WHERE id = ?').run(maintenant, maintenant, id);
    noter(l, { genre: 'allumage', resume: 'Allumé par l’utilisateur.', issue: 'note', date: maintenant });
    diffuser(projectId);
  }
  return lireAgent(projectId, id);
}

/** « Mettre en pause » : plus aucun passage automatique ; un passage en cours finit son tour. */
export function eteindre(projectId: string, id: string, maintenant = Date.now()): AgentPerso {
  const l = ligneAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  if (l.actif === 1) {
    getDb().prepare('UPDATE agents_perso SET actif = 0, mis_a_jour_le = ? WHERE id = ?').run(maintenant, id);
    noter(l, { genre: 'extinction', resume: 'Mis en pause par l’utilisateur.', issue: 'note', date: maintenant });
  }
  enSuite.delete(id);
  const attente = enAttenteDeQuota.get(id);
  if (attente) {
    finirLaLigne(attente.ligneId, 'Passage abandonné : l’agent a été mis en pause.', 'ignore');
    enAttenteDeQuota.delete(id);
  }
  diffuser(projectId);
  return lireAgent(projectId, id);
}

/** Retirer un agent : refusé pendant un passage ; ses questions ouvertes se ferment, sa conversation reste archivée. */
export async function supprimer(projectId: string, id: string): Promise<void> {
  const l = ligneAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  if (enPassage.has(id)) throw new Error('Cet agent travaille : attendez la fin de son passage.');
  if (l.agent_id) {
    const { fermerLesQuestionsDeLAgent } = await import('./fermeture-questions.js');
    fermerLesQuestionsDeLAgent(l.agent_id);
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM agents_perso_journal WHERE agent_perso_id = ?').run(id);
    db.prepare('DELETE FROM agents_perso WHERE id = ?').run(id);
  })();
  enSuite.delete(id);
  enAttenteDeQuota.delete(id);
  diffuser(projectId);
}

/* ------------------------------------------------------------------ */
/* Le contexte de chaque tour                                          */
/* ------------------------------------------------------------------ */

/** Le passage en cours de chaque agent, lu par le contexte du tour. */
const passageDuTour = new Map<string, { genre: GenreDeLigne; source?: SourceDEvenement; details?: string }>();

/**
 * LE RELAIS DE L'AGENT, redit à CHAQUE message (le contexte du tour, jamais une bulle) : consigne, fiche, journal
 * récent et, pendant un passage, son déclencheur et son détail. Rend `undefined` pour tout autre agent.
 */
export function contexteDeLAgentPersoDuTour(agentId: string): string | undefined {
  const l = agentPersoDeLAgent(agentId);
  if (!l) return undefined;
  const projet = store.getProject(l.project_id);
  return contexteDeLAgentPerso({
    projet: projet?.name ?? l.project_id,
    fiche: ficheDeLigne(l),
    actif: l.actif === 1,
    journal: journalDeLAgent(l.id, 8),
    passage: passageDuTour.get(l.id) ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Les passages                                                        */
/* ------------------------------------------------------------------ */

export type IssueDuDeclenchement = 'parti' | 'fusionne' | 'ecarte' | 'eteint' | 'limite' | 'attente-quota' | 'incomplet';

/** L'envoi d'un tour, remplaçable par les contrôles (aucun moteur). */
type Envoi = (
  agentId: string,
  texte: string,
  options: {
    context: string;
    /** Le déclencheur du passage : la réponse le porte, et le fil l'écrit en jaune (26/11/2026). */
    passage?: { genre: 'manuel' | 'horaire' | 'evenement' | 'veille'; source?: string };
    onComplete: (texte: string, ok: boolean, mesure: { usage?: { inputTokens?: number; outputTokens?: number } }, fin?: { arretDemande?: boolean }) => void;
  },
) => Promise<void>;
let envoi: Envoi = async (agentId, texte, options) => {
  const { sendPrompt } = await import('./runtime.js');
  await sendPrompt(agentId, texte, {
    silent: true,
    // ALLUMER EST LE GESTE HUMAIN qui autorise ce tour : la carte rangée de l'agent repasse « En cours » pendant
    // qu'il travaille, puis retombe « Archivé » (`colonneAuDemarrage`, agent attitré).
    demandeur: 'humain',
    template: 'none',
    context: options.context,
    ...(options.passage ? { passageAutomatique: options.passage } : {}),
    onComplete: options.onComplete as any,
  });
};
/** Le compte disponible pour le moteur de l'agent, remplaçable par les contrôles. */
type ChoixDuCompte = (agentId: string) => Promise<boolean>;
let compteDisponible: ChoixDuCompte = async (agentId) => {
  /* LE GARDE D'ESSAI : un démon jetable reprend les comptes de la machine (`bootstrapAccounts`) — sans ce garde, un
     contrôle qui clique « Lancer maintenant » ferait partir un VRAI tour. Le passage attend alors un compte. */
  if (process.env.BELUGA_AGENTS_PERSO_SANS_MOTEUR === '1') return false;
  const agent = store.getAgent(agentId);
  if (!agent) return false;
  const { pickAccount } = await import('./accounts.js');
  return (await pickAccount(agent.run.engine)) !== null;
};

/** Pour les contrôles seulement. */
export function remplacerLEnvoi(autre: Envoi | null, compte: ChoixDuCompte | null = null): void {
  if (autre) envoi = autre;
  if (compte) compteDisponible = compte;
}

function phraseDuPassage(genre: GenreDeLigne, source?: SourceDEvenement): string {
  if (genre === 'evenement' && source) return `Passage : ${LIBELLE_DE_SOURCE[source].toLowerCase()}.`;
  if (genre === 'horaire') return 'Passage à heure fixe.';
  if (genre === 'veille') return 'Passage : ta surveillance s’est levée.';
  return 'Passage lancé à la main (« Lancer maintenant »).';
}

/**
 * UN PASSAGE. `manuel` part même éteint (c'est le clic) mais jamais sur une fiche incomplète ; tout autre passage
 * exige l'agent allumé. Un passage déjà en cours FUSIONNE ce qui arrive en une seule suite.
 */
export async function passer(
  id: string,
  declencheur: { genre: GenreDeLigne; source?: SourceDEvenement; details?: string },
  maintenant = Date.now(),
): Promise<IssueDuDeclenchement> {
  const l = ligneAgent(id);
  if (!l) return 'ecarte';
  const fiche = ficheDeLigne(l);
  if (!ficheComplete(fiche)) return 'incomplet';
  if (declencheur.genre !== 'manuel' && l.actif !== 1) return 'eteint';
  const courant = enPassage.get(id);
  if (courant || enAttenteDeQuota.has(id)) {
    // PENDANT UNE SUITE, rien ne s'accumule plus : un agent ne se relance pas en chaîne.
    if (courant?.suite) return 'ecarte';
    // Un second clic « Lancer maintenant » rejoint le passage qui tourne ou attend : il n'en commande pas un autre.
    if (declencheur.genre === 'manuel') return 'fusionne';
    const suite = enSuite.get(id) ?? { genre: declencheur.genre, ...(declencheur.source ? { source: declencheur.source } : {}), details: [] };
    if (declencheur.details) suite.details.push(declencheur.details);
    enSuite.set(id, suite);
    return 'fusionne';
  }
  return lancerLePassage(l, fiche, declencheur, false, maintenant);
}

async function lancerLePassage(
  l: LigneAgent,
  fiche: FicheDAgent,
  declencheur: { genre: GenreDeLigne; source?: SourceDEvenement; details?: string },
  suite: boolean,
  maintenant: number,
  ligneDejaPosee?: string,
): Promise<IssueDuDeclenchement> {
  if (limiteAtteinte(journalDeLaPeriode(l.id, fiche, maintenant), fiche.limite, maintenant)) {
    // UNE SEULE LIGNE « en pause » PAR PÉRIODE : la suivante ne redit rien.
    const debut = fiche.limite && fiche.limite !== 'aucune' ? debutDeLaPeriode(fiche.limite.periode, maintenant) : maintenant;
    const dejaDit = getDb().prepare("SELECT 1 FROM agents_perso_journal WHERE agent_perso_id = ? AND genre = 'limite' AND date >= ?").get(l.id, debut);
    if (ligneDejaPosee) finirLaLigne(ligneDejaPosee, 'Passage écarté : la limite est atteinte.', 'ignore');
    if (!dejaDit) noter(l, { genre: 'limite', resume: 'Limite atteinte : l’agent est en pause jusqu’à la période suivante.', issue: 'pause', date: maintenant });
    diffuser(l.project_id);
    return 'limite';
  }
  const agentId = await assurerLaConversation(l.id).catch(() => null);
  if (!agentId) return 'ecarte';
  // LA LIGNE D'ABORD : un second événement qui arrive pendant l'attente du compte fusionne au lieu de doubler.
  const ligneId =
    ligneDejaPosee ??
    noter(l, { genre: declencheur.genre, ...(declencheur.source ? { source: declencheur.source } : {}), resume: 'Passage en cours…', issue: 'en_cours', date: maintenant });
  enPassage.set(l.id, { ligneId, depuis: maintenant, suite });
  if (declencheur.genre === 'horaire') getDb().prepare('UPDATE agents_perso SET dernier_horaire = ? WHERE id = ?').run(maintenant, l.id);
  diffuser(l.project_id);

  let disponible = false;
  try {
    disponible = await compteDisponible(agentId);
  } catch {
    disponible = false;
  }
  if (!disponible) {
    // SANS QUOTA, LE PASSAGE ATTEND EN FILE : la tournée le rejoue dès qu'un compte revient.
    enPassage.delete(l.id);
    enAttenteDeQuota.set(l.id, { ...declencheur, ligneId });
    getDb().prepare("UPDATE agents_perso_journal SET resume = ? WHERE id = ? AND issue = 'en_cours'").run('En attente d’un compte avec du quota.', ligneId);
    diffuser(l.project_id);
    return 'attente-quota';
  }

  passageDuTour.set(l.id, declencheur);
  let fini = false;
  const terminer = (texte: string, ok: boolean, jetons?: number, arret?: boolean) => {
    if (fini) return;
    fini = true;
    passageDuTour.delete(l.id);
    enPassage.delete(l.id);
    const { resume, issue } = ok ? compteRenduDuPassage(texte) : { resume: arret ? 'Passage arrêté à la main.' : `Passage tombé : ${(texte || 'raison inconnue').slice(0, 180)}`, issue: 'panne' as IssueDeLigne };
    // Une réponse préparée ou une carte proposée pendant le passage : « À valider », quoi que dise la phrase.
    const issueFinale: IssueDeLigne = issue === 'panne' ? 'panne' : attentesDeLAgent(agentId) > 0 ? 'a_valider' : issue;
    finirLaLigne(ligneId, resume, issueFinale, jetons);
    diffuser(l.project_id);
    // LES ÉVÉNEMENTS FUSIONNÉS : un seul passage de suite (jamais après une suite).
    const enAttente = enSuite.get(l.id);
    enSuite.delete(l.id);
    if (enAttente && !suite) {
      const relue = ligneAgent(l.id);
      if (relue && relue.actif === 1) {
        void lancerLePassage(relue, ficheDeLigne(relue), { genre: enAttente.genre, ...(enAttente.source ? { source: enAttente.source } : {}), details: enAttente.details.join('\n') }, true, Date.now()).catch(
          (err) => log.warn(`agent personnalisé ${l.id} : passage de suite impossible`, err),
        );
      }
    }
  };
  try {
    await envoi(agentId, `${phraseDuPassage(declencheur.genre, declencheur.source)} Fais ta mission dans ton cadre, dis où en est ton objectif et la prochaine étape que tu proposes, puis termine par ta phrase de compte rendu.`, {
      context: contexteDeLAgentPersoDuTour(agentId) ?? '',
      ...(declencheur.genre === 'manuel' || declencheur.genre === 'horaire' || declencheur.genre === 'evenement' || declencheur.genre === 'veille'
        ? { passage: { genre: declencheur.genre, ...(declencheur.source ? { source: declencheur.source } : {}) } }
        : {}),
      onComplete: (texte, ok, mesure, fin) => {
        const usage = mesure?.usage;
        terminer(texte, ok && !fin?.arretDemande, usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : undefined, fin?.arretDemande);
      },
    });
  } catch (err: any) {
    terminer(err?.message ?? String(err), false);
  }
  return 'parti';
}

/** « Lancer maintenant » : le clic de l'utilisateur. */
export async function lancerMaintenant(projectId: string, id: string): Promise<IssueDuDeclenchement> {
  const l = ligneAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  if (!ficheComplete(ficheDeLigne(l))) throw new Error('La fiche de l’agent n’est pas complète : terminez-la dans la conversation.');
  return passer(id, { genre: 'manuel' });
}

/**
 * LES ÉVÉNEMENTS DES SERVICES. Appelé HORS du chemin de chaque service (`void` + `.catch`) : jamais d'exception.
 * `origineAgentId` : l'agent qui a produit l'événement, s'il est connu — il ne se relance pas lui-même.
 */
export async function declencherLesAgents(
  projectId: string | null | undefined,
  source: SourceDEvenement,
  details = '',
  origineAgentId?: string | null,
): Promise<number> {
  if (!projectId) return 0;
  try {
    const lignes = getDb().prepare('SELECT * FROM agents_perso WHERE project_id = ? AND actif = 1').all(projectId) as LigneAgent[];
    let partis = 0;
    for (const l of lignes) {
      if (origineAgentId && l.agent_id === origineAgentId) continue;
      const fiche = ficheDeLigne(l);
      if (!fiche.declencheurs.some((d) => d.genre === 'evenement' && d.source === source)) continue;
      const issue = await passer(l.id, { genre: 'evenement', source, details });
      if (issue === 'parti' || issue === 'fusionne') partis++;
    }
    return partis;
  } catch (err) {
    log.warn(`agents personnalisés : événement ${source} non transmis`, err);
    return 0;
  }
}

/** Le même appel, lancé sans attendre : pour les services, qui ne doivent jamais en dépendre. */
export function signalerAuxAgents(projectId: string | null | undefined, source: SourceDEvenement, details = '', origineAgentId?: string | null): void {
  if (!projectId) return;
  void declencherLesAgents(projectId, source, details, origineAgentId).catch(() => undefined);
}

/** Une veille posée par l'agent sur sa carte s'est levée : un passage « veille ». */
export function apresLaLeveeDUneVeille(cardId: string, raison: string): boolean {
  try {
    const l = getDb().prepare('SELECT * FROM agents_perso WHERE card_id = ?').get(cardId) as LigneAgent | undefined;
    if (!l) return false;
    void passer(l.id, { genre: 'veille', details: raison }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* La tournée                                                          */
/* ------------------------------------------------------------------ */

/** Un passage resté « en cours » plus longtemps que ceci, sans agent au travail, est dit tombé. */
const PASSAGE_OUBLIE_MS = 45 * 60 * 1000;

/** Lance les passages horaires dus, rejoue ceux qui attendaient un compte, referme ceux que rien ne fermera. */
export async function tourneeDesAgents(maintenant = Date.now()): Promise<number> {
  const db = getDb();
  let lances = 0;
  for (const l of db.prepare('SELECT * FROM agents_perso WHERE actif = 1').all() as LigneAgent[]) {
    if (enPassage.has(l.id) || enAttenteDeQuota.has(l.id)) continue;
    const projet = store.getProject(l.project_id);
    if (!projet || projet.archived) continue;
    const fiche = ficheDeLigne(l);
    if (!ficheComplete(fiche)) continue;
    if (!passageHoraireDu(fiche.declencheurs, l.dernier_horaire, l.allume_le ?? l.cree_le, maintenant)) continue;
    if ((await passer(l.id, { genre: 'horaire' }, maintenant)) !== 'ecarte') lances++;
  }
  for (const [id, attente] of [...enAttenteDeQuota]) {
    const l = ligneAgent(id);
    if (!l || l.actif !== 1) {
      enAttenteDeQuota.delete(id);
      finirLaLigne(attente.ligneId, 'Passage abandonné.', 'ignore');
      continue;
    }
    enAttenteDeQuota.delete(id);
    await lancerLePassage(l, ficheDeLigne(l), attente, false, maintenant, attente.ligneId);
  }
  for (const [id, courant] of [...enPassage]) {
    if (maintenant - courant.depuis < PASSAGE_OUBLIE_MS) continue;
    const l = ligneAgent(id);
    const agent = l?.agent_id ? store.getAgent(l.agent_id) : null;
    if (agent && (agent.status === 'running' || agent.status === 'starting')) continue;
    enPassage.delete(id);
    passageDuTour.delete(id);
    finirLaLigne(courant.ligneId, 'Passage tombé : le tour n’a jamais rendu sa réponse.', 'panne');
    if (l) diffuser(l.project_id);
  }
  return lances;
}

const BATTEMENT_MS = 60 * 1000;

/** Au démarrage : un passage coupé par l'arrêt se dit tombé, puis la tournée part à la minute. */
export function demarrerLesAgentsPerso(): NodeJS.Timeout {
  try {
    getDb()
      .prepare("UPDATE agents_perso_journal SET issue = 'panne', resume = 'Passage interrompu par un redémarrage du serveur.' WHERE issue = 'en_cours'")
      .run();
  } catch (err) {
    log.warn('agents personnalisés : remise en ordre des passages interrompus impossible', err);
  }
  let enTournee = false;
  const tour = () => {
    if (enTournee) return;
    enTournee = true;
    void tourneeDesAgents()
      .catch((err) => log.warn('agents personnalisés : tournée impossible', err))
      .finally(() => {
        enTournee = false;
      });
  };
  setTimeout(tour, 30_000).unref?.();
  const minuteur = setInterval(tour, BATTEMENT_MS);
  minuteur.unref?.();
  return minuteur;
}

/** Pour les contrôles : oublier l'état en mémoire (passages, suites, attentes). */
export function oublierLEtatEnMemoire(): void {
  enPassage.clear();
  enSuite.clear();
  enAttenteDeQuota.clear();
  passageDuTour.clear();
}
