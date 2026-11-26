/**
 * L'ÉQUIPE D'AGENTS D'UN PROJET ET D'UN GROUPE (carte « Beluga piloté par des agents », 26/11/2026). Les règles pures
 * vivent dans `shared/src/equipe-d-agents.ts` ; ici, le SEMIS des équipes, le JOURNAL DES ÉCHANGES, les messages de
 * l'utilisateur à l'équipe et les DEMANDES entre collègues (outil `equipe`).
 *
 * CINQ PRINCIPES.
 *
 *  1. **UN MEMBRE EST UN AGENT PERSONNALISÉ.** Même table, même fiche, même journal, mêmes passages
 *     (`agents-personnalises.ts`) ; l'équipe y ajoute un métier, un portrait, une couleur, des outils et l'interrupteur
 *     « libre avec ses collègues ». Un agent de GROUPE est un agent dont le projet est le projet-regroupement.
 *  2. **LE SEMIS EST IDEMPOTENT.** Au démarrage et à chaque lecture d'une équipe, on sème les rôles par défaut qui
 *     MANQUENT — jamais un second « com » là où Eliot existe déjà, jamais un rôle que l'utilisateur a retiré.
 *     Un membre semé naît ÉTEINT et SANS conversation : il ne coûte rien tant qu'on ne lui parle pas.
 *  3. **LE CODE PASSE PAR UNE TÂCHE.** Demander quelque chose à l'agent de développement, c'est poser une tâche dans le
 *     projet. Elle part seule si l'agent est libre avec ses collègues (décision de l'utilisateur), sinon elle attend un
 *     clic dans « Planifié ». Une demande de l'UTILISATEUR ouvre la tâche en cadrage, comme « Nouvelle tâche ».
 *  4. **RIEN NE TOURNE EN ROND.** Profondeur de chaîne, échanges par heure entre deux agents et dans l'équipe : la garde
 *     pure `refusDEchange` refuse avant tout envoi ; un agent occupé ne met pas son collègue en file, il le lui dit.
 *  5. **LE JOURNAL NE FAIT QUE S'ALLONGER.** Chaque échange (de, à, texte, tâche née) s'ajoute ; il nourrit la discussion
 *     de l'équipe, les liaisons de la table et le relais de chaque agent.
 *
 * PUBLIER, DÉPLOYER, METTRE EN PRODUCTION, ENVOYER À UN CLIENT, PAYER, SUPPRIMER restent hors de ce module : aucun
 * chemin d'ici ne les déclenche (contrôle : `server/src/test/equipe-d-agents.test.ts`).
 */
