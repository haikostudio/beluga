/*
 * LA CONVERSATION VOCALE EN DIRECT AVEC CODEX, CÔTÉ NAVIGATEUR (carte « En-tête du projet et assistant vocal
 * Codex », 15/11/2026). Le module de voix l'allume d'un clic sur ses ondes : le micro s'ouvre par la porte unique
 * (`lib/micro.ts`), une connexion WebRTC part chez Codex par le démon (`voix.direct.demarrer`, qui la fait
 * accepter par l'ABONNEMENT), et la voix de Codex revient directement du fournisseur. Reparler lui coupe la parole :
 * c'est le direct lui-même qui le fait, plus rien à couper ici.
 *
 * Le fil (phrases dites, réponses, projets dont on parle, sources de la mémoire, tâche préparée) arrive du démon
 * par les événements `voix.direct.*`. Une panne SE DIT, en clair : jamais de repli silencieux vers l'ancienne
 * chaîne dictée + voix du serveur.
 */
import * as React from 'react';
import { client } from './client';
import { ouvrirMicro, type PriseMicro } from './micro';
import { lireNiveaux } from './micro-tranches';
import type { EntreeDuDirect } from './mot-de-reveil';
import { ID_DE_L_ONGLET } from './gestes-de-jarvis';
import { joindreAuChamp } from './joindre-au-champ';
import { readPref, writePref } from './prefs';
import { brouillonApresSynthese, creerControleDeVie, type MesureDuMicro } from '@beluga/shared';
import { t } from '@/lib/langue';
import { signalerErreur } from './erreurs';
import { plateformeNative } from './natif';
import { EVENEMENT_PARLER_A_JARVIS, prendreLaRaisonDeFermeture } from './etat-vocal';

/** Sans voix de Jarvis ni phrase de sa part ce temps-là après l'appel, Jarvis est dit « ne répond pas ». */
const REPONSE_A_L_APPEL_MAX_MS = 12_000;

/** L'événement de fenêtre par lequel le client relaie les nouvelles `voix.direct.*` du démon. */
export const EVENEMENT_VOIX_DIRECTE = 'beluga:voix-directe';

export type EtatDuDirect = 'eteint' | 'connexion' | 'ecoute' | 'refusee' | 'erreur';

export interface TacheDuDirect {
  titre: string;
  projet?: string;
  niveau?: string;
  moteur?: string;
  modele?: string;
  reflexion?: string;
  etat: 'proposee' | 'creee' | 'lancee';
}

/** Une action de Jarvis à l'écran, racontée dans le fil : un geste par ligne, chacun avec son état. */
export interface ActionDuDirect {
  id: string;
  titre: string;
  statut: 'en-cours' | 'arretee' | 'finie' | 'annulee' | 'echouee';
  gestes: { libelle: string; etat: 'todo' | 'running' | 'done' | 'stopped' | 'failed' }[];
  erreur?: string;
}

/** Ce que Jarvis fait EN CE MOMENT (une recherche, une tâche créée, un geste) : une ligne qui tourne puis se coche. */
export interface ActiviteDuDirect {
  id: string;
  libelle: string;
  etat: 'en-cours' | 'finie' | 'echec' | 'a-venir';
  /** Une action concrète dans l'application (pas une lecture) : la conversation se montre (18/11/2026). */
  agit?: boolean;
  /** Le court résultat d'une étape finie, ou la raison d'un échec. */
  resultat?: string;
}

/**
 * LA LISTE « JE VÉRIFIE AVANT DE RÉPONDRE » d'une phrase (carte « Jarvis plus fiable et vérifié », 18/11/2026) : les
 * sources du dossier, puis chaque outil du cerveau, cochés à mesure ; « Je recoupe les réponses » reste en dernier.
 */
export interface VerificationsDuDirect {
  phrase: string;
  etapes: ActiviteDuDirect[];
}

export interface TourDuDirect {
  id: number;
  /** L'heure d'arrivée du tour : le volet de l'assistant le pose à son heure parmi les messages. */
  le?: number;
  role: 'user' | 'assistant';
  texte: string;
  /** Faux tant que la phrase se dit encore. */
  final: boolean;
  projets: string[];
  sources?: number;
  /** Un point d'avancement dit pendant le travail du cerveau (19/11/2026) : la réponse est toujours attendue. */
  avancement?: boolean;
  tache?: TacheDuDirect;
  action?: ActionDuDirect;
  activite?: ActiviteDuDirect;
  verifications?: VerificationsDuDirect;
  /** Une confirmation posée en bulle par le cerveau (« voix_confirmer », 20/11/2026), avec ses choix à toucher. */
  question?: QuestionDuDirect;
  /** Ce que Jarvis a PRODUIT (carte proposée, image, document…) : le message qui le porte, rendu dans la bulle (20/11/2026). */
  production?: { messageId: string };
}

