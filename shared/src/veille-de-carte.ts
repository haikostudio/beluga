/**
 * LA VEILLE D'UNE CARTE — une attente extérieure confiée à un contrôle gratuit.
 *
 * Un agent qui bute sur quelque chose qui ne dépend ni de lui ni de
 * l'utilisateur (un profil Facebook que Meta valide en 1 à 48 h, un nom de
 * domaine qui se propage, une vérification d'identité) ne demande plus
 * « relancez-moi dans une heure » (capture #60e7, 20/10/2026). Il POSE UNE
 * VEILLE : une recette déclarative — la même que les surveillances de sites
 * (`RecetteSurveillance`), essayée avant d'être posée et sans aucun secret —
 * que le démon rejoue seul, sans moteur ni quota. La carte est mise en pause
 * SUR PLACE (le mécanisme du bouton « Suspendre ») ; quand le contrôle passe,
 * le blocage est levé et l'agent est relancé par un message. À l'échéance
 * (48 h au plus), la cloche demande : prolonger, relancer l'agent, abandonner.
 *
 * Ici, les règles pures : bornes, échéance, prochain passage, lecture d'un
 * verdict et phrase affichée. L'écriture, les passages et la reprise vivent
 * dans `server/src/veille-de-carte.ts`.
 */
import {
  jugerAdresse,
  jugerRecetteSurveillance,
  type EtapeParcours,
  type RecetteSurveillance,
  type VerdictSite,
} from './surveillance.js';

/* ------------------------------------------------------------------ */
/* Bornes                                                               */
/* ------------------------------------------------------------------ */

/** Pas plus souvent qu'un quart d'heure : la veille attend un tiers, elle ne le harcèle pas. */
export const INTERVALLE_VEILLE_MIN_MS = 15 * 60_000;
/** Pas plus rarement que six heures : un blocage levé ne doit pas dormir une demi-journée. */
export const INTERVALLE_VEILLE_MAX_MS = 6 * 3_600_000;
/** Le rythme quand l'agent n'en donne pas. */
export const INTERVALLE_VEILLE_DEFAUT_MS = 3_600_000;
/** L'échéance par défaut, et la plus lointaine : 48 h (demande du 20/10/2026). */
export const DUREE_VEILLE_MAX_MS = 48 * 3_600_000;
export const DUREE_VEILLE_DEFAUT_MS = DUREE_VEILLE_MAX_MS;
/** Une échéance trop proche ne laisse le temps d'aucun passage. */
export const DUREE_VEILLE_MIN_MS = INTERVALLE_VEILLE_MIN_MS;
/** La phrase qui dit ce qu'on attend : courte, elle s'affiche sur la carte. */
export const RAISON_VEILLE_MAX = 160;
/** Le nom d'un profil du navigateur d'essai (`dev-browser -b <profil>`). */
const PROFIL_VALIDE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Les étapes qu'un parcours MENÉ DANS UN PROFIL CONNECTÉ sait jouer : lire, jamais agir. */
export const ACTIONS_AVEC_PROFIL: readonly EtapeParcours['action'][] = ['aller', 'attendre', 'verifierTexte'];

/* ------------------------------------------------------------------ */
/* Le modèle                                                            */
/* ------------------------------------------------------------------ */

/* « attend_deploiement » (carte « Communication 2 : finitions et chats », décision de l'utilisateur) : la veille d'un
   travail FINI ne court pas encore — la carte part « À déployer », et la veille s'arme une fois la carte en ligne. */
export type EtatVeille = 'en_cours' | 'levee' | 'expiree' | 'abandonnee' | 'attend_deploiement';

/**
 * LE MOMENT D'UNE VEILLE. « pour-continuer » (défaut, et toute veille d'avant) : l'agent attend un tiers pour
 * POURSUIVRE — la carte se met en pause sur place, la levée le relance. « apres-deploiement » : le travail est FINI et
 * la veille contrôle son résultat EN LIGNE — la carte se range normalement (« À déployer »), la veille s'arme au
 * déploiement (ou au rangement en « Archivé » d'un projet sans déploiement), et sa levée NOTE le constat sans relancer
 * l'agent ni déplacer la carte (« Archivé » et « À déployer » ne se rouvrent que sur un geste humain).
 */
export type MomentDeVeille = 'pour-continuer' | 'apres-deploiement';

export function lireMomentDeVeille(v: unknown): MomentDeVeille {
  return v === 'apres-deploiement' ? 'apres-deploiement' : 'pour-continuer';
}

