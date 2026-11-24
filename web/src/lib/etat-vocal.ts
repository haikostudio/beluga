import * as React from 'react';
import { garderEveilleTantQue } from './veille';
import { arreterLActionDeJarvis } from './gestes-de-jarvis';
import { poserLaConversationEnCours } from './conversation-en-cours';
import type { TourDuDirect } from './direct-codex';
import { etatDuMicroApres, MICRO_AU_REPOS, type EtatDuMicro, type GesteDuMicro } from '@beluga/shared';

/**
 * LE MICRO DU MODULE DE VOIX (attente locale du mot de réveil) et LA CONVERSATION EN DIRECT, PARTAGÉS entre
 * `VoixAssistant` (qui les fait vraiment tourner) et la section « Voix » de
 * Réglages (qui les affiche depuis que le rond du menu du bas a cédé sa
 * place au bouton Robo). Volontairement NON persistés — ni en préférence
 * serveur, ni en stockage du navigateur — pour garder la règle d'origine :
 * le micro ne s'ouvre jamais sans un geste fait DANS la page, à l'instant
 * même. Un module top-level, un ensemble
 * d'écouteurs, `useSyncExternalStore`.
 */

/**
 * L'état vient de la règle pure `etatDuMicroApres` (shared/src/micro-demande.ts, 24/11/2026) : une conversation ouverte
 * micro coupé le REFERME à sa fin — la dernière prise fermée rend la session audio de l'iPhone (`lib/micro.ts`) et la
 * musique reprend ; ouverte « Dis Jarvis » allumé à la main, elle laisse l'attente reprendre.
 */
type EtatVocal = EtatDuMicro;

let etat: EtatVocal = MICRO_AU_REPOS;
const ecouteurs = new Set<() => void>();

function publier(): void {
  poserLaConversationEnCours(etat.conversationAllumee);
  for (const prevenir of ecouteurs) prevenir();
}

function appliquer(geste: GesteDuMicro): void {
  const suite = etatDuMicroApres(etat, geste);
  if (
    suite.microOuvert === etat.microOuvert &&
    suite.conversationAllumee === etat.conversationAllumee &&
    suite.microParLaConversation === etat.microParLaConversation
  )
    return;
  etat = suite;
  publier();
}

/** L'interrupteur « Micro » : couper le micro coupe aussi la conversation (elle passe par lui). */
export function setMicroOuvertGlobal(valeur: boolean): void {
  appliquer({ genre: 'micro', ouvert: valeur });
}

/** Ouvrir la conversation ouvre aussi le micro ; la fermer le referme s'il n'était pas ouvert avant elle. */
export function setConversationAllumeeGlobale(valeur: boolean): void {
  appliquer({ genre: 'conversation', allumee: valeur });
}

// Un micro ouvert (attente du mot) ou une conversation vocale continue sans écran.
garderEveilleTantQue(() => etat.microOuvert || etat.conversationAllumee);

function abonner(prevenir: () => void): () => void {
  ecouteurs.add(prevenir);
  return () => ecouteurs.delete(prevenir);
}

function lireEtat(): EtatVocal {
  return etat;
}

export function useEtatVocalGlobal(): EtatVocal {
  return React.useSyncExternalStore(abonner, lireEtat, lireEtat);
}

/* ------------------------------------------------------------------ */
/* Le direct, vu par le volet de l'assistant (16/11/2026)               */
/* ------------------------------------------------------------------ */

/**
 * CE QUE LE VOLET DE L'ASSISTANT MONTRE DE LA VOIX (carte « Jarvis : volet, voix et rapidité ») : la barre d'appel et
 * la conversation empilée de Jarvis ont disparu ; c'est le volet de l'assistant qui montre le fil du direct (à son
 * heure, parmi les messages) et, à la place de la zone d'écriture, les ondes avec Muet et Arrêter. `VoixAssistant`
 * tient le son et PUBLIE ici ; le volet lit, et demande par `parlerAJarvis`, `basculerLaSourdine`, `arreterJarvis`.
 * Rien n'est retenu : la règle « le micro repart éteint » tient toujours.
 */