export interface QuestionDuDirect {
  id: string;
  question: string;
  choix: string[];
  /** Le choix touché, ou « dite » quand la réponse est venue de la voix. */
  reponse?: string;
}

/*
 * JARVIS TRAVAILLE PENDANT LA VEILLE (décision de l'utilisateur, 20/11/2026) : la voix est coupée, le cerveau finit son
 * travail ; le bouton du coin montre un rond de chargement tant que dure ce travail (`jarvis-natif.tsx`).
 */
let travailEnVeille = false;
const abonnesDuTravail = new Set<() => void>();
function poserLeTravailEnVeille(valeur: boolean): void {
  if (travailEnVeille === valeur) return;
  travailEnVeille = valeur;
  for (const f of abonnesDuTravail) f();
}
export function useTravailEnVeille(): boolean {
  return React.useSyncExternalStore(
    (f) => {
      abonnesDuTravail.add(f);
      return () => abonnesDuTravail.delete(f);
    },
    () => travailEnVeille,
    () => false,
  );
}

export interface DirectCodex {
  etat: EtatDuDirect;
  erreur: string | null;
  voix: string | null;
  /** L'agent qui porte la session, dit par le démon (l'assistant quand aucune cible n'a été donnée). */
  agentId: string | null;
  /** Jarvis rédige la synthèse pour le champ de cet agent (la conversation est déjà close). */
  redaction: string | null;
  fil: TourDuDirect[];
  /** Le navigateur a bloqué la lecture du son : un geste le rallume. */
  sonBloque: boolean;
  activerLeSon: () => void;
}

/** Combien de tours le module garde à l'écran (le fil entier est gardé dans la mémoire, côté démon). */
const TOURS_A_L_ECRAN = 60;

/* Les deux analyseurs des ondes : ce que j'entends dire (micro) et ce que dit Codex (son reçu). */
let analyseurMicro: AnalyserNode | null = null;
let donneesMicro: Uint8Array | null = null;
let analyseurVoix: AnalyserNode | null = null;
let donneesVoix: Uint8Array | null = null;

/**
 * QUI PARLE DANS LE DIRECT, pour la COULEUR des ondes du volet (16/11/2026) : « jarvis » quand sa voix s'entend
 * (bleu), « vous » quand le micro porte une parole (jaune), `null` dans le silence. Les niveaux suivent : ceux de la
 * voix qui parle, sinon ceux du micro.
 */
export function niveauxEtVoixDuDirect(nombre: number): { niveaux: number[] | null; qui: 'jarvis' | 'vous' | null } {
  const voix = lireNiveaux(analyseurVoix, donneesVoix, nombre);
  if (voix && voix.some((n) => n > 0.04)) return { niveaux: voix, qui: 'jarvis' };
  const micro = lireNiveaux(analyseurMicro, donneesMicro, nombre);
  if (micro && micro.some((n) => n > 0.08)) return { niveaux: micro, qui: 'vous' };
  return { niveaux: micro ?? voix, qui: null };
}

/** La voix de Codex s'entend-elle en ce moment ? (Le silence qui remet en veille se mesure aussi sur elle.) */
export function voixDuDirectEntendue(): boolean {
  const voix = lireNiveaux(analyseurVoix, donneesVoix, 8);
  return !!voix && voix.some((n) => n > 0.04);
}

/** L'offre WebRTC complète (candidats rassemblés, trois secondes au plus). */
async function offreComplete(pc: RTCPeerConnection): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>((fini) => {
    if (pc.iceGatheringState === 'complete') return fini();
    const minuterie = window.setTimeout(fini, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        window.clearTimeout(minuterie);
        fini();
      }
    });
  });
  return pc.localDescription?.sdp ?? '';
}

/** Attend l'ouverture du canal de données du direct (ou la fin du délai : le direct marche quand même). */
function canalOuvert(canal: RTCDataChannel, delaiMs: number): Promise<void> {
  if (canal.readyState === 'open') return Promise.resolve();
  return new Promise((fini) => {
    const minuterie = window.setTimeout(fini, delaiMs);
    canal.addEventListener('open', () => {
      window.clearTimeout(minuterie);
      fini();
    }, { once: true });
  });
}