/** La veille d'après déploiement peut-elle s'armer ? Sa carte est en ligne, ou rangée sans déploiement. */
export function carteEnLignePourLaVeille(card: { column: string; deployedAt?: number | null } | null | undefined): boolean {
  return !!card && (!!card.deployedAt || card.column === 'archived');
}

/**
 * QUAND LE BLOCAGE EST-IL LEVÉ ?
 *  - `reussite` : la recette passe (le texte « Profil validé » est là) ;
 *  - `contenuAbsent` : le contenu vérifié a DISPARU (« En cours de
 *    vérification » n'est plus sur la page).
 * Dans les deux cas, une page injoignable ou un parcours cassé n'est jamais
 * pris pour un blocage levé : c'est une PANNE du contrôle.
 */
export type LeveeSi = 'reussite' | 'contenuAbsent';

export interface RecetteDeVeille {
  url: string;
  recette: RecetteSurveillance;
  /** Le profil du navigateur d'essai, pour lire une page CONNECTÉE (session du compte du coffre). */
  profil?: string;
  leveeSi: LeveeSi;
}

/** Ce qu'un passage a conclu. */
export type IssueDeControle = 'levee' | 'pas-encore' | 'panne';

export interface ControleDeVeille {
  a: number;
  issue: IssueDeControle;
  /** Ce qui s'est passé, en clair (étape qui casse, détail) — jamais une valeur du coffre. */
  detail?: string;
}

export interface VeilleDeCarte {
  id: string;
  cardId: string;
  agentId: string;
  raison: string;
  recette: RecetteDeVeille;
  intervalleMs: number;
  echeance: number;
  etat: EtatVeille;
  creeA: number;
  prochainControleA: number;
  dernierControle?: ControleDeVeille;
  /** Le message qui porte la question de l'échéance, une fois posée. */
  questionMessageId?: string;
  /** Quand la veille a cessé de courir ; absente tant qu'elle court. */
  termineA?: number;
  /** Absent : « pour-continuer » (les veilles d'avant gardent leur comportement). */
  moment?: MomentDeVeille;
}

/**
 * CE QUE LA CARTE AFFICHE — un résumé porté par la carte elle-même
 * (`Card.veille`), pour que l'écran n'ait rien à demander de plus.
 */
export interface ResumeDeVeille {
  id: string;
  etat: EtatVeille;
  raison: string;
  echeance: number;
  prochainControleA?: number;
  dernierControle?: ControleDeVeille;
  moment?: MomentDeVeille;
}

/* ------------------------------------------------------------------ */
/* Bornes et dates                                                      */
/* ------------------------------------------------------------------ */

export function bornerIntervalleDeVeille(minutes: unknown): number {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return INTERVALLE_VEILLE_DEFAUT_MS;
  return Math.min(INTERVALLE_VEILLE_MAX_MS, Math.max(INTERVALLE_VEILLE_MIN_MS, Math.round(n * 60_000)));
}

/** L'échéance : `heures` bornées à 48 h, 48 h sans indication. */
export function echeanceDeVeille(maintenant: number, heures?: unknown): number {
  const n = Number(heures);
  const duree =
    !Number.isFinite(n) || n <= 0
      ? DUREE_VEILLE_DEFAUT_MS
      : Math.min(DUREE_VEILLE_MAX_MS, Math.max(DUREE_VEILLE_MIN_MS, Math.round(n * 3_600_000)));
  return maintenant + duree;
}

/** Le prochain passage : un intervalle plus loin, jamais au-delà de l'échéance. */
export function prochainControleDeVeille(maintenant: number, intervalleMs: number, echeance: number): number {
  return Math.min(maintenant + intervalleMs, echeance);
}

/** Un passage est dû : la veille court et son heure est venue. */
export function veilleDue(veille: Pick<VeilleDeCarte, 'etat' | 'prochainControleA'>, maintenant: number): boolean {
  return veille.etat === 'en_cours' && veille.prochainControleA <= maintenant;
}

/** L'échéance est passée : le passage qui la constate (s'il ne lève rien) la rend « expirée ». */
export function veilleEchue(veille: Pick<VeilleDeCarte, 'etat' | 'echeance'>, maintenant: number): boolean {
  return veille.etat === 'en_cours' && maintenant >= veille.echeance;
}

/**
 * LA VEILLE TIENT LA RANGÉE D'ACTION (demande du 24/10/2026) : pendant une
 * veille en cours ou échue, ses gestes — vérifier, arrêter, le service —
 * REMPLACENT « Reprendre / Terminer la tâche / réglages / horloge » au lieu de
 * s'y ajouter. Un agent qui travaille malgré la veille (un message l'a relancé)
 * garde la rangée habituelle : son arrêt doit rester à portée.
 */
