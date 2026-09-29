/**
 * L'AGENT DE CADRAGE D'UNE CARTE : celui à qui on parle avant de lancer.
 *
 * Le « + » de la colonne « Planifié » ne demande plus un titre dans un petit
 * formulaire : il crée la carte et OUVRE SA CONVERSATION. Un agent léger y
 * discute le besoin, écrit le titre, la description et le niveau d'exécution de
 * la carte, et s'arrête là — il ne code pas, la carte n'a pas de branche.
 *
 * Son MODÈLE est celui que l'utilisateur a retenu la dernière fois dans la
 * barre d'écriture, sans plafond ni épinglage : le modèle affiché en haut de la
 * conversation est celui qui tourne. Le modèle « économe » imposé d'office —
 * Haiku 4.5 sous Claude — a été retiré le 02/09/2026 : il reprenait la main sur
 * un choix fait à l'écran, à chaque nouveau cadrage.
 *
 * RIEN NE PART AU MOTEUR À LA CRÉATION : l'agent existe, sa conversation est
 * vide, et le premier tour n'a lieu qu'au premier message de l'utilisateur.
 */

import {
  Agent,
  Card,
  Message,
  TITRE_CARTE_DE_CADRAGE,
  demandeAfficheeDeProposition,
  demandeDeCadrageDeProposition,
} from '@beluga/shared';
import * as store from './store.js';
import { createAgent, isRunning, sendPrompt } from './runtime.js';
import { createCard } from './tools.js';
import { bus } from './bus.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { log } from './logger.js';
import { listEngines } from './engines/index.js';
import { choixDuCadrage, resolveModel } from './engines/catalog.js';

/**
 * L'agent de cadrage d'une carte, créé s'il n'existe pas encore.
 *
 * Une carte qui a DÉJÀ un agent — cadrage repris, ou agent de tâche parce
 * qu'elle a été lancée — n'en reçoit pas un second : deux fils sur la même
 * carte, ce serait deux endroits où répondre.
 */
export async function ouvrirLeCadrage(cardId: string): Promise<Agent | null> {
  const card = store.getCard(cardId);
  if (!card) return null;
  const existant = store.getLastAgentByCard(cardId);
  if (existant) return existant.role === 'cadrage' ? existant : null;
  return creerLAgentDeCadrage(card);
}

/**
 * UNE PROPOSITION ACCEPTÉE OUVRE SON CADRAGE, SANS ATTENDRE PERSONNE.
 *
 * Appelé par `proposal.decide` juste après la création de la carte. Trois
 * temps, dans cet ordre :
 *  1. l'agent de cadrage naît (`ouvrirLeCadrage`, qui n'en crée pas un second) ;
 *  2. le jalon « Demande » s'écrit AUSSITÔT, avec le texte rédigé par l'agent du
 *     chat : la demande part en `silent` — la synthèse ouvre déjà le fil
 *     (`filAvecLaSynthese`), une bulle d'utilisateur la redirait —, or seul un
 *     message d'utilisateur écrit ce jalon (`journaliserLaDemande`). Sans lui,
 *     le point restait sur « Dites ce que vous voulez faire. » et le geste 1 du
 *     cadrage n'avait aucun jalon où poser sa synthèse ;
 *  3. le premier tour part par `sendPrompt` — qui choisit le compte, met en file
 *     faute de quota et enchaîne deux demandes rapprochées — SANS être attendu :
 *     l'acceptation rend la main tout de suite.
 *
 * Une carte qui a déjà un agent (autre que ce cadrage neuf) n'est pas touchée.
 */
export async function lancerLeCadrageDeLaProposition(cardId: string): Promise<Agent | null> {
  const card = store.getCard(cardId);
  if (!card || store.getLastAgentByCard(cardId)) return null;
  const cadrage = await ouvrirLeCadrage(cardId);
  if (!cadrage) return null;
  const demande = demandeAfficheeDeProposition(card);
  const jalon = ajouterAuJournal({
    cardId,
    phase: phaseDeLaCarte(cardId, cadrage.role),
    nature: 'jalon',
    libelle: 'Demande',
    agentId: cadrage.id,
    agentRole: cadrage.role,
    resultat: demande.texte,
    donnees: demande.resume ? { resumeDemande: demande.resume } : undefined,
  });
  if (jalon) bus.emit({ type: 'journal.entree', entree: jalon });
  void sendPrompt(cadrage.id, demandeDeCadrageDeProposition(card), { template: 'none', silent: true }).catch((err) =>
    log.error(`le cadrage de la proposition « ${card.title} » n'a pas pu partir`, err),
  );
  return cadrage;
}

/**
 * L'agent de cadrage d'une carte QUEL QUE SOIT son rang — même quand un agent
 * de tâche a pris le relais après lui.
 */
export function cadrageDeLaCarte(cardId: string): Agent | null {
  return store.getCadrageAgentByCard(cardId);
}

