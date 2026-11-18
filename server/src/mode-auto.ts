/**
 * LE MODE « AUTO » D'UNE CARTE, CÔTÉ DÉMON (carte « Services homogènes et centrés », 14/11/2026). Les règles pures
 * vivent dans `shared/src/mode-auto.ts` ; ici, le va-et-vient :
 *  - RÉPONDRE : une question ordinaire posée par l'agent d'une carte en Auto (cadrage ou tâche) reçoit la réponse
 *    conseillée par le MÊME chemin qu'un clic (`question.answer`, marquée `parAuto`) — l'agent arrêté sur `ask_user`
 *    (DEC-026) repart ; les questions gardées sur la carte (DEC-326) reçoivent leur `recommandee` ;
 *  - RELANCER : en fin de tour de tâche, le bilan déclaré par l'agent (`bilan_du_travail`) décide — rien, une relance
 *    par le cadrage (au plus deux), ou l'arrêt avec une alerte qui dit ce qui reste.
 * Le lancement après la compréhension reste `lancerSiAutomatique` (`ws.ts`). Rien ne se publie, ne se paie ni ne part
 * chez un client par ici : ces questions-là portent un champ qui les garde hors d'Auto (`CHAMPS_HORS_AUTO`).
 */
import { questionPourAuto, questionsSansReponse, reponseConseillee, suiteDuBilan, REPONSE_AUTO_OUVERTE, type Message } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { listerComptes } from './comptes.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { notify } from './notify.js';

/** La carte est-elle en mode Auto ? */
export function carteEnAuto(cardId: string | null | undefined): boolean {
  return !!cardId && !!store.getCard(cardId)?.parcours?.lancementAutomatique;
}

/** Le délai avant la réponse d'Auto : la question se voit un instant dans le fil, puis se répond. */
const DELAI_DE_REPONSE_MS = 1200;

function compteAdmin() {
  return listerComptes().find((c) => c.role === 'admin' && c.actif) ?? null;
}

function noterAuJournal(cardId: string, agentId: string, libelle: string, resultat: string, reussie = true): void {
  const agent = store.getAgent(agentId);
  const jalon = ajouterAuJournal({
    cardId,
    phase: phaseDeLaCarte(cardId, agent?.role),
    nature: 'jalon',
    libelle,
    agentId,
    ...(agent?.role ? { agentRole: agent.role } : {}),
    resultat,
    reussie,
  });
  if (jalon) bus.emit({ type: 'journal.entree', entree: jalon });
}

/**
 * RÉPONDRE PAR AUTO À UNE QUESTION D'UN AGENT. Refus silencieux (rien n'est fait) si la carte n'est plus en Auto, si la
 * question est déjà tranchée, ou si elle engage un geste qu'un clic doit valider.
 */
export async function repondreParAuto(messageId: string, questionId: string): Promise<boolean> {
  const message = store.getMessage(messageId);
  const question = message?.questions.find((q) => q.id === questionId);
  if (!message || !question || !questionPourAuto(question as unknown as Record<string, unknown>)) return false;
  const agent = store.getAgent(message.agentId);
  if (!agent?.cardId || !carteEnAuto(agent.cardId)) return false;
  const compte = compteAdmin();
  if (!compte) {
    log.warn(`mode Auto : aucun compte administrateur pour répondre à la question ${questionId}`);
    return false;
  }
  const reponse = reponseConseillee(question);
  const { commandeCommeLUtilisateur } = await import('./ws.js');
  await commandeCommeLUtilisateur({ type: 'question.answer', messageId, questionId, answer: reponse, attachments: [], parAuto: true }, compte);
  noterAuJournal(agent.cardId, agent.id, 'Auto a répondu', `${question.question} → ${reponse === REPONSE_AUTO_OUVERTE ? 'l’agent décide lui-même' : reponse}`);
  return true;
}

/** Une question vient d'être posée par l'agent d'une carte en Auto : sa réponse part après un court instant. */
export function planifierLaReponseAuto(agentId: string, questionId: string): void {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId || !carteEnAuto(agent.cardId)) return;
  setTimeout(() => {
    const message = store.listMessages(agentId, 8).find((m) => m.questions.some((q) => q.id === questionId));
    if (!message) return;
    void repondreParAuto(message.id, questionId).catch((err) => log.warn(`mode Auto : réponse à ${questionId} impossible`, err));
  }, DELAI_DE_REPONSE_MS);
}