/**
 * POURQUOI LA CONVERSATION SE FERME, dit au démon avec l'arrêt (18/11/2026) : l'appel du 18/11 au matin s'est fermé
 * trois fois sans que le journal dise pourquoi. Chaque geste qui ferme pose sa raison juste avant ; un démontage sans
 * raison posée (page rechargée, écran quitté) le dit aussi.
 */
let pageQuittee = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    pageQuittee = true;
  });
}

/** Le temps laissé au salut avant que ce qui a été dit pendant la connexion parte quand même. */
const SALUT_MAX_MS = 5000;

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : t('Le direct avec Codex n’a pas pu s’ouvrir.');
}

/** Le repère de la dernière étape d'une liste : « Je recoupe les réponses » (`…:recoupe`). */
const estLeRecoupement = (etape: ActiviteDuDirect) => etape.id.endsWith(':recoupe');

/**
 * Range une étape dans la liste de SA phrase : mise à jour en place (en gardant ce qu'on savait d'elle), ou ajoutée
 * juste avant « Je recoupe les réponses », qui reste la dernière. Une liste neuve se pose à la suite du fil.
 */
export function listeApres(fil: TourDuDirect[], phrase: string, etape: ActiviteDuDirect, prochainId: () => number): TourDuDirect[] {
  const suite = [...fil];
  for (let k = suite.length - 1; k >= 0; k -= 1) {
    const liste = suite[k].verifications;
    if (liste?.phrase !== phrase) continue;
    const etapes = [...liste.etapes];
    const i = etapes.findIndex((e) => e.id === etape.id);
    if (i >= 0) {
      const avant = etapes[i]!;
      etapes[i] = { ...etape, ...(avant.agit ? { agit: true } : {}), ...(!etape.resultat && avant.resultat ? { resultat: avant.resultat } : {}) };
    } else {
      const fin = etapes.findIndex(estLeRecoupement);
      if (fin >= 0 && !estLeRecoupement(etape)) etapes.splice(fin, 0, etape);
      else etapes.push(etape);
    }
    suite[k] = { ...suite[k], verifications: { phrase, etapes } };
    return suite;
  }
  suite.push({ id: prochainId(), le: Date.now(), role: 'assistant', texte: '', final: true, projets: [], verifications: { phrase, etapes: [etape] } });
  return suite.slice(-TOURS_A_L_ECRAN);
}