export interface DirectVu {
  /** Où en est le direct (« eteint », « connexion », « ecoute », « refusee », « erreur »). */
  etat: string;
  erreur: string | null;
  /**
   * L'AGENT QUI PORTE LA CONVERSATION (17/11/2026) : celui du champ où l'on a appuyé sur le bouton voix, ou l'assistant
   * (« Dis Jarvis », Cmd+Espace). Seul le `Chat` de cet agent remplace son champ par le pied vocal. `null` : l'assistant,
   * avant que son identifiant soit connu.
   */
  agentId: string | null;
  /**
   * Le fil de la session (tours, tâches, actions, activité) : PLUS JAMAIS posé dans le fil des messages (17/11/2026),
   * il nourrit les BULLES au-dessus du pied vocal (`voix-du-champ.tsx`, dix au plus).
   */
  fil: readonly TourDuDirect[];
  /** La conversation est close et Jarvis rédige la synthèse pour le champ de cet agent. */
  redaction: string | null;
  /** Le micro est coupé pendant la conversation : la piste qui part au direct se tait, sans raccrocher. */
  sourdine: boolean;
  /**
   * La voix de Jarvis arrive mais le navigateur refuse de la jouer sans un toucher (iPhone, 17/11/2026) : le pied
   * vocal le dit, avec un bouton qui la fait entendre (`activerLeSonDuDirect`).
   */
  sonBloque?: boolean;
  /** Jarvis agit à l'écran (une action en cours, ou arrêtée qui attend « Reprendre ») : le volet passe devant les fenêtres. */
  actionVivante: boolean;
  /** Les niveaux des ondes et QUI parle (« jarvis » en bleu, « vous » en jaune), lus à chaque image. */
  lecteur: ((nombre: number) => { niveaux: number[] | null; qui: 'jarvis' | 'vous' | null }) | null;
}

let direct: DirectVu = { etat: 'eteint', erreur: null, agentId: null, fil: [], redaction: null, sourdine: false, actionVivante: false, lecteur: null };
const ecouteursDuDirect = new Set<() => void>();

export function publierLeDirect(suite: Partial<DirectVu>): void {
  const prochain = { ...direct, ...suite };
  if (
    prochain.etat === direct.etat &&
    prochain.erreur === direct.erreur &&
    prochain.agentId === direct.agentId &&
    prochain.fil === direct.fil &&
    prochain.redaction === direct.redaction &&
    prochain.sourdine === direct.sourdine &&
    prochain.sonBloque === direct.sonBloque &&
    prochain.actionVivante === direct.actionVivante &&
    prochain.lecteur === direct.lecteur
  )
    return;
  direct = prochain;
  for (const prevenir of ecouteursDuDirect) prevenir();
}

export function useDirectVu(): DirectVu {
  return React.useSyncExternalStore(
    (prevenir) => {
      ecouteursDuDirect.add(prevenir);
      return () => ecouteursDuDirect.delete(prevenir);
    },
    () => direct,
    () => direct,
  );
}

/** Ce qui fait entendre la voix de Jarvis bloquée par le navigateur : posé par le module de voix, qui tient le son. */
let activationDuSon: (() => void) | null = null;
export function poserLActivationDuSon(activer: (() => void) | null): void {
  activationDuSon = activer;
}
/** Le toucher qui fait entendre la voix de Jarvis (un geste : le navigateur l'accepte alors). */
export function activerLeSonDuDirect(): void {
  activationDuSon?.();
}

/**
 * POURQUOI LA CONVERSATION SE FERME, dit au démon avec l'arrêt (18/11/2026) : l'appel du 18/11 au matin s'est fermé
 * trois fois sans que le journal dise pourquoi. Chaque geste qui ferme pose sa raison juste avant ; le direct la prend
 * en fermant (`lib/direct-codex.ts`), et un démontage sans raison posée (page rechargée, écran quitté) le dit aussi.
 */
let raisonDeFermeture: string | null = null;
export function poserLaRaisonDeFermeture(raison: string): void {
  raisonDeFermeture = raison;
}
export function prendreLaRaisonDeFermeture(): string | null {
  const raison = raisonDeFermeture;
  raisonDeFermeture = null;
  return raison;
}