/**
 * UNE CARTE PRÊTE À PUBLIER QUI REÇOIT UN MESSAGE ROUVRE SON CADRAGE — SANS
 * BOUGER DU TABLEAU.
 *
 * L'agent de cadrage d'origine reprend la discussion — ou naît, pour une carte
 * qui n'en a jamais eu (proposée par le chef, écrite à la main). La date de
 * réouverture est posée, UNE fois, pour que les messages suivants de la même
 * relance ne la repoussent pas (`shared/src/relance-apres-rapport.ts`).
 *
 * LA CARTE, ELLE, NE CHANGE PLUS DE COLONNE ICI. Un message peut n'être qu'une
 * QUESTION sur le travail rendu : la sortir du lot à publier dès sa réception
 * vidait « À déployer » sur une simple demande d'explication. C'est le RENDU
 * DE COMPRÉHENSION du cadrage qui la renvoie en « Demande », et lui seul
 * (`colonneApresComprehensionDeRelance`, `server/src/tools.ts`) : l'agent de
 * cadrage a alors tranché qu'un nouveau travail se prépare.
 *
 * L'agent de tâche n'est pas touché, ni `doneAt` ni le code enregistré : le
 * lancement les reprend.
 */
export async function rouvrirLeCadrage(cardId: string): Promise<Agent | null> {
  const card = store.getCard(cardId);
  if (!card) return null;
  const agent =
    cadrageDeLaCarte(cardId) ?? agentDeLaCarteRenduAuCadrage(card) ?? (await creerLAgentDeCadrage(card));
  const fraiche = store.getCard(cardId);
  if (fraiche && !fraiche.parcours?.cadrageRouvertA) {
    const rouverte = store.saveCard({
      ...fraiche,
      parcours: { ...(fraiche.parcours ?? { plans: [] }), cadrageRouvertA: Date.now(), incident: undefined },
    });
    bus.emit({ type: 'card.upsert', card: rouverte });
  }
  return agent;
}

/**
 * L'AGENT UNIQUE DE LA CARTE REPREND LA DISCUSSION APRÈS LA LIVRAISON.
 *
 * Une carte cadrée depuis l'agent unique (`shared/src/agent-unique-de-carte.ts`)
 * n'a plus d'agent de cadrage à part : c'est son agent d'exécution qui a
 * discuté, puis travaillé. Un message sous le rapport le RAMÈNE donc au
 * cadrage — même identifiant, même fil —, au lieu de faire naître un second
 * agent qui ne saurait rien du travail livré. Il quitte la copie de travail,
 * refermée à la livraison, pour son espace de cadrage. Un agent encore au
 * travail n'est jamais retourné : le cadrage naît alors à part, comme avant.
 */
function agentDeLaCarteRenduAuCadrage(card: NonNullable<ReturnType<typeof store.getCard>>): Agent | null {
  const agent = card.agentId ? store.getAgent(card.agentId) : null;
  if (!agent || agent.role !== 'task' || agent.cardId !== card.id || isRunning(agent.id)) return null;
  const rendu = store.saveAgent({
    ...agent,
    role: 'cadrage',
    status: 'idle',
    workdir: undefined,
    briefingDExecutionAttendu: undefined,
  });
  bus.emit({ type: 'agent.upsert', agent: rendu });
  return rendu;
}

async function creerLAgentDeCadrage(card: NonNullable<ReturnType<typeof store.getCard>>): Promise<Agent> {
  const engines = await listEngines();
  const settings = store.getSettings();
  const project = store.getProject(card.projectId);

  /*
   * LE MOTEUR SUIT LA CARTE, PUIS LE PROJET. Une carte posée avec des réglages
   * (héritage d'une proposition) garde son moteur ; sinon c'est celui du
   * projet, comme pour toute autre conversation.
   */
  const engineId = card.run?.engine ?? project?.defaultEngine ?? 'claude';
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];
  /*
   * LE MODÈLE DE LA DISCUSSION EST CELUI QU'ON VOIT EN HAUT D'ELLE, dans cet
   * ordre : celui posé sur LA CARTE (la barre d'écriture d'un cadrage écrit
   * `card.run`), puis le réglage de cadrage retenu, puis les défauts du PROJET,
   * puis le défaut du moteur. Aucun de ces quatre n'est un modèle choisi pour
   * son prix : l'épinglage économe a été retiré le 02/09/2026, il reprenait la
   * main sur le choix de l'utilisateur à chaque nouvelle carte.
   */
  const duCadrage = settings.cadrageEngine === engineId ? settings : undefined;
  const duProjet = project?.defaultEngine === engineId ? project : undefined;
  const voulu = card.run?.model ?? duCadrage?.cadrageModel ?? duProjet?.defaultModel;
  const cranVoulu = card.run?.thinking ?? duCadrage?.cadrageThinking ?? duProjet?.defaultThinking;
  const { model, thinking } = choixDuCadrage(
    engine?.models ?? [],
    engine?.defaultModel,
    voulu ? resolveModel(engine?.models ?? [], voulu) : undefined,
    cranVoulu,
  );

  const agent = createAgent({
    projectId: card.projectId,
    role: 'cadrage',
    title: card.title || TITRE_CARTE_DE_CADRAGE,
    cardId: card.id,
    run: { engine: engineId, model, thinking },
  });
  bus.emit({ type: 'agent.upsert', agent });

  /*
   * LA CARTE AFFICHE LE RÉGLAGE DE SA CONVERSATION, et rien d'autre : le
   * composant de saisie (`web/src/components/composer.tsx`) lit `card.run`
   * pendant un cadrage, pas le réglage de l'agent qui discute. On y recopie
   * donc le moteur, le modèle et la réflexion qui viennent d'être retenus,
   * c'est-à-dire le choix de l'utilisateur.
   *
   * On n'y écrit PLUS le palier « léger » traduit en modèle : ce que la carte
   * montrait n'était pas ce qui allait tourner, et un modèle bon marché
   * s'installait sur la carte avant même le premier échange. Une carte qui a
   * DÉJÀ un modèle (reprise, héritage d'une proposition) n'est jamais touchée.
   */
  if (!card.run?.model) {
    const fraiche = store.saveCard({
      ...card,
      run: { ...(card.run ?? {}), engine: engineId, model, thinking },
    });
    bus.emit({ type: 'card.upsert', card: fraiche });
  }

  return agent;
}