/** Range une nouvelle du démon dans le fil. Règle pure, exportée pour être testée par les contrôles. */
export function filApres(fil: TourDuDirect[], evenement: any, prochainId: () => number): TourDuDirect[] {
  if (evenement?.type === 'voix.direct.tour') {
    // Une étape que Beluga a fait dire à la voix : déjà cochée dans la liste, elle n'a pas de bulle.
    if (evenement.annonce) return fil;
    const role = evenement.role === 'user' ? 'user' : 'assistant';
    const suite = [...fil];
    let i = -1;
    for (let k = suite.length - 1; k >= 0; k -= 1) {
      if (suite[k].role === role && !suite[k].final && !suite[k].tache && !suite[k].action && !suite[k].activite && !suite[k].verifications) {
        i = k;
        break;
      }
    }
    const tour: TourDuDirect = {
      id: i >= 0 ? suite[i].id : prochainId(),
      le: i >= 0 ? suite[i].le : Date.now(),
      role,
      texte: String(evenement.texte ?? ''),
      final: !!evenement.final,
      projets: Array.isArray(evenement.projets) ? evenement.projets : [],
      ...(typeof evenement.sources === 'number' ? { sources: evenement.sources } : {}),
      ...(evenement.avancement ? { avancement: true } : {}),
    };
    if (!tour.texte) return fil;
    if (i >= 0) suite[i] = tour;
    else suite.push(tour);
    /* Une réponse DITE à voix haute tranche la confirmation en attente : ses choix se referment. */
    if (role === 'user' && tour.final) {
      for (let k = 0; k < suite.length; k += 1) if (suite[k].question && !suite[k].question!.reponse) suite[k] = { ...suite[k], question: { ...suite[k].question!, reponse: 'dite' } };
    }
    return suite.slice(-TOURS_A_L_ECRAN);
  }
  /* UNE ACTION DE JARVIS À L'ÉCRAN — de CET onglet seulement : son encadré se met à jour en place, geste par geste. */
  if (evenement?.type === 'voix.direct.action') {
    if (evenement.client !== ID_DE_L_ONGLET) return fil;
    const action: ActionDuDirect = {
      id: String(evenement.id),
      titre: String(evenement.titre ?? ''),
      statut: evenement.statut,
      gestes: Array.isArray(evenement.gestes) ? evenement.gestes : [],
      ...(evenement.erreur ? { erreur: String(evenement.erreur) } : {}),
    };
    const suite = [...fil];
    for (let k = suite.length - 1; k >= 0; k -= 1) {
      if (suite[k].action?.id === action.id) {
        suite[k] = { ...suite[k], action };
        return suite;
      }
    }
    suite.push({ id: prochainId(), le: Date.now(), role: 'assistant', texte: '', final: true, projets: [], action });
    return suite.slice(-TOURS_A_L_ECRAN);
  }
  if (evenement?.type === 'voix.direct.tache') {
    const tache: TacheDuDirect = {
      titre: String(evenement.titre ?? ''),
      projet: evenement.projet,
      niveau: evenement.niveau,
      moteur: evenement.moteur,
      modele: evenement.modele,
      reflexion: evenement.reflexion,
      etat: evenement.etat,
    };
    const suite = [...fil];
    // Une tâche créée ou lancée met à jour l'encadré de la même tâche, sans en poser un second.
    if (tache.etat !== 'proposee') {
      for (let k = suite.length - 1; k >= 0; k -= 1) {
        const avant = suite[k].tache;
        if (avant && avant.titre === tache.titre) {
          suite[k] = { ...suite[k], tache: { ...avant, etat: tache.etat } };
          return suite;
        }
      }
    }
    suite.push({ id: prochainId(), le: Date.now(), role: 'assistant', texte: '', final: true, projets: tache.projet ? [tache.projet] : [], tache });
    return suite.slice(-TOURS_A_L_ECRAN);
  }
  /* UNE CONFIRMATION EN BULLE (20/11/2026) : posée, puis tranchée en place quand un choix est touché. */
  if (evenement?.type === 'voix.direct.question') {
    const id = String(evenement.id ?? '');
    if (!id) return fil;
    const suite = [...fil];
    for (let k = suite.length - 1; k >= 0; k -= 1) {
      if (suite[k].question?.id === id) {
        suite[k] = { ...suite[k], question: { ...suite[k].question!, ...(evenement.reponse ? { reponse: String(evenement.reponse) } : {}) } };
        return suite;
      }
    }
    if (evenement.reponse) return fil;
    const question: QuestionDuDirect = { id, question: String(evenement.question ?? ''), choix: Array.isArray(evenement.choix) ? evenement.choix.map(String) : [] };
    suite.push({ id: prochainId(), le: Date.now(), role: 'assistant', texte: '', final: true, projets: [], question });
    return suite.slice(-TOURS_A_L_ECRAN);
  }
  /* CE QUE JARVIS PRODUIT (carte, image, document) se lit DANS LES BULLES, plus dans le volet (20/11/2026). */
  if (evenement?.type === 'voix.direct.production') {
    const messageId = typeof evenement.messageId === 'string' ? evenement.messageId : '';
    if (!messageId || fil.some((tour) => tour.production?.messageId === messageId)) return fil;
    return [...fil, { id: prochainId(), le: Date.now(), role: 'assistant' as const, texte: '', final: true, projets: [], production: { messageId } }].slice(-TOURS_A_L_ECRAN);
  }
  /* CE QUE JARVIS FAIT, EN DIRECT (16/11/2026) : chaque appel d'outil pose sa ligne, mise à jour en place à sa fin. */
  if (evenement?.type === 'voix.direct.activite') {
    const activite: ActiviteDuDirect = {
      id: String(evenement.id ?? ''),
      libelle: String(evenement.libelle ?? ''),
      etat: evenement.etat === 'finie' || evenement.etat === 'echec' || evenement.etat === 'a-venir' ? evenement.etat : 'en-cours',
      ...(evenement.agit ? { agit: true } : {}),
      ...(typeof evenement.resultat === 'string' && evenement.resultat ? { resultat: evenement.resultat } : {}),
    };
    if (!activite.id || !activite.libelle) return fil;
    if (typeof evenement.phrase === 'string' && evenement.phrase) return listeApres(fil, evenement.phrase, activite, prochainId);
    const suite = [...fil];
    for (let k = suite.length - 1; k >= 0; k -= 1) {
      if (suite[k].activite?.id === activite.id) {
        // La fin d'une activité garde ce qu'on savait d'elle au départ (« agit »).
        suite[k] = { ...suite[k], activite: { ...activite, ...(suite[k].activite?.agit ? { agit: true } : {}) } };
        return suite;
      }
    }
    suite.push({ id: prochainId(), le: Date.now(), role: 'assistant', texte: '', final: true, projets: [], activite });
    return suite.slice(-TOURS_A_L_ECRAN);
  }
  return fil;
}