/**
 * AUTO VIENT D'ÊTRE ALLUMÉ : ce qui attend déjà une réponse se répond tout de suite — les questions ouvertes des
 * agents de la carte, puis les questions gardées sur la carte (une à une ; la dernière relance le cadrage).
 */
export async function repondreAuxQuestionsOuvertes(cardId: string): Promise<number> {
  let repondues = 0;
  for (const agent of store.listAgents().filter((a) => a.cardId === cardId)) {
    for (const message of store.listMessages(agent.id, 8)) {
      for (const question of message.questions) {
        if (await repondreParAuto(message.id, question.id).catch(() => false)) repondues += 1;
      }
    }
  }
  const comprise = store.getCard(cardId)?.parcours?.comprehension;
  const enAttente = comprise ? questionsSansReponse(comprise) : [];
  if (enAttente.length) {
    const { repondreALaQuestionDeLaCarte } = await import('./questions-de-carte.js');
    for (const q of enAttente) {
      const reponse = q.recommandee?.trim() || reponseConseillee({ kind: q.kind, options: q.options });
      await repondreALaQuestionDeLaCarte(cardId, q.id, reponse).catch((err) => log.warn(`mode Auto : question de la carte ${q.id}`, err));
      repondues += 1;
    }
  }
  return repondues;
}

/**
 * LA FIN D'UN TOUR DE TÂCHE D'UNE CARTE EN AUTO. Le bilan de CE tour décide : rien, une relance par le cadrage (qui
 * répondra seul et relancera le travail), ou l'arrêt — un jalon rouge au journal et une alerte qui dit ce qui reste.
 */
