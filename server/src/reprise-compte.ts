import {
  Agent,
  ChoixDeCompte,
  CompteConnu,
  MotifDArretQuota,
  RepriseDeCompte,
  choixPossible,
  comptesDeReprise,
  demandeDeReprise,
  jugerRepriseSurCompte,
  messageDeRefus,
} from '@haikodev/shared';
import { AccountRecord, cachedQuotas, listAllAccountRecords, refreshQuotas } from './accounts.js';
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
 * On ne choisit JAMAIS en silence, on ne change ni de moteur ni de modèle, et
 * on ne recommence jamais le travail : c'est le MÊME agent qui repart, avec son
 * fil, sa branche et ses étapes restantes.
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
  return cachedQuotas().map((quota) => ({
    id: quota.id,
    label: quota.label,
    engine: quota.engine,
    disponible: quota.available !== false && !quota.disabled,
    coupe: quota.disabled || coupes.has(quota.id),
    consommePct: consomme(quota.session?.usedPct, quota.weekly?.usedPct),
    resetsAt: prochaineRemiseAZero(quota.session?.resetsAt, quota.weekly?.resetsAt),
  }));
}

/** Les comptes proposés pour poursuivre un tour tombé sur ce compte-là. */
export function choixDeReprise(engine: string, compteEpuise: string): ChoixDeCompte[] {
  return comptesDeReprise(engine, compteEpuise, comptesConnus());
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
}): RepriseDeCompte {
  const quota = cachedQuotas().find((q) => q.id === entree.compte.id);
  return {
    engine: entree.engine,
    compteEpuise: entree.compte.id,
    compteEpuiseLabel: entree.compte.label,
    resetsAt: prochaineRemiseAZero(quota?.session?.resetsAt, quota?.weekly?.resetsAt),
    motif: entree.motif,
    at: Date.now(),
  };
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

  notify({
    motif: 'decision-attendue',
    title: 'Sur quel compte poursuivre ?',
    body: possible
      ? `${entree.agent.title} — le compte « ${entree.reprise.compteEpuiseLabel} » a atteint sa limite.`
      : `${entree.agent.title} — le compte « ${entree.reprise.compteEpuiseLabel} » a atteint sa limite, ` +
        `aucun autre compte n'est libre pour l'instant.`,
    // La CARTE quand il y en a une : deux tours coupés sur la même carte ne
    // font pas deux alertes tant que le choix n'a pas été fait.
    reference: entree.agent.cardId ?? entree.messageId,
    element: entree.agent.title,
    projectId: entree.agent.projectId,
    cardId: entree.agent.cardId,
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
export async function reprendreSurCompte(messageId: string, accountId: string): Promise<ResultatDeReprise> {
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
  const refus = jugerRepriseSurCompte({
    dejaChoisi: reprise.choisi,
    engine: reprise.engine,
    compteEpuise: reprise.compteEpuise,
    compte,
  });
  if (refus) {
    // Les choix affichés doivent refléter la réalité qui vient de refuser.
    bus.emit({ type: 'quotas', quotas: cachedQuotas() });
    return { ok: false, error: messageDeRefus(refus) };
  }

  const choisi = compte!;
  const retenue = store.saveMessage({
    ...message,
    repriseCompte: { ...reprise, choisi: choisi.id, choisiLabel: choisi.label, choisiA: Date.now() },
  });
  bus.emit({ type: 'message.upsert', message: retenue });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  oublierSignale(messageId);

  /*
   * Le MÊME agent repart : même moteur, même modèle, même session tant qu'elle
   * est reprenable, même dossier de travail, même branche. La demande est
   * SILENCIEUSE — elle ne s'affiche pas comme un message de l'utilisateur, qui
   * n'a rien écrit — et le compte choisi est IMPOSÉ au tour.
   */
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(agent.id, demandeDeReprise(reprise.compteEpuiseLabel, choisi.label), {
    silent: true,
    compteImpose: choisi.id,
  }).catch((err) => log.error('reprise sur un autre compte impossible', err));

  return { ok: true };
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
