/**
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION, côté démon (voir [[auto-amelioration]]
 * dans `shared` pour les règles).
 *
 * Chaque nuit vers 3 h, un agent d'ANALYSE relit le mécanisme de Beluga Build et
 * propose au plus trois améliorations réelles. Il ne modifie rien : ses
 * trouvailles deviennent, SANS clic, des cartes posées dans « À planifier » et
 * étiquetées « auto amélioration » — c'est ce rendez-vous, et lui seul, qui se
 * conclut tout seul. Leur LANCEMENT reste un geste de l'utilisateur, au réveil.
 *
 * CHACUNE DE CES CARTES SUIT ENSUITE LE MÊME CHEMIN QUE LES AUTRES : elle reçoit
 * son agent de CADRAGE et son premier tour (`ouvrirLesCadragesDeLaNuit`), donc
 * son déroulé habituel de cadrage dans la conversation, arrêté à la
 * compréhension — et une barre d'écriture vivante, pour qu'on puisse lui
 * répondre au lieu de seulement la commenter.
 *
 * Le projet examiné est Beluga Build LUI-MÊME (`project.isSelf`) : c'est de sa
 * propre progression qu'il s'agit, et lancer une analyse nocturne sur chaque
 * projet du serveur noierait tous les tableaux à la fois.
 *
 * Rien ici ne doit gêner le reste du démon : un seul passage à la fois, la date
 * du rendez-vous notée AVANT le lancement (un agent lent ne doit pas être relancé
 * dix minutes plus tard), et le moindre échec journalisé plutôt que propagé.
 */

import {
  ATTENTE_PLACE_MAX_MS,
  consigneDAutoAmelioration,
  demandeDeCadrageDeLaNuit,
  decisionDuRendezVous,
  descriptionDuRendezVous,
  heritageAnalyseDeProposition,
  LABEL_AUTO_AMELIORATION,
  LABEL_RENDEZ_VOUS_DE_NUIT,
  propositionsEnAttente,
  raisonDite,
  rapportDuRendezVous,
  runPlancherAutomatique,
  titreDuRendezVous,
  trierParInteret,
} from '@beluga/shared';
import type { Card, MoteurCatalogue, Project, RaisonDeSauter, TaskProposal } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { bus } from './bus.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent, rangerCarteDAgent } from './carte-d-agent-demon.js';
import { createCard } from './tools.js';
import { ouvrirLeCadrage } from './cadrage.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { canStartAgent } from './capacity.js';
import { noterUneProposition } from './jugement-rapide.js';
import * as store from './store.js';
import { unitesARelireCetteNuit } from './memoire-de-nuit.js';

/**
 * LA RELECTURE DES UNITÉS DE LA JOURNÉE : les unités de la base de
 * connaissances du projet (et du global) qu'un agent a écrites ou modifiées
 * depuis la veille, relevées par le passage de nuit. L'analyse ne réécrit rien :
 * elle PROPOSE une carte de relecture quand deux unités disent la même chose,
 * ou qu'une contredit une plus ancienne.
 */
function relectureDesFiches(projectId: string): string {
  const unites = unitesARelireCetteNuit().filter((u) => u.portee === projectId || u.portee === 'global');
  if (!unites.length) return '';
  return (
    '\n\nUNITÉS DE LA BASE DE CONNAISSANCES MODIFIÉES DEPUIS HIER — lis-les avec l’outil « memoire » (geste « lire », « id ») : ' +
    unites.map((u) => `${u.id} « ${u.titre} »${u.portee === 'global' ? ' (global)' : ''} par ${u.auteur || '—'}`).join(', ') +
    '. Si deux d’entre elles disent la même chose, ou si l’une contredit une plus ancienne, propose UNE carte de relecture qui les fusionne ou déprécie la fausse, sans perdre aucun fait.'
  );
}

/** L'instant du dernier rendez-vous, tenu ou seulement tenté. */
const CLE_DERNIER_PASSAGE = 'auto-amelioration.dernier-passage';

/**
 * Depuis quand le rendez-vous ATTEND une place pour la nuit en cours — posée
 * dès le premier refus « travail-en-cours », effacée dès que le tour part
 * (ou que la nuit est abandonnée, `ATTENTE_PLACE_MAX_MS` dépassé). C'est elle qui
 * permet aux essais suivants de continuer même une fois sorti de la fenêtre
 * 3 h-5 h, au lieu de se faire refuser pour « pas-l-heure » à 6 h.
 */
