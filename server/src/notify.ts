import {
  type FamilleNotification,
  type MotifNotification,
  cleEvenement,
  corpsNotification,
  dansLesHeuresDeSilence,
  emojiDuMotif,
  evenementDejaVu,
  familleDuMotif,
  interrompt,
  resumeGroupe,
  titreNotification,
  totalDesRendus,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getCard, getProject, getSettings, projectsWithFinishedWork } from './store.js';

/**
 * Le guichet UNIQUE des notifications. Tout ce que le démon veut annoncer passe
 * ici, et trois filtres se posent dans cet ordre :
 *
 *  1. le MOTIF est-il l'un des TROIS qui alertent — une attente, une tâche
 *     finie, une erreur ? Sinon rien ne part, ni sur le téléphone ni à l'écran :
 *     l'événement se lit là où on le cherche déjà. Les règles sont dans
 *     `shared/src/notification-tri.ts`, et le second canal les applique aussi.
 *  2. la famille est-elle activée, et sommes-nous hors des heures de silence ?
 *  3. cet ÉVÉNEMENT a-t-il déjà été annoncé ? Deux endroits du code qui
 *     décrivent la même chose ne font qu'une alerte.
 *
 * Ce qui passe est ensuite regroupé quatre secondes par famille — et le groupe
 * NOMME ses éléments, il ne se contente pas de les compter.
 */

interface Pending {
  famille: FamilleNotification;
  /** Le motif du premier événement du groupe : il choisit l'image affichée. */
  motif: MotifNotification;
  /** Ce qui nomme chaque élément du groupe : titres de cartes, noms de comptes… */
  libelles: string[];
  title: string;
  body: string;
  /** La phrase déjà rédigée à dire à voix haute (résumé de la réponse), s'il y en a une. */
  voix?: string;
  cardId?: string;
  projectId?: string;
  /** L'agent où répondre quand l'événement ne tient à aucune carte (question
      du chef d'orchestre) : perdu dès qu'un groupe mélange deux agents. */
  agentId?: string;
  /** Le projet nommé en tête du titre, tant que tous les événements du groupe viennent de lui. */
  projet?: string;
  /** Le compte VISÉ, quand l'alerte ne s'adresse pas aux administrateurs. */
  pour?: string;
  /** L'adresse toute faite où mène l'appui (espace client) : perdue dès qu'un groupe mélange deux lieux. */
  url?: string;
  timer: NodeJS.Timeout;
}

/**
 * LES GROUPES SONT PAR FAMILLE **ET PAR DESTINATAIRE**. Un seul groupe par
 * famille mélangerait l'alerte d'un client et celle de Haiko dans un même
 * envoi : l'un recevrait le titre de l'autre. La clé est donc
 * « famille|compte-visé », et « famille| » pour les administrateurs.
 */
const pending = new Map<string, Pending>();

function cleDeGroupe(famille: FamilleNotification, pour?: string): string {
  return `${famille}|${pour ?? ''}`;
}
const GROUP_WINDOW_MS = 4000;

/** Les événements déjà annoncés, pour ne jamais les dire deux fois. */
const vus = new Map<string, number>();

function allowed(famille: FamilleNotification): boolean {
  const settings = getSettings();
  switch (famille) {
    case 'done':
      return settings.notifyOnDone;
    case 'failed':
      return settings.notifyOnFailed;
    case 'proposal':
      return settings.notifyOnProposal;
    case 'deploy':
      return settings.notifyOnDeploy;
    default:
      return true;
  }
}

function inQuietHours(): boolean {
  const settings = getSettings();
  // La même règle sert à l'amorçage des fenêtres de quota : une seule plage de
  // silence, décrite au même endroit (voir [[amorce]]).
  return dansLesHeuresDeSilence(new Date().getHours(), settings.quietHoursStart, settings.quietHoursEnd);
}