/**
 * L'agent de cadrage d'une carte, s'il en a un — et seulement lui. Sert à
 * décider ce que le lancement doit reprendre (`startCard`). Une carte déjà
 * lancée a un agent de tâche plus récent : elle ne rend donc rien ici.
 */
export function agentDeCadrage(cardId: string): Agent | null {
  const dernier = store.getLastAgentByCard(cardId);
  return dernier && dernier.role === 'cadrage' ? dernier : null;
}

/** Les envois récents : un envoi rejoué (double clic, reconnexion) ne crée pas une seconde carte. */
const nouvellesCartesRecentes = new Map<string, { cardId: string; at: number }>();
const FENETRE_ENVOI_REJOUE_MS = 60_000;

/**
 * UN MESSAGE SUR UNE CARTE DÉJÀ EN LIGNE DEVIENT UNE NOUVELLE CARTE.
 *
 * Le travail d'une carte « Archivé » avec sa date de mise en ligne est publié :
 * on ne le réécrit pas sur place (`messageOuvreUneNouvelleCarte`). Le texte et
 * les pièces jointes du message ouvrent donc une carte neuve du même projet —
 * elle naît dans « Planifié », comme celle du « + » —, dont le cadrage reçoit
 * le message exactement comme un premier message tapé dans une carte vide.
 * RIEN NE PART AU MOTEUR AVANT LE LANCEMENT : c'est un tour de cadrage.
 *
 * L'ancienne carte n'est pas touchée, hors une note qui pointe vers la
 * nouvelle (une proposition déjà acceptée, que le fil affiche comme un lien).
 * Un envoi rejoué dans la minute rend la même carte au lieu d'en créer une
 * autre. Le verrou de publication est vérifié par l'appelant, AVANT.
 */
export async function ouvrirUneNouvelleCarteDepuis(
  agentId: string,
  texte: string,
  attachments: string[] = [],
): Promise<Card | null> {
  const agent = store.getAgent(agentId);
  const mere = agent?.cardId ? store.getCard(agent.cardId) : null;
  if (!agent || !mere) return null;

  const cle = `${agentId}\n${texte}\n${attachments.join(',')}`;
  const maintenant = Date.now();
  for (const [autre, vu] of nouvellesCartesRecentes) {
    if (maintenant - vu.at > FENETRE_ENVOI_REJOUE_MS) nouvellesCartesRecentes.delete(autre);
  }
  const deja = nouvellesCartesRecentes.get(cle);
  const dejaCree = deja ? store.getCard(deja.cardId) : null;
  if (dejaCree) return dejaCree;

  const card = createCard(mere.projectId, { title: TITRE_CARTE_DE_CADRAGE, origin: 'user', cadrage: true });
  nouvellesCartesRecentes.set(cle, { cardId: card.id, at: maintenant });
  bus.emit({ type: 'card.upsert', card });

  const cadrage = await ouvrirLeCadrage(card.id);
  if (!cadrage) return card;

  const titreDeLaNote = (texte.trim().split('\n')[0] ?? '').slice(0, 80) || TITRE_CARTE_DE_CADRAGE;
  const note = store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId,
      role: 'assistant',
      content:
        "Cette carte est déjà en ligne : je ne la modifie pas sur place. Votre message a ouvert une nouvelle carte, qui suit tout le parcours.",
      proposals: [
        {
          id: store.newId(),
          title: titreDeLaNote,
          decision: 'accepted',
          cardId: card.id,
          decidedAt: store.now(),
        },
      ],
      createdAt: store.now(),
    }),
  );
  bus.emit({ type: 'message.upsert', message: note });

  void sendPrompt(cadrage.id, texte, { attachments }).catch((err) =>
    log.error(`le cadrage de la carte ouverte depuis « ${mere.title} » n'a pas pu partir`, err),
  );
  return card;
}