/**
 * Le direct tant que `actif` est vrai. Rien ne démarre tout seul : `actif` vient du module (mot de réveil, toucher
 * sur les ondes), éteint à chaque ouverture de l'application. `entree` est le micro du réveil
 * (`lib/mot-de-reveil.ts`) : quand il est là, le direct l'EMPRUNTE (même prise, piste qui rejoue ce qui a été dit
 * après le mot) au lieu d'ouvrir le sien. Fermer le direct, c'est TOUT fermer : connexion, canal, session du démon ;
 * aucune reconnexion automatique ne le relance.
 */
export function useDirectCodex(actif: boolean, entree: EntreeDuDirect | null = null, cible: string | null = null): DirectCodex {
  const [etat, setEtat] = React.useState<EtatDuDirect>('eteint');
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [voix, setVoix] = React.useState<string | null>(null);
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [redaction, setRedaction] = React.useState<string | null>(null);
  const [fil, setFil] = React.useState<TourDuDirect[]>([]);
  const [sonBloque, setSonBloque] = React.useState(false);
  const idRef = React.useRef(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  /** Jarvis a-t-il déjà dit quelque chose dans cette session ? (Le contrôle de la réponse au salut le lit.) */
  const aReponduRef = React.useRef(false);

  // Les nouvelles du démon : le fil, les tâches, l'état et les pannes.
  React.useEffect(() => {
    const recevoir = (e: Event) => {
      const evenement = (e as CustomEvent).detail;
      /* LA SYNTHÈSE DE FIN (17/11/2026) : ajoutée à la suite du brouillon du champ de son agent, jamais envoyée. */
      if (evenement?.type === 'voix.direct.synthese') {
        /* UN AJOUT DE JARVIS DANS LA DEMANDE D'UNE CARTE (« carte_demande ») : l'onglet de la voix seul l'écrit, tout de suite. */
        if (evenement.ajout) {
          if (!evenement.client || evenement.client === ID_DE_L_ONGLET) recevoirLaSynthese(String(evenement.agentId ?? ''), String(evenement.texte ?? ''), undefined, true);
          return;
        }
        /* PLUS DE SYNTHÈSE DE FIN (décision de l'utilisateur, 20/11/2026) : Jarvis se tait, le champ n'est pas touché. */
        return;
      }
      /* LA CARTE CRÉÉE À LA VOIX s'ouvre sur l'écran principal (20/11/2026) — l'écran qui tient la conversation. */
      if (evenement?.type === 'voix.direct.ouvrir') {
        window.dispatchEvent(new CustomEvent('beluga:ouvrir-carte-de-jarvis', { detail: { cardId: evenement.cardId, projectId: evenement.projectId } }));
        return;
      }
      /* LE TRAVAIL FAIT PENDANT LA VEILLE EST FINI : la conversation se rouvre, Jarvis dit le résultat. */
      if (evenement?.type === 'voix.direct.reprendre') {
        poserLeTravailEnVeille(false);
        window.dispatchEvent(new CustomEvent(EVENEMENT_PARLER_A_JARVIS, { detail: { agentId: null, reprise: true } }));
        return;
      }
      if (evenement?.type === 'voix.direct') {
        if (evenement.etat === 'veille-au-travail') {
          poserLeTravailEnVeille(true);
          return;
        }
        if (evenement.etat === 'arrete') {
          setRedaction(null);
          poserLeTravailEnVeille(false);
          return;
        }
        if (evenement.etat === 'en-direct') poserLeTravailEnVeille(false);
        if (evenement.etat === 'erreur') {
          setEtat('erreur');
          setErreur(evenement.message ?? t('Le direct avec Codex s’est interrompu.'));
        } else if (evenement.etat === 'en-direct') {
          // L'état « à l'écoute » est posé par l'ouverture elle-même, une fois le canal ouvert (jamais avant).
          setErreur(null);
          if (evenement.voix) setVoix(evenement.voix);
          if (evenement.agentId) setAgentId(evenement.agentId);
        }
        return;
      }
      if (evenement?.type === 'voix.direct.tour' && evenement.role === 'assistant') aReponduRef.current = true;
      setFil((f) => filApres(f, evenement, () => (idRef.current += 1)));
    };
    window.addEventListener(EVENEMENT_VOIX_DIRECTE, recevoir);
    return () => window.removeEventListener(EVENEMENT_VOIX_DIRECTE, recevoir);
  }, []);

  /* Une rédaction qui ne revient jamais (démon coupé) ne laisse pas « Jarvis rédige… » affiché pour toujours. */
  React.useEffect(() => {
    if (!redaction) return;
    const minuterie = window.setTimeout(() => setRedaction(null), 45_000);
    return () => window.clearTimeout(minuterie);
  }, [redaction]);

  React.useEffect(() => {
    if (!actif) {
      setEtat('eteint');
      setErreur(null);
      return;
    }
    // UNE SESSION NEUVE, DES BULLES NEUVES : le fil d'avant ne se mélange pas à celui-ci.
    setFil([]);
    setAgentId(cible);
    let vivant = true;
    let prise: PriseMicro | null = null;
    let pc: RTCPeerConnection | null = null;
    let contexteVoix: AudioContext | null = null;
    const audio = new Audio();
    audio.autoplay = true;
    audioRef.current = audio;
    setEtat('connexion');
    setErreur(null);
    setSonBloque(false);
    aReponduRef.current = false;
    /* OUVERTE D'UN GESTE, TOUT CE QUI EST DIT DÈS MAINTENANT EST GARDÉ (décision du 17/11/2026) : sur l'appareil, puis
       transmis dès que la ligne est ouverte — on n'attend plus que Jarvis soit là pour parler. */
    entree?.preparer();
    const parReveil = entree?.parReveil() ?? false;
    const debut = Date.now();
    let controle: number | null = null;
    let signale = false;

    const renoncer = (texte: string, refus = false) => {
      if (!vivant) return;
      setEtat(refus ? 'refusee' : 'erreur');
      setErreur(texte);
      client.pushToast('error', texte);
    };
    /* LA TRACE D'UNE CONVERSATION MUETTE (17/11/2026) : ce que le micro mesurait, pour savoir tout de suite ce qui a
       coincé — jamais un mot de ce qui a été dit. Une seule par conversation. */
    const signaler = (message: string, mesure?: MesureDuMicro, appelDemande?: boolean) => {
      if (signale) return;
      signale = true;
      signalerErreur({
        source: 'voix',
        message,
        pile: JSON.stringify({
          plateforme: plateformeNative() ?? 'navigateur',
          parReveil,
          appelDemande: appelDemande ?? null,
          depuisMs: Date.now() - debut,
          ...(mesure ?? {}),
          pisteSortante: entree ? { muted: entree.piste.muted, readyState: entree.piste.readyState, enabled: entree.piste.enabled } : null,
        }),
      });
    };

    const demarrer = async () => {
      if (typeof RTCPeerConnection === 'undefined') {
        renoncer(t('Ce navigateur ne sait pas tenir une conversation en direct.'));
        return;
      }
      let flux: MediaStream;
      if (entree) {
        // Le micro du réveil, emprunté : il reste ouvert après la conversation, pour l'attente du mot.
        flux = entree.flux;
        analyseurMicro = entree.analyseur;
        donneesMicro = new Uint8Array(entree.analyseur.frequencyBinCount);
      } else {
        try {
          prise = await ouvrirMicro('conversation en direct');
        } catch {
          renoncer(t('Micro refusé : autorisez le micro pour parler à Codex.'), true);
          return;
        }
        if (!vivant) {
          prise.fermer();
          return;
        }
        flux = prise.flux;
        // Les ondes du micro, branchées sur la prise : elle refermera le contexte avec le flux.
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(prise.flux);
          const analyseur = ctx.createAnalyser();
          analyseur.fftSize = 64;
          source.connect(analyseur);
          prise.brancher(ctx, source);
          analyseurMicro = analyseur;
          donneesMicro = new Uint8Array(analyseur.frequencyBinCount);
        } catch {
          /* sans ondes, le direct marche quand même */
        }
      }
      pc = new RTCPeerConnection();
      const piste = entree ? entree.piste : flux.getAudioTracks()[0];
      if (piste) pc.addTrack(piste, flux);
      const canal = pc.createDataChannel('oai-events');
      pc.ontrack = ({ streams }) => {
        const flux = streams[0];
        if (!flux) return;
        audio.srcObject = flux;
        void audio.play().catch(() => vivant && setSonBloque(true));
        try {
          contexteVoix = new AudioContext();
          const analyseur = contexteVoix.createAnalyser();
          analyseur.fftSize = 64;
          contexteVoix.createMediaStreamSource(flux).connect(analyseur);
          analyseurVoix = analyseur;
          donneesVoix = new Uint8Array(analyseur.frequencyBinCount);
        } catch {
          /* sans ondes de la voix */
        }
      };
      pc.onconnectionstatechange = () => {
        if (!vivant || !pc) return;
        if (pc.connectionState === 'failed') renoncer(t('La connexion du direct a été perdue.'));
      };
      try {
        const offre = await offreComplete(pc);
        if (!vivant) return;
        // L'onglet se nomme : c'est sur LUI, et sur lui seul, que Jarvis jouera ses gestes à l'écran.
        const reponse = await client.call<{ sdp: string; voix: string; agentId?: string; appel?: boolean }>(
            // `appel` : le salut est voulu — à CHAQUE ouverture voulue, mot de réveil compris (18/11/2026).
          { type: 'voix.direct.demarrer', sdp: offre, client: ID_DE_L_ONGLET, ...(cible ? { agentId: cible } : {}), appel: true },
          70_000,
        );
        if (!vivant || !pc) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: reponse.sdp });
        setVoix(reponse.voix);
        if (reponse.agentId) setAgentId(reponse.agentId);
        /* L'ÉCOUTE RÉELLE (17/11/2026) : réponse acceptée, micro branché ET canal ouvert — c'est là, et pas avant, que
           le cercle de chargement se transforme en onde (`MorphingDeLaVoix`). Cinq secondes au plus d'attente. */
        await canalOuvert(canal, 5000);
        if (!vivant || !pc) return;
        /* LE SALUT À CHAQUE OUVERTURE VOULUE (décision du 18/11/2026) : « Salut <prénom>, je t'écoute. », dit par Jarvis
           de sa propre voix sur une consigne que le démon glisse (`voix.direct.saluer`) — même quand une demande a déjà
           été dite. Ce qui a été dit pendant la connexion part APRÈS le salut : sinon il lui couperait la parole. */
        const saluer = !!reponse.appel;
        setEtat('ecoute');
        if (saluer) {
          const salut = await client.call<{ ok: boolean }>({ type: 'voix.direct.saluer' }).catch(() => ({ ok: false }));
          if (!vivant) return;
          if (salut.ok) {
            // Le salut est dit et la voix s'est tue (ou il tarde) : la piste peut porter le son.
            const debutDuSalut = Date.now();
            let silence = 0;
            while (vivant && Date.now() - debutDuSalut < SALUT_MAX_MS) {
              await new Promise((r) => window.setTimeout(r, 120));
              silence = aReponduRef.current && !voixDuDirectEntendue() ? silence + 1 : 0;
              if (silence >= 3) break;
            }
            if (!vivant) return;
          } else signaler('conversation vocale : le salut n’a pas pu partir', entree?.mesurer(), true);
        }
        // La piste porte enfin le son : le mot de réveil et sa suite, ou ce qui a été dit depuis le geste, puis le micro réel.
        entree?.commencer();
        /* LE CONTRÔLE DE VIE (17/11/2026) : plus jamais « je t'écoute » quand rien ne part. Chaque seconde, ce que le
           micro entend et ce qui part sont mesurés (`creerControleDeVie`) : un son coupé se relance, une panne qui dure
           se DIT dans la bulle et laisse une trace au serveur ; un salut sans réponse aussi. Se taire n'est jamais une
           panne. */
        const vie = creerControleDeVie();
        const ouverteLe = Date.now();
        controle = window.setInterval(() => {
          if (!vivant) return;
          if (entree) {
            const mesure = entree.mesurer();
            const verdict = vie.juger(mesure);
            if (verdict === 'relancer') entree.relancer();
            else if (verdict === 'panne') {
              if (controle !== null) window.clearInterval(controle);
              signaler(`conversation vocale muette : ${vie.raison()}`, mesure, saluer);
              renoncer(t('Le micro ne transmet rien à Jarvis. Arrêtez puis relancez la conversation.'));
              return;
            }
          }
          if (saluer && !aReponduRef.current && !voixDuDirectEntendue() && Date.now() - ouverteLe > REPONSE_A_L_APPEL_MAX_MS) {
            if (controle !== null) window.clearInterval(controle);
            signaler('conversation vocale : Jarvis n’a pas répondu à l’appel', entree?.mesurer(), true);
            renoncer(t('Jarvis ne répond pas. Arrêtez puis relancez la conversation.'));
          }
        }, 1000);
      } catch (err) {
        renoncer(message(err));
      }
    };
    void demarrer();

    return () => {
      vivant = false;
      if (controle !== null) window.clearInterval(controle);
      entree?.finir();
      const raison = prendreLaRaisonDeFermeture() ?? (pageQuittee ? 'page quittée ou rechargée' : document.visibilityState === 'hidden' ? 'écran caché' : 'conversation démontée');
      /* La MISE EN VEILLE garde le travail du cerveau en cours (20/11/2026) : le démon ne coupe que la voix. */
      void client.call({ type: 'voix.direct.arreter', raison, ...(/silence|veille/.test(raison) ? { garderLeTravail: true } : {}) }).catch(() => undefined);
      try {
        pc?.close();
      } catch {
        /* déjà fermée */
      }
      prise?.fermer();
      audio.srcObject = null;
      if (contexteVoix && contexteVoix.state !== 'closed') void contexteVoix.close().catch(() => undefined);
      analyseurMicro = null;
      donneesMicro = null;
      analyseurVoix = null;
      donneesVoix = null;
      audioRef.current = null;
    };
  }, [actif, entree, cible]);

  const activerLeSon = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => setSonBloque(false)).catch(() => undefined);
  }, []);

  return { etat, erreur, voix, agentId, redaction, fil, sonBloque, activerLeSon };
}

