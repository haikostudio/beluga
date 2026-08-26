/**
 * LE RENDEZ-VOUS D'AUTO-AMÉLIORATION, côté démon (voir [[auto-amelioration]]
 * dans `shared` pour les règles).
 *
 * Chaque nuit vers 3 h, un agent d'ANALYSE relit le mécanisme de HaikoDev et
 * propose au plus trois améliorations réelles. Il ne modifie rien : ses
 * trouvailles deviennent, SANS clic, des cartes posées dans « Planifié » et
 * étiquetées « auto amélioration » — c'est ce rendez-vous, et lui seul, qui se
 * conclut tout seul. Leur LANCEMENT reste un geste de l'utilisateur, au réveil.
 *
 * Le projet examiné est HaikoDev LUI-MÊME (`project.isSelf`) : c'est de sa
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
  decisionDuRendezVous,
  heritageAnalyseDeProposition,
  LABEL_AUTO_AMELIORATION,
  propositionsEnAttente,
  raisonDite,
  titreDuRendezVous,
} from '@haikodev/shared';
import type { Project, RaisonDeSauter, TaskProposal } from '@haikodev/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { bus } from './bus.js';
import { createAgent, sendPrompt } from './runtime.js';
import { createCard } from './tools.js';
import { canStartAgent } from './capacity.js';
import * as store from './store.js';

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
 * Le projet examiné : HaikoDev lui-même, s'il est inscrit et pas mis de côté.
 * Un projet archivé ne s'améliore plus.
 */
export function projetDuRendezVous(): Project | undefined {
  return store.listProjects().find((projet) => projet.isSelf && !projet.archived);
}

/**
 * Fait naître, SANS clic, une carte réelle dans « Planifié » pour chaque
 * proposition encore en attente du tour de la nuit — étiquetée « auto
 * amélioration » en plus des étiquettes que l'agent lui a déjà posées.
 *
 * Ce rendez-vous n'a personne pour valider au réveil : c'est la SEULE
 * différence avec le clic de l'utilisateur sur une proposition ordinaire
 * (`proposal.decide` dans `ws.ts`), dont cette fonction rejoue exactement le
 * geste — même appel à `createCard`, même mise à jour de la proposition et du
 * message, pour que le fil de la conversation les montre déjà décidées.
 *
 * Rend le nombre de cartes réellement posées : c'est le seul chiffre qui
 * compte au réveil.
 */
export function accepterPropositionsDeLaNuit(agentId: string): number {
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
  let posees = 0;
  for (const { messageId, proposal } of enAttente) {
    const message = parMessage.get(messageId);
    if (!message) continue;

    const labels = [...new Set([...(proposal.labels ?? []), LABEL_AUTO_AMELIORATION])];
    const heritage = heritageAnalyseDeProposition(proposal, proposal.title, proposal.description);
    const card = createCard(agent.projectId, {
      title: proposal.title,
      description: proposal.description,
      labels,
      origin: 'agent',
      run: proposal.run,
      attachments: proposal.attachments,
      // La synthèse ouvre la conversation de la carte, ici comme ailleurs :
      // au réveil, on lit ce que l'agent de la nuit a constaté avant même de
      // lancer quoi que ce soit.
      briefing: proposal.briefing,
      departPrevu: proposal.departPrevu,
      origineAgentId: agentId,
      origineAt: message.createdAt,
      ...heritage,
    });
    bus.emit({ type: 'card.upsert', card });
    posees += 1;

    const decided: TaskProposal = { ...proposal, labels, decision: 'accepted', cardId: card.id, decidedAt: Date.now() };
    store.saveProposal(messageId, card.projectId, decided);
    const updatedMessage = store.saveMessage({
      ...message,
      proposals: message.proposals.map((p) => (p.id === proposal.id ? decided : p)),
    });
    parMessage.set(messageId, updatedMessage);
    bus.emit({ type: 'message.upsert', message: updatedMessage });
  }
  if (posees) bus.emit({ type: 'attention', ...store.signalAttention() });
  return posees;
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

  const agent = createAgent({
    projectId: cible.id,
    // Le rôle « analysis » porte déjà l'interdit d'écrire dans sa consigne, et
    // il donne accès à `propose_task` : c'est exactement ce rendez-vous.
    role: 'analysis',
    title: titreDuRendezVous(new Date(maintenant)),
  });

  try {
    await sendPrompt(agent.id, consigneDAutoAmelioration(cible.name), {
      // Aucun gabarit de compte rendu : ce tour rend quelques lignes, pas les
      // six sections d'une tâche livrée.
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    log.error('auto-amélioration : le rendez-vous a échoué', err);
    return { lance: true, raison: err?.message ?? 'raison inconnue', propositions: 0 };
  } finally {
    enCours = false;
  }

  const propositions = accepterPropositionsDeLaNuit(agent.id);
  log.info(
    `auto-amélioration : rendez-vous tenu sur ${cible.name}, ${propositions} carte(s) posée(s) dans « Planifié »`,
  );
  return { lance: true, propositions };
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