import {
  CONSIGNE_DU_ROLE,
  EQUIPE_DU_GROUPE,
  LIBELLE_DU_ROLE,
  TOUTE_L_EQUIPE,
  VOUS,
  couleurLue,
  destinataireDuMessage,
  estUnRegroupement,
  etatDuMembre,
  ficheComplete,
  ficheDUnMembre,
  graineDe,
  membresASemer,
  portraitConnu,
  portraitLibre,
  refusDEchange,
  roleDEquipierLu,
  roleDevine,
  OUTILS_D_AGENT,
  ROLES_D_EQUIPIER,
  type AgentPerso,
  type EchangeDAgents,
  type RoleDEquipier,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import * as perso from './agents-personnalises.js';

/* ------------------------------------------------------------------ */
/* Le semis                                                            */
/* ------------------------------------------------------------------ */

interface LigneSemis {
  project_id: string;
  retires: string;
  semee_le: number | null;
}

function rolesRetires(projectId: string): RoleDEquipier[] {
  try {
    const l = getDb().prepare('SELECT * FROM equipes_semis WHERE project_id = ?').get(projectId) as LigneSemis | undefined;
    const v = l ? JSON.parse(l.retires) : [];
    return Array.isArray(v) ? v.map(roleDEquipierLu).filter((r) => r !== 'libre') : [];
  } catch {
    return [];
  }
}

/** Un rôle par défaut retiré par l'utilisateur : le rattrapage ne le resème plus. */
export function noterLeRoleRetire(projectId: string, role: RoleDEquipier): void {
  if (role === 'libre') return;
  const deja = rolesRetires(projectId);
  if (deja.includes(role)) return;
  getDb()
    .prepare(
      `INSERT INTO equipes_semis (project_id, retires, semee_le) VALUES (?, ?, NULL)
       ON CONFLICT(project_id) DO UPDATE SET retires = excluded.retires`,
    )
    .run(projectId, JSON.stringify([...deja, role]));
}

/** Le projet reçoit-il une équipe ? Ni archivé, ni simple marque sans dépôt. */
function projetAvecEquipe(projectId: string): boolean {
  const projet = store.getProject(projectId);
  return !!projet && !projet.archived && !projet.marqueSansDepot;
}

/** Les semis en cours, par projet : deux lectures simultanées ne sèment pas deux fois. */
const semisEnCours = new Map<string, Promise<number>>();

/**
 * SEMER L'ÉQUIPE D'UN PROJET (idempotent). Reprend d'abord les agents d'avant les équipes (rôle deviné de leur fiche,
 * portrait libre), puis sème les rôles par défaut qui manquent, éteints et sans conversation. Rend le nombre d'agents
 * semés.
 */
export function semerLEquipe(projectId: string): Promise<number> {
  const deja = semisEnCours.get(projectId);
  if (deja) return deja;
  const semis = semerMaintenant(projectId).finally(() => semisEnCours.delete(projectId));
  semisEnCours.set(projectId, semis);
  return semis;
}

async function semerMaintenant(projectId: string): Promise<number> {
  if (!projetAvecEquipe(projectId)) return 0;
  const projet = store.getProject(projectId)!;
  const db = getDb();
  const lignes = db.prepare('SELECT id, role, portrait, fiche FROM agents_perso WHERE project_id = ? ORDER BY cree_le ASC').all(projectId) as {
    id: string;
    role: string | null;
    portrait: string | null;
    fiche: string;
  }[];
  const pris = new Set<string>();
  // LA REPRISE : un agent d'avant les équipes reçoit un métier et un visage, sans rien perdre de sa fiche.
  for (const l of lignes) {
    let role = l.role ? roleDEquipierLu(l.role) : null;
    let portrait = l.portrait;
    if (!role) {
      let fiche: { nom?: string; mission?: string } = {};
      try {
        fiche = JSON.parse(l.fiche);
      } catch {
        /* fiche illisible : agent libre */
      }
      role = roleDevine({ nom: fiche.nom ?? '', mission: fiche.mission ?? '' });
    }
    if (!portrait || (!portraitConnu(portrait) && !/^(https?:|\/|data:)/.test(portrait))) {
      const voulu = (estUnRegroupement(projet) ? EQUIPE_DU_GROUPE : []).find((m) => m.role === role)?.portrait ?? null;
      portrait = portraitLibre(pris, role === 'com' && !estUnRegroupement(projet) ? 'eliot' : voulu, graineDe(projectId + l.id));
    }
    pris.add(portrait);
    if (role !== l.role || portrait !== l.portrait) db.prepare('UPDATE agents_perso SET role = ?, portrait = ? WHERE id = ?').run(role, portrait, l.id);
    l.role = role;
  }
  const manquants = membresASemer(
    lignes.map((l) => ({ role: roleDEquipierLu(l.role) })),
    { groupe: estUnRegroupement(projet), aUneMiseEnLigne: !estUnRegroupement(projet), retires: rolesRetires(projectId) },
  );
  let semes = 0;
  for (const membre of manquants) {
    const portrait = portraitLibre(pris, membre.portrait, graineDe(projectId + membre.role));
    pris.add(portrait);
    await perso.creerAgent(projectId, Date.now(), {
      role: membre.role,
      portrait,
      fiche: ficheDUnMembre(membre),
      sansConversation: true,
      note: `${membre.prenom} rejoint l’équipe (${LIBELLE_DU_ROLE[membre.role].toLowerCase()}). Éteint : il ne travaille seul qu’une fois allumé.`,
    });
    semes++;
  }
  db.prepare(
    `INSERT INTO equipes_semis (project_id, retires, semee_le) VALUES (?, '[]', ?)
     ON CONFLICT(project_id) DO UPDATE SET semee_le = excluded.semee_le`,
  ).run(projectId, Date.now());
  return semes;
}

/** LE RATTRAPAGE DU DÉMARRAGE : chaque projet vivant reçoit les membres qui lui manquent. Rejoué, il ne sème rien. */
export async function semerToutesLesEquipes(): Promise<number> {
  let total = 0;
  for (const projet of store.listProjects(false)) {
    if (projet.marqueSansDepot) continue;
    try {
      total += await semerLEquipe(projet.id);
    } catch (err) {
      log.warn(`équipe de « ${projet.name} » non semée`, err);
    }
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Les échanges                                                        */
/* ------------------------------------------------------------------ */

interface LigneEchange {
  id: string;
  project_id: string;
  de: string;
  a: string;
  texte: string;
  date: number;
  card_id: string | null;
  en_reponse_a: string | null;
  profondeur: number;
}

function echangeDeLigne(l: LigneEchange): EchangeDAgents {
  return {
    id: l.id,
    projectId: l.project_id,
    de: l.de,
    a: l.a,
    texte: l.texte,
    date: l.date,
    cardId: l.card_id,
    enReponseA: l.en_reponse_a,
    profondeur: l.profondeur,
  };
}

/** Les échanges d'un projet (et de son groupe, s'il en a un), du plus ancien au plus récent. */
export function listerLesEchanges(projectIds: readonly string[], limite = 120): EchangeDAgents[] {
  if (!projectIds.length) return [];
  const trous = projectIds.map(() => '?').join(', ');
  return (
    getDb()
      .prepare(`SELECT * FROM agents_echanges WHERE project_id IN (${trous}) ORDER BY date DESC, rowid DESC LIMIT ?`)
      .all(...projectIds, limite) as LigneEchange[]
  )
    .map(echangeDeLigne)
    .reverse();
}

/** Ajoute un échange au journal (ajout seul) et prévient les écrans du projet. */
export function noterUnEchange(e: Omit<EchangeDAgents, 'id' | 'date'> & { date?: number }): EchangeDAgents {
  const echange: EchangeDAgents = { ...e, id: store.newId(), date: e.date ?? Date.now(), texte: e.texte.trim().slice(0, 4000) };
  getDb()
    .prepare('INSERT INTO agents_echanges (id, project_id, de, a, texte, date, card_id, en_reponse_a, profondeur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(echange.id, echange.projectId, echange.de, echange.a, echange.texte, echange.date, echange.cardId ?? null, echange.enReponseA ?? null, echange.profondeur);
  bus.emit({ type: 'agentsPerso', projectId: echange.projectId });
  return echange;
}

/* ------------------------------------------------------------------ */
/* L'équipe d'un projet                                                */
/* ------------------------------------------------------------------ */

/** Le projet-regroupement d'un projet membre, ou `null`. */
function groupeDuProjet(projectId: string): string | null {
  const projet = store.getProject(projectId);
  if (!projet || estUnRegroupement(projet) || !projet.regroupementId) return null;
  const groupe = store.getProject(projet.regroupementId);
  return groupe && !groupe.archived ? groupe.id : null;
}

/** L'état d'un agent, et pour l'agent de développement celui des tâches du projet. */
interface SignauxDuDev {
  tachesAuTravail: number;
  tachesQuiAttendent: number;
  activite: string | null;
}

function signauxDesTaches(projectId: string): SignauxDuDev {
  const cartes = store.tachesDeLaColonne().filter((c) => c.projectId === projectId && !(c.labels ?? []).includes('agent-perso'));
  const decisions = new Set(store.decisionsEnAttente().map((d) => d.cardId).filter(Boolean) as string[]);
  let auTravail = 0;
  let attendent = 0;
  let activite: string | null = null;
  for (const c of cartes) {
    const agent = c.agentId ? store.getAgent(c.agentId) : null;
    const travaille = !!agent && (agent.status === 'running' || agent.status === 'starting');
    if (decisions.has(c.id)) attendent++;
    else if (travaille) {
      auTravail++;
      activite ??= c.title;
    }
  }
  return { tachesAuTravail: auTravail, tachesQuiAttendent: attendent, activite };
}

/** Ce que l'écran reçoit d'un membre : l'agent, son état en formes et son activité en une ligne. */
export interface MembreDeLEquipe extends AgentPerso {
  etat: ReturnType<typeof etatDuMembre>;
  activite: string | null;
}

function membre(agent: AgentPerso, dev: SignauxDuDev | null): MembreDeLEquipe {
  const conversation = agent.agentId ? store.getAgent(agent.agentId) : null;
  const parle = !!conversation && (conversation.status === 'running' || conversation.status === 'starting');
  const etat = etatDuMembre({
    attentes: agent.attentes,
    enPassage: agent.enPassage || parle,
    ...(agent.role === 'dev' && dev ? { tachesAuTravail: dev.tachesAuTravail, tachesQuiAttendent: dev.tachesQuiAttendent } : {}),
  });
  const activite =
    agent.role === 'dev' && dev?.activite
      ? dev.activite
      : agent.enPassage || parle
        ? (conversation?.title && conversation.title !== agent.fiche.nom ? conversation.title : null)
        : agent.attentes > 0
          ? perso.premiereAttenteDeLAgent(agent.agentId)
          : null;
  return { ...agent, etat, activite };
}

/** L'ÉQUIPE D'UN PROJET : ses membres (semés au besoin), ceux de son groupe, et les derniers échanges. */
export async function equipeDuProjet(projectId: string): Promise<{
  agents: MembreDeLEquipe[];
  groupe: { projectId: string; agents: MembreDeLEquipe[] } | null;
  echanges: EchangeDAgents[];
}> {
  await semerLEquipe(projectId).catch((err) => log.warn('équipe non semée', err));
  const groupeId = groupeDuProjet(projectId);
  if (groupeId) await semerLEquipe(groupeId).catch(() => 0);
  const dev = signauxDesTaches(projectId);
  const agents = perso.listerAgents(projectId).map((a) => membre(a, dev));
  const groupe = groupeId ? { projectId: groupeId, agents: perso.listerAgents(groupeId).map((a) => membre(a, null)) } : null;
  return { agents, groupe, echanges: listerLesEchanges(groupeId ? [projectId, groupeId] : [projectId]) };
}

/**
 * LES ÉQUIPES DE PLUSIEURS PROJETS, EN LÉGER (colonne de gauche) : rien que ce qu'une ligne montre. Aucun semis ici —
 * le démarrage s'en est chargé — : la colonne ne doit jamais attendre.
 */
export function equipesEnLeger(projectIds: readonly string[]): Array<
  Pick<MembreDeLEquipe, 'id' | 'projectId' | 'role' | 'portrait' | 'couleur' | 'etat' | 'activite' | 'agentId'> & { nom: string }
> {
  const sortie: ReturnType<typeof equipesEnLeger> = [];
  for (const projectId of projectIds) {
    const dev = signauxDesTaches(projectId);
    for (const a of perso.listerAgents(projectId)) {
      const m = membre(a, dev);
      sortie.push({ id: m.id, projectId, role: m.role, portrait: m.portrait, couleur: m.couleur, etat: m.etat, activite: m.activite, agentId: m.agentId, nom: m.fiche.nom });
    }
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* Le réglage d'un membre                                              */
/* ------------------------------------------------------------------ */

export interface ReglageDuMembre {
  portrait?: string | null;
  couleur?: string | null;
  role?: string;
  outils?: string[];
  autonome?: boolean;
  nom?: string;
}

/** Régler un membre depuis sa fiche : visage, couleur, métier, outils d'un agent libre, « libre avec ses collègues », prénom. */
export function reglerLeMembre(projectId: string, id: string, reglage: ReglageDuMembre): AgentPerso {
  const l = perso.ligneBruteDeLAgent(id);
  if (!l || l.project_id !== projectId) throw new Error('agent introuvable dans ce projet');
  const db = getDb();
  if (reglage.portrait !== undefined) {
    const p = reglage.portrait;
    if (p !== null && !portraitConnu(p) && !/^\/api\/attachments\/[\w-]+/.test(p)) throw new Error('portrait inconnu');
    if (p && portraitConnu(p)) {
      const pris = db.prepare('SELECT id FROM agents_perso WHERE project_id = ? AND portrait = ? AND id <> ?').get(projectId, p, id);
      if (pris) throw new Error('Ce visage est déjà celui d’un autre agent de l’équipe.');
    }
    db.prepare('UPDATE agents_perso SET portrait = ? WHERE id = ?').run(p, id);
  }
  if (reglage.couleur !== undefined) db.prepare('UPDATE agents_perso SET couleur = ? WHERE id = ?').run(reglage.couleur === null ? null : couleurLue(reglage.couleur), id);
  if (reglage.role !== undefined) {
    if (!(ROLES_D_EQUIPIER as readonly string[]).includes(reglage.role)) throw new Error('métier inconnu');
    db.prepare('UPDATE agents_perso SET role = ? WHERE id = ?').run(reglage.role, id);
  }
  if (reglage.outils !== undefined) {
    const outils = reglage.outils.filter((o) => (OUTILS_D_AGENT as readonly string[]).includes(o));
    db.prepare('UPDATE agents_perso SET outils = ? WHERE id = ?').run(JSON.stringify([...new Set(outils)]), id);
  }
  if (reglage.autonome !== undefined) db.prepare('UPDATE agents_perso SET autonome = ? WHERE id = ?').run(reglage.autonome ? 1 : 0, id);
  if (reglage.nom !== undefined && reglage.nom.trim()) {
    const conversation = l.agent_id ?? null;
    if (conversation) perso.ecrireRubriqueDeLAgent(conversation, 'nom', reglage.nom);
    else {
      const ecrite = JSON.parse(l.fiche);
      ecrite.nom = reglage.nom.replace(/\s+/g, ' ').trim().slice(0, 60);
      db.prepare('UPDATE agents_perso SET fiche = ? WHERE id = ?').run(JSON.stringify(ecrite), id);
    }
  }
  db.prepare('UPDATE agents_perso SET mis_a_jour_le = ? WHERE id = ?').run(Date.now(), id);
  bus.emit({ type: 'agentsPerso', projectId });
  return perso.lireAgent(projectId, id);
}

/** UN NOUVEL AGENT DANS L'ÉQUIPE : libre, sa fiche à remplir en lui parlant, un visage que personne n'a dans l'équipe. */
export async function nouveauMembre(projectId: string, relieA?: string | null): Promise<AgentPerso> {
  const pris = (getDb().prepare('SELECT portrait FROM agents_perso WHERE project_id = ?').all(projectId) as { portrait: string | null }[])
    .map((p) => p.portrait)
    .filter((p): p is string => !!p);
  const portrait = portraitLibre(pris, null, graineDe(projectId + Date.now()));
  const agent = await perso.creerAgent(projectId, Date.now(), { role: 'libre', portrait });
  /* « + » AU SURVOL D'UN AGENT (comme n8n) : le nouveau naît RELIÉ à lui — le lien se lit sur la table. */
  if (relieA) {
    const voisin = perso.ligneBruteDeLAgent(relieA);
    if (voisin && voisin.project_id === projectId) {
      noterUnEchange({ projectId, de: relieA, a: agent.id, texte: 'Bienvenue dans l’équipe : on travaillera ensemble.', profondeur: 0 });
    }
  }
  return agent;
}

/* ------------------------------------------------------------------ */
/* La discussion de l'équipe : l'utilisateur écrit                     */
/* ------------------------------------------------------------------ */

/** L'envoi d'un tour à la conversation d'un membre, remplaçable par les contrôles (aucun moteur). */
type EnvoiALAgent = (agentId: string, texte: string, apres: (reponse: string, ok: boolean) => void) => Promise<void>;
const envoiALAgent: EnvoiALAgent = async (agentId, texte, apres) => {
  if (process.env.BELUGA_AGENTS_PERSO_SANS_MOTEUR === '1') {
    apres('', false);
    return;
  }
  const { sendPrompt } = await import('./runtime.js');
  await sendPrompt(agentId, texte, {
    demandeur: 'humain',
    template: 'none',
    context: perso.contexteDeLAgentPersoDuTour(agentId) ?? '',
    onComplete: ((reponse: string, ok: boolean) => apres(reponse, ok)) as any,
  });
};
/**
 * LA NAISSANCE D'UNE TÂCHE PAR UN MESSAGE DE L'UTILISATEUR : fournie par le démon (`ws.ts`), qui la fait passer par
 * le MÊME chemin qu'une carte créée puis un premier message tapé (carte en cadrage, message au cadrage). Rend la carte.
 */
export type OuvertureDeTache = (projectId: string, texte: string) => Promise<string>;

/** Le titre d'une tâche née d'un message : sa première phrase, bornée. */
export function titreDeTache(texte: string): string {
  const premiere = texte.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return premiere.length > 80 ? `${premiere.slice(0, 79)}…` : premiere || 'Nouvelle tâche';
}

/**
 * L'UTILISATEUR ÉCRIT À L'ÉQUIPE (à tous, ou à un seul). Le message entre au journal ; le destinataire est l'agent
 * choisi ou, pour « toute l'équipe », celui dont le métier correspond (à défaut le développement). Au développement,
 * le message ouvre une TÂCHE en cadrage ; à un autre, il part dans sa conversation et sa réponse revient au journal.
 */
export async function ecrireALEquipe(
  projectId: string,
  texte: string,
  cible: string,
  ouvrirUneTache: OuvertureDeTache,
): Promise<{ echange: EchangeDAgents; destinataire: string | null; cardId?: string }> {
  const propre = texte.trim();
  if (!propre) throw new Error('message vide');
  const { agents, groupe } = await equipeDuProjet(projectId);
  const tous = [...agents, ...(groupe?.agents ?? [])];
  const choisi = cible === TOUTE_L_EQUIPE ? destinataireDuMessage(propre, agents) : tous.find((a) => a.id === cible) ?? null;
  if (cible !== TOUTE_L_EQUIPE && !choisi) throw new Error('agent introuvable dans cette équipe');
  const echange = noterUnEchange({ projectId, de: VOUS, a: cible === TOUTE_L_EQUIPE ? TOUTE_L_EQUIPE : choisi!.id, texte: propre, profondeur: 0 });
  if (!choisi) return { echange, destinataire: null };
  const projetDuMembre = choisi.projectId;
  if (choisi.role === 'dev') {
    const cardId = await ouvrirUneTache(projetDuMembre, propre);
    noterUnEchange({
      projectId,
      de: choisi.id,
      a: VOUS,
      texte: `J’ouvre la tâche « ${titreDeTache(propre)} » : on la cadre ensemble avant que je m’y mette.`,
      cardId,
      enReponseA: echange.id,
      profondeur: 1,
    });
    return { echange, destinataire: choisi.id, cardId };
  }
  const agentId = choisi.agentId ?? (await perso.ouvrirLaConversation(projetDuMembre, choisi.id));
  void envoiALAgent(agentId, propre, (reponse, ok) => {
    if (!ok || !reponse.trim()) return;
    noterUnEchange({ projectId, de: choisi.id, a: VOUS, texte: resumeDeReponse(reponse), enReponseA: echange.id, profondeur: 1 });
  }).catch((err) => log.warn('équipe : message non transmis', err));
  return { echange, destinataire: choisi.id };
}

/** Une réponse d'agent, ramenée à ce que la discussion de l'équipe montre : son début, sans la phrase de compte rendu. */
export function resumeDeReponse(texte: string): string {
  const lignes = texte
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(fait|à valider|a valider|rien à faire|rien a faire)\s*:/i.test(l.replace(/\*\*/g, '')));
  const corps = lignes.join('\n').trim() || texte.trim();
  return corps.length > 900 ? `${corps.slice(0, 899)}…` : corps;
}

/* ------------------------------------------------------------------ */
/* Les demandes entre collègues (outil `equipe`)                       */
/* ------------------------------------------------------------------ */

/** Les profondeurs des passages en cours, par agent de conversation : un relais hérite de la chaîne qui l'a lancé. */
const profondeurDuTour = new Map<string, number>();

/** Trouver un collègue par prénom, métier ou identifiant, dans l'équipe du projet et de son groupe. */
function trouverLeCollegue(tous: readonly MembreDeLEquipe[], qui: string): MembreDeLEquipe | null {
  const q = qui.trim().toLowerCase();
  if (!q) return null;
  const sans = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return (
    tous.find((a) => a.id === qui) ??
    tous.find((a) => sans(a.fiche.nom) === sans(q)) ??
    tous.find((a) => sans(a.fiche.nom).split(/\s+/)[0] === sans(q)) ??
    tous.find((a) => a.role === q || sans(LIBELLE_DU_ROLE[a.role]) === sans(q)) ??
    null
  );
}

/**
 * L'OUTIL `equipe` D'UN AGENT : « lister » ses collègues, « demander » un travail à l'un d'eux. Rend le texte de l'outil.
 */
export async function outilEquipe(agentId: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const moi = perso.agentPersoDeLAgent(agentId);
  if (!moi) return { ok: false, text: 'Seul un agent d’équipe a des collègues.' };
  const projectId = moi.project_id;
  const groupeId = groupeDuProjet(projectId);
  const { agents, groupe } = await equipeDuProjet(projectId);
  // UN AGENT DE GROUPE travaille avec les équipes de ses projets ; un agent de projet, avec son équipe et son groupe.
  let tous: MembreDeLEquipe[] = [...agents, ...(groupe?.agents ?? [])];
  const projet = store.getProject(projectId);
  if (estUnRegroupement(projet)) {
    for (const membreDuGroupe of store.listProjects(false).filter((p) => p.regroupementId === projectId)) {
      tous = tous.concat(perso.listerAgents(membreDuGroupe.id).map((a) => membre(a, null)));
    }
  }
  const collegues = tous.filter((a) => a.id !== moi.id);
  const action = String(args.action ?? 'lister');
  if (action === 'lister') {
    return {
      ok: true,
      text: collegues.length
        ? collegues
            .map((a) => `- ${a.fiche.nom} · ${LIBELLE_DU_ROLE[a.role]} · ${a.etat === 'au-travail' ? 'au travail' : a.etat === 'vous-attend' ? 'attend l’utilisateur' : 'au repos'}${a.autonome ? '' : ' · ne travaille pas seul sur la demande d’un collègue'}${a.projectId !== projectId ? ` · ${store.getProject(a.projectId)?.name ?? ''}` : ''}`)
            .join('\n')
        : 'Tu n’as aucun collègue dans cette équipe.',
    };
  }
  /* LE DÉVELOPPEUR POSE SES PROPRES TÂCHES (« tache ») : même chemin qu'une demande d'un collègue vers lui. */
  if (action === 'tache') {
    if (roleDEquipierLu(moi.role) !== 'dev') return { ok: false, text: 'Seul l’agent de développement pose une tâche : demande-la-lui avec « demander ».' };
    const consigneDeTache = String(args.consigne ?? '').trim();
    if (!consigneDeTache) return { ok: false, text: 'La consigne est vide : dis ce que la tâche doit faire.' };
    return poserUneTacheDeDev(projectId, moi, agentId, consigneDeTache, null, profondeurDuTour.get(agentId) ?? 0);
  }
  if (action !== 'demander') return { ok: false, text: 'Action : « lister », « demander » (avec « a » et « consigne ») ou « tache » (développement seulement).' };
  const consigne = String(args.consigne ?? '').trim();
  if (!consigne) return { ok: false, text: 'La consigne est vide : dis à ton collègue ce que tu attends de lui.' };
  const cible = trouverLeCollegue(collegues, String(args.a ?? ''));
  if (!cible) return { ok: false, text: `Collègue introuvable. Ton équipe : ${collegues.map((a) => `${a.fiche.nom} (${LIBELLE_DU_ROLE[a.role]})`).join(', ') || 'personne'}.` };
  const profondeur = (profondeurDuTour.get(agentId) ?? 0) + 1;
  const projetDuJournal = cible.projectId === projectId || cible.projectId === groupeId ? projectId : cible.projectId;
  const recents = listerLesEchanges([projetDuJournal], 200);
  const refus = refusDEchange({ de: moi.id, a: cible.id, profondeur }, recents, Date.now());
  if (refus) return { ok: false, text: `REFUSÉ : ${refus}` };
  const nomMoi = ficheNom(moi.fiche);
  const echange = noterUnEchange({ projectId: projetDuJournal, de: moi.id, a: cible.id, texte: consigne, profondeur });

  /* LE DÉVELOPPEMENT : une tâche du projet, qui part seule si l'agent est libre avec ses collègues. */
  if (cible.role === 'dev') {
    const lu = perso.ligneBruteDeLAgent(cible.id);
    if (!lu) return { ok: false, text: 'Agent de développement introuvable.' };
    return poserUneTacheDeDev(cible.projectId, lu, agentId, consigne, { echange, demandeur: moi, journal: projetDuJournal }, profondeur);
  }

  /* UN AUTRE MÉTIER : un passage de l'agent, sa réponse revient au journal (et dans ton prochain relais). */
  if (!cible.autonome) {
    return {
      ok: true,
      text: `${cible.fiche.nom} ne travaille pas seul sur la demande d’un collègue : ta demande est dans la discussion de l’équipe, l’utilisateur la lui transmettra.`,
    };
  }
  if (!ficheComplete(cible.fiche)) return { ok: false, text: `${cible.fiche.nom} n’a pas encore de fiche complète : il ne peut rien faire seul.` };
  if (!cible.agentId) await perso.ouvrirLaConversation(cible.projectId, cible.id);
  const relu = perso.lireAgent(cible.projectId, cible.id);
  const issue = await perso.passer(relu.id, {
    genre: 'collegue',
    de: nomMoi,
    details: consigne,
    onFini: (reponse, ok) => {
      if (relu.agentId) profondeurDuTour.delete(relu.agentId);
      if (!ok || !reponse.trim()) return;
      noterUnEchange({ projectId: projetDuJournal, de: cible.id, a: moi.id, texte: resumeDeReponse(reponse), enReponseA: echange.id, profondeur });
    },
  });
  if (relu.agentId && issue === 'parti') profondeurDuTour.set(relu.agentId, profondeur);
  switch (issue) {
    case 'parti':
      return { ok: true, text: `${cible.fiche.nom} s’y met. Sa réponse paraîtra dans la discussion de l’équipe et dans ton prochain relais : n’attends pas, continue ton travail.` };
    case 'attente-quota':
      return { ok: true, text: `${cible.fiche.nom} s’y mettra dès qu’un compte aura du quota.` };
    case 'limite':
      return { ok: false, text: `${cible.fiche.nom} a atteint sa limite de passages pour cette période.` };
    case 'ecarte':
    case 'fusionne':
      return { ok: false, text: `${cible.fiche.nom} est occupé : redemande-lui plus tard, ou avance sans lui.` };
    default:
      return { ok: false, text: `${cible.fiche.nom} ne peut pas s’y mettre seul pour le moment.` };
  }
}

/**
 * POSER UNE TÂCHE DE DÉVELOPPEMENT : la carte naît dans le projet de l'agent de développement, avec la consigne et son
 * auteur ; elle PART SEULE si l'agent est libre avec ses collègues (décision de l'utilisateur), sinon elle attend un clic
 * dans « Planifié ». Le journal dit lequel des deux. Aucune publication, aucune mise en ligne ici.
 */
async function poserUneTacheDeDev(
  projectId: string,
  dev: NonNullable<ReturnType<typeof perso.ligneBruteDeLAgent>>,
  agentIdDuDemandeur: string,
  consigne: string,
  demande: { echange: EchangeDAgents; demandeur: NonNullable<ReturnType<typeof perso.agentPersoDeLAgent>>; journal: string } | null,
  profondeur: number,
): Promise<{ ok: boolean; text: string }> {
  const nomDuDev = ficheNom(dev.fiche);
  const auteur = demande ? `${ficheNom(demande.demandeur.fiche)} (${LIBELLE_DU_ROLE[roleDEquipierLu(demande.demandeur.role)].toLowerCase()})` : nomDuDev;
  const { createCard } = await import('./tools.js');
  const card = createCard(projectId, {
    title: titreDeTache(consigne),
    description: `${consigne}\n\nDemandé par ${auteur}, dans l’équipe du projet.`,
    origin: 'agent',
    auteur: 'agent',
    origineAgentId: agentIdDuDemandeur,
    origineAt: Date.now(),
  });
  bus.emit({ type: 'card.upsert', card });
  let lancee = false;
  if (dev.autonome !== 0 && process.env.BELUGA_AGENTS_PERSO_SANS_MOTEUR !== '1') {
    const { startCard } = await import('./scheduler.js');
    const r = await startCard(card.id).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
    lancee = r.ok;
    if (!r.ok) log.warn(`équipe : tâche « ${card.title} » non lancée`, r.error);
  }
  noterUnEchange({
    projectId: demande?.journal ?? projectId,
    de: dev.id,
    a: demande ? demande.demandeur.id : VOUS,
    texte: lancee ? `Je m’y mets : tâche « ${card.title} ».` : `Tâche « ${card.title} » posée dans « Planifié » : elle part à votre clic.`,
    cardId: card.id,
    enReponseA: demande?.echange.id ?? null,
    profondeur,
  });
  return {
    ok: true,
    text: lancee
      ? `${nomDuDev} a lancé la tâche « ${card.title} » (elle se suit dans l’onglet Tâches du projet).`
      : `Tâche « ${card.title} » posée dans « Planifié » : elle partira au clic de l’utilisateur.`,
  };
}

function ficheNom(fiche: string): string {
  try {
    return String(JSON.parse(fiche).nom ?? 'un collègue');
  } catch {
    return 'un collègue';
  }
}

/* ------------------------------------------------------------------ */
/* Le relais de chaque tour                                            */
/* ------------------------------------------------------------------ */

/** CE QUE LE RELAIS D'UN AGENT DIT DE SON ÉQUIPE : son métier, ses collègues, les derniers échanges qui le concernent. */
export function contexteDEquipe(agentPersoId: string): {
  role?: string;
  equipe?: { prenom: string; metier: string; etat: string; libre: boolean }[];
  echanges?: { de: string; a: string; texte: string; date: number }[];
} {
  const l = perso.ligneBruteDeLAgent(agentPersoId);
  if (!l) return {};
  const role = roleDEquipierLu(l.role);
  const groupeId = groupeDuProjet(l.project_id);
  const ids = groupeId ? [l.project_id, groupeId] : [l.project_id];
  const membres = ids.flatMap((id) => perso.listerAgents(id));
  const noms = new Map(membres.map((m) => [m.id, m.fiche.nom]));
  noms.set(VOUS, 'l’utilisateur');
  noms.set(TOUTE_L_EQUIPE, 'toute l’équipe');
  const echanges = listerLesEchanges(ids, 60)
    .filter((e) => e.de === l.id || e.a === l.id)
    .slice(-8)
    .map((e) => ({ de: noms.get(e.de) ?? 'un ancien collègue', a: noms.get(e.a) ?? 'un ancien collègue', texte: e.texte, date: e.date }));
  return {
    role: `${LIBELLE_DU_ROLE[role]}. ${CONSIGNE_DU_ROLE[role]}`,
    equipe: membres
      .filter((m) => m.id !== l.id)
      .map((m) => ({
        prenom: m.fiche.nom,
        metier: LIBELLE_DU_ROLE[m.role],
        etat: m.enPassage ? 'au travail' : m.attentes > 0 ? 'attend l’utilisateur' : 'au repos',
        libre: m.autonome,
      })),
    ...(echanges.length ? { echanges } : {}),
  };
}

/** Au démarrage : le rattrapage des équipes, un peu après le reste (il n'est jamais urgent). */
export function demarrerLesEquipes(): void {
  const t = setTimeout(() => {
    void semerToutesLesEquipes()
      .then((n) => n && log.info(`équipes : ${n} agent(s) semé(s)`))
      .catch((err) => log.warn('équipes : rattrapage impossible', err));
  }, 20_000);
  t.unref?.();
}

/* ------------------------------------------------------------------ */
/* Ce que montre l'onglet d'un outil                                   */
/* ------------------------------------------------------------------ */

/**
 * L'APERÇU D'UN OUTIL DANS LE VOLET D'UN AGENT (26/11/2026) : une lecture COURTE, bornée au projet, des services que
 * l'agent tient — le calendrier et les comptes reliés (communication), l'état du site, les sauvegardes et les audits
 * (production). Le service entier s'ouvre ensuite par le bouton du pied. Rien ne s'écrit ici.
 */
export async function apercuDeLOutil(projectId: string, outil: string, compte: import('@beluga/shared').CompteUtilisateur): Promise<Record<string, unknown>> {
  switch (outil) {
    case 'calendrier':
    case 'reseaux': {
      const { marqueDuProjet, lirePublications } = await import('./communication.js');
      const marque = marqueDuProjet(projectId);
      if (!marque) return { marqueId: null, contenus: [], comptes: [] };
      const lu = (await lirePublications(marque.id, compte, 30)) as { contenus: any[]; comptes: any[] };
      const depuis = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const contenus = lu.contenus
        .filter((c) => c.projectId === projectId && (!c.datePrevue || c.datePrevue >= depuis))
        .sort((a, b) => String(a.datePrevue ?? '9999').localeCompare(String(b.datePrevue ?? '9999')) || String(a.heurePrevue ?? '').localeCompare(String(b.heurePrevue ?? '')))
        .slice(0, 40)
        .map((c) => ({ id: c.id, titre: c.titre, texte: String(c.texte ?? '').slice(0, 220), canal: c.canal, datePrevue: c.datePrevue ?? null, heurePrevue: c.heurePrevue ?? null, etape: c.etape }));
      const comptes = lu.comptes.filter((c) => c.projectId === projectId).map((c) => ({ id: c.id, reseau: c.reseau, nom: c.nom, etat: c.etat }));
      return { marqueId: marque.id, contenus, comptes };
    }
    case 'etat-du-site': {
      const { listerSites } = await import('./surveillance.js');
      return {
        sites: listerSites()
          .filter((s) => s.projectId === projectId)
          .map((s) => ({ id: s.id, nom: s.nom, url: s.url, etat: s.etat, dernierePanne: s.dernierePanne || null })),
      };
    }
    case 'sauvegardes': {
      const { listerSites, derniersPoints } = await import('./backups.js');
      const derniers = derniersPoints();
      return {
        sites: listerSites()
          .filter((s) => s.projectId === projectId)
          .map((s) => {
            const p = derniers.get(s.id);
            return { id: s.id, nom: s.nom, dernier: p ? { statut: p.statut, fin: p.fin || p.debut, detail: String(p.detail ?? '').slice(0, 160) } : null };
          }),
      };
    }
    case 'securite': {
      const { estSuivi, listerAudits } = await import('./service-securite.js');
      if (!estSuivi(projectId)) return { suivi: false, audits: [] };
      return { suivi: true, audits: listerAudits(projectId).slice(0, 5) };
    }
    default:
      return {};
  }
}