export function notify(input: {
  /** Ce qui s'est passé, en un mot : c'est lui qui décide d'interrompre ou non. */
  motif: MotifNotification;
  title: string;
  body: string;
  /**
   * L'objet dont parle l'événement (une carte, un compte, une publication).
   * Deux appels de même motif et même référence sont le MÊME événement.
   */
  reference?: string;
  /** Ce qui nomme l'élément dans un groupe. À défaut, le titre de la carte. */
  element?: string;
  /**
   * Une phrase déjà rédigée à dire à voix haute (résumé du vrai contenu de la
   * réponse), quand l'appelant a pu la tirer. La voix la préfère au repli par
   * titre. Perdue si l'événement se fond dans un groupe (le résumé ne vaut que
   * pour UNE tâche).
   */
  voix?: string;
  cardId?: string;
  projectId?: string;
  /** L'agent où la décision se prend, quand elle ne tient à aucune carte. */
  agentId?: string;
  /**
   * LE COMPTE VISÉ. Absent, l'alerte va aux ADMINISTRATEURS — c'est le
   * comportement historique du démon. Présent, elle ne va QU'À lui : c'est ce
   * qui permet d'alerter un client sans faire sonner le téléphone de Haiko.
   */
  pour?: string;
  /** L'adresse où mène l'appui, quand l'appelant la connaît mieux que le service worker. */
  url?: string;
}): void {
  const famille = familleDuMotif(input.motif);
  const cle = cleDeGroupe(famille, input.pour);

  /*
   * TROIS MOTIFS ALERTENT, PAS UN DE PLUS (`shared/src/notification-tri.ts`) :
   * une attente, une tâche finie, une erreur. Ce qui n'entre dans aucun des
   * trois ne descend même plus en message passager : la charge de la machine se
   * lit sur la jauge de capacité, un quota sur son volet, une liste cochée sur
   * le repère des tâches, un redémarrage sur le bouton qui le réclame. On coupe
   * l'alerte, pas la trace — le journal du serveur, lui, garde tout.
   */
  if (!interrompt(input.motif)) return;

  if (!allowed(famille) || inQuietHours()) return;

  // Un même événement, deux endroits du code : une seule alerte.
  const reference = `${input.pour ?? ''}${input.reference ?? input.cardId ?? input.projectId ?? input.title}`;
  if (evenementDejaVu(vus, cleEvenement(input.motif, reference), Date.now())) return;

  /*
   * L'AVANCE : quand une phrase parlée est déjà décidée (fin de tâche,
   * publication terminée ou en échec), on prépare son son AUSSITÔT — avant même
   * que le navigateur ne le demande. Le fichier gardé sera alors déjà là, et
   * l'annonce démarrera sans délai. Fabrication en arrière-plan, jamais
   * bloquante ; un échec est sans conséquence (repli sur la voix du navigateur).
   */
  if (input.voix) {
    void import('./voice.js')
      .then((v) => v.precharger(input.voix!))
      .catch(() => undefined);
  }

  /*
   * Le nom du projet et la description de la carte sont ajoutés ICI, une fois
   * pour toutes : les endroits qui appellent `notify` n'ont pas à y penser, et
   * l'alerte dit toujours de quoi elle parle.
   */
  const projet = input.projectId ? (getProject(input.projectId)?.name ?? undefined) : undefined;
  const carte = input.cardId ? (getCard(input.cardId) ?? undefined) : undefined;
  const libelle = input.element ?? carte?.title ?? input.title;

  /*
   * Le TITRE nomme l'action, pas le genre : le titre réel de la carte quand il
   * y en a une, sinon l'objet précis de l'événement (le libellé passé par
   * l'appelant, déjà spécifique — « Le serveur redémarre », « Publication
   * terminée »). Un emoji l'ouvre selon le genre : c'est le repère visuel qui
   * survit sur un téléphone.
   */
  const emoji = emojiDuMotif(input.motif);
  const action = carte?.title?.trim() || input.title;

  const existing = pending.get(cle);
  if (existing) {
    clearTimeout(existing.timer);
    existing.libelles.push(libelle);
    // Un groupe qui mélange deux projets ne peut plus en nommer un seul.
    if (existing.projet && existing.projet !== projet) existing.projet = undefined;
    existing.cardId = undefined; // un groupe ne pointe plus vers une carte précise
    existing.agentId = undefined; // ni vers une conversation précise
    existing.voix = undefined; // un résumé ne vaut que pour UNE tâche, pas pour un lot
    if (existing.url !== input.url) existing.url = undefined; // deux fiches : l'appui ouvre l'espace
    existing.timer = setTimeout(() => flush(cle), GROUP_WINDOW_MS);
    return;
  }

  pending.set(cle, {
    famille,
    pour: input.pour,
    motif: input.motif,
    libelles: [libelle],
    title: titreNotification(action, projet, emoji),
    body: corpsNotification(input.body, carte, action),
    voix: input.voix,
    cardId: input.cardId,
    projectId: input.projectId,
    agentId: input.agentId,
    projet,
    url: input.url,
    timer: setTimeout(() => flush(cle), GROUP_WINDOW_MS),
  });
}

/**
 * Vide tout de suite les groupes en attente, et REND LA MAIN quand les
 * appareils ont été servis. Utile au seul endroit où l'on n'a pas quatre
 * secondes devant soi : le serveur qui s'arrête pour repartir.
 */
export async function viderLesGroupes(): Promise<void> {
  const envois: Promise<void>[] = [];
  for (const [cle, entry] of [...pending]) {
    clearTimeout(entry.timer);
    envois.push(flush(cle));
  }
  await Promise.all(envois);
}

function flush(cle: string): Promise<void> {
  const entry = pending.get(cle);
  if (!entry) return Promise.resolve();
  pending.delete(cle);
  const famille = entry.famille;

  // À plusieurs, le titre compte et le corps ÉNUMÈRE : « 3 tâches terminées »
  // seul obligerait à ouvrir l'application pour savoir lesquelles.
  const groupe =
    entry.libelles.length > 1 ? resumeGroupe(famille, entry.libelles, entry.projet, emojiDuMotif(entry.motif)) : null;
  const payload = {
    title: groupe?.titre ?? entry.title,
    body: groupe?.corps ?? entry.body,
    // Le résumé parlé ne suit que l'événement SEUL : un groupe l'a déjà effacé.
    voix: groupe ? undefined : entry.voix,
    tag: famille,
    // Le MOTIF voyage jusqu'au bout : c'est lui qui choisit l'image affichée,
    // côté onglet ouvert comme côté service worker. Un groupe garde le motif du
    // premier événement — ils sont de la même famille, donc du même genre.
    motif: entry.motif,
    cardId: entry.cardId,
    projectId: entry.projectId,
    agentId: entry.agentId,
    url: entry.url ?? (entry.pour ? '/' : undefined),
  };
  /*
   * Vers les onglets ouverts… mais `notify` n'est PAS un événement ouvert aux
   * clients (`EVENEMENTS_CLIENT`) : une alerte visant un client s'affiche par
   * `toast.client`, posé par l'appelant, jamais par ce canal-ci.
   */
  if (!entry.pour) bus.emit({ type: 'notify', ...payload });
  /*
   * …et vers les appareils où l'application est installée mais fermée. On y
   * joint le compte des réponses non lues : c'est ce qui pose le chiffre sur
   * l'icône de l'application, sans qu'on ait besoin de l'ouvrir.
   */
  const nonLues = entry.pour ? undefined : totalDesRendus(projectsWithFinishedWork());
  return import('./push.js').then(({ sendPush }) => sendPush({ ...payload, nonLues }, entry.pour));
}