export function veilleTientLaRangee(
  veille: Pick<ResumeDeVeille, 'etat' | 'moment'> | null | undefined,
  agentAuTravail: boolean,
): boolean {
  /* La veille d'après déploiement ne tient jamais la rangée : la carte est rangée, la veille n'est qu'un contrôle. */
  if (veille?.moment === 'apres-deploiement') return false;
  return !agentAuTravail && (veille?.etat === 'en_cours' || veille?.etat === 'expiree');
}

/* ------------------------------------------------------------------ */
/* La recette                                                           */
/* ------------------------------------------------------------------ */

export type JugementVeille =
  | { ok: true; recette: RecetteDeVeille; raison: string }
  | { ok: false; raison: string };

/**
 * LA RECETTE D'UNE VEILLE se juge comme celle d'une surveillance
 * (`jugerRecetteSurveillance` : aucun mot de passe en clair, un parcours
 * commence par « aller »), plus trois règles à elle :
 *  - une PHRASE qui dit ce qu'on attend, affichée sur la carte ;
 *  - un PROFIL nommé (session d'un compte du coffre) ne sert qu'à LIRE une
 *    page : aller, attendre un délai, vérifier un texte. Jamais remplir ni
 *    cliquer — un contrôle seul ne se reconnecte pas et n'agit pas à la place
 *    de quelqu'un (risque de blocage du compte, de SMS en rafale) ;
 *  - `contenuAbsent` n'a de sens que si la recette vérifie un contenu.
 */
export function jugerVeille(brut: unknown): JugementVeille {
  const r = (brut ?? {}) as Record<string, unknown>;
  const raison = String(r.raison ?? '').trim().replace(/\s+/g, ' ').slice(0, RAISON_VEILLE_MAX);
  if (raison.length < 3) return { ok: false, raison: 'dis en une phrase courte ce que la veille attend (« raison »)' };

  const adresse = jugerAdresse(r.url);
  if (!adresse.ok) return { ok: false, raison: adresse.raison };

  const avis = jugerRecetteSurveillance(r.recette ?? { type: 'appel' });
  if (!avis.ok) return { ok: false, raison: avis.raison };
  const recette = avis.recette;

  let profil: string | undefined;
  if (r.profil !== undefined && r.profil !== null && String(r.profil).trim()) {
    profil = String(r.profil).trim().toLowerCase();
    if (!PROFIL_VALIDE.test(profil))
      return { ok: false, raison: 'le profil est un nom du navigateur d’essai (lettres, chiffres, « - », « . », « _ »)' };
    if (recette.type !== 'parcours')
      return { ok: false, raison: 'un profil connecté se lit par un « parcours » (aller, attendre, verifierTexte)' };
    const interdite = recette.etapes.find(
      (e) => !ACTIONS_AVEC_PROFIL.includes(e.action) || (e.action === 'attendre' && e.selecteur),
    );
    if (interdite)
      return {
        ok: false,
        raison: `avec un profil connecté, une veille ne fait que LIRE : « aller », « attendre » (en ms), « verifierTexte » — pas « ${interdite.action} »`,
      };
  }

  const leveeSi: LeveeSi = r.leveeSi === 'contenuAbsent' ? 'contenuAbsent' : 'reussite';
  if (leveeSi === 'contenuAbsent') {
    const verifie =
      recette.type === 'appel'
        ? !!recette.motAttendu
        : recette.etapes.some((e) => e.action === 'verifierTexte' || e.action === 'verifierSelecteur');
    if (!verifie)
      return { ok: false, raison: '« contenuAbsent » suppose un contenu vérifié (motAttendu, verifierTexte ou verifierSelecteur)' };
  }

  return { ok: true, raison, recette: { url: adresse.url, recette, ...(profil ? { profil } : {}), leveeSi } };
}

/**
 * CE QUE VEUT DIRE UN VERDICT POUR UNE VEILLE. Seul le CONTENU tranche entre
 * « levé » et « pas encore » ; tout le reste — page injoignable, délai, erreur
 * serveur, parcours cassé — est une panne du contrôle, qui ne lève rien et ne
 * relance personne : l'échéance tranchera.
 */
