import {
  Agent,
  ChoixDeCompte,
  CompteConnu,
  MotifDArretQuota,
  RepriseDeCompte,
  choixPossible,
  compteDeRepriseAutomatique,
  RELEVES_EN_CHAINE_MAX,
  type ChaineDeReprise,
  comptesDeReprise,
  demandeDePassation,
  demandeDeReprise,
  jugerRepriseSurCompte,
  messageDeRefus,
  repriseSurUnAutreMoteur,
  tachesAPoursuivre,
} from '@beluga/shared';
import { execFileSync } from 'node:child_process';
import { AccountRecord, cachedQuotas, listAllAccountRecords, refreshQuotas } from './accounts.js';
import { listEngines } from './engines/index.js';
import { normaliseThinking } from './engines/catalog.js';
import { comptesEcartesParLimite } from './limites-connues.js';
import { bus } from './bus.js';
import { notify } from './notify.js';
import * as store from './store.js';
import { log } from './logger.js';

/**
 * REPRENDRE UN TRAVAIL COUPÉ PAR LA LIMITE D'UN COMPTE.
 *
 * Le compte d'un tour est choisi au lancement. Quand la limite tombe en cours
 * de route, le moteur s'arrête et, jusqu'ici, tout se terminait comme une
 * panne : agent en échec, message « Le moteur s'est arrêté (code 1) », carte
 * bloquée en « En cours ». Le travail, lui, n'avait rien de cassé.
 *
 * Ce fichier tient les trois gestes qui manquaient : POSER la décision « Avec
 * quel compte poursuivre ? », la TRANCHER au clic (en revérifiant le compte à
 * cet instant précis), et SIGNALER quand un compte se libère alors qu'aucun
 * n'était disponible. Les règles pures — reconnaître l'arrêt, classer les
 * comptes, juger le clic — vivent dans `shared/src/reprise-compte.ts`.
 *
 * On ne choisit JAMAIS en silence et on ne recommence jamais le travail : c'est
 * le MÊME agent qui repart, avec sa branche et ses étapes restantes. Le CLIC
 * peut changer de moteur ou de modèle : l'agent reçoit alors ce choix dans ses
 * réglages, et un moteur neuf ouvre un fil neuf, nourri d'une PASSATION écrite
 * (`demandeDePassation`). La relève automatique, elle, reste sur son moteur.
 */

/** Le pire des deux pourcentages consommés : ce qui classe les candidats. */
function consomme(session?: number, weekly?: number): number | undefined {
  const valeurs = [session, weekly].filter((v): v is number => typeof v === 'number');
  return valeurs.length ? Math.max(...valeurs) : undefined;
}

/** La remise à zéro la plus PROCHE d'un compte : ce qui dit quand il reviendra. */
function prochaineRemiseAZero(session?: number, weekly?: number): number | undefined {
  const valeurs = [session, weekly].filter((v): v is number => typeof v === 'number' && v > 0);
  return valeurs.length ? Math.min(...valeurs) : undefined;
}

/**
 * Les comptes tels que le dernier relevé les connaît, dans la forme que la
 * règle pure attend. On part de `cachedQuotas` : elle rejoue déjà les comptes
 * coupés avec leur drapeau, donc rien ne manque à l'appel.
 */
export function comptesConnus(): CompteConnu[] {
  const coupes = new Set(listAllAccountRecords().filter((a) => a.disabled).map((a) => a.id));
  const comptes = new Map(listAllAccountRecords().map((compte) => [compte.id, compte]));
  // Un compte à sa LIMITE CONNUE n'est pas disponible, quoi qu'en dise le
  // relevé : le moteur l'a refusé (`server/src/limites-connues.ts`).
  const ecartes = comptesEcartesParLimite();
  // Une ligne de SUIVI (Gemini) n'est pas un compte : jamais proposée pour poursuivre un tour.
  return cachedQuotas().filter((quota) => !quota.suivi).map((quota) => ({
    id: quota.id,
    label: quota.label,
    engine: quota.engine,
    disponible: quota.available !== false && !quota.disabled && !ecartes.has(quota.id),
    releveFiable: !quota.error,
    coupe: quota.disabled || coupes.has(quota.id),
    plan: quota.plan ?? comptes.get(quota.id)?.plan,
    priority: comptes.get(quota.id)?.priority ?? quota.priority,
    sessionPct: quota.session?.usedPct,
    weeklyPct: quota.weekly?.usedPct,
    consommePct: consomme(quota.session?.usedPct, quota.weekly?.usedPct),
    resetsAt: prochaineRemiseAZero(quota.session?.resetsAt, quota.weekly?.resetsAt),
  }));
}