/**
 * LA SYNTHÈSE ARRIVE AU CHAMP DE SON AGENT : à la suite du brouillon, une ligne vide entre les deux, curseur en fin —
 * jamais à sa place, jamais envoyée. Champ démonté (la carte a été quittée) : elle s'écrit dans son brouillon retenu,
 * qu'on retrouve en revenant. Un échec se dit ; « rien à coller » ne touche à rien.
 */
export function recevoirLaSynthese(agentId: string, texte: string, erreur?: string, ajoutDeJarvis = false): void {
  if (erreur) {
    client.pushToast('error', erreur);
    return;
  }
  if (!agentId || !texte.trim()) return;
  if (joindreAuChamp({ agentId, ajout: texte.trim(), separation: '\n\n' })) return;
  const cle = `draft.${agentId}`;
  writePref(cle, brouillonApresSynthese(readPref<string>(cle, ''), texte));
  if (!ajoutDeJarvis) client.pushToast('info', t('La synthèse de la conversation vocale attend dans le champ d’écriture.'));
}

/* ------------------------------------------------------------------ */
/* L'extrait d'une voix (Réglages › Voix)                               */
/* ------------------------------------------------------------------ */

let extraitEnCours: (() => void) | null = null;

/**
 * FAIT ENTENDRE UNE VOIX DU DIRECT, sans micro : le navigateur « dit » au direct une courte phrase fabriquée par la
 * voix du serveur (« Présente-toi… »), et la voix choisie répond. Un seul extrait à la fois ; un second coupe le
 * premier. Rend une fonction qui l'arrête.
 */