export function issueDuVerdict(verdict: Pick<VerdictSite, 'etat' | 'raison'>, leveeSi: LeveeSi): IssueDeControle {
  const contenuVu = verdict.etat === 'ok';
  const contenuAbsent = verdict.etat === 'panne' && verdict.raison === 'contenu';
  if (!contenuVu && !contenuAbsent) return 'panne';
  if (leveeSi === 'reussite') return contenuVu ? 'levee' : 'pas-encore';
  return contenuAbsent ? 'levee' : 'pas-encore';
}

/* ------------------------------------------------------------------ */
/* Ce qui s'affiche                                                     */
/* ------------------------------------------------------------------ */

export function resumeDeVeille(veille: VeilleDeCarte): ResumeDeVeille {
  return {
    id: veille.id,
    etat: veille.etat,
    raison: veille.raison,
    echeance: veille.echeance,
    ...(veille.etat === 'en_cours' ? { prochainControleA: veille.prochainControleA } : {}),
    ...(veille.dernierControle ? { dernierControle: veille.dernierControle } : {}),
    ...(veille.moment === 'apres-deploiement' ? { moment: veille.moment } : {}),
  };
}

/** La phrase posée sur la carte en pause (`waitingReason`). */
export function raisonDeLaCarteEnVeille(raison: string): string {
  return `En veille : ${raison}`;
}

/* ------------------------------------------------------------------ */
/* L'échéance : la question posée dans la cloche                        */
/* ------------------------------------------------------------------ */

export type ChoixDEcheance = 'prolonger' | 'relancer' | 'abandonner';

export const CHOIX_D_ECHEANCE: readonly { id: ChoixDEcheance; label: string; description: string }[] = [
  {
    id: 'prolonger',
    label: 'Prolonger la veille de 48 h',
    description: 'Le même contrôle continue, au même rythme, sans dépenser de quota.',
  },
  {
    id: 'relancer',
    label: 'Relancer l’agent',
    description: 'L’agent reprend la tâche maintenant et regarde lui-même où en est le blocage.',
  },
  {
    id: 'abandonner',
    label: 'Abandonner',
    description: 'La veille s’arrête et la carte se termine.',
  },
];

export function questionDEcheance(raison: string, heures: number): string {
  return `Toujours bloqué après ${heures} h : ${raison}. Prolonger la veille, relancer l’agent ou abandonner ?`;
}

/** Le choix lu dans la réponse : l'option cliquée porte son libellé. */
export function choixDEcheance(reponse: string): ChoixDEcheance | null {
  const texte = reponse.trim().toLowerCase();
  for (const choix of CHOIX_D_ECHEANCE) if (texte === choix.label.toLowerCase()) return choix.id;
  if (texte.startsWith('prolonger')) return 'prolonger';
  if (texte.startsWith('relancer')) return 'relancer';
  if (texte.startsWith('abandonner')) return 'abandonner';
  return null;
}

/** Le message qui relance l'agent quand le blocage est levé. */
export function messageDeBlocageLeve(raison: string): string {
  return `Le blocage est levé : ${raison}. La veille l’a constaté par son contrôle. Reprends la tâche là où tu t’étais arrêté.`;
}

/** La note écrite dans le fil quand la veille d'après déploiement passe : un constat, sans relance. */
export function noteDeControlePasse(raison: string): string {
  return `Contrôle passé après la mise en ligne : ${raison}. La veille s’arrête ; rien d’autre n’est à faire.`;
}

/**
 * LA RÉPARATION D'UNE VEILLE EN PANNE (décision du 11/11/2026) : le bouton
 * « Demander à l'agent de réparer » relance l'agent avec ce message. Jamais de
 * relance automatique sur panne : l'agent ne travaille qu'au clic. La recette
 * citée est TOUJOURS celle de `recetteAffichable` (aucune valeur saisie).
 */
export function messageDeReparation(veille: Pick<VeilleDeCarte, 'raison' | 'recette' | 'dernierControle'>, heure: string): string {
  const recette = recetteAffichable(veille.recette);
  const ce =
    recette.recette.type === 'parcours'
      ? `le parcours sur ${recette.url} (${recette.recette.etapes.length} étape(s))`
      : `l’adresse ${recette.url}${recette.recette.type === 'appel' ? ' (appel direct)' : ''}`;
  const detail = veille.dernierControle?.detail ? ` Détail du dernier contrôle (${heure}) : ${veille.dernierControle.detail}.` : ` Dernier contrôle : ${heure}.`;
  return (
    `Ta veille « ${veille.raison} » est EN PANNE : son contrôle n’arrive plus à joindre ce qu’il surveille, ${ce}.${detail} ` +
    `L’utilisateur te demande de la réparer : regarde pourquoi ce contrôle échoue (service arrêté, adresse changée, page modifiée, session expirée), ` +
    `relance ou remplace ce qu’elle interroge, puis repose la veille par « veille_poser » avec une recette qui passe. ` +
    `Si ce qu’elle attendait est déjà arrivé, dis-le et reprends la tâche.`
  );
}