/** Les comptes proposés À LA MAIN pour poursuivre un tour tombé sur ce compte-là, tous moteurs confondus. */
export function choixDeReprise(engine: string, compteEpuise: string): ChoixDeCompte[] {
  return comptesDeReprise(engine, compteEpuise, comptesConnus(), { tousMoteurs: true });
}

const NOM_DU_MOTEUR: Record<string, string> = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };

/** La branche réellement posée dans le dossier de l'agent — jamais devinée. */
function brancheDuDossier(dossier?: string): string | undefined {
  if (!dossier) return undefined;
  try {
    return execFileSync('git', ['-C', dossier, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * LE MODÈLE DE LA REPRISE : celui demandé s'il existe pour ce moteur ; sinon
 * le modèle actuel si le moteur ne change pas ; sinon le modèle par défaut du
 * moteur choisi — jamais un modèle d'un autre moteur.
 */
async function modeleDeLaReprise(agent: Agent, moteur: string, demande?: string): Promise<string | undefined> {
  const moteurs = await listEngines().catch(() => []);
  const info = moteurs.find((m) => m.id === moteur);
  if (demande && (!info || info.models.some((m) => m.id === demande))) return demande;
  if (moteur === agent.run.engine) return agent.run.model;
  return info?.defaultModel ?? info?.models[0]?.id;
}

/**
 * LE CHOIX DU CLIC DEVIENT LE RÉGLAGE DE L'AGENT ET DE SA CARTE : le tour qui
 * part lit `agent.run`, et la carte ne doit pas annoncer l'ancien moteur. Le
 * compte imposé du réglage tombe — celui de la reprise est imposé au tour.
 */
async function reglerLeMoteurDeLaReprise(agent: Agent, moteur: Agent['run']['engine'], modele?: string): Promise<void> {
  const moteurs = await listEngines().catch(() => []);
  const thinking = normaliseThinking(moteurs.find((m) => m.id === moteur)?.models ?? [], modele, agent.run.thinking);
  const run = { ...agent.run, engine: moteur, model: modele, thinking, account: undefined } as Agent['run'];
  const agentRegle = store.saveAgent({ ...agent, run, contextUsage: undefined });
  bus.emit({ type: 'agent.upsert', agent: agentRegle });
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  if (carte) {
    const carteReglee = store.saveCard({ ...carte, run: { ...carte.run, engine: moteur, model: modele, thinking, account: undefined } });
    bus.emit({ type: 'card.upsert', card: carteReglee });
  }
}

/** Ce que le fil neuf doit savoir : dossier, branche, plan, étapes, derniers textes. */
function passationDe(agent: Agent, messageId: string, reprise: RepriseDeCompte, compteChoisi: string, moteur: string, modele?: string) {
  const carte = agent.cardId ? store.getCard(agent.cardId) : null;
  const messages = store.listMessages(agent.id);
  const avecTaches = [...messages].reverse().find((m) => m.todos?.length);
  const plans = carte?.parcours?.plans ?? [];
  return demandeDePassation({
    compteEpuise: reprise.compteEpuiseLabel,
    compteChoisi,
    moteurAvant: NOM_DU_MOTEUR[reprise.engine] ?? reprise.engine,
    moteurApres: NOM_DU_MOTEUR[moteur] ?? moteur,
    modele,
    dossier: agent.workdir,
    branche: brancheDuDossier(agent.workdir),
    plan: plans.length ? plans[plans.length - 1].texte : undefined,
    taches: tachesAPoursuivre(avecTaches?.todos ?? []),
    derniersEchanges: messages
      .filter((m) => m.role === 'assistant' && m.id !== messageId && m.content?.trim())
      .slice(-3)
      .map((m) => m.content),
  });
}

/**
 * La décision à poser sur le message du tour. Elle ne recopie PAS la liste des
 * comptes : l'interface la calcule depuis le relevé de quota qu'elle reçoit
 * déjà, si bien qu'elle se rafraîchit toute seule quand un compte se libère.
 */
export function repriseDeCompte(entree: {
  engine: RepriseDeCompte['engine'];
  compte: AccountRecord;
  motif: MotifDArretQuota;
  /** La chaîne des relèves que cet arrêt prolonge (`chaineDeReprise`). */
  chaine?: ChaineDeReprise;
}): RepriseDeCompte {
  const quota = cachedQuotas().find((q) => q.id === entree.compte.id);
  return {
    engine: entree.engine,
    compteEpuise: entree.compte.id,
    compteEpuiseLabel: entree.compte.label,
    resetsAt: prochaineRemiseAZero(quota?.session?.resetsAt, quota?.weekly?.resetsAt),
    motif: entree.motif,
    comptesEssayes: entree.chaine?.comptesEssayes,
    relevesEnChaine: entree.chaine?.relevesEnChaine,
    at: Date.now(),
  };
}

/**
 * LA RELÈVE QUI A LANCÉ LE TOUR QUI VIENT DE TOMBER, s'il en était une : la
 * dernière reprise choisie dans le fil de l'agent, hors le message du tour
 * lui-même. C'est elle qui porte la chaîne des comptes déjà essayés.
 */
export function derniereRepriseDeLAgent(agentId: string, saufMessageId: string): RepriseDeCompte | null {
  const messages = store.listMessages(agentId).filter((m) => m.id !== saufMessageId && m.repriseCompte?.choisi);
  return messages.length ? (messages[messages.length - 1].repriseCompte ?? null) : null;
}

/**
 * La décision est POSÉE : le triangle orange s'allume là où elle se prend, et
 * une alerte sort de l'application — c'est bien une décision attendue, pas un
 * échec. Le message porte déjà la reprise ; ici on ne fait que le signaler.
 */
export function poserDecisionDeReprise(entree: {
  messageId: string;
  agent: Agent;
  reprise: RepriseDeCompte;
}): void {
  const choix = choixDeReprise(entree.reprise.engine, entree.reprise.compteEpuise);
  const possible = choixPossible(choix);
  if (possible) marquerSignale(entree.messageId);

  log.info(
    `tour de l'agent ${entree.agent.id} coupé par la limite du compte ${entree.reprise.compteEpuiseLabel} ` +
      `(${entree.reprise.motif}) — ${choix.filter((c) => c.disponible).length} compte(s) disponible(s)`,
  );

  const enChaine = (entree.reprise.relevesEnChaine ?? 0) >= RELEVES_EN_CHAINE_MAX;
  notify({
    motif: 'decision-attendue',
    title: 'Sur quel compte poursuivre ?',
    body: enChaine
      ? `${entree.agent.title} — ${entree.reprise.relevesEnChaine} relèves automatiques se sont enchaînées sans ` +
        `reprendre le travail : à vous de choisir le compte, ou d'attendre.`
      : possible
        ? `${entree.agent.title} — le compte « ${entree.reprise.compteEpuiseLabel} » a atteint sa limite.`
        : `${entree.agent.title} — le compte « ${entree.reprise.compteEpuiseLabel} » a atteint sa limite, ` +
          `aucun autre compte n'est libre pour l'instant.`,
    // La CARTE quand il y en a une : deux tours coupés sur la même carte ne
    // font pas deux alertes tant que le choix n'a pas été fait.
    reference: entree.agent.cardId ?? entree.messageId,
    element: entree.agent.title,
    projectId: entree.agent.projectId,
    cardId: entree.agent.cardId,
    agentId: entree.agent.id,
  });
  bus.emit({ type: 'attention', ...store.signalAttention() });
}

/* ------------------------------------------------------------------ */
/* Le clic : reprendre sur le compte choisi                            */
/* ------------------------------------------------------------------ */

export interface ResultatDeReprise {
  ok: boolean;
  /** Dit en français pourquoi rien n'a été lancé. */
  error?: string;
}

/**
 * LE GESTE. On revérifie le compte SUR UN RELEVÉ FRAIS — entre l'affichage et
 * le clic, il a pu tomber, être coupé, ou un autre navigateur a pu reprendre —,
 * on retient le choix sur le message, puis on relance le MÊME agent.
 *
 * Le choix est posé AVANT le lancement : c'est lui qui rend le double clic sans
 * effet, puisque `jugerRepriseSurCompte` refuse une décision déjà fermée. Un
 * refus rafraîchit les quotas diffusés, donc les choix affichés, et ne lance
 * rien.
 */
export async function reprendreSurCompte(
  messageId: string,
  accountId: string,
  options: { automatique?: boolean; model?: string } = {},
): Promise<ResultatDeReprise> {
  const message = store.getMessage(messageId);
  if (!message) throw new Error('message introuvable');
  const reprise = message.repriseCompte;
  if (!reprise) throw new Error('ce tour n’attend aucun choix de compte');
  const agent = store.getAgent(message.agentId);
  if (!agent) throw new Error('agent introuvable');

  // Relevé FRAIS du compte visé : on ne repart pas sur des chiffres de tout à
  // l'heure pour une décision qui engage un tour entier.
  const quotas = await refreshQuotas(true, [accountId]).catch(() => null);
  if (quotas) bus.emit({ type: 'quotas', quotas });

  const compte = comptesConnus().find((c) => c.id === accountId);
  /*
   * UN CLIC SUR UN AGENT DÉJÀ REPARTI EST REFUSÉ. La relève automatique part de
   * la fin du tour tombé — l'agent est encore en préparation à cet instant,
   * c'est normal, elle passe par la file. Un CLIC, lui, n'a de sens que sur un
   * agent au repos : sur un agent qui travaille ou dont la file porte déjà sa
   * reprise, il injectait un second compte imposé par-dessus le premier.
   */
  const { agentsActifs } = await import('./runtime.js');
  const agentDejaReparti =
    !options.automatique &&
    (agentsActifs().includes(agent.id) || store.listQueue(agent.id).some((d) => d.repriseDe === messageId));
  const refus = jugerRepriseSurCompte({
    dejaChoisi: reprise.choisi,
    agentDejaReparti,
    engine: reprise.engine,
    // Seul un CLIC change de moteur ; la relève automatique reste sur le sien.
    moteurLibre: !options.automatique,
    compteEpuise: reprise.compteEpuise,
    compte,
  });
  if (refus) {
    // Les choix affichés doivent refléter la réalité qui vient de refuser.
    bus.emit({ type: 'quotas', quotas: cachedQuotas() });
    return { ok: false, error: messageDeRefus(refus) };
  }

  const choisi = compte!;
  const moteur = choisi.engine as Agent['run']['engine'];
  const changeDeMoteur = repriseSurUnAutreMoteur({ engine: reprise.engine }, { engine: moteur });
  const modele = await modeleDeLaReprise(agent, moteur, options.model);
  const changeDeModele = modele !== agent.run.model;
  // La passation se lit sur l'agent tel qu'il était : son dossier, ses messages.
  const demande = changeDeMoteur
    ? passationDe(agent, messageId, reprise, choisi.label, moteur, modele)
    : demandeDeReprise(reprise.compteEpuiseLabel, choisi.label);
  const retenue = store.saveMessage({
    ...message,
    repriseCompte: {
      ...reprise,
      choisi: choisi.id,
      choisiLabel: choisi.label,
      choisiA: Date.now(),
      automatique: options.automatique || undefined,
      choisiMoteur: changeDeMoteur ? moteur : undefined,
      choisiModele: changeDeMoteur || changeDeModele ? modele : undefined,
    },
  });
  /*
   * UN AUTRE MOTEUR OU UN AUTRE MODÈLE DEVIENT LE RÉGLAGE DE L'AGENT, avant le
   * départ du tour. La clé de session suit d'elle-même (`cleDeSession`) : un
   * autre moteur — ou un autre modèle sous Codex — ouvre un fil neuf.
   */
  if (changeDeMoteur || changeDeModele) await reglerLeMoteurDeLaReprise(agent, moteur, modele);
  bus.emit({ type: 'message.upsert', message: retenue });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  oublierSignale(messageId);

  /*
   * Le MÊME agent repart : même session tant qu'elle est reprenable, même
   * dossier de travail, même branche. La demande est SILENCIEUSE — elle ne
   * s'affiche pas comme un message de l'utilisateur, qui n'a rien écrit — et
   * le compte choisi est IMPOSÉ au tour.
   */
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(agent.id, demande, {
    silent: true,
    compteImpose: choisi.id,
    // La reprise voyage avec la demande : le tour qui part la marque consommée,
    // et la file jette une copie devenue inutile.
    repriseDe: messageId,
  }).catch((err) => log.error('reprise sur un autre compte impossible', err));

  return { ok: true };
}

/**
 * Après une limite, chercher une relève sur un relevé frais et repartir sans
 * clic. Faux signifie que le bloc de choix manuel doit rester ouvert.
 */
export async function reprendreAutomatiquement(messageId: string): Promise<boolean> {
  const message = store.getMessage(messageId);
  const reprise = message?.repriseCompte;
  if (!reprise || reprise.choisi || reprise.abandonnee) return false;

  const quotas = await refreshQuotas(true).catch(() => null);
  if (!quotas) return false;
  bus.emit({ type: 'quotas', quotas });
  const essayes = reprise.comptesEssayes?.length ? reprise.comptesEssayes : [reprise.compteEpuise];
  const connus = comptesConnus();
  let compte = compteDeRepriseAutomatique(reprise.engine, essayes, connus, reprise.relevesEnChaine ?? 0);
  if (!compte && (reprise.relevesEnChaine ?? 0) >= RELEVES_EN_CHAINE_MAX) {
    /*
     * AU PLAFOND DE CHAÎNE, LA QUESTION NE SE POSE QUE S'IL N'Y A PLUS AUCUN
     * COMPTE LIBRE. Le plafond existe contre la boucle A → B → A ; or les
     * comptes tombés sont désormais à leur limite CONNUE, donc déjà écartés de
     * `disponible`. S'il reste un compte jamais essayé, libre et lu, on repart
     * dessus sans rien demander — la question manuelle n'est plus posée quand
     * le compte est déjà fixé.
     */
    const libre = compteDeRepriseAutomatique(reprise.engine, essayes, connus, 0);
    if (libre) {
      log.info(
        `relève au-delà du plafond de chaîne : ${libre.label} n'a jamais été essayé et reste libre — ` +
          `on repart dessus sans question`,
      );
      compte = libre;
    } else {
      log.warn(
        `relève automatique arrêtée : ${reprise.relevesEnChaine} relèves se sont enchaînées sur ce travail ` +
          `(comptes essayés : ${essayes.join(', ')}) — la main est rendue`,
      );
    }
  }
  if (!compte) return false;

  const resultat = await reprendreSurCompte(messageId, compte.id, { automatique: true });
  if (!resultat.ok) {
    log.warn(`relève automatique refusée pour le compte ${compte.label} : ${resultat.error}`);
  }
  return resultat.ok;
}

/* ------------------------------------------------------------------ */
/* Aucun compte libre : prévenir dès qu'un choix devient possible       */
/* ------------------------------------------------------------------ */

/**
 * Les décisions pour lesquelles on a DÉJÀ dit qu'un choix était possible. Sans
 * cette mémoire, chaque relevé de quota — toutes les dix minutes — redirait la
 * même chose. Elle s'efface dès qu'il n'y a plus de compte libre : la prochaine
 * ouverture pourra donc parler de nouveau.
 */
const signales = new Set<string>();

function marquerSignale(messageId: string): void {
  signales.add(messageId);
}

function oublierSignale(messageId: string): void {
  signales.delete(messageId);
}

/**
 * Un compte se libère alors qu'un travail attendait : on le DIT. C'est la
 * moitié de la promesse — le composant reste visible et s'actualise tout seul
 * avec les quotas ; encore faut-il savoir qu'il est redevenu utile.
 */
export function signalerRepriseRedevenuePossible(): void {
  const attentes = store.reprisesDeCompteEnAttente();
  if (!attentes.length) {
    signales.clear();
    return;
  }
  const comptes = comptesConnus();
  const vivantes = new Set(attentes.map((a) => a.messageId));
  for (const marque of [...signales]) if (!vivantes.has(marque)) signales.delete(marque);

  for (const attente of attentes) {
    const choix = comptesDeReprise(attente.engine, attente.compteEpuise, comptes);
    if (!choixPossible(choix)) {
      // Plus rien de libre : l'ardoise s'efface, la prochaine ouverture parlera.
      signales.delete(attente.messageId);
      continue;
    }
    if (signales.has(attente.messageId)) continue;
    signales.add(attente.messageId);

    const agent = store.getAgent(attente.agentId);
    notify({
      motif: 'decision-attendue',
      title: 'Un compte est de nouveau libre',
      body: `${agent?.title ?? 'Un travail'} peut repartir : ${choix.find((c) => c.disponible)!.label} a du quota.`,
      reference: `${attente.messageId}:compte-libre`,
      element: agent?.title ?? 'un travail en attente',
      projectId: attente.projectId,
      cardId: attente.cardId,
      agentId: attente.agentId,
    });
  }
}

/**
 * Branché sur la diffusion des quotas : toute lecture (échéance, bouton, boucle
 * de sécurité) passe par le même événement, donc un seul abonnement suffit.
 */
export function surveillerRepriseDeCompte(): () => void {
  return bus.subscribe((evenement) => {
    if (evenement.type !== 'quotas') return;
    try {
      signalerRepriseRedevenuePossible();
    } catch (err) {
      log.warn('surveillance des reprises de compte impossible', err);
    }
  });
}