export async function ecouterUneVoixDuDirect(voixId: string, surFin: () => void): Promise<() => void> {
  extraitEnCours?.();
  const pc = new RTCPeerConnection();
  const ctx = new AudioContext();
  const audio = new Audio();
  audio.autoplay = true;
  let fini = false;
  const arreter = () => {
    if (fini) return;
    fini = true;
    try {
      pc.close();
    } catch {
      /* déjà fermée */
    }
    audio.srcObject = null;
    if (ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    if (extraitEnCours === arreter) extraitEnCours = null;
    surFin();
  };
  extraitEnCours = arreter;
  try {
    // La question « Présente-toi en une phrase, en disant ton nom. », enregistrée UNE FOIS dans un son fixe (la voix du
    // serveur a été retirée le 17/11/2026), devient la « parole » envoyée au direct.
    const reponse = await fetch('/sons/question-d-essai-de-voix.mp3');
    if (!reponse.ok) throw new Error(t('La question d’essai est introuvable : impossible de faire l’essai.'));
    const tampon = await ctx.decodeAudioData(await reponse.arrayBuffer());
    const destination = ctx.createMediaStreamDestination();
    const piste = destination.stream.getAudioTracks()[0];
    pc.addTrack(piste, destination.stream);
    pc.createDataChannel('oai-events');
    pc.ontrack = ({ streams }) => {
      if (streams[0]) {
        audio.srcObject = streams[0];
        void audio.play().catch(() => undefined);
      }
    };
    const offre = await offreComplete(pc);
    const r = await client.call<{ sdp: string }>({ type: 'voix.direct.extrait', sdp: offre, voix: voixId }, 60_000);
    if (fini) return arreter;
    await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
    // Une seconde de silence, la question, puis on laisse la voix répondre.
    window.setTimeout(() => {
      if (fini) return;
      const source = ctx.createBufferSource();
      source.buffer = tampon;
      source.connect(destination);
      source.start();
    }, 1000);
    window.setTimeout(arreter, 1000 + tampon.duration * 1000 + 9000);
  } catch (err) {
    arreter();
    throw err;
  }
  return arreter;
}