/**
 * LES BULLES REPLIÉES (18/11/2026) : le chevron centré entre les bulles et le panneau vocal les replie ou les rouvre.
 * Sur téléphone, elles se replient d'elles-mêmes quand Jarvis agit (pour laisser voir l'écran) ; un toucher du chevron
 * garde la main jusqu'à la fin de l'action.
 */
let bulles = { repliees: false, aLaMain: false };
const ecouteursDesBulles = new Set<() => void>();
function poserLesBulles(suite: typeof bulles): void {
  if (suite.repliees === bulles.repliees && suite.aLaMain === bulles.aLaMain) return;
  bulles = suite;
  for (const prevenir of ecouteursDesBulles) prevenir();
}
export function useBullesRepliees(): boolean {
  return React.useSyncExternalStore(
    (prevenir) => {
      ecouteursDesBulles.add(prevenir);
      return () => ecouteursDesBulles.delete(prevenir);
    },
    () => bulles.repliees,
    () => bulles.repliees,
  );
}
/** Le toucher du chevron : il replie ou rouvre, et garde la main jusqu'à la fin de l'action en cours. */
export function basculerLesBulles(): void {
  poserLesBulles({ repliees: !bulles.repliees, aLaMain: true });
}
/** Jarvis commence à agir (téléphone) : les bulles se replient, sauf si l'utilisateur a la main. */
export function replierLesBullesPendantLAction(agit: boolean): void {
  if (agit) {
    if (!bulles.aLaMain) poserLesBulles({ repliees: true, aLaMain: false });
    return;
  }
  // L'action est finie : la main se rend, les bulles repliées d'office se rouvrent.
  poserLesBulles({ repliees: bulles.aLaMain ? bulles.repliees : false, aLaMain: false });
}
/** Une conversation neuve repart bulles ouvertes. */
export function rouvrirLesBulles(): void {
  poserLesBulles({ repliees: false, aLaMain: false });
}

/** Couper / rétablir le micro pendant la conversation, sans raccrocher. */
export function basculerLaSourdine(): void {
  publierLeDirect({ sourdine: !direct.sourdine });
}

/** L'événement par lequel un champ d'écriture (bouton voix) ou le Mac (Cmd+Espace) demande à parler à Jarvis. */
export const EVENEMENT_PARLER_A_JARVIS = 'beluga:parler-a-jarvis';

/**
 * PARLER À JARVIS. `agentId` : l'agent du champ où l'on a appuyé (une carte) — la conversation se branche sur lui et
 * sa synthèse revient dans SON champ. Absent : l'assistant (« Dis Jarvis », Cmd+Espace l'ouvrent toujours).
 */
export function parlerAJarvis(agentId?: string | null): void {
  window.dispatchEvent(new CustomEvent<{ agentId: string | null }>(EVENEMENT_PARLER_A_JARVIS, { detail: { agentId: agentId ?? null } }));
}

/** Arrêter Jarvis : la conversation se ferme et la zone d'écriture revient. En sourdine, le micro se coupe pour de bon. */
export function arreterJarvis(): void {
  poserLaRaisonDeFermeture('bouton Arrêter');
  // Le bouton Arrêter coupe aussi l'action que Jarvis jouait à l'écran : c'est désormais le SEUL geste qui l'arrête.
  arreterLActionDeJarvis();
  if (direct.sourdine) setMicroOuvertGlobal(false);
  setConversationAllumeeGlobale(false);
  publierLeDirect({ sourdine: false });
}

/* Le point d'essai (hors production) : l'interrupteur « Micro ouvert » des réglages, sans naviguer jusqu'à eux. */
if (typeof window !== 'undefined' && import.meta.env.MODE !== 'production') {
  const essai = ((window as unknown as { belugaEssai?: Record<string, unknown> }).belugaEssai ??= {});
  essai.microALaMain = (ouvert: boolean) => setMicroOuvertGlobal(ouvert);
  essai.etatDuMicro = () => ({ ...etat });
}