/** Ce que l'écran dit après « Vérifier maintenant », selon l'issue rendue. */
export type ResultatDeVerification = { genre: 'info' | 'success' | 'error'; texte: string; detail?: string };
export function resultatDeVerification(issue: IssueDeControle | undefined, detail?: string): ResultatDeVerification {
  if (issue === 'levee') return { genre: 'success', texte: 'C’est arrivé : l’agent reprend la tâche.' };
  if (issue === 'pas-encore') return { genre: 'info', texte: 'Vérifié : rien de nouveau pour l’instant.' };
  if (issue === 'panne') return { genre: 'error', texte: 'Le contrôle n’arrive plus à joindre ce qu’il surveille.', ...(detail ? { detail } : {}) };
  return { genre: 'info', texte: 'Contrôle fait.' };
}

/** Le bouton de réparation : une veille qui court ET dont le DERNIER contrôle est en panne. */
export function veilleAReparer(veille: Pick<ResumeDeVeille, 'etat' | 'dernierControle'> | null | undefined): boolean {
  return !!veille && veille.etat === 'en_cours' && veille.dernierControle?.issue === 'panne';
}

/** Le message qui relance l'agent à la demande de l'utilisateur, à l'échéance. */
export function messageDeRelanceApresEcheance(raison: string): string {
  return `La veille « ${raison} » est arrivée à échéance sans que son contrôle passe. L’utilisateur te demande de reprendre : regarde toi-même où en est le blocage, puis poursuis ou dis ce qui manque.`;
}

/**
 * LA CONSIGNE, dite aux agents de tâche et à l'agent marketing : une attente
 * extérieure se confie à une veille, jamais à « relancez-moi dans une heure ».
 */
export const CONSIGNE_DE_LA_VEILLE =
  'ATTENTE EXTÉRIEURE : si tu dépends d’un tiers qui doit valider, propager ou répondre (profil vérifié par un réseau, domaine, revue d’une boutique…), ne demande pas à l’utilisateur de te relancer. Pose une veille avec « veille_poser » : un contrôle gratuit et sans secret, essayé d’abord, qui te relance seul quand il passe (48 h au plus). Ton travail est FINI et la veille ne fait que contrôler son résultat une fois en ligne : « moment: apres-deploiement » — la carte part « À déployer » et la veille démarre au déploiement. Puis termine ton tour par une phrase courte qui dit ce qu’on attend.';

/* ------------------------------------------------------------------ */
/* Le service « Tâches récurrentes »                                    */
/* ------------------------------------------------------------------ */

/**
 * UNE VEILLE TELLE QUE LA LISTE LA MONTRE — toutes les veilles de tous les
 * projets, lues au démon (`veilles.lister`) et jamais dans les cartes chargées
 * de l'écran : celles d'un projet qu'on ne consulte plus en sont déchargées.
 * La carte peut avoir été supprimée depuis : `titreCarte` et `projectId` sont
 * alors nuls.
 */
export interface VeilleListee extends ResumeDeVeille {
  cardId: string;
  projectId: string | null;
  titreCarte: string | null;
  intervalleMs: number;
  creeA: number;
  /** Quand la veille a cessé de courir (levée, arrêtée, échue). */
  termineA?: number;
  /** La recette, SANS aucune valeur saisie (`recetteAffichable`). */
  recette: RecetteDeVeille;
}

/** Une veille qui court encore ; tout le reste — levée, arrêtée, échue — est de l'historique. */
export function veilleActive(veille: Pick<ResumeDeVeille, 'etat'>): boolean {
  return veille.etat === 'en_cours';
}

/**
 * LA RECETTE MONTRÉE À L'ÉCRAN : la valeur d'un champ rempli ne quitte jamais
 * le démon, ni sa référence au coffre-fort. Seuls restent l'action et sa cible.
 */
export function recetteAffichable(recette: RecetteDeVeille): RecetteDeVeille {
  if (recette.recette.type !== 'parcours') return recette;
  return {
    ...recette,
    recette: {
      ...recette.recette,
      etapes: recette.recette.etapes.map((e) => (e.action === 'remplir' ? { action: 'remplir', selecteur: e.selecteur } : e)),
    },
  };
}