const CLE_ATTENTE_DEPUIS = 'auto-amelioration.attente-depuis';

function attenteDepuis(): number | undefined {
  const brut = getMeta(CLE_ATTENTE_DEPUIS);
  const valeur = brut ? Number(brut) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

/**
 * À quel rythme on REGARDE si le rendez-vous doit partir. Dix minutes : assez
 * fin pour que le report « un travail est en cours » se rejoue plusieurs fois
 * dans la fenêtre de trois heures, assez peu pour que le coût soit nul (une
 * lecture de base et un compteur d'agents).
 */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

/** Un seul rendez-vous à la fois : deux ne doivent jamais se chevaucher. */
let enCours = false;

export function dernierPassage(): number | undefined {
  const brut = getMeta(CLE_DERNIER_PASSAGE);
  const valeur = brut ? Number(brut) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

/**
 * Le projet examiné : Beluga Build lui-même, s'il est inscrit et pas mis de côté.
 * Un projet archivé ne s'améliore plus.
 */
export function projetDuRendezVous(): Project | undefined {
  return store.listProjects().find((projet) => projet.isSelf && !projet.archived);
}

/**
 * Fait naître, SANS clic, une carte réelle dans « À planifier » pour chaque
 * proposition encore en attente du tour de la nuit — étiquetée « auto
 * amélioration » en plus des étiquettes que l'agent lui a déjà posées.
 *
 * Ce rendez-vous n'a personne pour valider au réveil : c'est la SEULE
 * différence avec le clic de l'utilisateur sur une proposition ordinaire
 * (`proposal.decide` dans `ws.ts`), dont cette fonction rejoue exactement le
 * geste — même appel à `createCard`, même mise à jour de la proposition et du
 * message, pour que le fil de la conversation les montre déjà décidées.
 *
 * Rend les cartes réellement posées : leur NOMBRE est ce qui compte au réveil,
 * et la LISTE sert juste après à ouvrir le cadrage de chacune
 * (`ouvrirLesCadragesDeLaNuit`).
 */
/**
 * NOTE LES PROPOSITIONS DE LA NUIT, AVANT QU'ELLES NE DEVIENNENT DES CARTES.
 *
 * Deux notes par proposition — le gain attendu, l'ampleur du travail — d'où un
 * rang (`rangDUneProposition`). Elles ne changent QUE L'ORDRE : la nuit continue
 * de proposer tout ce qu'elle a trouvé, et une note basse ne retire, ne refuse
 * ni ne fusionne rien.
 *
 * Tout échec est SANS CONSÉQUENCE : juge éteint, clé absente, service lent ou en
 * panne, la proposition repart sans note et l'ordre d'écriture tient. Cette
 * fonction ne lève donc jamais — une nuit d'analyse ne peut pas tomber à cause
 * d'un avis qu'on ne lui a pas demandé.
 *
 * Rend le nombre de propositions réellement notées, pour le journal.
 */
export async function noterLesPropositionsDeLaNuit(agentId: string): Promise<number> {
  try {
    const messages = store.listMessages(agentId);
    const enAttente = propositionsEnAttente(
      messages.map((message) => ({ id: message.id, agentId, proposals: message.proposals })),
    );
    if (!enAttente.length) return 0;
    const projectId = store.getAgent(agentId)?.projectId;
    if (!projectId) return 0;
    /*
     * TOUTES EN PARALLÈLE : chaque jugement tient sous son propre délai court,
     * et les enchaîner ferait attendre la nuit pour rien.
     */
    const notes = await Promise.all(
      enAttente.map(({ proposal }) =>
        noterUneProposition({ titre: proposal.title, description: proposal.description }, { projectId }).catch(
          () => undefined,
        ),
      ),
    );
    let notees = 0;
    for (const [index, { messageId, proposal }] of enAttente.entries()) {
      const interet = notes[index];
      if (!interet) continue;
      /*
       * ON RELIT LE MESSAGE À CHAQUE ÉCRITURE : deux propositions peuvent
       * partager le même message, et repartir d'un instantané lu avant la
       * boucle écraserait la note de la précédente.
       */
      const message = store.listMessages(agentId).find((candidat) => candidat.id === messageId);
      if (!message) continue;
      const notee: TaskProposal = { ...proposal, interet };
      store.saveProposal(messageId, projectId, notee);
      const remis = store.saveMessage({
        ...message,
        proposals: message.proposals.map((p) => (p.id === proposal.id ? notee : p)),
      });
      bus.emit({ type: 'message.upsert', message: remis });
      notees += 1;
    }
    return notees;
  } catch (err) {
    log.warn('auto-amélioration : les propositions n’ont pas pu être notées', err);
    return 0;
  }
}

export function accepterPropositionsDeLaNuit(agentId: string, catalogue: MoteurCatalogue[] = []): Card[] {
  const messages = store.listMessages(agentId);
  // Deux propositions PENDING peuvent partager le même message : chaque
  // acceptation doit repartir du message déjà mis à jour par la précédente,
  // jamais de l'instantané lu avant la boucle — sinon la seconde écrase la
  // première en réécrivant son tableau `proposals` d'avant tour.
  const parMessage = new Map(messages.map((message) => [message.id, message]));
  const enAttente = propositionsEnAttente(
    messages.map((message) => ({ id: message.id, agentId, proposals: message.proposals })),
  );
  const agent = store.getAgent(agentId)!;
  const posees: Card[] = [];
  /*
   * LES PLUS RENTABLES D'ABORD, ET AUCUNE PERDUE. Quand le juge rapide a noté
   * les propositions (`noterLesPropositionsDeLaNuit`), leurs cartes naissent
   * dans l'ordre de leur rang : au réveil, la colonne montre en tête ce qui
   * rapporte le plus pour le moins d'effort. Sans note — juge éteint, service
   * injoignable —, `trierParInteret` rend l'ordre d'écriture tel quel, et
   * AUCUNE proposition n'est écartée dans un cas comme dans l'autre.
   */
  const ordonnees = trierParInteret(enAttente, ({ proposal }) => proposal.interet?.rang);
  for (const { messageId, proposal } of ordonnees) {
    const message = parMessage.get(messageId);
    if (!message) continue;

    const labels = [...new Set([...(proposal.labels ?? []), LABEL_AUTO_AMELIORATION])];
    const heritage = heritageAnalyseDeProposition(proposal, proposal.title, proposal.description);
    const card = createCard(agent.projectId, {
      title: proposal.title,
      description: proposal.description,
      labels,
      origin: 'agent',
      // JAMAIS LE PALIER LE PLUS FAIBLE SANS CLIC : personne n'est là pour
      // corriger le réglage, et le cadrage reprend le modèle de la carte.
      // Appliqué AVANT la création : un modèle posé n'est plus réécrit.
      run: runPlancherAutomatique(proposal.run ?? { engine: store.getProject(agent.projectId)?.defaultEngine ?? 'claude' }, catalogue),
      attachments: proposal.attachments,
      // La synthèse ouvre la conversation de la carte, ici comme ailleurs :
      // au réveil, on lit ce que l'agent de la nuit a constaté avant même de
      // lancer quoi que ce soit.
      briefing: proposal.briefing,
      auteur: 'nuit',
      // AUCUNE DATE : l'agent de la nuit n'est pas l'utilisateur. Une carte
      // proposée seule attend « Lancer » ou une programmation à la main.
      origineAgentId: agentId,
      origineAt: message.createdAt,
      ...heritage,
    });
    bus.emit({ type: 'card.upsert', card });
    posees.push(card);

    const decided: TaskProposal = { ...proposal, labels, decision: 'accepted', cardId: card.id, decidedAt: Date.now() };
    store.saveProposal(messageId, card.projectId, decided);
    const updatedMessage = store.saveMessage({
      ...message,
      proposals: message.proposals.map((p) => (p.id === proposal.id ? decided : p)),
    });
    parMessage.set(messageId, updatedMessage);
    bus.emit({ type: 'message.upsert', message: updatedMessage });
  }
  if (posees.length) bus.emit({ type: 'attention', ...store.signalAttention() });
  return posees;
}

/**
 * CHAQUE CARTE DE LA NUIT NAÎT AVEC SA CONVERSATION DE CADRAGE, ET LE PROCESSUS
 * HABITUEL S'Y JOUE.
 *
 * Une carte posée par le rendez-vous n'avait AUCUN agent : son constat
 * s'affichait en premier message, mais la barre d'écriture restait éteinte —
 * on ne pouvait que commenter la carte, jamais lui parler ni la faire affiner.
 * Elle reçoit donc le même agent de cadrage que la carte née du « + » de
 * « À planifier » (`ouvrirLeCadrage`), et cette fonction lui envoie le premier
 * tour : le déroulé habituel de cadrage se joue tout seul jusqu'à la
 * compréhension — jamais jusqu'au plan —, et il se lit au réveil dans la
 * conversation de la carte.
 *
 * UN CADRAGE PAR CARTE, L'UN APRÈS L'AUTRE : trois moteurs lancés d'un coup à
 * 3 h du matin prendraient toute la place, et ces tours-là sont économes mais
 * pas gratuits. Un échec sur une carte n'emporte pas les suivantes : la carte
 * garde son agent, et l'utilisateur peut lui écrire au réveil.
 *
 * Rend le nombre de cadrages réellement partis.
 */
export async function ouvrirLesCadragesDeLaNuit(cartes: Card[], nomDuProjet: string): Promise<number> {
  let partis = 0;
  for (const carte of cartes) {
    try {
      const cadrage = await ouvrirLeCadrage(carte.id);
      if (!cadrage) {
        log.warn(`auto-amélioration : aucun agent de cadrage pour « ${carte.title} »`);
        continue;
      }
      /*
       * `silent` : le constat de la nuit ouvre DÉJÀ la conversation de la carte
       * (`filAvecLaSynthese`, le champ `briefing`). Écrire la demande une
       * seconde fois en bulle d'utilisateur la redirait mot pour mot — elle se
       * lit dans le tiroir du prompt envoyé, comme tout appel interne.
       * `template: 'none'` : un cadrage ne rend pas un compte rendu à titres.
       */
      await sendPrompt(cadrage.id, demandeDeCadrageDeLaNuit(carte, nomDuProjet), {
        template: 'none',
        silent: true,
      });
      partis += 1;
    } catch (err) {
      log.error(`auto-amélioration : le cadrage de « ${carte.title} » a échoué`, err);
    }
  }
  return partis;
}

/**
 * LES CARTES DES NUITS PASSÉES SONT RATTRAPÉES À L'OUVERTURE.
 *
 * Le rendez-vous donne désormais sa conversation à chaque carte qu'il pose —
 * mais celles déjà sur le tableau, posées avant cette règle, restent muettes :
 * aucun agent, donc une barre d'écriture éteinte. La première fois qu'on ouvre
 * l'une d'elles, elle reçoit son cadrage et son premier tour, sous les yeux :
 * c'est le même processus, simplement déclenché au réveil plutôt qu'à 3 h.
 *
 * TROIS CONDITIONS, ET RIEN D'AUTRE : la carte est en « À planifier », elle porte
 * l'étiquette de la nuit, et elle n'a AUCUN agent. Une carte lancée, rangée
 * ailleurs, ou venue d'une conversation ordinaire n'est jamais touchée — elle
 * garde son bouton « Lancer » et son fil.
 */
export async function rattraperLeCadrageDeLaNuit(card: Card, nomDuProjet: string): Promise<boolean> {
  if (card.column !== 'planned') return false;
  if (!card.labels.includes(LABEL_AUTO_AMELIORATION)) return false;
  if (card.agentId || card.conversationAgentId) return false;
  if (store.getLastAgentByCard(card.id)) return false;
  // Une carte d'avant le plancher peut porter le palier léger : on la relève
  // avant que son cadrage ne reprenne ce modèle.
  const plancher = runPlancherAutomatique(
    card.run ?? { engine: store.getProject(card.projectId)?.defaultEngine ?? 'claude' },
    await catalogueMoteurs().catch(() => []),
  );
  if (plancher && JSON.stringify(plancher) !== JSON.stringify(card.run)) {
    const relevee = store.saveCard({ ...card, run: plancher as Card['run'] });
    bus.emit({ type: 'card.upsert', card: relevee });
  }
  return (await ouvrirLesCadragesDeLaNuit([card], nomDuProjet)) > 0;
}

/**
 * LE TOUR A-T-IL ABOUTI ? Un moteur qui tombe (session expirée, limite du
 * compte) ne lève pas toujours d'erreur : l'agent finit « en échec » ou
 * « arrêté », et le motif est écrit sur son dernier message. Rend ce motif, ou
 * `null` quand le tour a abouti.
 */
export function panneDuTour(agentId: string): string | null {
  const agent = store.getAgent(agentId);
  if (!agent || (agent.status !== 'failed' && agent.status !== 'stopped')) return null;
  const dernier = [...store.listMessages(agentId)].reverse().find((message) => message.error);
  return dernier?.error ?? `le tour s’est arrêté sans aboutir (statut « ${agent.status} »)`;
}

/**
 * Le rendez-vous de la nuit. Appelé souvent, il ne fait presque toujours rien :
 * c'est la décision partagée qui tranche, et elle dit pourquoi.
 */
export async function rendezVousDAutoAmelioration(): Promise<{
  lance: boolean;
  /** La raison du refus, dite en clair. */
  raison?: string;
  /** Le motif brut, pour qui doit le reconnaître sans lire une phrase. */
  motif?: RaisonDeSauter;
  propositions?: number;
}> {
  if (enCours) return { lance: false, raison: 'rendez-vous déjà en cours' };

  const maintenant = Date.now();
  const projet = projetDuRendezVous();
  // Une attente PÉRIMÉE (nuit d'avant, abandonnée) ne doit pas empêcher la
  // nuit suivante d'en ouvrir une nouvelle : sans ce nettoyage, le prochain
  // refus « travail-en-cours » verrait `attente` déjà défini et ne poserait
  // pas de NOUVEAU départ d'attente, empêchant cette nuit-là de dépasser la
  // fenêtre 3 h-5 h à son tour.
  const brute = attenteDepuis();
  const attente = brute !== undefined && maintenant - brute >= ATTENTE_PLACE_MAX_MS ? undefined : brute;
  if (brute !== undefined && attente === undefined) setMeta(CLE_ATTENTE_DEPUIS, '');
  const decision = decisionDuRendezVous({
    projetPresent: !!projet,
    dernierPassage: dernierPassage(),
    maintenant,
    heureCourante: new Date(maintenant).getHours(),
    placeLibre: canStartAgent().ok,
    enAttenteDepuis: attente,
  });
  if (!decision.lancer) {
    // Le premier refus « travail-en-cours » marque le début de l'attente ;
    // les suivants ne font que la prolonger (rien à réécrire), et ne se
    // journalisent pas : ils reviendraient toutes les dix minutes pendant des
    // heures pour ne rien dire de neuf.
    if (decision.raison === 'travail-en-cours' && attente === undefined) {
      setMeta(CLE_ATTENTE_DEPUIS, String(maintenant));
      log.info(`auto-amélioration : ${raisonDite(decision.raison)}`);
    }
    return { lance: false, raison: raisonDite(decision.raison), motif: decision.raison };
  }
  // `projetPresent` vient d'être vérifié : le projet existe forcément ici.
  const cible = projet!;

  if (attente !== undefined) {
    log.info(
      `auto-amélioration : une place s'est libérée après ${Math.round((maintenant - attente) / 60000)} min d'attente`,
    );
  }
  setMeta(CLE_ATTENTE_DEPUIS, '');

  /*
   * La date est notée AVANT le tour, et non après. Un tour d'analyse peut durer
   * un long moment ; sans cette note, la veille de dix minutes le relancerait
   * pendant qu'il travaille encore. Un tour en échec consomme donc le
   * rendez-vous de la nuit — c'est voulu : mieux vaut une nuit blanche qu'une
   * boucle qui s'entête à 4 h du matin.
   */
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
  enCours = true;

  /*
   * LE RENDEZ-VOUS A SA CARTE, POSÉE AU MOMENT OÙ LE TOUR PART — jamais pendant
   * l'attente d'une place, qui peut durer des heures. Sans elle, un tour tombé
   * à 5 h 35 sur une session expirée ne laissait rien au tableau : ni carte, ni
   * panne, ni moyen d'ouvrir sa conversation (11.09.2026).
   */
  const { card: carteDuRendezVous, agentId } = ouvrirCarteDAgent({
    projectId: cible.id,
    titre: titreDuRendezVous(new Date(maintenant)),
    description: descriptionDuRendezVous(cible.name),
    labels: [LABEL_RENDEZ_VOUS_DE_NUIT],
    // Le rôle « analysis » porte déjà l'interdit d'écrire dans sa consigne, et
    // il donne accès à `propose_task` : c'est exactement ce rendez-vous. Sans
    // copie de travail, sa carte ne lui vaut pas la consigne de tâche
    // (`roleMoteur`, `runtime.ts`).
    role: 'analysis',
  });

  let panne: string | null = null;
  try {
    await sendPrompt(agentId, consigneDAutoAmelioration(cible.name) + relectureDesFiches(cible.id), {
      // Aucun gabarit de compte rendu : ce tour rend quelques lignes, pas les
      // six sections d'une tâche livrée.
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    log.error('auto-amélioration : le rendez-vous a échoué', err);
    panne = err?.message ?? 'raison inconnue';
  } finally {
    enCours = false;
  }

  /*
   * UN TOUR TOMBÉ SANS LEVER D'ERREUR EST AUSSI UNE PANNE. Le moteur peut
   * rendre la main sur un échec (session expirée, limite du compte) : c'est le
   * statut de l'agent qui le dit, et le motif se lit sur son dernier message.
   */
  panne ??= panneDuTour(agentId);
  if (panne) {
    direLaPanneSurLaCarte(carteDuRendezVous.id, agentId, panne);
    return { lance: true, raison: panne, propositions: 0 };
  }

  /*
   * LE JUGE RAPIDE NOTE D'ABORD, LA NUIT POSE ENSUITE. Sans Laya installé, cet
   * appel ne fait rien du tout et les cartes naissent dans l'ordre d'écriture,
   * comme avant (`server/src/jugement-rapide.ts`).
   */
  const notees = await noterLesPropositionsDeLaNuit(agentId);
  if (notees) log.info(`auto-amélioration : ${notees} proposition(s) notée(s) par le juge rapide`);
  const cartes = accepterPropositionsDeLaNuit(agentId, await catalogueMoteurs().catch(() => []));
  // LA CARTE DU RENDEZ-VOUS N'A RIEN À FAIRE SOUS LES YEUX AU RÉVEIL : ELLE,
  // SEULE, PART DIRECTEMENT EN ARCHIVE — pas ses propositions, qui restent
  // posées dans « Demande » comme avant. Avant cette règle, elle rejoignait
  // « À déployer » comme n'importe quelle carte réussie et encombrait la
  // colonne d'un travail que personne n'avait à publier (elle n'a ni branche
  // ni copie de travail, `carte-d-agent-demon.ts`).
  rangerCarteDAgent(carteDuRendezVous.id, agentId, 'archived', rapportDuRendezVous(cartes.map((carte) => carte.title)));
  log.info(
    `auto-amélioration : rendez-vous tenu sur ${cible.name}, ${cartes.length} carte(s) posée(s) dans « Demande »`,
  );
  /*
   * LES CARTES DE LA NUIT SUIVENT LE MÊME CHEMIN QUE LES AUTRES. Le rendez-vous
   * ne se contente plus de les poser : chacune reçoit sa conversation de
   * cadrage et son premier tour, pour qu'au réveil on lise le déroulé habituel
   * au lieu d'un message jeté là — et surtout, pour qu'on puisse LUI RÉPONDRE.
   */
  const cadrages = await ouvrirLesCadragesDeLaNuit(cartes, cible.name);
  if (cadrages) log.info(`auto-amélioration : ${cadrages} cadrage(s) ouvert(s) sur les cartes de la nuit`);
  return { lance: true, propositions: cartes.length };
}

/**
 * La veille du rendez-vous. Elle ne réveille personne : elle regarde l'heure,
 * et la décision partagée fait le reste.
 */
export function planifierAutoAmelioration(): NodeJS.Timeout {
  return setInterval(() => {
    // Un rendez-vous sauté ne se journalise pas : « ce n'est pas l'heure »
    // reviendrait des dizaines de fois par jour et remplirait le journal pour
    // rien. Le début et la fin d'une attente se journalisent déjà à l'intérieur
    // de `rendezVousDAutoAmelioration`, pas ici : sinon un manque de place se
    // redirait toutes les dix minutes pendant des heures pour ne rien apprendre
    // de neuf.
    void rendezVousDAutoAmelioration();
  }, PERIODE_DE_VEILLE_MS);
}