export function apresLeTourDeTache(cardId: string, agentId: string, tourReussi: boolean, debutDuTour: number): void {
  if (!tourReussi) return;
  const carte = store.getCard(cardId);
  if (!carte?.parcours?.lancementAutomatique) return;
  const relances = carte.parcours.relancesAuto ?? 0;
  const suite = suiteDuBilan(carte.parcours.bilanAuto ?? null, debutDuTour, relances);
  if (suite.geste === 'rien') return;
  if (suite.geste === 'arreter') {
    noterAuJournal(cardId, agentId, 'Auto arrêté', suite.raison, false);
    notify({
      motif: 'decision-attendue',
      title: 'Auto s’est arrêté',
      body: suite.raison.slice(0, 160),
      reference: `auto:${cardId}`,
      element: carte.title,
      cardId,
      projectId: carte.projectId,
      agentId,
    });
    bus.emit({ type: 'attention', ...store.signalAttention() });
    return;
  }
  const ecrite = store.saveCard({ ...carte, parcours: { ...carte.parcours, relancesAuto: suite.relance } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  noterAuJournal(cardId, agentId, `Auto relance le travail (${suite.relance}/2)`, (carte.parcours.bilanAuto?.restes ?? []).join(' ; ') || 'travail non abouti');
  void (async () => {
    const { remettreUneDemandeAuCadrage } = await import('./runtime.js');
    remettreUneDemandeAuCadrage(cardId, suite.consigne);
  })();
}

/** Auto rallumé, ou un message humain écrit : le compteur des relances repart de zéro. */
export function remettreLesRelancesAZero(cardId: string): void {
  const carte = store.getCard(cardId);
  if (!carte?.parcours?.relancesAuto) return;
  const ecrite = store.saveCard({ ...carte, parcours: { ...carte.parcours, relancesAuto: 0 } });
  bus.emit({ type: 'card.upsert', card: ecrite });
}

/**
 * LA CRÉATION D'OFFICE D'UNE CARTE DANS UN AUTRE PROJET (`issueDePropositionEnAuto`, 15/11/2026). La proposition part au
 * fil comme d'ordinaire ; un instant après, Auto la VALIDE par le même chemin qu'un clic (`proposal.decide`), la marque
 * `parAuto`, allume Auto sur la carte née (elle se cadre puis part seule — une suite part par sa carte globale), et
 * pose dans le fil d'origine une ligne qui la nomme. Rien ne se publie par ici.
 */
export function planifierLaCreationAuto(agentId: string, proposalId: string, essai = 0): void {
  setTimeout(() => {
    void creerParAuto(agentId, proposalId).then((fait) => {
      /* La proposition n'est posée dans le fil qu'à la sortie de l'outil : on la cherche quelques fois. */
      if (fait === 'absente' && essai < 10) planifierLaCreationAuto(agentId, proposalId, essai + 1);
    });
  }, DELAI_DE_REPONSE_MS);
}

async function creerParAuto(agentId: string, proposalId: string): Promise<'faite' | 'absente' | 'refusee'> {
  try {
    const message = store.messageDeLaProposition(proposalId) ?? store.listMessages(agentId, 12).find((m) => m.proposals.some((p) => p.id === proposalId));
    const proposal = message?.proposals.find((p) => p.id === proposalId);
    if (!message || !proposal) return 'absente';
    if (proposal.decision !== 'pending') return 'refusee';
    const agent = store.getAgent(agentId);
    if (!agent?.cardId || !carteEnAuto(agent.cardId)) return 'refusee';
    const compte = compteAdmin();
    if (!compte) {
      log.warn(`mode Auto : aucun compte administrateur pour créer la carte ${proposalId}`);
      return 'refusee';
    }
    const { commandeCommeLUtilisateur } = await import('./ws.js');
    const rendu = (await commandeCommeLUtilisateur({ type: 'proposal.decide', messageId: message.id, proposalId, accept: true }, compte)) as { cardId?: string };
    const cardId = rendu?.cardId;
    if (!cardId) return 'refusee';
    /* La marque `parAuto` : la carte née ne créera rien d'office à son tour (une seule génération). */
    const frais = store.getMessage(message.id);
    const decidee = frais?.proposals.find((p) => p.id === proposalId);
    if (frais && decidee) {
      const marquee = { ...decidee, parAuto: true };
      store.saveProposal(frais.id, agent.projectId, marquee);
      bus.emit({ type: 'message.upsert', message: store.saveMessage({ ...frais, proposals: frais.proposals.map((p) => (p.id === proposalId ? marquee : p)) }) });
    }
    const nee = store.getCard(cardId);
    await commandeCommeLUtilisateur({ type: 'card.lancement.automatique', cardId, actif: true }, compte);
    /* Le cadrage de la carte née part en même temps (`lancerLeCadrageDeLaProposition`) : une écriture de la carte
       croisée avec l'allumage pourrait l'éteindre. On le relit un instant après, et on le repose s'il a sauté. */
    setTimeout(() => {
      if (store.getCard(cardId) && !store.getCard(cardId)?.parcours?.lancementAutomatique)
        void commandeCommeLUtilisateur({ type: 'card.lancement.automatique', cardId, actif: true }, compte).catch(() => {});
    }, 5_000);
    /* UNE SUITE EST DÉJÀ CADRÉE : aucun tour de cadrage ne la lancera, sa carte globale part donc tout de suite. */
    if (proposal.etapes?.length) await commandeCommeLUtilisateur({ type: 'card.start', id: cardId }, compte).catch((err) => log.warn(`mode Auto : départ de la suite ${cardId}`, err));
    const projet = nee ? store.getProject(nee.projectId) : null;
    const ligne = store.saveMessage({
      id: store.newId(),
      agentId,
      role: 'system',
      content: `Mode Auto : carte « ${nee?.title ?? proposal.title} » créée d'office dans le projet « ${projet?.name ?? '?'} », en Auto — elle se cadre et part seule.`,
      createdAt: store.now(),
    } as Message);
    bus.emit({ type: 'message.upsert', message: ligne });
    noterAuJournal(agent.cardId, agentId, 'Auto a créé une carte', `« ${nee?.title ?? proposal.title} » dans ${projet?.name ?? 'un autre projet'}`);
    return 'faite';
  } catch (err) {
    log.warn(`mode Auto : création d'office de ${proposalId} impossible`, err);
    return 'refusee';
  }
}
